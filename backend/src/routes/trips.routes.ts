import { Router } from "express";
import { z } from "zod";
import { BookingStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { generateTripPin, sendTripPin } from "../lib/otp";
import { getIo } from "../sockets/io";
import { routeOrFallback, reverseGeocode } from "../lib/routing";
import { emitTripStatus, withOtpVisibility } from "./bookings.routes";
import {
  DRIVER_TRANSITIONS,
  STAGES,
  STATUS_TIMESTAMP,
  stageForStatus,
  stageIssuedAt,
  type OtpStage,
} from "../lib/trip-stages";

// Confirmed event, decompiled_user.js:477271 — pushed privately to the rider's own
// socket room, never to the shared trip room (the driver must not see it in advance).
// `stage` tells the rider's screen which of the three PINs this is.
function emitTripOtp(riderId: string, otp: string, stage: OtpStage) {
  getIo().to(`user:${riderId}`).emit("trip:otp", { otp, stage });
}

/**
 * Mints the PIN for whichever gate this status opens, and delivers it to the rider by
 * socket and SMS. Returns the field/value to persist, or null when the status has no gate.
 */
async function issueStagePin(status: BookingStatus, riderId: string, riderPhone: string) {
  const stage = stageIssuedAt(status);
  if (!stage) return null;
  const cfg = STAGES[stage];
  const pin = generateTripPin();
  sendTripPin(riderPhone, pin, cfg.smsLabel);
  emitTripOtp(riderId, pin, stage);
  return { field: cfg.field, pin };
}

// Mounted at /trips — confirmed as its own service surface (LIVE_OPS_BASE_URL) distinct from
// /bookings (BOOKING_API_BASE_URL), decompiled_user.js:416400-416415. This is what the driver
// app actually calls for every arrival/transit transition — there is no dedicated `/arrived`
// endpoint (decompiled_driver.js:462651-462695, `postStatus`).
export const tripsRouter = Router();

const statusSchema = z.object({
  status: z.nativeEnum(BookingStatus),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

tripsRouter.post("/:id/status", requireAuth, requireRole("DRIVER"), async (req: AuthedRequest, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const { status, lat, lng } = parsed.data;

  const existing = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!existing) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  if (existing.driverId !== req.auth!.sub) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your trip" } });
  }

  // The transition table is the single source of truth. A driver cannot skip a custody
  // gate by posting a later status directly — the gates are only crossed by PIN.
  if (DRIVER_TRANSITIONS[existing.status] !== status) {
    const gate = stageForStatus(existing.status);
    return res.status(409).json({
      error: {
        code: gate ? "AWAITING_OTP" : "INVALID_TRANSITION",
        message: gate
          ? `Enter the ${STAGES[gate].smsLabel} PIN from the customer to continue.`
          : `Cannot move from ${existing.status} to ${status}`,
      },
    });
  }

  const issued = await issueStagePin(status, existing.userId, existing.user.phone);
  const timestampField = STATUS_TIMESTAMP[status];

  const booking = await prisma.booking.update({
    where: { id: req.params.id },
    data: {
      status,
      ...(timestampField ? { [timestampField]: new Date() } : {}),
      ...(issued ? { [issued.field]: issued.pin } : {}),
    },
  });

  if (lat != null && lng != null) {
    await prisma.driverProfile
      .update({ where: { userId: req.auth!.sub }, data: { currentLat: lat, currentLng: lng, locationAt: new Date() } })
      .catch(() => {});
  }

  emitTripStatus(booking.id, booking.status);
  return res.json({ booking: withOtpVisibility(booking, req.auth!.sub) });
});

// Driver keys in the code the rider read off their own screen — decompiled_driver.js:483382,
// generalised across all three custody gates.
const verifyOtpSchema = z.object({
  otp: z.string(),
  stage: z.enum(["pickup", "start", "drop"]).optional(),
});

tripsRouter.post("/:id/verify-otp", requireAuth, requireRole("DRIVER"), async (req: AuthedRequest, res) => {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  if (existing.driverId !== req.auth!.sub) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your trip" } });
  }

  // The trip's own state decides which gate is open; a caller cannot nominate a different
  // stage to skip ahead. An explicit `stage` is honoured only when it agrees.
  const stage = stageForStatus(existing.status);
  if (!stage || (parsed.data.stage && parsed.data.stage !== stage)) {
    return res.status(409).json({
      error: { code: "INVALID_STATE", message: "There's no code to enter at this point in the trip." },
    });
  }

  const cfg = STAGES[stage];
  const expected = existing[cfg.field];
  if (!expected || expected !== parsed.data.otp) {
    return res.status(400).json({ error: { code: "INVALID_OTP", message: `${cfg.smsLabel} code is wrong` } });
  }

  const timestampField = STATUS_TIMESTAMP[cfg.nextStatus];
  // Opening one gate mints the PIN for the next one, so the rider always has the code they
  // are about to be asked for.
  const issued = await issueStagePin(cfg.nextStatus, existing.userId, (
    await prisma.user.findUniqueOrThrow({ where: { id: existing.userId }, select: { phone: true } })
  ).phone);

  const booking = await prisma.booking.update({
    where: { id: req.params.id },
    data: {
      status: cfg.nextStatus,
      ...(timestampField ? { [timestampField]: new Date() } : {}),
      // Consumed codes are cleared so they can never be replayed at a later gate.
      [cfg.field]: null,
      ...(issued ? { [issued.field]: issued.pin } : {}),
    },
  });

  emitTripStatus(booking.id, booking.status);
  return res.json({ booking: withOtpVisibility(booking, req.auth!.sub) });
});

