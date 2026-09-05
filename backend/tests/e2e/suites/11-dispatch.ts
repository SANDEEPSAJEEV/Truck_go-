/**
 * Dispatch — who gets told about a new load.
 *
 * Eligibility has one definition (`findEligibleDrivers`) shared by the push fan-out and the
 * driver's own feed, so "loads I was told about" and "loads I can see" cannot drift apart.
 * These cases drive both sides of that.
 */

import { suite, test, expect } from "../runner";
import { api, sleep } from "../http";
import { ctx, createBooking, goOnline, goOffline, KOCHI, KOCHI_NEARBY, RING_TWO, FAR_AWAY } from "../actors";
import { db } from "../db";
import { TestSocket } from "../socket";
import { haversineKm } from "../../../src/lib/dispatch";

suite("dispatch", "11 — Dispatch & eligibility", () => {
  test("11.1", "haversine matches real-world distances", async () => {
    // Kochi → Thrissur is ~66 km as the crow flies.
    expect(haversineKm(KOCHI, { lat: 10.5276, lng: 76.2144 }), "Kochi→Thrissur").toBeCloseTo(66, 4);
    expect(haversineKm(KOCHI, KOCHI_NEARBY), "the 5km fixture").toBeCloseTo(5, 1);
    expect(haversineKm(KOCHI, RING_TWO), "the ring-two fixture").toBeCloseTo(25, 2);
    expect(haversineKm(KOCHI, FAR_AWAY), "Kochi→Kozhikode").toBeGreaterThan(150);
    expect(haversineKm(KOCHI, KOCHI), "zero distance").toBeCloseTo(0, 0.001);
  });

  test("11.2", "a nearby eligible driver is notified over the socket", async () => {
    await goOnline(ctx.driverA, KOCHI_NEARBY);
    const socket = await TestSocket.connect("driverA-dispatch", ctx.driverA.accessToken);
    try {
      const booking = await createBooking(ctx.rider);
      const payload = await socket.waitFor("load:new", (p) => p.bookingId === booking.id);
      expect(payload.bookingId, "bookingId").toBe(booking.id);
    } finally {
      socket.close();
    }
  });

  test.known(
    "11.3",
    "load:new must carry a numeric estimatedFare",
    "dispatch sends the raw Prisma Decimal, which serialises as a JSON string — the popup's Accept then posts a string amount, zod rejects it, and load-alert-host's bare catch hides the failure. Fix A5",
    async () => {
      await goOnline(ctx.driverA, KOCHI_NEARBY);
      const socket = await TestSocket.connect("driverA-payload", ctx.driverA.accessToken);
      try {
        const booking = await createBooking(ctx.rider);
        const payload = await socket.waitFor("load:new", (p) => p.bookingId === booking.id);

        // Everything load-alert-host renders.
        expect(payload.reference, "reference").toBeDefined();
        expect(payload.pickupAddress, "pickupAddress").toBeDefined();
        expect(payload.dropAddress, "dropAddress").toBeDefined();
        expect(payload.vehicleType, "vehicleType").toBe("tataAce");
        expect(typeof payload.distanceKm, "distanceKm type").toBe("number");
        // And the one it posts straight back as a bid amount.
        expect(typeof payload.estimatedFare, "estimatedFare type").toBe("number");
      } finally {
        socket.close();
      }
    },
  );

  test("11.4", "the fare from load:new is actually usable as a bid", async () => {
    // The end the driver feels: tapping Accept on the popup must place a real bid.
    await goOnline(ctx.driverA, KOCHI_NEARBY);
    const socket = await TestSocket.connect("driverA-accept", ctx.driverA.accessToken);
    try {
      const booking = await createBooking(ctx.rider);
      const payload = await socket.waitFor("load:new", (p) => p.bookingId === booking.id);

      const res = await api(`/bookings/${payload.bookingId}/bids`, {
        method: "POST",
        token: ctx.driverA.accessToken,
        body: { amount: payload.estimatedFare },
      });
      expect(res.status, "the popup's Accept succeeds").toBe(201);
    } finally {
      socket.close();
    }
  });

  test("11.5", "a driver with the wrong vehicle is not notified", async () => {
    await goOnline(ctx.driverWrongVehicle, KOCHI_NEARBY);
    const socket = await TestSocket.connect("wrongVehicle", ctx.driverWrongVehicle.accessToken);
    try {
      const booking = await createBooking(ctx.rider);
      await socket.expectSilence("load:new", 5000, (p) => p.bookingId === booking.id);
    } finally {
      socket.close();
    }
  });

  test("11.6", "a driver outside every radius is not notified", async () => {
    await goOnline(ctx.driverFar, FAR_AWAY);
    const socket = await TestSocket.connect("farDriver", ctx.driverFar.accessToken);
    try {
      const booking = await createBooking(ctx.rider);
      await socket.expectSilence("load:new", 5000, (p) => p.bookingId === booking.id);
    } finally {
      socket.close();
    }
  });

  test("11.7", "an offline driver is not notified, even parked at the pickup", async () => {
    await goOnline(ctx.driverB, KOCHI_NEARBY);
    await goOffline(ctx.driverB);
    const socket = await TestSocket.connect("offlineDriver", ctx.driverB.accessToken);
    try {
      const booking = await createBooking(ctx.rider);
      await socket.expectSilence("load:new", 5000, (p) => p.bookingId === booking.id);
      expect(await db.notification.count({ where: { userId: ctx.driverB.id, bookingId: booking.id } }), "no row either").toBe(0);
    } finally {
      socket.close();
      await goOnline(ctx.driverB, KOCHI_NEARBY);
    }
  });

  test("11.8", "a driver whose position is 20 minutes stale is treated as unknown", async () => {
    // A position that old says nothing about where the truck is now.
    await goOnline(ctx.driverB, KOCHI_NEARBY);
    await db.driverProfile.update({
      where: { userId: ctx.driverB.id },
      data: { locationAt: new Date(Date.now() - 20 * 60_000) },
    });

    const booking = await createBooking(ctx.rider);
    const notified = await db.notification.count({ where: { userId: ctx.driverB.id, bookingId: booking.id } });
    expect(notified, "stale driver excluded").toBe(0);

    await goOnline(ctx.driverB, KOCHI_NEARBY);
  });

  test("11.9", "the bounding box does not over-select at the corners", async () => {
    // A driver diagonally placed sits inside the lat/lng box but outside the 15km circle.
    // Without the precise haversine pass they would be dispatched to.
    const cornerOffset = 14 / 111; // ~14km on each axis → ~19.8km diagonal
    const corner = { lat: KOCHI.lat + cornerOffset, lng: KOCHI.lng + cornerOffset };
    expect(haversineKm(KOCHI, corner), "the corner is beyond 15km").toBeGreaterThan(15);

    await goOnline(ctx.driverB, corner);
    const booking = await createBooking(ctx.rider);
    const notified = await db.notification.count({ where: { userId: ctx.driverB.id, bookingId: booking.id } });
    expect(notified, "corner driver excluded from ring one").toBe(0);

    await goOnline(ctx.driverB, KOCHI_NEARBY);
  });

  test("11.10", "the radius ladder widens when nobody nearby bids", async () => {
    // Everyone out of ring one; one driver at ~25km, inside ring two.
    await goOffline(ctx.driverA);
    await goOffline(ctx.driverB);
    await goOnline(ctx.driverFar, RING_TWO);

    const booking = await createBooking(ctx.rider);
    expect(
      await db.notification.count({ where: { userId: ctx.driverFar.id, bookingId: booking.id } }),
      "not reached at radius 15",
    ).toBe(0);

    // The sweep runs every 60s and only considers bookings older than 90s with no PENDING bid.
    console.log("      \x1b[2m(waiting up to 3min for the re-dispatch sweep)\x1b[0m");
    let reached = 0;
    for (let i = 0; i < 18 && reached === 0; i++) {
      await sleep(10_000);
      reached = await db.notification.count({ where: { userId: ctx.driverFar.id, bookingId: booking.id } });
    }
    expect(reached, "reached once the radius widened").toBeGreaterThan(0);

    await goOnline(ctx.driverA, KOCHI_NEARBY);
    await goOnline(ctx.driverB, KOCHI_NEARBY);
    await goOnline(ctx.driverFar, FAR_AWAY);
  });

  test("11.11", "a booking with a live bid is not re-dispatched", async () => {
    await goOnline(ctx.driverA, KOCHI_NEARBY);
    const booking = await createBooking(ctx.rider);
    await api(`/bookings/${booking.id}/bids`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { amount: Number(booking.estimatedFare) },
    });

    const before = await db.notification.count({ where: { bookingId: booking.id } });
    // A booking becomes sweep-eligible at 90s and the sweep runs every 60s, so 155s
    // guarantees at least one sweep has looked at this booking and passed it over.
    console.log("      \x1b[2m(waiting 155s to let a sweep run and decline)\x1b[0m");
    await sleep(155_000);
    const after = await db.notification.count({ where: { bookingId: booking.id } });
    expect(after, "no extra fan-out while a bid stands").toBe(before);
  });

  test("11.12", "a booking whose only bid was withdrawn is re-dispatched", async () => {
    // Regression guard: the sweep previously matched `bids: { none: {} }`, so a withdrawn
    // bid left a row behind and the booking was never re-offered to anyone.
    await goOnline(ctx.driverA, KOCHI_NEARBY);
    const booking = await createBooking(ctx.rider);
    const placed = await api(`/bookings/${booking.id}/bids`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { amount: Number(booking.estimatedFare) },
    });
    await api(`/bookings/${booking.id}/bids/${placed.body.bid.id}`, { method: "DELETE", token: ctx.driverA.accessToken });

    const withdrawn = await db.bid.findUniqueOrThrow({ where: { id: placed.body.bid.id } });
    expect(withdrawn.status, "the row is still there").toBe("WITHDRAWN");

    const before = await db.notification.count({ where: { bookingId: booking.id } });
    console.log("      \x1b[2m(waiting up to 3min for the re-dispatch sweep)\x1b[0m");
    let after = before;
    for (let i = 0; i < 18 && after === before; i++) {
      await sleep(10_000);
      after = await db.notification.count({ where: { bookingId: booking.id } });
    }
    expect(after, "re-offered after the withdrawal").toBeGreaterThan(before);
  });

  test("11.13", "accepting a bid clears the load from other drivers' feeds", async () => {
    await goOnline(ctx.driverA, KOCHI_NEARBY);
    await goOnline(ctx.driverB, KOCHI_NEARBY);
    const booking = await createBooking(ctx.rider);

    const winner = await api(`/bookings/${booking.id}/bids`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { amount: Number(booking.estimatedFare) },
    });

    const socket = await TestSocket.connect("driverB-taken", ctx.driverB.accessToken);
    try {
      await api(`/bookings/${booking.id}/bids/${winner.body.bid.id}/accept`, {
        method: "POST",
        token: ctx.rider.accessToken,
      });
      const taken = await socket.waitFor("load:taken", (p) => p.bookingId === booking.id);
      expect(taken.bookingId, "bookingId").toBe(booking.id);
    } finally {
      socket.close();
    }

    const feed = await api("/bookings/available", { token: ctx.driverB.accessToken });
    expect(feed.body.bookings.some((b: any) => b.id === booking.id), "gone from the feed").toBe(false);
  });

  test("11.14", "the driver already carrying a load is never re-offered it", async () => {
    const assigned = await db.booking.findFirst({
      where: { driverId: ctx.driverA.id, status: { not: "AWAITING_BIDS" } },
      select: { id: true },
    });
    expect(assigned, "driverA has an assigned trip").toBeDefined();

    const feed = await api("/bookings/available", { token: ctx.driverA.accessToken });
    expect(feed.body.bookings.some((b: any) => b.id === assigned!.id), "not in their own feed").toBe(false);
  });
});
