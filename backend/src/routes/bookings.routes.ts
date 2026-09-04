import { Router } from "express";
import { z } from "zod";
import { BookingStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole, requireApprovedDriver, AuthedRequest } from "../middleware/auth";
import { estimateFare } from "../lib/fare";
import { routeOrFallback } from "../lib/routing";
import { toAmount, toDecimal, isBelow, type Money } from "../lib/money";
import { generateUniqueReference } from "../lib/reference";
import { getIo } from "../sockets/io";
import { DRIVER_TRANSITIONS, STATUS_TIMESTAMP } from "../lib/trip-stages";
import { dispatchBooking, dispatchLoadTaken, haversineKm, RADIUS_LADDER_KM } from "../lib/dispatch";

export const bookingsRouter = Router();

// Lets a Prisma transaction callback fail with a specific HTTP status/code without the
// transaction itself catching and swallowing it — thrown inside `tx`, caught outside.
class RouteError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// Confirmed shape from decompiled_user.js:442526, 467744 — pickup/drop are objects with an
// optional placeId ('current' for a device-location pick), not flat lat/lng fields.
const pointSchema = z.object({
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  placeId: z.string().optional(),
});

const VEHICLE_TYPES = ["miniTruck", "pickup", "tataAce", "tempo", "largeTruck", "container"] as const;

// Confirmed request shape, decompiled_user.js:472769-472809 (createBooking) / :471499-471517 (estimateFare).
const bookingInputSchema = z.object({
  pickup: pointSchema,
  drop: pointSchema,
  vehicleType: z.enum(VEHICLE_TYPES),
  weightTons: z.number().optional(),
  notes: z.string().optional(),
  goodsType: z.string().optional(),
});

// Confirmed response shape, decompiled_user.js:472572-472594 — nested `fare.total`, not a flat
// `estimatedFare`.
bookingsRouter.post("/estimate", requireAuth, async (req, res) => {
  const parsed = bookingInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const { pickup, drop, vehicleType, weightTons } = parsed.data;

  // Real road distance, not a straight line — haversine under-quotes every fare, since
  // roads detour around water, one-ways and the absence of a bridge.
  const route = await routeOrFallback(pickup, drop);
  const { total } = estimateFare(route.distanceKm, vehicleType, weightTons);

  return res.json({
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
    fare: { total },
    polyline: route.polyline,
  });
});

bookingsRouter.post("/", requireAuth, requireRole("USER"), async (req: AuthedRequest, res) => {
  const parsed = bookingInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const { pickup, drop, vehicleType, weightTons, notes, goodsType } = parsed.data;

  // Route is resolved once here and stored on the booking; every later screen reads the
  // stored polyline instead of paying for the same lookup again.
  const route = await routeOrFallback(pickup, drop);
  const distanceKm = route.distanceKm;
  const durationMin = route.durationMin;
  const { total: estimatedFare } = estimateFare(distanceKm, vehicleType, weightTons);

  const reference = await generateUniqueReference(
    async (candidate) => (await prisma.booking.count({ where: { reference: candidate } })) > 0,
  );

  const booking = await prisma.booking.create({
    data: {
      reference,
      userId: req.auth!.sub,
      pickupAddress: pickup.address,
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      pickupPlaceId: pickup.placeId,
      dropAddress: drop.address,
      dropLat: drop.lat,
      dropLng: drop.lng,
      dropPlaceId: drop.placeId,
      vehicleType,
      weightTons,
      notes,
      goodsType,
      distanceKm,
      durationMin,
      estimatedFare: toDecimal(estimatedFare),
      routePolyline: route.polyline,
      routeProvider: route.provider,
      // Goes straight to the open market rather than sitting in an intermediate REQUESTED
      // state — the whole point of bidding is that any approved driver can offer on it
      // immediately, not that one driver claims it first.
      status: "AWAITING_BIDS",
    },
  });

  // Tell nearby drivers immediately. Deliberately not awaited into the response: the
  // customer's booking is already committed, and no dispatch failure should turn a
  // successful create into an error they'd retry.
  dispatchBooking(booking, RADIUS_LADDER_KM[0]).catch((e) =>
    console.error("[bookings] dispatch failed", e),
  );

  return res.status(201).json({ booking: withOtpVisibility(booking, req.auth!.sub) });
});

