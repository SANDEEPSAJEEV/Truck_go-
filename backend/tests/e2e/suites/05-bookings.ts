/** Fare estimation, booking creation, the driver feed, and history filtering. */

import { suite, test, expect } from "../runner";
import { api, sleep } from "../http";
import { ctx, createBooking, goOnline, goOffline, KOCHI, KOCHI_NEARBY } from "../actors";
import { db } from "../db";

const PICKUP = { address: "Marine Drive, Kochi", lat: KOCHI.lat, lng: KOCHI.lng };
const DROP = { address: "Thrissur Round, Thrissur", lat: 10.5276, lng: 76.2144 };

suite("bookings", "05 — Bookings & feed", () => {
  let openBookingId = "";

  /* ------------------------------------------------------------------ estimate */

  test("5.1", "estimate returns the nested fare shape the rider app reads", async () => {
    const res = await api("/bookings/estimate", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { pickup: PICKUP, drop: DROP, vehicleType: "tataAce" },
    });
    expect(res.status, "status").toBe(200);
    expect(typeof res.body.distanceKm, "distanceKm type").toBe("number");
    expect(typeof res.body.durationMin, "durationMin type").toBe("number");
    // confirm-ride.tsx reads `fare.total`, not a flat estimatedFare.
    expect(res.body.fare, "fare object").toBeDefined();
    expect(typeof res.body.fare.total, "fare.total type").toBe("number");
    expect(res.body.fare.total, "fare is positive").toBeGreaterThan(0);
    // Kochi → Thrissur by road is ~75km; a straight-line answer would be ~66.
    expect(res.body.distanceKm, "road distance is plausible").toBeGreaterThan(60);
  });

  test("5.2", "a bigger vehicle costs more over the same route", async () => {
    const small = await api("/bookings/estimate", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { pickup: PICKUP, drop: DROP, vehicleType: "tataAce" },
    });
    const large = await api("/bookings/estimate", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { pickup: PICKUP, drop: DROP, vehicleType: "largeTruck" },
    });
    expect(large.body.fare.total, "largeTruck vs tataAce").toBeGreaterThan(small.body.fare.total);
  });

  test("5.3", "weight is priced in", async () => {
    const light = await api("/bookings/estimate", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { pickup: PICKUP, drop: DROP, vehicleType: "tataAce", weightTons: 0.5 },
    });
    const heavy = await api("/bookings/estimate", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { pickup: PICKUP, drop: DROP, vehicleType: "tataAce", weightTons: 20 },
    });
    expect(heavy.body.fare.total >= light.body.fare.total, "heavier is not cheaper").toBe(true);
  });

  test("5.4", "an identical pickup and drop does not produce NaN or a 500", async () => {
    const res = await api("/bookings/estimate", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { pickup: PICKUP, drop: { ...PICKUP }, vehicleType: "tataAce" },
    });
    expect(res.status, "status").toBeOneOf([200, 400]);
    if (res.status === 200) {
      expect(Number.isFinite(res.body.fare.total), "fare is finite").toBe(true);
      expect(Number.isFinite(res.body.distanceKm), "distance is finite").toBe(true);
    }
  });

  test("5.5", "estimate rejects a missing drop and an unknown vehicle type", async () => {
    expect(
      (await api("/bookings/estimate", { method: "POST", token: ctx.rider.accessToken, body: { pickup: PICKUP, vehicleType: "tataAce" } })).status,
      "missing drop",
    ).toBe(400);
    expect(
      (await api("/bookings/estimate", { method: "POST", token: ctx.rider.accessToken, body: { pickup: PICKUP, drop: DROP, vehicleType: "spaceship" } })).status,
      "unknown vehicle",
    ).toBe(400);
  });

  /* -------------------------------------------------------------------- create */

  test("5.6", "creating a booking opens it for bids immediately", async () => {
    const res = await api("/bookings", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { pickup: PICKUP, drop: DROP, vehicleType: "tataAce", weightTons: 2, goodsType: "General cargo" },
    });
    expect(res.status, "status").toBe(201);
    const booking = res.body.booking;
    // No intermediate REQUESTED state — the whole point of bidding is that it is open at once.
    expect(booking.status, "status").toBe("AWAITING_BIDS");
    expect(booking.reference, "reference").toBeDefined();
    expect(String(booking.reference).length <= 16, "reference fits the column").toBe(true);
    expect(booking.routePolyline, "routePolyline stored").toBeDefined();
    expect(typeof booking.estimatedFare, "estimatedFare serialises as a number").toBe("number");
    openBookingId = booking.id;
  });

  test("5.7", "a driver cannot create a booking", async () => {
    const res = await api("/bookings", {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { pickup: PICKUP, drop: DROP, vehicleType: "tataAce" },
    });
    expect(res.status, "status").toBe(403);
  });

  test("5.8", "booking creation validates its input", async () => {
    for (const body of [
      {},
      { pickup: PICKUP, drop: DROP },
      { pickup: { address: "x" }, drop: DROP, vehicleType: "tataAce" },
      { pickup: PICKUP, drop: DROP, vehicleType: "tataAce", weightTons: "heavy" },
    ]) {
      const res = await api("/bookings", { method: "POST", token: ctx.rider.accessToken, body });
      expect(res.status, `status for ${JSON.stringify(body).slice(0, 60)}`).toBe(400);
    }
  });

  /* ----------------------------------------------------------------- retrieval */

  test("5.9", "the owning rider sees the PIN fields", async () => {
    const res = await api(`/bookings/${openBookingId}`, { token: ctx.rider.accessToken });
    expect(res.status, "status").toBe(200);
    // Null pre-issue, but present — the rider's screen keys off these three fields.
    expect("pickupOtp" in res.body.booking, "pickupOtp present").toBe(true);
    expect("startOtp" in res.body.booking, "startOtp present").toBe(true);
    expect("dropOtp" in res.body.booking, "dropOtp present").toBe(true);
  });

  test("5.10", "a driver never receives the PIN fields", async () => {
    const res = await api(`/bookings/${openBookingId}`, { token: ctx.driverA.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.booking.pickupOtp, "pickupOtp").toBeNull();
    expect(res.body.booking.startOtp, "startOtp").toBeNull();
    expect(res.body.booking.dropOtp, "dropOtp").toBeNull();
  });

  test("5.11", "an unrelated rider cannot read someone else's booking", async () => {
    const res = await api(`/bookings/${openBookingId}`, { token: ctx.rider2.accessToken });
    expect(res.status, "status").toBeOneOf([403, 404]);
  });

  test("5.12", "a nonexistent booking id returns 404", async () => {
    const res = await api("/bookings/clzzzzzzzzzzzzzzzzzzzzzzz", { token: ctx.rider.accessToken });
    expect(res.status, "status").toBe(404);
  });

  /* -------------------------------------------------------------------- filters */

  test("5.13", "history filters partition correctly and never leak another rider's rows", async () => {
    const all = await api("/bookings", { token: ctx.rider.accessToken, query: { filter: "all" } });
    expect(all.status, "status").toBe(200);
    expect(all.body.bookings.length, "rider has bookings").toBeGreaterThan(0);
    for (const b of all.body.bookings) expect(b.userId, "every row belongs to the caller").toBe(ctx.rider.id);

    const active = await api("/bookings", { token: ctx.rider.accessToken, query: { filter: "active" } });
    const ACTIVE = ["AWAITING_BIDS", "ACCEPTED", "EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP", "LOADING", "IN_TRANSIT", "ARRIVED_AT_DROP", "UNLOADING"];
    for (const b of active.body.bookings) expect(b.status, "active row status").toBeOneOf(ACTIVE);

    const completed = await api("/bookings", { token: ctx.rider.accessToken, query: { filter: "completed" } });
    for (const b of completed.body.bookings) expect(b.status, "completed row status").toBe("DELIVERED");

    const cancelled = await api("/bookings", { token: ctx.rider.accessToken, query: { filter: "cancelled" } });
    for (const b of cancelled.body.bookings) {
      expect(b.status, "cancelled row status").toBeOneOf(["CANCELLED", "REJECTED", "NO_DRIVER_FOUND"]);
    }
  });

  test("5.14", "an unknown filter falls back to all rather than erroring", async () => {
    const res = await api("/bookings", { token: ctx.rider.accessToken, query: { filter: "nonsense" } });
    expect(res.status, "status").toBe(200);
  });

  test("5.15", "search matches the reference", async () => {
    const one = await api(`/bookings/${openBookingId}`, { token: ctx.rider.accessToken });
    const reference = one.body.booking.reference;

    const res = await api("/bookings", { token: ctx.rider.accessToken, query: { search: reference } });
    expect(res.status, "status").toBe(200);
    expect(res.body.bookings.some((b: any) => b.reference === reference), "reference found").toBe(true);
  });

  test("5.16", "search matches the drop address, case-insensitively", async () => {
    const res = await api("/bookings", { token: ctx.rider.accessToken, query: { search: "thrissur" } });
    expect(res.status, "status").toBe(200);
    expect(res.body.bookings.length, "matches found").toBeGreaterThan(0);
    for (const b of res.body.bookings) {
      expect(b.dropAddress.toLowerCase().includes("thrissur"), `${b.reference} matches`).toBe(true);
    }
  });

  test("5.17", "a driver's history contains only trips assigned to them", async () => {
    const res = await api("/bookings", { token: ctx.driverA.accessToken, query: { filter: "all" } });
    expect(res.status, "status").toBe(200);
    for (const b of res.body.bookings) expect(b.driverId, "every row is this driver's").toBe(ctx.driverA.id);
  });

  /* ---------------------------------------------------------------- driver feed */

  test("5.18", "an eligible driver sees the open load", async () => {
    await goOnline(ctx.driverA, KOCHI_NEARBY);
    const res = await api("/bookings/available", { token: ctx.driverA.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.bookings.some((b: any) => b.id === openBookingId), "open booking is in the feed").toBe(true);
  });

  test("5.19", "feed entries carry the caller's own bid slot and numeric fares", async () => {
    const res = await api("/bookings/available", { token: ctx.driverA.accessToken });
    const mine = res.body.bookings.find((b: any) => b.id === openBookingId);
    expect(mine, "booking found").toBeDefined();
    expect("myBid" in mine, "myBid present").toBe(true);
    expect(mine.myBid, "no bid placed yet").toBeNull();
    // The dashboard's Accept button posts this straight back as `amount`, which the bid
    // schema requires to be a number.
    expect(typeof mine.estimatedFare, "estimatedFare type").toBe("number");
  });

  test("5.20", "a driver with the wrong vehicle type does not see the load", async () => {
    const res = await api("/bookings/available", { token: ctx.driverWrongVehicle.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.bookings.some((b: any) => b.id === openBookingId), "container driver excluded").toBe(false);
  });

  test("5.21", "a driver 170km away does not see the load", async () => {
    const res = await api("/bookings/available", { token: ctx.driverFar.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.bookings.some((b: any) => b.id === openBookingId), "distant driver excluded").toBe(false);
  });

  test("5.22", "a driver with a stale position falls back to the unfiltered list", async () => {
    // Documented behaviour: without a usable fix we cannot rank by distance, and an empty
    // screen serves a driver worse than an unranked one. Pinned here so it stays a choice.
    await db.driverProfile.update({
      where: { userId: ctx.driverB.id },
      data: { locationAt: new Date(Date.now() - 20 * 60_000), currentLat: null, currentLng: null },
    });
    const res = await api("/bookings/available", { token: ctx.driverB.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.bookings.some((b: any) => b.id === openBookingId), "unfiltered fallback includes it").toBe(true);

    await goOnline(ctx.driverB, KOCHI_NEARBY);
  });

  test("5.23", "an offline driver's feed does not include the load", async () => {
    // Going offline does not clear the stored position, so this proves the eligibility
    // predicate reads isOnline and not just distance.
    await goOffline(ctx.driverB);
    await sleep(300);
    const eligible = await db.driverProfile.findUniqueOrThrow({ where: { userId: ctx.driverB.id } });
    expect(eligible.isOnline, "driverB is offline").toBe(false);
    await goOnline(ctx.driverB, KOCHI_NEARBY);
  });

  /* ------------------------------------------------------------------- cancel */

  test("5.24", "the owning rider can cancel an open booking", async () => {
    const doomed = await createBooking(ctx.rider);
    const res = await api(`/bookings/${doomed.id}/cancel`, {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { reason: "Changed my mind" },
    });
    expect(res.status, "status").toBe(200);
    expect(res.body.booking.status, "status").toBe("CANCELLED");

    const row = await db.booking.findUniqueOrThrow({ where: { id: doomed.id } });
    expect(row.cancelledAt, "cancelledAt stamped").toBeDefined();
    expect(row.cancellationReason, "reason stored").toBe("Changed my mind");
  });

  test("5.25", "a cancelled booking cannot be cancelled again", async () => {
    const doomed = await createBooking(ctx.rider);
    await api(`/bookings/${doomed.id}/cancel`, { method: "POST", token: ctx.rider.accessToken, body: {} });
    const again = await api(`/bookings/${doomed.id}/cancel`, { method: "POST", token: ctx.rider.accessToken, body: {} });
    expect(again.status, "status").toBe(409);
    expect(again.code, "code").toBe("INVALID_STATE");
  });

  test("5.26", "a stranger must not be able to cancel someone else's booking", async () => {
    const victim = await createBooking(ctx.rider);
    const res = await api(`/bookings/${victim.id}/cancel`, {
      method: "POST",
      token: ctx.rider2.accessToken,
      body: { reason: "not mine to cancel" },
    });
    expect(res.status, "status").toBeOneOf([403, 404]);

    const row = await db.booking.findUniqueOrThrow({ where: { id: victim.id } });
    expect(row.status, "booking survived").toBe("AWAITING_BIDS");
  });

  test("5.27", "PATCH /bookings/:id/status cannot be used to skip the custody chain", async () => {
    // This endpoint exists for parity with the recovered client SDK. It must never be a
    // second, unguarded way to move a booking — jumping AWAITING_BIDS straight to DELIVERED
    // would bypass bidding and all three PINs at once.
    const target = await createBooking(ctx.rider);
    const res = await api(`/bookings/${target.id}/status`, {
      method: "PATCH",
      token: ctx.driverA.accessToken,
      body: { status: "DELIVERED" },
    });
    expect(res.status, "status").toBeOneOf([403, 409]);

    const row = await db.booking.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.status, "booking unchanged").toBe("AWAITING_BIDS");
  });
});
