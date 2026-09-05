/**
 * Bidding — the only path by which a driver is ever assigned.
 *
 * There is deliberately no direct-claim endpoint, so the price floor and the rider's choice
 * are both enforced here or nowhere.
 */

import { suite, test, expect } from "../runner";
import { api } from "../http";
import { ctx, createBooking } from "../actors";
import { db } from "../db";
import { state } from "../state";

suite("bidding", "06 — Bidding", () => {
  let bookingId = "";
  let floor = 0;
  let driverABidId = "";

  test("6.1", "a bid at the auto-quoted fare is accepted and reaches the rider", async () => {
    const booking = await createBooking(ctx.rider);
    bookingId = booking.id;
    floor = Number(booking.estimatedFare);
    expect(floor, "the floor is a usable number").toBeGreaterThan(0);

    const res = await api(`/bookings/${bookingId}/bids`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { amount: floor, note: "Available now" },
    });
    expect(res.status, "status").toBe(201);
    expect(res.body.bid.status, "bid status").toBe("PENDING");
    expect(typeof res.body.bid.amount, "amount serialises as a number").toBe("number");
    driverABidId = res.body.bid.id;
  });

  test("6.2", "a bid below the floor is refused by the server, not just the UI", async () => {
    const res = await api(`/bookings/${bookingId}/bids`, {
      method: "POST",
      token: ctx.driverB.accessToken,
      body: { amount: Math.max(1, floor - 100) },
    });
    expect(res.status, "status").toBe(400);
    expect(res.code, "code").toBe("BELOW_FLOOR");
    expect(res.message, "message names the floor").toContain("₹");
  });

  test("6.3", "a bid a fraction of a paisa under the floor is still refused", async () => {
    // Exact decimal comparison. A float comparison here would let this through.
    const res = await api(`/bookings/${bookingId}/bids`, {
      method: "POST",
      token: ctx.driverB.accessToken,
      body: { amount: floor - 0.01 },
    });
    expect(res.status, "status").toBe(400);
    expect(res.code, "code").toBe("BELOW_FLOOR");
  });

  test("6.4", "a bid above the floor is accepted", async () => {
    const res = await api(`/bookings/${bookingId}/bids`, {
      method: "POST",
      token: ctx.driverB.accessToken,
      body: { amount: floor + 250 },
    });
    expect(res.status, "status").toBe(201);
  });

  test("6.5", "zero, negative and non-numeric amounts are refused", async () => {
    for (const amount of [0, -100, "1000", null]) {
      const res = await api(`/bookings/${bookingId}/bids`, {
        method: "POST",
        token: ctx.driverA.accessToken,
        body: { amount },
      });
      expect(res.status, `status for amount=${JSON.stringify(amount)}`).toBe(400);
    }
  });

  test("6.6", "a second bid from the same driver replaces the first, not adds to it", async () => {
    const res = await api(`/bookings/${bookingId}/bids`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { amount: floor + 50 },
    });
    expect(res.status, "status").toBe(201);

    const rows = await db.bid.findMany({ where: { bookingId, driverId: ctx.driverA.id } });
    expect(rows.length, "one row per driver per booking").toBe(1);
    expect(Number(rows[0].amount), "amount updated").toBeCloseTo(floor + 50, 0.01);
  });

  test("6.7", "an unapproved driver cannot bid", async () => {
    const res = await api(`/bookings/${bookingId}/bids`, {
      method: "POST",
      token: ctx.driverPending.accessToken,
      body: { amount: floor },
    });
    expect(res.status, "status").toBe(403);
    expect(res.code, "code").toBe("DRIVER_NOT_APPROVED");
  });

  test("6.8", "a rider cannot bid on their own booking", async () => {
    const res = await api(`/bookings/${bookingId}/bids`, {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { amount: floor },
    });
    expect(res.status, "status").toBe(403);
  });

  test("6.9", "the rider sees every bid, with the driver detail the offer card renders", async () => {
    const res = await api(`/bookings/${bookingId}/bids`, { token: ctx.rider.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.bids.length, "two bids").toBe(2);
    // Cheapest first — the rider's list is ordered by amount ascending.
    expect(res.body.bids[0].amount <= res.body.bids[1].amount, "sorted cheapest first").toBe(true);

    for (const bid of res.body.bids) {
      expect(bid.driver, "driver block").toBeDefined();
      expect(bid.driver.fullName, "fullName").toBeDefined();
      expect(bid.driver.vehicleNumber, "vehicleNumber").toBeDefined();
      // track/[id].tsx calls ratingAvg.toFixed(1) unguarded, so a null here crashes the screen.
      expect(typeof bid.driver.ratingAvg, "ratingAvg type").toBe("number");
      expect(typeof bid.driver.ratingCount, "ratingCount type").toBe("number");
    }
  });

  test("6.10", "a driver sees only their own bid, never a competitor's price", async () => {
    const res = await api(`/bookings/${bookingId}/bids`, { token: ctx.driverB.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.bids.length, "only one bid visible").toBe(1);
    expect(res.body.bids[0].driver, "no driver block for a non-owner").toBeUndefined();

    const mine = await db.bid.findFirstOrThrow({ where: { bookingId, driverId: ctx.driverB.id } });
    expect(res.body.bids[0].id, "it is their own bid").toBe(mine.id);
  });

  test("6.11", "an unrelated rider cannot read the bids", async () => {
    const res = await api(`/bookings/${bookingId}/bids`, { token: ctx.rider2.accessToken });
    expect(res.status, "status").toBe(403);
  });

  test("6.12", "a driver can withdraw their own bid", async () => {
    const scratch = await createBooking(ctx.rider);
    const placed = await api(`/bookings/${scratch.id}/bids`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { amount: Number(scratch.estimatedFare) },
    });
    const bidId = placed.body.bid.id;

    const res = await api(`/bookings/${scratch.id}/bids/${bidId}`, {
      method: "DELETE",
      token: ctx.driverA.accessToken,
    });
    expect(res.status, "status").toBe(204);

    // The row is retained, not deleted — the audit trail matters and the unique constraint
    // is what stops withdraw-then-rebid spam.
    const row = await db.bid.findUniqueOrThrow({ where: { id: bidId } });
    expect(row.status, "bid status").toBe("WITHDRAWN");
  });

  test("6.13", "a driver cannot withdraw someone else's bid", async () => {
    const res = await api(`/bookings/${bookingId}/bids/${driverABidId}`, {
      method: "DELETE",
      token: ctx.driverB.accessToken,
    });
    expect(res.status, "status").toBe(403);

    const row = await db.bid.findUniqueOrThrow({ where: { id: driverABidId } });
    expect(row.status, "bid untouched").toBe("PENDING");
  });

  test("6.14", "a rider cannot withdraw a bid", async () => {
    const res = await api(`/bookings/${bookingId}/bids/${driverABidId}`, {
      method: "DELETE",
      token: ctx.rider.accessToken,
    });
    expect(res.status, "status").toBe(403);
  });

  /* ------------------------------------------------------------------- accept */

  test("6.15", "accepting a bid assigns the driver and locks in the agreed fare", async () => {
    const res = await api(`/bookings/${bookingId}/bids/${driverABidId}/accept`, {
      method: "POST",
      token: ctx.rider.accessToken,
    });
    expect(res.status, "status").toBe(200);
    expect(res.body.booking.status, "status").toBe("ACCEPTED");
    expect(res.body.booking.driverId, "driverId").toBe(ctx.driverA.id);
    // The agreed price, not the auto-quote, is what gets charged.
    expect(res.body.booking.actualFare, "actualFare").toBeCloseTo(floor + 50, 0.01);

    const row = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.acceptedAt, "acceptedAt stamped").toBeDefined();

    state.tripBookingId = bookingId;
  });

  test("6.16", "the losing bid is marked REJECTED in the same transaction", async () => {
    const loser = await db.bid.findFirstOrThrow({ where: { bookingId, driverId: ctx.driverB.id } });
    expect(loser.status, "loser status").toBe("REJECTED");

    const winner = await db.bid.findUniqueOrThrow({ where: { id: driverABidId } });
    expect(winner.status, "winner status").toBe("ACCEPTED");
  });

  test("6.17", "an assigned booking is no longer open for bids", async () => {
    const res = await api(`/bookings/${bookingId}/bids`, {
      method: "POST",
      token: ctx.driverB.accessToken,
      body: { amount: floor + 500 },
    });
    expect(res.status, "status").toBe(409);
    expect(res.code, "code").toBe("NOT_OPEN");
  });

  test("6.18", "a second accept on the same booking is refused", async () => {
    const loser = await db.bid.findFirstOrThrow({ where: { bookingId, driverId: ctx.driverB.id } });
    const res = await api(`/bookings/${bookingId}/bids/${loser.id}/accept`, {
      method: "POST",
      token: ctx.rider.accessToken,
    });
    expect(res.status, "status").toBe(409);

    const row = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.driverId, "driver unchanged").toBe(ctx.driverA.id);
  });

  test("6.19", "two simultaneous accepts cannot both win", async () => {
    // A double-tap, or a retry after a slow response, must not assign two drivers.
    const race = await createBooking(ctx.rider);
    const amount = Number(race.estimatedFare);
    const a = await api(`/bookings/${race.id}/bids`, { method: "POST", token: ctx.driverA.accessToken, body: { amount } });
    const b = await api(`/bookings/${race.id}/bids`, { method: "POST", token: ctx.driverB.accessToken, body: { amount: amount + 10 } });

    const [first, second] = await Promise.all([
      api(`/bookings/${race.id}/bids/${a.body.bid.id}/accept`, { method: "POST", token: ctx.rider.accessToken }),
      api(`/bookings/${race.id}/bids/${b.body.bid.id}/accept`, { method: "POST", token: ctx.rider.accessToken }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses, "exactly one winner").toEqual([200, 409]);

    const row = await db.booking.findUniqueOrThrow({ where: { id: race.id } });
    expect(row.driverId, "one driver assigned").toBeOneOf([ctx.driverA.id, ctx.driverB.id]);
    const accepted = await db.bid.count({ where: { bookingId: race.id, status: "ACCEPTED" } });
    expect(accepted, "one accepted bid").toBe(1);
  });

  test("6.20", "a non-owning rider cannot accept a bid", async () => {
    const scratch = await createBooking(ctx.rider);
    const placed = await api(`/bookings/${scratch.id}/bids`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { amount: Number(scratch.estimatedFare) },
    });
    const res = await api(`/bookings/${scratch.id}/bids/${placed.body.bid.id}/accept`, {
      method: "POST",
      token: ctx.rider2.accessToken,
    });
    expect(res.status, "status").toBe(403);
  });

  test("6.21", "a driver cannot accept a bid, not even their own", async () => {
    const scratch = await createBooking(ctx.rider);
    const placed = await api(`/bookings/${scratch.id}/bids`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { amount: Number(scratch.estimatedFare) },
    });
    const res = await api(`/bookings/${scratch.id}/bids/${placed.body.bid.id}/accept`, {
      method: "POST",
      token: ctx.driverA.accessToken,
    });
    expect(res.status, "status").toBe(403);
  });

  test("6.22", "a withdrawn bid cannot be accepted", async () => {
    const scratch = await createBooking(ctx.rider);
    const placed = await api(`/bookings/${scratch.id}/bids`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { amount: Number(scratch.estimatedFare) },
    });
    await api(`/bookings/${scratch.id}/bids/${placed.body.bid.id}`, { method: "DELETE", token: ctx.driverA.accessToken });

    const res = await api(`/bookings/${scratch.id}/bids/${placed.body.bid.id}/accept`, {
      method: "POST",
      token: ctx.rider.accessToken,
    });
    expect(res.status, "status").toBe(409);
    expect(res.code, "code").toBe("NOT_AVAILABLE");
  });

  test("6.23", "a bid id from a different booking is not accepted", async () => {
    const other = await createBooking(ctx.rider);
    const res = await api(`/bookings/${other.id}/bids/${driverABidId}/accept`, {
      method: "POST",
      token: ctx.rider.accessToken,
    });
    expect(res.status, "status").toBeOneOf([404, 409]);
  });
});