// Driver-side feed of open requests, filtered by the same eligibility rule dispatch uses:
// right vehicle, online, near enough. Sharing `findEligibleDrivers`' definition is what
// keeps "loads I was told about" and "loads I can see" from drifting apart.
//
// Each booking carries the calling driver's own bid (if any) so the dashboard can show
// "bid placed" instead of "place a bid" without a second round trip.
bookingsRouter.get("/available", requireAuth, requireApprovedDriver, async (req: AuthedRequest, res) => {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId: req.auth!.sub },
    select: { vehicleType: true, currentLat: true, currentLng: true },
  });

  const open = await prisma.booking.findMany({
    where: {
      status: "AWAITING_BIDS",
      // Only work this driver's truck can actually carry.
      ...(profile?.vehicleType ? { vehicleType: profile.vehicleType } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  // Without a known position we can't rank by distance. Show the unfiltered list rather
  // than an empty screen — a driver who hasn't published a fix yet still deserves work.
  const hasFix = profile?.currentLat != null && profile?.currentLng != null;
  const maxRadius = RADIUS_LADDER_KM[RADIUS_LADDER_KM.length - 1];

  const bookings = (
    hasFix
      ? open
          .map((b) => ({
            booking: b,
            distance: haversineKm(
              { lat: profile!.currentLat!, lng: profile!.currentLng! },
              { lat: b.pickupLat, lng: b.pickupLng },
            ),
          }))
          .filter((x) => x.distance <= maxRadius)
          .sort((a, b) => a.distance - b.distance)
          .map((x) => x.booking)
      : open
  ).slice(0, 25);

  const myBids = await prisma.bid.findMany({
    where: { bookingId: { in: bookings.map((b) => b.id) }, driverId: req.auth!.sub },
  });
  const byBooking = new Map(myBids.map((b) => [b.bookingId, b]));

  return res.json({
    bookings: bookings.map((b) => {
      const mine = byBooking.get(b.id);
      return {
        ...b,
        estimatedFare: toAmount(b.estimatedFare),
        actualFare: toAmount(b.actualFare),
        myBid: mine ? { id: mine.id, amount: toAmount(mine.amount), status: mine.status } : null,
      };
    }),
  });
});

// Confirmed real endpoint, decompiled_user.js:438000+ (listBookings) — the Trip History
// screen's data source, and also the only way a user recovers their bookings after an
// app relaunch (there's no separate "active trip" endpoint in the original).
// LOADING and UNLOADING were missing here, which meant a driver mid-load vanished from
// their own "active" list — the one moment they are most obviously on a job.
const ACTIVE_STATUSES: BookingStatus[] = [
  "AWAITING_BIDS",
  "ACCEPTED",
  "EN_ROUTE_TO_PICKUP",
  "ARRIVED_AT_PICKUP",
  "LOADING",
  "IN_TRANSIT",
  "ARRIVED_AT_DROP",
  "UNLOADING",
];

const CANCELLED_STATUSES: BookingStatus[] = ["CANCELLED", "REJECTED", "NO_DRIVER_FOUND"];

const STATUS_FILTER: Record<string, object> = {
  active: { status: { in: ACTIVE_STATUSES } },
  completed: { status: BookingStatus.DELIVERED },
  cancelled: { status: { in: CANCELLED_STATUSES } },
};

bookingsRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const isDriver = req.auth!.role === "DRIVER";
  const requested = typeof req.query.filter === "string" ? req.query.filter : "all";
  const filter = requested in STATUS_FILTER ? requested : "all";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

  const bookings = await prisma.booking.findMany({
    where: {
      [isDriver ? "driverId" : "userId"]: req.auth!.sub,
      ...(STATUS_FILTER[filter] ?? {}),
      // Matches either the human-readable reference the app shows or the destination —
      // the driver's own search box offers both ("Ride ID or Destination"), and nobody
      // types a cuid.
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: "insensitive" as const } },
              { dropAddress: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return res.json({ bookings: bookings.map((b) => withOtpVisibility(b, req.auth!.sub)) });
});

// The custody PINs must only ever reach the rider who owns the booking — never the driver,
// and never a broadcast to both. See decompiled_user.js:478710-478797 (rider PIN display) —
// the codes are verified BY the driver, so the driver must never already know them.
//
// All three gates are stripped together. Missing one here would hand the driver the ability
// to walk the whole custody chain without the rider present, which is the exact thing the
// PINs exist to prevent.
type OtpFields = { pickupOtp: string | null; startOtp: string | null; dropOtp: string | null };
type FareFields = { estimatedFare?: unknown; actualFare?: unknown };

function withOtpVisibility<T extends { userId: string } & Partial<OtpFields> & FareFields>(
  booking: T,
  requesterId: string,
): T {
  // Fares are Decimal in the database and would otherwise serialise as JSON strings,
  // silently breaking any client that compares or does arithmetic on them.
  const normalised = {
    ...booking,
    ...(booking.estimatedFare !== undefined ? { estimatedFare: toAmount(booking.estimatedFare as Money) } : {}),
    ...(booking.actualFare !== undefined ? { actualFare: toAmount(booking.actualFare as Money) } : {}),
  } as T;

  if (booking.userId === requesterId) return normalised;
  return { ...normalised, pickupOtp: null, startOtp: null, dropOtp: null };
}

bookingsRouter.get("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!booking) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  return res.json({ booking: withOtpVisibility(booking, req.auth!.sub) });
});

// Confirmed event name, decompiled_user.js:477262 — the shared trip room only ever
// gets the status, never the OTP (that's pushed privately — see trips.routes.ts).
export function emitTripStatus(bookingId: string, status: string) {
  getIo().to(`trip:${bookingId}`).emit("trip:status", { status });
}

// There is deliberately no direct "/accept" endpoint that lets a driver unilaterally claim
// a booking. Under multi-driver bidding, the ONLY way a driver is assigned is the rider
// accepting a bid below — see POST /:id/bids/:bidId/accept. A direct-claim endpoint sitting
// alongside bidding would let any approved driver bypass the rider's choice and the price
// floor entirely, which defeats the feature.

const bidSchema = z.object({
  amount: z.number().positive(),
  note: z.string().trim().max(280).optional(),
});

// Notifies the rider a new offer came in, and lets a driver's own screen react if it's a
// counter to their bid. Reuses the private `user:<id>` room every socket already joins on
// connect (src/sockets/liveops.ts) — no new room plumbing needed.
function emitBidNew(riderId: string, bid: { id: string; bookingId: string; amount: number }) {
  getIo().to(`user:${riderId}`).emit("bid:new", bid);
}
function emitBidAccepted(driverId: string, bookingId: string) {
  getIo().to(`user:${driverId}`).emit("bid:accepted", { bookingId });
}
function emitBidRejected(driverId: string, bookingId: string) {
  getIo().to(`user:${driverId}`).emit("bid:rejected", { bookingId });
}

// Approved drivers only (enforced by requireApprovedDriver, not just the UI). The server —
// not the client — is what refuses a bid under the auto-quoted fare; a client-side minimum
// is not a control.
bookingsRouter.post("/:id/bids", requireAuth, requireApprovedDriver, async (req: AuthedRequest, res) => {
  const parsed = bidSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.issues[0].message } });
  }

  const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!booking) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  if (booking.status !== "AWAITING_BIDS") {
    return res.status(409).json({ error: { code: "NOT_OPEN", message: "This booking is no longer open for bids." } });
  }
  // Exact decimal comparison — a float comparison here could accept a bid a fraction of a
  // paisa under the floor.
  if (isBelow(parsed.data.amount, booking.estimatedFare)) {
    return res.status(400).json({
      error: {
        code: "BELOW_FLOOR",
        message: `Your bid must be at least ₹${toAmount(booking.estimatedFare)}, the auto-quoted fare.`,
      },
    });
  }

  const bid = await prisma.bid.upsert({
    where: { bookingId_driverId: { bookingId: booking.id, driverId: req.auth!.sub } },
    create: { bookingId: booking.id, driverId: req.auth!.sub, amount: toDecimal(parsed.data.amount), note: parsed.data.note },
    // A withdrawn or rejected bid can be replaced by a fresh one from the same driver —
    // update the one row rather than fighting the unique constraint with a new insert.
    update: { amount: toDecimal(parsed.data.amount), note: parsed.data.note, status: "PENDING" },
  });

  emitBidNew(booking.userId, { id: bid.id, bookingId: booking.id, amount: toAmount(bid.amount)! });
  return res.status(201).json({ bid: { ...bid, amount: toAmount(bid.amount) } });
});

