/**
 * Ratings.
 *
 * A driver's average is what wins them work — it is shown on every bid card the rider chooses
 * from. So the write path needs to be as guarded as any other. Several of these cases are
 * written against the guards that should exist rather than the ones that do.
 */

import { suite, test, expect } from "../runner";
import { api } from "../http";
import { ctx, createBooking } from "../actors";
import { db } from "../db";
import { state, require as need } from "../state";

suite("ratings", "10 — Ratings", () => {
  test("10.1", "a rider can rate the driver after delivery, and the average moves", async () => {
    const bookingId = need("deliveredBookingId", "suite 07 must complete a trip first");
    const before = await db.driverProfile.findUniqueOrThrow({ where: { userId: ctx.driverA.id } });

    const res = await api("/ratings", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { bookingId, toUserId: ctx.driverA.id, stars: 5, comment: "On time, careful with the load" },
    });
    expect(res.status, "status").toBe(201);
    expect(res.body.rating.stars, "stars").toBe(5);

    const after = await db.driverProfile.findUniqueOrThrow({ where: { userId: ctx.driverA.id } });
    expect(after.ratingCount, "ratingCount incremented").toBe(before.ratingCount + 1);

    const expected = (before.ratingAvg * before.ratingCount + 5) / (before.ratingCount + 1);
    expect(after.ratingAvg, "ratingAvg recomputed").toBeCloseTo(expected, 0.0001);
  });

  test("10.2", "the rating summary endpoint reflects it", async () => {
    const res = await api(`/ratings/users/${ctx.driverA.id}/summary`, { token: ctx.rider.accessToken });
    expect(res.status, "status").toBe(200);
    expect(typeof res.body.average, "average type").toBe("number");
    expect(res.body.count, "count").toBeGreaterThan(0);
    expect(Array.isArray(res.body.recent), "recent is an array").toBe(true);
  });

  test("10.3", "stars outside 1-5, and non-integers, are refused", async () => {
    const bookingId = state.deliveredBookingId!;
    for (const stars of [0, 6, -1, 3.5, "five"]) {
      const res = await api("/ratings", {
        method: "POST",
        token: ctx.rider2.accessToken,
        body: { bookingId, toUserId: ctx.driverA.id, stars },
      });
      expect(res.status, `status for stars=${stars}`).toBe(400);
    }
  });

  test("10.4", "a missing bookingId or toUserId is refused", async () => {
    for (const body of [{ stars: 5 }, { bookingId: state.deliveredBookingId, stars: 5 }, { toUserId: ctx.driverA.id, stars: 5 }]) {
      const res = await api("/ratings", { method: "POST", token: ctx.rider.accessToken, body });
      expect(res.status, `status for ${JSON.stringify(body)}`).toBe(400);
    }
  });

  test("10.5", "rating the same booking twice must be refused, not 500", async () => {
    const bookingId = state.deliveredBookingId!;
    const res = await api("/ratings", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { bookingId, toUserId: ctx.driverA.id, stars: 1, comment: "second bite" },
    });
    expect(res.status, "status").toBe(409);
    expect(res.status, "definitely not a 500").toBeLessThan(500);
  });

  test("10.6", "a stranger must not be able to rate a trip they had no part in", async () => {
    const bookingId = state.deliveredBookingId!;
    const before = await db.driverProfile.findUniqueOrThrow({ where: { userId: ctx.driverA.id } });

    const res = await api("/ratings", {
      method: "POST",
      token: ctx.rider2.accessToken,
      body: { bookingId, toUserId: ctx.driverA.id, stars: 1, comment: "never met them" },
    });
    expect(res.status, "status").toBeOneOf([403, 404]);

    const after = await db.driverProfile.findUniqueOrThrow({ where: { userId: ctx.driverA.id } });
    expect(after.ratingCount, "average untouched").toBe(before.ratingCount);
  });

  test("10.7", "a trip that was never delivered must not be ratable", async () => {
    const open = await createBooking(ctx.rider);
    const res = await api("/ratings", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { bookingId: open.id, toUserId: ctx.driverA.id, stars: 5 },
    });
    expect(res.status, "status").toBe(409);
  });

  test("10.8", "a rating for a nonexistent booking must be refused, not 500", async () => {
    const res = await api("/ratings", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { bookingId: "clzzzzzzzzzzzzzzzzzzzzzzz", toUserId: ctx.driverA.id, stars: 5 },
    });
    expect(res.status, "status").toBeOneOf([400, 404]);
    expect(res.status, "not a 500").toBeLessThan(500);
  });

  test("10.9", "the recipient must be the counterparty on that trip", async () => {
    const bookingId = state.deliveredBookingId!;
    const res = await api("/ratings", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { bookingId, toUserId: ctx.driverB.id, stars: 1 },
    });
    expect(res.status, "status").toBeOneOf([400, 403, 409]);
  });

  test("10.10", "the driver can rate the rider back", async () => {
    // The driver app has a feedback screen but nothing navigates to it, so this direction
    // never actually happens in the shipped app. The contract works — the missing piece is
    // client-side (fix C12).
    const bookingId = state.deliveredBookingId!;
    const res = await api("/ratings", {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { bookingId, toUserId: ctx.rider.id, stars: 5, comment: "Goods ready on arrival" },
    });
    expect(res.status, "status").toBe(201);
    expect(res.body.rating.fromUserId, "fromUserId").toBe(ctx.driverA.id);
    expect(res.body.rating.toUserId, "toUserId").toBe(ctx.rider.id);
  });

  test("10.11", "ratings require authentication", async () => {
    const res = await api("/ratings", {
      method: "POST",
      body: { bookingId: state.deliveredBookingId, toUserId: ctx.driverA.id, stars: 5 },
    });
    expect(res.status, "status").toBe(401);
  });

  test("10.12", "a driver's rating is visible on their bid card", async () => {
    // This is where the average actually gets used: the rider picks from these.
    const booking = await createBooking(ctx.rider);
    await api(`/bookings/${booking.id}/bids`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { amount: Number(booking.estimatedFare) },
    });

    const res = await api(`/bookings/${booking.id}/bids`, { token: ctx.rider.accessToken });
    const bid = res.body.bids[0];
    expect(typeof bid.driver.ratingAvg, "ratingAvg type").toBe("number");
    expect(bid.driver.ratingCount, "ratingCount").toBeGreaterThan(0);
  });
});
