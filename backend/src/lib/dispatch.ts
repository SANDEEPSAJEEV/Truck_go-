import type { Booking } from "@prisma/client";

import { prisma } from "./prisma";
import { getIo } from "../sockets/io";
import { getPushProvider } from "./push";

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
    estimatedFare: booking.estimatedFare,
  };

  // getIo() throws before the server is wired up (and in unit tests), which must never
  // turn into a failed booking.
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
 * Tell every driver a load is gone.
 *
 * Broadcast rather than targeted: the set of drivers notified at dispatch time isn't
 * recorded, and a stale card that can never be bid on is worse than a redundant event.
 */
export function dispatchLoadTaken(bookingId: string): void {
  try {
    getIo().emit("load:taken", { bookingId });
  } catch (e) {
    console.error("[dispatch] socket unavailable", e);
  }
}