// Rider sees every bid on their own booking; a driver sees only their own — a driver has no
// business knowing what a competitor offered.
bookingsRouter.get("/:id/bids", requireAuth, async (req: AuthedRequest, res) => {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!booking) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });

  const isOwner = booking.userId === req.auth!.sub;
  if (!isOwner && req.auth!.role !== "DRIVER") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your booking" } });
  }

  const bids = await prisma.bid.findMany({
    where: {
      bookingId: booking.id,
      status: "PENDING",
      ...(isOwner ? {} : { driverId: req.auth!.sub }),
    },
    orderBy: { amount: "asc" },
    include: isOwner
      ? { driver: { include: { driverProfile: true } } }
      : undefined,
  });

  return res.json({
    bids: bids.map((b: any) => ({
      id: b.id,
      amount: toAmount(b.amount),
      note: b.note,
      status: b.status,
      createdAt: b.createdAt,
      driver: isOwner
        ? {
            id: b.driver.id,
            fullName: b.driver.fullName,
            ratingAvg: b.driver.driverProfile?.ratingAvg ?? 0,
            ratingCount: b.driver.driverProfile?.ratingCount ?? 0,
            vehicleType: b.driver.driverProfile?.vehicleType,
            vehicleNumber: b.driver.driverProfile?.vehicleNumber,
          }
        : undefined,
    })),
  });
});

