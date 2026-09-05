import type { Booking } from "@prisma/client";

import { prisma } from "./prisma";
import { getIo } from "../sockets/io";
import { getPushProvider } from "./push";
import { toAmount } from "./money";

/**
 * Who gets told about a new load, and how.
 *
 * Before this existed, `POST /bookings` wrote the row and returned — nothing reached any
 * driver, and discovery was an 8-second poll that only ran while the app was open. The
 * feed itself was unfiltered, so every approved driver in the country saw every booking.
 *
 * This module is the single source of truth for eligibility. `GET /bookings/available`
 * calls the same predicate, so what a driver is notified about and what they can see in
 * the app cannot drift apart.
 */

/** Ladder used when nobody bids: try close first, then widen rather than spam. */
export const RADIUS_LADDER_KM = [15, 30, 50];

/** A position older than this is treated as unknown — a driver may be long gone. */
const LOCATION_MAX_AGE_MS = 15 * 60 * 1000;

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export type EligibleDriver = { userId: string; distanceKm: number };

/**
 * Approved + online + right truck + near enough, with a fresh position.
 *
 * Postgres here has no PostGIS, so this is a bounding-box prefilter in SQL (which can use
 * the `[isOnline, verificationStatus]` index) followed by a precise haversine pass in JS.
 * A bounding box alone over-selects at the corners by up to ~40%, which at 50km is a real
 * distance, not a rounding error.
 */
export async function findEligibleDrivers(
  booking: Pick<Booking, "vehicleType" | "pickupLat" | "pickupLng" | "driverId">,
  radiusKm: number,
): Promise<EligibleDriver[]> {
  const pickup = { lat: booking.pickupLat, lng: booking.pickupLng };

  // 1 degree of latitude is ~111km everywhere; longitude shrinks with latitude.
  const latPad = radiusKm / 111;
  const lngPad = radiusKm / (111 * Math.max(Math.cos((pickup.lat * Math.PI) / 180), 0.01));

  const candidates = await prisma.driverProfile.findMany({
    where: {
      isOnline: true,
      verificationStatus: "APPROVED",
      vehicleType: booking.vehicleType,
      locationAt: { gte: new Date(Date.now() - LOCATION_MAX_AGE_MS) },
      currentLat: { gte: pickup.lat - latPad, lte: pickup.lat + latPad },
      currentLng: { gte: pickup.lng - lngPad, lte: pickup.lng + lngPad },
    },
    select: { userId: true, currentLat: true, currentLng: true },
  });

  const eligible: EligibleDriver[] = [];
  for (const c of candidates) {
    if (c.currentLat == null || c.currentLng == null) continue;
    // Never dispatch a booking back to the driver already carrying it.
    if (booking.driverId && c.userId === booking.driverId) continue;
    const distanceKm = haversineKm(pickup, { lat: c.currentLat, lng: c.currentLng });
    if (distanceKm <= radiusKm) eligible.push({ userId: c.userId, distanceKm });
  }

  // Nearest first, so any future "offer to one driver at a time" logic has the right order.
  return eligible.sort((a, b) => a.distanceKm - b.distanceKm);
}

function money(n: unknown): string {
  const value = Number(n ?? 0);
  return Number.isFinite(value) ? `₹${Math.round(value)}` : "";
}

/**
 * Fan a new booking out to everyone eligible: socket for anyone with the app open, a
 * notification row so it survives in the Alerts tab, and a push for everyone else.
 */
export async function dispatchBooking(booking: Booking, radiusKm: number): Promise<number> {
  const drivers = await findEligibleDrivers(booking, radiusKm);
  if (drivers.length === 0) return 0;

  const title = "New load nearby";
  const body = `${booking.pickupAddress} → ${booking.dropAddress} · ${money(booking.estimatedFare)}`;
  const payload = {
    bookingId: booking.id,
    reference: booking.reference,
    pickupAddress: booking.pickupAddress,
    dropAddress: booking.dropAddress,
    vehicleType: booking.vehicleType,
    distanceKm: booking.distanceKm,
    // A Prisma Decimal serialises to a JSON *string* over the socket. The driver's load
    // popup posts this value straight back as a bid amount, where the schema requires a
    // number — so sending the raw Decimal made every Accept on that popup fail validation,
    // and the popup's catch-all swallowed the error so it looked like it had worked.
    estimatedFare: toAmount(booking.estimatedFare),
  };

  // getIo() throws before the server is wired up (and in unit tests), which must never
  // turn into a failed booking.
  rememberDispatch(booking.id, drivers.map((d) => d.userId));

  try {
    const io = getIo();
    for (const d of drivers) io.to(`user:${d.userId}`).emit("load:new", payload);
  } catch (e) {
    console.error("[dispatch] socket unavailable", e);
  }

  // Best-effort persistence and push. Neither is allowed to fail the booking that
  // triggered it — the customer's request is already accepted at this point.
  try {
    await prisma.notification.createMany({
      data: drivers.map((d) => ({
        userId: d.userId,
        title,
        body,
        type: "LOAD_NEW",
        bookingId: booking.id,
      })),
    });
  } catch (e) {
    console.error("[dispatch] could not write notifications", e);
  }

  try {
    const devices = await prisma.device.findMany({
      where: { userId: { in: drivers.map((d) => d.userId) } },
      select: { expoPushToken: true },
    });
    if (devices.length) {
      await getPushProvider().send(
        devices.map((dev) => ({
          to: dev.expoPushToken,
          title,
          body,
          data: { type: "LOAD_NEW", bookingId: booking.id },
          channelId: "loads",
        })),
      );
    }
  } catch (e) {
    console.error("[dispatch] could not push", e);
  }

  return drivers.length;
}

/**
 * Remembers who a booking was offered to, so it can be withdrawn from exactly those drivers.
 *
 * In memory rather than a table: it is only needed between a dispatch and the moment the load
 * is taken, it is rebuilt from the notification rows if the process restarts, and a booking
 * that outlives the entry falls back to the same query.
 */
const dispatchedTo = new Map<string, Set<string>>();

function rememberDispatch(bookingId: string, userIds: string[]): void {
  const existing = dispatchedTo.get(bookingId) ?? new Set<string>();
  for (const id of userIds) existing.add(id);
  dispatchedTo.set(bookingId, existing);
}

/**
 * Tell the drivers who were offered this load that it is gone, so it leaves their sheet and
 * their Rides list.
 *
 * Previously a global `io.emit`, which reached every connected socket — including every rider,
 * none of whom have a load board. That handed anyone with an account a live feed of every
 * booking id in the system as it was taken.
 */
export async function dispatchLoadTaken(bookingId: string): Promise<void> {
  try {
    const io = getIo();
    let recipients = dispatchedTo.get(bookingId);

    // Rebuilt from the durable notification rows when this process didn't do the dispatch
    // (a restart, or a re-dispatch handled by another instance).
    if (!recipients || recipients.size === 0) {
      const rows = await prisma.notification.findMany({
        where: { bookingId, type: "LOAD_NEW" },
        select: { userId: true },
      });
      recipients = new Set(rows.map((r) => r.userId));
    }

    for (const userId of recipients) io.to(`user:${userId}`).emit("load:taken", { bookingId });
    dispatchedTo.delete(bookingId);
  } catch (e) {
    console.error("[dispatch] could not announce load:taken", e);
  }
}