// Rider-called resend — decompiled_user.js:478630. Only the booking's own rider can trigger
// it, and only for whichever gate is currently open.
tripsRouter.post("/:id/resend-otp", requireAuth, requireRole("USER"), async (req: AuthedRequest, res) => {
  const existing = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!existing) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  if (existing.userId !== req.auth!.sub) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your booking" } });
  }

  const stage = stageForStatus(existing.status);
  if (!stage) {
    return res.status(409).json({ error: { code: "INVALID_STATE", message: "No code to resend right now" } });
  }

  const cfg = STAGES[stage];
  const pin = generateTripPin();
  await prisma.booking.update({ where: { id: req.params.id }, data: { [cfg.field]: pin } });
  sendTripPin(existing.user.phone, pin, cfg.smsLabel);
  emitTripOtp(existing.userId, pin, stage);
  return res.status(200).json({ message: "Code resent", stage });
});

// REST fallback for the live map — the primary path is the `trip:subscribe` /
// `trip:location` socket exchange in src/sockets/liveops.ts.
tripsRouter.get("/:id/tracking", requireAuth, async (req: AuthedRequest, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { driver: { include: { driverProfile: true } } },
  });
  if (!booking) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });

  return res.json({
    status: booking.status,
    driverLocation: booking.driver?.driverProfile
      ? {
          lat: booking.driver.driverProfile.currentLat,
          lng: booking.driver.driverProfile.currentLng,
          updatedAt: booking.driver.driverProfile.locationAt,
        }
      : null,
  });
});

// Confirmed endpoint, decompiled_user.js:461944 (getLastLocation) — narrower REST
// fallback than /tracking, just the coordinates.
tripsRouter.get("/:id/location", requireAuth, async (req: AuthedRequest, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { driver: { include: { driverProfile: true } } },
  });
  if (!booking) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  const profile = booking.driver?.driverProfile;
  if (!profile?.currentLat || !profile?.currentLng) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "No location yet" } });
  }
  return res.json({ lat: profile.currentLat, lng: profile.currentLng, ts: profile.locationAt });
});

/**
 * Live ETA and the route the truck is currently driving.
 *
 * Which leg matters depends on the stage: before the goods are loaded the customer cares
 * when the truck reaches THEM, and after that, when it reaches the drop.
 *
 * Cached per trip because routing is billed per call and the map ticks far more often than
 * an ETA meaningfully changes.
 */
const etaCache = new Map<string, { at: number; payload: unknown }>();
const ETA_TTL_MS = 60_000;

const PRE_PICKUP_STATUSES = ["ACCEPTED", "EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP", "LOADING"];

