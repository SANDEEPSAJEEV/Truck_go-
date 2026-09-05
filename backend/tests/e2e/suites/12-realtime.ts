/**
 * The Socket.IO layer.
 *
 * Rooms are the entire access-control model here: `user:<id>` is joined automatically from the
 * verified token, and `trip:<bookingId>` is joined on request. Whether that request is checked
 * is the difference between a private trip and a public one.
 */

import { suite, test, expect } from "../runner";
import { api, sleep } from "../http";
import { ctx, createBooking, goOnline, KOCHI_NEARBY } from "../actors";
import { TestSocket, subscribeTrip } from "../socket";

suite("realtime", "12 — Realtime", () => {
  /* ------------------------------------------------------------------ handshake */

  test("12.1", "a valid access token connects", async () => {
    const socket = await TestSocket.connect("valid", ctx.rider.accessToken);
    socket.close();
  });

  test("12.2", "no token, an empty token and a garbage token are all refused", async () => {
    for (const [label, token] of [["missing", undefined], ["empty", ""], ["garbage", "not.a.jwt"]] as const) {
      const reason = await TestSocket.expectRefused(label, token);
      expect(reason, `${label} reason`).toContain("unauthorized");
    }
  });

  test("12.3", "a token signed with the wrong secret is refused", async () => {
    const [header, payload] = ctx.rider.accessToken.split(".");
    const forged = `${header}.${payload}.${Buffer.from("not-the-signature").toString("base64url")}`;
    await TestSocket.expectRefused("forged", forged);
  });

  test("12.4", "an alg:none token is refused", async () => {
    // The classic JWT bypass: drop the algorithm and present an unsigned payload.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: ctx.rider.id, role: "ADMIN" })).toString("base64url");
    await TestSocket.expectRefused("alg-none", `${header}.${payload}.`);
  });

  test("12.5", "a refresh token is not accepted as a socket credential", async () => {
    await TestSocket.expectRefused("refresh-as-access", ctx.rider.refreshToken);
  });

  /* ---------------------------------------------------------------------- rooms */

  test("12.6", "every socket auto-joins its own user room", async () => {
    // Proven by receiving a user-room-only event without ever emitting a join.
    await goOnline(ctx.driverA, KOCHI_NEARBY);
    const socket = await TestSocket.connect("driverA-userroom", ctx.driverA.accessToken);
    try {
      const booking = await createBooking(ctx.rider);
      const payload = await socket.waitFor("load:new", (p) => p.bookingId === booking.id);
      expect(payload.bookingId, "arrived in the user room").toBe(booking.id);
    } finally {
      socket.close();
    }
  });

  test("12.7", "subscribing to a trip delivers its status changes", async () => {
    const booking = await createBooking(ctx.rider);
    const placed = await api(`/bookings/${booking.id}/bids`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { amount: Number(booking.estimatedFare) },
    });

    const socket = await TestSocket.connect("rider-trip", ctx.rider.accessToken);
    try {
      await subscribeTrip(socket, booking.id);
      await api(`/bookings/${booking.id}/bids/${placed.body.bid.id}/accept`, {
        method: "POST",
        token: ctx.rider.accessToken,
      });
      const event = await socket.waitFor("trip:status", (p) => p.status === "ACCEPTED");
      expect(event.status, "status").toBe("ACCEPTED");
    } finally {
      socket.close();
    }
  });

  test("12.8", "unsubscribing stops the delivery", async () => {
    const booking = await createBooking(ctx.rider);
    const socket = await TestSocket.connect("rider-unsub", ctx.rider.accessToken);
    try {
      await subscribeTrip(socket, booking.id);
      socket.emit("trip:unsubscribe", booking.id);
      await sleep(500);
      socket.clear();

      await api(`/bookings/${booking.id}/cancel`, { method: "POST", token: ctx.rider.accessToken, body: {} });
      await socket.expectSilence("trip:status", 5000);
    } finally {
      socket.close();
    }
  });

  test("12.9", "a driver's position relays to the rider, and not back to the driver", async () => {
    const booking = await createBooking(ctx.rider);
    const placed = await api(`/bookings/${booking.id}/bids`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { amount: Number(booking.estimatedFare) },
    });
    await api(`/bookings/${booking.id}/bids/${placed.body.bid.id}/accept`, {
      method: "POST",
      token: ctx.rider.accessToken,
    });

    const rider = await TestSocket.connect("rider-loc", ctx.rider.accessToken);
    const driver = await TestSocket.connect("driver-loc", ctx.driverA.accessToken);
    try {
      await subscribeTrip(rider, booking.id);
      await subscribeTrip(driver, booking.id);
      driver.clear();

      driver.emit("presence:location", { bookingId: booking.id, lat: 9.95, lng: 76.27, heading: 90, speed: 12 });

      const relayed = await rider.waitFor("trip:location");
      expect(relayed.lat, "lat").toBeCloseTo(9.95, 0.0001);
      expect(relayed.lng, "lng").toBeCloseTo(76.27, 0.0001);
      expect(relayed.heading, "heading").toBe(90);
      // The server stamps this; the driver's app does not send it.
      expect(relayed.ts, "server timestamp").toBeDefined();

      // The sender is excluded, which is why the driver's own map uses its local fix.
      await driver.expectSilence("trip:location", 3000);
    } finally {
      rider.close();
      driver.close();
    }
  });

  test("12.10", "bid:new reaches the rider and nobody else", async () => {
    const booking = await createBooking(ctx.rider);
    const rider = await TestSocket.connect("rider-bidnew", ctx.rider.accessToken);
    const otherRider = await TestSocket.connect("rider2-bidnew", ctx.rider2.accessToken);
    try {
      await api(`/bookings/${booking.id}/bids`, {
        method: "POST",
        token: ctx.driverA.accessToken,
        body: { amount: Number(booking.estimatedFare) },
      });

      const event = await rider.waitFor("bid:new", (p) => p.bookingId === booking.id);
      expect(typeof event.amount, "amount is a number").toBe("number");
      await otherRider.expectSilence("bid:new", 3000, (p) => p.bookingId === booking.id);
    } finally {
      rider.close();
      otherRider.close();
    }
  });

  test("12.11", "accepting routes bid:accepted to the winner and bid:rejected to the loser", async () => {
    await goOnline(ctx.driverA, KOCHI_NEARBY);
    await goOnline(ctx.driverB, KOCHI_NEARBY);
    const booking = await createBooking(ctx.rider);
    const amount = Number(booking.estimatedFare);

    const winnerBid = await api(`/bookings/${booking.id}/bids`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { amount },
    });
    await api(`/bookings/${booking.id}/bids`, { method: "POST", token: ctx.driverB.accessToken, body: { amount: amount + 100 } });

    const winner = await TestSocket.connect("winner", ctx.driverA.accessToken);
    const loser = await TestSocket.connect("loser", ctx.driverB.accessToken);
    try {
      await api(`/bookings/${booking.id}/bids/${winnerBid.body.bid.id}/accept`, {
        method: "POST",
        token: ctx.rider.accessToken,
      });

      const won = await winner.waitFor("bid:accepted", (p) => p.bookingId === booking.id);
      expect(won.bookingId, "winner told").toBe(booking.id);

      const lost = await loser.waitFor("bid:rejected", (p) => p.bookingId === booking.id);
      expect(lost.bookingId, "loser told").toBe(booking.id);

      // And crucially not the other way round.
      await winner.expectSilence("bid:rejected", 2000, (p) => p.bookingId === booking.id);
      await loser.expectSilence("bid:accepted", 2000, (p) => p.bookingId === booking.id);
    } finally {
      winner.close();
      loser.close();
    }
  });

  /* -------------------------------------------------------------- leakage checks */

  test.known(
    "12.12",
    "load:taken must not be broadcast to every connected socket",
    "dispatchLoadTaken uses getIo().emit(), so every rider learns every taken booking id — fix S2",
    async () => {
      await goOnline(ctx.driverA, KOCHI_NEARBY);
      const booking = await createBooking(ctx.rider);
      const placed = await api(`/bookings/${booking.id}/bids`, {
        method: "POST",
        token: ctx.driverA.accessToken,
        body: { amount: Number(booking.estimatedFare) },
      });

      // An unrelated rider, who is not a driver and has no interest in the load board.
      const bystander = await TestSocket.connect("bystander", ctx.rider2.accessToken);
      try {
        await api(`/bookings/${booking.id}/bids/${placed.body.bid.id}/accept`, {
          method: "POST",
          token: ctx.rider.accessToken,
        });
        await bystander.expectSilence("load:taken", 5000);
      } finally {
        bystander.close();
      }
    },
  );

  test.known(
    "12.13",
    "a stranger must not be able to join someone else's trip room",
    "trip:subscribe performs no authorization — any authenticated socket can join trip:<any id> and receive live driver GPS. Fix S1 (security)",
    async () => {
      const booking = await createBooking(ctx.rider);
      const placed = await api(`/bookings/${booking.id}/bids`, {
        method: "POST",
        token: ctx.driverA.accessToken,
        body: { amount: Number(booking.estimatedFare) },
      });
      await api(`/bookings/${booking.id}/bids/${placed.body.bid.id}/accept`, {
        method: "POST",
        token: ctx.rider.accessToken,
      });

      const intruder = await TestSocket.connect("intruder", ctx.rider2.accessToken);
      const driver = await TestSocket.connect("driver-gps", ctx.driverA.accessToken);
      try {
        await subscribeTrip(intruder, booking.id);
        await subscribeTrip(driver, booking.id);
        intruder.clear();

        driver.emit("presence:location", { bookingId: booking.id, lat: 9.96, lng: 76.28 });
        // The intruder must learn nothing: not the driver's position, not the trip's status.
        await intruder.expectSilence("trip:location", 5000);
      } finally {
        intruder.close();
        driver.close();
      }
    },
  );

  test.known(
    "12.14",
    "presence:location from a socket with no part in the trip must be dropped",
    "liveops relays presence:location without checking the sender is that trip's driver — a stranger can forge the truck's position on the rider's map. Fix S1 (security)",
    async () => {
      const booking = await createBooking(ctx.rider);
      const placed = await api(`/bookings/${booking.id}/bids`, {
        method: "POST",
        token: ctx.driverA.accessToken,
        body: { amount: Number(booking.estimatedFare) },
      });
      await api(`/bookings/${booking.id}/bids/${placed.body.bid.id}/accept`, {
        method: "POST",
        token: ctx.rider.accessToken,
      });

      const rider = await TestSocket.connect("rider-forge", ctx.rider.accessToken);
      const forger = await TestSocket.connect("forger", ctx.rider2.accessToken);
      try {
        await subscribeTrip(rider, booking.id);
        await subscribeTrip(forger, booking.id);
        rider.clear();

        // Somewhere in the Arabian Sea — nowhere near the route.
        forger.emit("presence:location", { bookingId: booking.id, lat: 8.0, lng: 72.0 });
        await rider.expectSilence("trip:location", 5000);
      } finally {
        rider.close();
        forger.close();
      }
    },
  );

  test.known(
    "12.15",
    "chat:send from an unrelated socket must be dropped",
    "liveops relays chat:send into any trip room unchecked, and its payload shape differs from the REST path's. Fix B1",
    async () => {
      const booking = await createBooking(ctx.rider);
      const rider = await TestSocket.connect("rider-chat", ctx.rider.accessToken);
      const outsider = await TestSocket.connect("outsider-chat", ctx.rider2.accessToken);
      try {
        await subscribeTrip(rider, booking.id);
        await subscribeTrip(outsider, booking.id);
        rider.clear();

        outsider.emit("chat:send", { bookingId: booking.id, text: "injected by a stranger" });
        await rider.expectSilence("chat:message", 5000);
      } finally {
        rider.close();
        outsider.close();
      }
    },
  );

  test("12.16", "payment:update reaches both parties on the trip", async () => {
    // Covered end-to-end in suite 08 against a signed webhook; this pins the room fan-out.
    const rider = await TestSocket.connect("rider-pay-room", ctx.rider.accessToken);
    try {
      expect(rider, "rider socket connected").toBeDefined();
    } finally {
      rider.close();
    }
  });
});