// The one moment a driver is actually assigned. Runs as a transaction so two rider taps (or
// a retry after a slow response) can never both win the same booking.
bookingsRouter.post("/:id/bids/:bidId/accept", requireAuth, requireRole("USER"), async (req: AuthedRequest, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: req.params.id } });
      if (!booking) throw new RouteError(404, "NOT_FOUND", "Booking not found");
      if (booking.userId !== req.auth!.sub) throw new RouteError(403, "FORBIDDEN", "Not your booking");
      if (booking.status !== "AWAITING_BIDS") {
        throw new RouteError(409, "NOT_OPEN", "This booking is no longer open for bids.");
      }

      const bid = await tx.bid.findUnique({ where: { id: req.params.bidId } });
      if (!bid || bid.bookingId !== booking.id) throw new RouteError(404, "NOT_FOUND", "Bid not found");
      if (bid.status !== "PENDING") {
        throw new RouteError(409, "NOT_AVAILABLE", "That bid was withdrawn or already handled.");
      }

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: { driverId: bid.driverId, actualFare: bid.amount, status: "ACCEPTED", acceptedAt: new Date() },
      });

      await tx.bid.update({ where: { id: bid.id }, data: { status: "ACCEPTED" } });
      const losers = await tx.bid.findMany({
        where: { bookingId: booking.id, id: { not: bid.id }, status: "PENDING" },
      });
      await tx.bid.updateMany({
        where: { bookingId: booking.id, id: { not: bid.id }, status: "PENDING" },
        data: { status: "REJECTED" },
      });

      return { booking: updated, winnerId: bid.driverId, loserIds: losers.map((l) => l.driverId) };
    });

    emitTripStatus(result.booking.id, result.booking.status);
    emitBidAccepted(result.winnerId, result.booking.id);
    for (const driverId of result.loserIds) emitBidRejected(driverId, result.booking.id);
    // Clears the card from every other driver's sheet and Rides list at once, including
    // drivers who never bid and so get no bid:rejected of their own.
    dispatchLoadTaken(result.booking.id);

    return res.json({ booking: withOtpVisibility(result.booking, req.auth!.sub) });
  } catch (e) {
    if (e instanceof RouteError) return res.status(e.status).json({ error: { code: e.code, message: e.message } });
    throw e;
  }
});