tripsRouter.get("/:id/eta", requireAuth, async (req: AuthedRequest, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { driver: { include: { driverProfile: true } } },
  });
  if (!booking) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  if (booking.userId !== req.auth!.sub && booking.driverId !== req.auth!.sub) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your trip" } });
  }

  const cached = etaCache.get(booking.id);
  if (cached && Date.now() - cached.at < ETA_TTL_MS) return res.json(cached.payload);

  const profile = booking.driver?.driverProfile;
  const heading = PRE_PICKUP_STATUSES.includes(booking.status)
    ? { lat: booking.pickupLat, lng: booking.pickupLng, label: "pickup" as const }
    : { lat: booking.dropLat, lng: booking.dropLng, label: "drop" as const };

  // No GPS fix yet — fall back to the stored whole-journey estimate rather than erroring,
  // so the screen shows something truthful instead of a spinner.
  if (profile?.currentLat == null || profile?.currentLng == null) {
    const payload = {
      target: heading.label,
      etaMinutes: booking.durationMin ?? null,
      distanceKm: booking.distanceKm ?? null,
      polyline: booking.routePolyline ?? null,
      nearPlace: null,
      stale: true,
    };
    return res.json(payload);
  }

  const from = { lat: profile.currentLat, lng: profile.currentLng };
  const [route, nearPlace] = await Promise.all([
    routeOrFallback(from, { lat: heading.lat, lng: heading.lng }),
    // Piggybacks on the same 60s cache as the ETA, so a customer watching for an hour
    // costs ~60 lookups rather than one per GPS tick.
    reverseGeocode(from),
  ]);

  const payload = {
    target: heading.label,
    etaMinutes: route.durationMin,
    distanceKm: route.distanceKm,
    polyline: route.polyline,
    // Where the truck actually is, in words the customer recognises.
    nearPlace,
    stale: false,
  };
  etaCache.set(booking.id, { at: Date.now(), payload });
  return res.json(payload);
});

// Confirmed endpoint, decompiled_user.js:462031 (getCancellationPolicy) — the client
// parses `windowEndsAt` with Date.parse and counts down `secondsRemaining` itself; the
// exact window duration is a business rule we don't have (see
// reference/UNKNOWNS-AND-ASSUMPTIONS.md #2). 10 minutes from booking creation is a
// placeholder.
const FREE_CANCELLATION_WINDOW_MS = 10 * 60_000;

tripsRouter.get("/:id/cancellation-policy", requireAuth, async (req: AuthedRequest, res) => {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!booking) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  const windowEndsAt = new Date(booking.createdAt.getTime() + FREE_CANCELLATION_WINDOW_MS);
  const secondsRemaining = Math.max(0, Math.round((windowEndsAt.getTime() - Date.now()) / 1000));
  return res.json({ secondsRemaining, windowEndsAt: windowEndsAt.toISOString() });
});

// Confirmed endpoint, decompiled_user.js:462050 (cancelTrip) — a second, trip-scoped
// cancel alongside POST /bookings/:id/cancel. Both are real in the original client SDK.
const tripCancelSchema = z.object({ reason: z.string().optional() });
const TRIP_TERMINAL_STATUSES = ["DELIVERED", "CANCELLED"];

tripsRouter.post("/:id/cancel", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = tripCancelSchema.safeParse(req.body ?? {});
  const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  if (TRIP_TERMINAL_STATUSES.includes(existing.status)) {
    return res.status(409).json({ error: { code: "INVALID_STATE", message: "Booking already finished" } });
  }
  const booking = await prisma.booking.update({
    where: { id: req.params.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancellationReason: parsed.success ? parsed.data.reason : undefined,
    },
  });
  emitTripStatus(booking.id, booking.status);
  return res.json({ booking: withOtpVisibility(booking, req.auth!.sub) });
});

// Confirmed path, decompiled_user.js:463840 — chat lives under /trips/:id/messages,
// not a query-param /messages?bookingId= as we first built it.
tripsRouter.get("/:id/messages", requireAuth, async (req: AuthedRequest, res) => {
  const messages = await prisma.message.findMany({
    where: { bookingId: req.params.id },
    orderBy: { createdAt: "asc" },
  });
  return res.json({ messages });
});

tripsRouter.get("/:id/messages/unread-count", requireAuth, async (_req: AuthedRequest, res) => {
  // Chat has no per-message read state yet — placeholder until that's tracked.
  return res.json({ count: 0 });
});

const sendMessageSchema = z.object({ text: z.string().min(1) });

tripsRouter.post("/:id/messages", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const message = await prisma.message.create({
    data: { bookingId: req.params.id, senderId: req.auth!.sub, text: parsed.data.text },
  });
  getIo().to(`trip:${req.params.id}`).emit("chat:message", message);
  return res.status(201).json({ message });
});
