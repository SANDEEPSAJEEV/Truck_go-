import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { getPaymentProvider } from "../lib/payments";
import { toAmount, toDecimal } from "../lib/money";
import { getIo } from "../sockets/io";

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

function emitPaymentUpdate(userId: string, driverId: string | null, bookingId: string, status: string) {
  getIo().to(`user:${userId}`).emit("payment:update", { bookingId, status });
  if (driverId) getIo().to(`user:${driverId}`).emit("payment:update", { bookingId, status });
}

/**
 * Creates (or refreshes) the gateway order for a delivered trip.
 *
 * Rider-only, and only once the trip is actually DELIVERED — paying before delivery would
 * let the fare be settled for a shipment that was never confirmed to have arrived.
 */
paymentsRouter.post("/:bookingId/order", async (req: AuthedRequest, res) => {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.bookingId } });
  if (!booking) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  if (booking.userId !== req.auth!.sub) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your booking" } });
  }
  if (booking.status !== "DELIVERED") {
    return res.status(409).json({ error: { code: "NOT_DELIVERED", message: "Payment opens once the trip is delivered." } });
  }

  const amount = toAmount(booking.actualFare ?? booking.estimatedFare);
  if (amount == null) {
    return res.status(409).json({ error: { code: "NO_FARE", message: "This booking has no fare to charge." } });
  }

  const existing = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
  if (existing?.status === "PAID") {
    return res.status(409).json({ error: { code: "ALREADY_PAID", message: "This trip has already been paid for." } });
  }

  const provider = getPaymentProvider();
  const order = await provider.createOrder(amount, "INR", booking.reference);

  const payment = await prisma.payment.upsert({
    where: { bookingId: booking.id },
    create: {
      bookingId: booking.id,
      amount: toDecimal(amount),
      currency: order.currency,
      gatewayOrderId: order.orderId,
      status: "PENDING",
    },
    // A retry after a failed or abandoned checkout gets a fresh order rather than being
    // stuck reusing one Razorpay may have already expired.
    update: { gatewayOrderId: order.orderId, status: "PENDING", gatewayData: undefined },
  });

  return res.status(201).json({
    paymentId: payment.id,
    orderId: order.orderId,
    amount: order.amount,
    currency: order.currency,
    keyId: order.publicKeyId,
    provider: provider.name,
  });
});

/** Polling fallback for a delayed webhook — either party on the trip may check. */
paymentsRouter.get("/:bookingId", async (req: AuthedRequest, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.bookingId },
    include: { payment: true },
  });
  if (!booking) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  if (booking.userId !== req.auth!.sub && booking.driverId !== req.auth!.sub) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your trip" } });
  }

  if (!booking.payment) return res.json({ status: "NONE" });
  return res.json({
    status: booking.payment.status,
    amount: toAmount(booking.payment.amount),
    currency: booking.payment.currency,
    paidAt: booking.payment.paidAt,
  });
});

/**
 * Dev/demo-only: simulates what the real webhook does, since the mock provider has no real
 * checkout page to redirect to and therefore nothing that would ever call the webhook.
 * Refuses outright unless the mock provider is actually active — this can never fire against
 * a real Razorpay-backed payment, in dev or otherwise.
 */
paymentsRouter.post("/:bookingId/mock-complete", async (req: AuthedRequest, res) => {
  const provider = getPaymentProvider();
  if (provider.name !== "mock") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not available with a real payment provider configured." } });
  }

  const booking = await prisma.booking.findUnique({ where: { id: req.params.bookingId } });
  if (!booking) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  if (booking.userId !== req.auth!.sub) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your booking" } });
  }

  const payment = await prisma.payment.update({
    where: { bookingId: booking.id },
    data: {
      status: "PAID",
      paidAt: new Date(),
      gatewayPaymentId: `mock_pay_${Date.now()}`,
      gatewayData: { simulated: true },
    },
  });

  emitPaymentUpdate(booking.userId, booking.driverId, booking.id, "PAID");
  return res.json({ status: payment.status });
});

/**
 * The real webhook handler. Mounted directly on the Express app in index.ts with
 * `express.raw()`, BEFORE the global `express.json()` — the signature must be checked
 * against the exact bytes Razorpay sent, and re-parsing to JSON first would already have
 * lost that.
 *
 * This is the ONLY code path allowed to mark a payment PAID against a real gateway. A
 * client returning from checkout triggers a re-fetch of status, never a write — "I completed
 * checkout" from the client is not proof that a payment happened.
 */
export async function handlePaymentsWebhook(req: Request, res: Response) {
  const provider = getPaymentProvider();
  const rawBody = req.body as Buffer;
  const signature = req.header("X-Razorpay-Signature");

  if (!provider.verifyWebhookSignature(rawBody, signature)) {
    console.error("[payments] webhook signature verification failed");
    return res.status(400).json({ error: { code: "INVALID_SIGNATURE", message: "Signature verification failed" } });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: { code: "INVALID_BODY", message: "Malformed webhook body" } });
  }

  const event = provider.parseWebhookEvent(payload);
  if (!event) return res.status(200).json({ ok: true }); // an event type we don't act on — ack it anyway

  const payment = await prisma.payment.findUnique({
    where: { gatewayOrderId: event.orderId },
    include: { booking: true },
  });
  if (!payment) {
    console.error("[payments] webhook for unknown order:", event.orderId);
    return res.status(200).json({ ok: true }); // ack regardless — retrying won't make the order exist
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: event.status === "paid" ? "PAID" : "FAILED",
      paidAt: event.status === "paid" ? new Date() : null,
      gatewayPaymentId: event.paymentId,
      gatewayData: payload,
    },
  });

  emitPaymentUpdate(payment.booking.userId, payment.booking.driverId, payment.booking.id, event.status === "paid" ? "PAID" : "FAILED");
  return res.status(200).json({ ok: true });
}