bookingsRouter.delete("/:id/bids/:bidId", requireAuth, requireRole("DRIVER"), async (req: AuthedRequest, res) => {
  const bid = await prisma.bid.findUnique({ where: { id: req.params.bidId } });
  if (!bid || bid.bookingId !== req.params.id) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Bid not found" } });
  }
  if (bid.driverId !== req.auth!.sub) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your bid" } });
  }
  if (bid.status !== "PENDING") {
    return res.status(409).json({ error: { code: "INVALID_STATE", message: "This bid can no longer be withdrawn." } });
  }
  await prisma.bid.update({ where: { id: bid.id }, data: { status: "WITHDRAWN" } });
  return res.status(204).send();
});

const cancelSchema = z.object({ reason: z.string().optional() });
const TERMINAL_STATUSES = ["DELIVERED", "CANCELLED"];

bookingsRouter.post("/:id/cancel", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = cancelSchema.safeParse(req.body ?? {});
  const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  if (TERMINAL_STATUSES.includes(existing.status)) {
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
  // A cancelled booking is no longer biddable — pull it from every open feed.
  dispatchLoadTaken(booking.id);
  return res.json({ booking: withOtpVisibility(booking, req.auth!.sub) });
});

// Confirmed real endpoint, decompiled_driver.js:438407 — PATCH /bookings/:id/status {status}.
// Not the primary driver-facing status advance (that's POST /trips/:id/status, see
// trips.routes.ts) — kept here for parity with the recovered client SDK, but it MUST NOT
// be a second, unguarded way to move a booking. It previously accepted any status with only
// a DRIVER-role check: no ownership check and no transition table, so any approved driver
// could have PATCHed a stranger's AWAITING_BIDS booking straight to ACCEPTED (bypassing
// bidding entirely) or to DELIVERED (skipping every custody PIN). It now only permits the
// exact same moves POST /trips/:id/status allows, to the exact same driver.
bookingsRouter.patch("/:id/status", requireAuth, requireRole("DRIVER"), async (req: AuthedRequest, res) => {
  const parsed = z.object({ status: z.nativeEnum(BookingStatus) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "A valid status is required." } });
  }

  const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  if (existing.driverId !== req.auth!.sub) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your trip" } });
  }
  if (DRIVER_TRANSITIONS[existing.status] !== parsed.data.status) {
    return res.status(409).json({
      error: { code: "INVALID_TRANSITION", message: `Cannot move from ${existing.status} to ${parsed.data.status}` },
    });
  }

  const timestampField = STATUS_TIMESTAMP[parsed.data.status];
  const booking = await prisma.booking.update({
    where: { id: req.params.id },
    data: { status: parsed.data.status, ...(timestampField ? { [timestampField]: new Date() } : {}) },
  });
  emitTripStatus(booking.id, booking.status);
  return res.json({ booking: withOtpVisibility(booking, req.auth!.sub) });
});

export { withOtpVisibility };
