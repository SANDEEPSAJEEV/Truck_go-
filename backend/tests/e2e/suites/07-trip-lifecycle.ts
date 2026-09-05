/**
 * The custody chain, end to end, asserted at every step against HTTP, sockets and the database.
 *
 *   ACCEPTED → EN_ROUTE_TO_PICKUP → ARRIVED_AT_PICKUP
 *     →[pickup PIN]→ LOADING →[start PIN]→ IN_TRANSIT
 *     → ARRIVED_AT_DROP →[drop PIN]→ UNLOADING → DELIVERED
 *
 * The three PINs only ever reach the rider. The driver moves the trip between gates; the
 * rider's code is what opens each one. That asymmetry is the entire security model for
 * somebody else's cargo, so it is checked at every single status, not once.
 */

import { suite, test, expect } from "../runner";
import { api } from "../http";
import { ctx } from "../actors";
import { db } from "../db";
import { state, require as need } from "../state";
import { TestSocket, subscribeTrip } from "../socket";

suite("trips", "07 — Trip lifecycle & PIN gates", () => {
  let riderSocket: TestSocket | null = null;
  /** PINs, captured from the rider's socket as they are minted. */
  const pins: Record<string, string> = {};

  async function bookingRow() {
    return db.booking.findUniqueOrThrow({ where: { id: need("tripBookingId", "suite 06 must accept a bid first") } });
  }

  async function advance(status: string, token = ctx.driverA.accessToken) {
    return api(`/trips/${state.tripBookingId}/status`, { method: "POST", token, body: { status } });
  }

  test("7.0", "the rider joins the trip room and starts recording PINs", async () => {
    const id = need("tripBookingId", "suite 06 must accept a bid first");
    riderSocket = await TestSocket.connect("rider", ctx.rider.accessToken);
    await subscribeTrip(riderSocket, id);

    // trip:otp is pushed to the rider's private user room, so it arrives whether or not the
    // trip room was joined — recording it here is what lets later cases open each gate.
    riderSocket.log.length = 0;
  });

  test("7.1", "ACCEPTED → EN_ROUTE_TO_PICKUP, and the rider is told", async () => {
    const res = await advance("EN_ROUTE_TO_PICKUP");
    expect(res.status, "status").toBe(200);
    expect(res.body.booking.status, "booking status").toBe("EN_ROUTE_TO_PICKUP");

    const row = await bookingRow();
    expect(row.enRouteAt, "enRouteAt stamped").toBeDefined();

    const event = await riderSocket!.waitFor("trip:status", (p) => p.status === "EN_ROUTE_TO_PICKUP");
    expect(event.status, "socket status").toBe("EN_ROUTE_TO_PICKUP");
  });

  test("7.2", "arriving at pickup mints the pickup PIN and pushes it to the rider only", async () => {
    const res = await advance("ARRIVED_AT_PICKUP");
    expect(res.status, "status").toBe(200);

    const event = await riderSocket!.waitFor("trip:otp", (p) => p.stage === "pickup");
    expect(String(event.otp).length, "PIN is 4 digits").toBe(4);
    pins.pickup = event.otp;

    const row = await bookingRow();
    expect(row.arrivedAt, "arrivedAt stamped").toBeDefined();
    expect(row.pickupOtp, "PIN persisted").toBe(pins.pickup);
  });

  test("7.3", "the driver still cannot read the PIN through any endpoint", async () => {
    const paths = [`/bookings/${state.tripBookingId}`, "/bookings?filter=active"];
    for (const path of paths) {
      const res = await api(path, { token: ctx.driverA.accessToken });
      expect(res.status, `status for ${path}`).toBe(200);
      const serialised = JSON.stringify(res.body);
      expect(serialised.includes(pins.pickup), `${path} does not leak the PIN`).toBe(false);
    }
  });

  test("7.4", "the driver cannot walk past a PIN gate with a status post", async () => {
    const res = await advance("LOADING");
    expect(res.status, "status").toBe(409);
    expect(res.code, "code").toBe("AWAITING_OTP");
    expect(res.message, "message names the gate").toContain("PIN");

    const row = await bookingRow();
    expect(row.status, "status unchanged").toBe("ARRIVED_AT_PICKUP");
  });

  test("7.5", "a wrong PIN does not open the gate", async () => {
    const wrong = pins.pickup === "0000" ? "1111" : "0000";
    const res = await api(`/trips/${state.tripBookingId}/verify-otp`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { otp: wrong, stage: "pickup" },
    });
    expect(res.status, "status").toBe(400);
    expect(res.code, "code").toBe("INVALID_OTP");

    const row = await bookingRow();
    expect(row.status, "status unchanged").toBe("ARRIVED_AT_PICKUP");
  });

  test("7.6", "a caller cannot nominate a later stage to skip ahead", async () => {
    const res = await api(`/trips/${state.tripBookingId}/verify-otp`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { otp: pins.pickup, stage: "drop" },
    });
    expect(res.status, "status").toBe(409);
    expect(res.code, "code").toBe("INVALID_STATE");
  });

  test("7.7", "the correct pickup PIN opens the gate, burns itself, and mints the next", async () => {
    const res = await api(`/trips/${state.tripBookingId}/verify-otp`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { otp: pins.pickup, stage: "pickup" },
    });
    expect(res.status, "status").toBe(200);
    expect(res.body.booking.status, "status").toBe("LOADING");

    const row = await bookingRow();
    expect(row.loadingAt, "loadingAt stamped").toBeDefined();
    // Consumed codes are cleared so they can never be replayed at a later gate.
    expect(row.pickupOtp, "pickup PIN cleared").toBeNull();
    expect(row.startOtp, "start PIN minted").toBeDefined();

    const event = await riderSocket!.waitFor("trip:otp", (p) => p.stage === "start");
    pins.start = event.otp;
    expect(row.startOtp, "socket PIN matches the stored one").toBe(pins.start);
  });

  test("7.8", "the consumed pickup PIN cannot be replayed", async () => {
    const res = await api(`/trips/${state.tripBookingId}/verify-otp`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { otp: pins.pickup },
    });
    expect(res.status, "status").toBe(400);
  });

  test("7.9", "the start PIN moves the trip into transit", async () => {
    const res = await api(`/trips/${state.tripBookingId}/verify-otp`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { otp: pins.start, stage: "start" },
    });
    expect(res.status, "status").toBe(200);
    expect(res.body.booking.status, "status").toBe("IN_TRANSIT");

    const row = await bookingRow();
    expect(row.startedAt, "startedAt stamped").toBeDefined();
    expect(row.startOtp, "start PIN cleared").toBeNull();
  });

  test("7.10", "arriving at the drop mints the unload PIN", async () => {
    const res = await advance("ARRIVED_AT_DROP");
    expect(res.status, "status").toBe(200);

    const event = await riderSocket!.waitFor("trip:otp", (p) => p.stage === "drop");
    pins.drop = event.otp;

    const row = await bookingRow();
    expect(row.arrivedDropAt, "arrivedDropAt stamped").toBeDefined();
    expect(row.dropOtp, "drop PIN persisted").toBe(pins.drop);
  });

  test("7.11", "resend mints a fresh code and invalidates the old one", async () => {
    const previous = pins.drop;
    const res = await api(`/trips/${state.tripBookingId}/resend-otp`, {
      method: "POST",
      token: ctx.rider.accessToken,
    });
    expect(res.status, "status").toBe(200);
    expect(res.body.stage, "stage").toBe("drop");

    const event = await riderSocket!.waitFor("trip:otp", (p) => p.stage === "drop" && p.otp !== previous, 15_000);
    pins.drop = event.otp;

    const row = await bookingRow();
    expect(row.dropOtp, "the new code is the stored one").toBe(pins.drop);

    // The superseded code must stop working, or a resend would widen the window rather
    // than replace it.
    if (previous !== pins.drop) {
      const stale = await api(`/trips/${state.tripBookingId}/verify-otp`, {
        method: "POST",
        token: ctx.driverA.accessToken,
        body: { otp: previous },
      });
      expect(stale.status, "the superseded code is dead").toBe(400);
    }
  });

  test("7.12", "only the owning rider can trigger a resend", async () => {
    expect(
      (await api(`/trips/${state.tripBookingId}/resend-otp`, { method: "POST", token: ctx.rider2.accessToken })).status,
      "another rider",
    ).toBe(403);
    expect(
      (await api(`/trips/${state.tripBookingId}/resend-otp`, { method: "POST", token: ctx.driverA.accessToken })).status,
      "the driver",
    ).toBe(403);
  });

  test("7.13", "the drop PIN opens unloading, and the trip completes", async () => {
    const unload = await api(`/trips/${state.tripBookingId}/verify-otp`, {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { otp: pins.drop, stage: "drop" },
    });
    expect(unload.status, "unload status").toBe(200);
    expect(unload.body.booking.status, "status").toBe("UNLOADING");

    const delivered = await advance("DELIVERED");
    expect(delivered.status, "deliver status").toBe(200);
    expect(delivered.body.booking.status, "status").toBe("DELIVERED");

    state.deliveredBookingId = state.tripBookingId;
  });

  test("7.14", "every custody timestamp is set, in order", async () => {
    const row = await bookingRow();
    const chain: Array<[string, Date | null]> = [
      ["acceptedAt", row.acceptedAt],
      ["enRouteAt", row.enRouteAt],
      ["arrivedAt", row.arrivedAt],
      ["loadingAt", row.loadingAt],
      ["startedAt", row.startedAt],
      ["arrivedDropAt", row.arrivedDropAt],
      ["unloadingAt", row.unloadingAt],
      ["completedAt", row.completedAt],
    ];
    for (const [name, value] of chain) expect(value, `${name} is set`).toBeDefined();

    for (let i = 1; i < chain.length; i++) {
      const [prevName, prev] = chain[i - 1];
      const [name, current] = chain[i];
      expect(current!.getTime() >= prev!.getTime(), `${name} is not before ${prevName}`).toBe(true);
    }

    // And all three codes are spent.
    expect(row.pickupOtp, "pickupOtp").toBeNull();
    expect(row.startOtp, "startOtp").toBeNull();
    expect(row.dropOtp, "dropOtp").toBeNull();
  });

  test("7.15", "a delivered trip appears in the driver's earnings", async () => {
    const res = await api("/drivers/earnings", { token: ctx.driverA.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.completedTrips, "completedTrips").toBeGreaterThan(0);
    expect(res.body.trips.some((t: any) => t.id === state.deliveredBookingId), "the trip is listed").toBe(true);
    expect(res.body.totalEarnings, "totalEarnings moved").toBeGreaterThan(0);
  });

  test("7.16", "a delivered trip accepts no further transitions", async () => {
    const res = await advance("EN_ROUTE_TO_PICKUP");
    expect(res.status, "status").toBe(409);
  });

  test("7.17", "resend has nothing to send once the trip is done", async () => {
    const res = await api(`/trips/${state.deliveredBookingId}/resend-otp`, {
      method: "POST",
      token: ctx.rider.accessToken,
    });
    expect(res.status, "status").toBe(409);
    expect(res.code, "code").toBe("INVALID_STATE");
  });

  /* ---------------------------------------------- authorization across the chain */

  test("7.18", "a driver who was not assigned cannot touch the trip", async () => {
    const status = await advance("EN_ROUTE_TO_PICKUP", ctx.driverB.accessToken);
    expect(status.status, "status post").toBe(403);

    const verify = await api(`/trips/${state.deliveredBookingId}/verify-otp`, {
      method: "POST",
      token: ctx.driverB.accessToken,
      body: { otp: "1234" },
    });
    expect(verify.status, "verify-otp").toBe(403);
  });

  test("7.19", "a rider cannot advance their own trip's status", async () => {
    const res = await api(`/trips/${state.deliveredBookingId}/status`, {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { status: "DELIVERED" },
    });
    expect(res.status, "status").toBe(403);
  });

  /* ---------------------------------------------------------------- ETA & tracking */

  test("7.20", "ETA is scoped to the two parties on the trip", async () => {
    const rider = await api(`/trips/${state.deliveredBookingId}/eta`, { token: ctx.rider.accessToken });
    expect(rider.status, "rider").toBe(200);
    expect(rider.body.target, "target").toBeOneOf(["pickup", "drop"]);

    const driver = await api(`/trips/${state.deliveredBookingId}/eta`, { token: ctx.driverA.accessToken });
    expect(driver.status, "assigned driver").toBe(200);

    const stranger = await api(`/trips/${state.deliveredBookingId}/eta`, { token: ctx.rider2.accessToken });
    expect(stranger.status, "unrelated rider").toBe(403);
  });

  test("7.21", "the ETA target follows the leg the truck is actually driving", async () => {
    const res = await api(`/trips/${state.deliveredBookingId}/eta`, { token: ctx.rider.accessToken });
    // Past LOADING the customer cares when the truck reaches the drop, not them.
    expect(res.body.target, "target after delivery").toBe("drop");
    if (res.body.etaMinutes !== null) expect(Number.isFinite(res.body.etaMinutes), "etaMinutes is finite").toBe(true);
  });

  test.known(
    "7.22",
    "live driver location must not be readable by a stranger",
    "GET /trips/:id/location and /tracking have no ownership check — fix A3 (security)",
    async () => {
      const location = await api(`/trips/${state.deliveredBookingId}/location`, { token: ctx.rider2.accessToken });
      expect(location.status, "location").toBeOneOf([403, 404]);

      const tracking = await api(`/trips/${state.deliveredBookingId}/tracking`, { token: ctx.rider2.accessToken });
      expect(tracking.status, "tracking").toBeOneOf([403, 404]);
    },
  );

  test("7.23", "the assigned parties can read the driver's last location", async () => {
    const res = await api(`/trips/${state.deliveredBookingId}/location`, { token: ctx.rider.accessToken });
    expect(res.status, "status").toBeOneOf([200, 404]);
    if (res.status === 200) {
      expect(typeof res.body.lat, "lat type").toBe("number");
      expect(typeof res.body.lng, "lng type").toBe("number");
    }
  });

  test("7.24", "the cancellation policy returns a countable window", async () => {
    const res = await api(`/trips/${state.deliveredBookingId}/cancellation-policy`, { token: ctx.rider.accessToken });
    expect(res.status, "status").toBe(200);
    expect(typeof res.body.secondsRemaining, "secondsRemaining type").toBe("number");
    // The rider app parses this with Date.parse, so it has to be a real ISO string.
    expect(Number.isFinite(Date.parse(res.body.windowEndsAt)), "windowEndsAt parses").toBe(true);
  });

  /* --------------------------------------------------------------------- cancel */

  test("7.25", "a rider can cancel a trip in progress", async () => {
    const scratch = await api("/bookings", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: {
        pickup: { address: "Marine Drive, Kochi", lat: 9.9312, lng: 76.2673 },
        drop: { address: "Thrissur Round, Thrissur", lat: 10.5276, lng: 76.2144 },
        vehicleType: "tataAce",
      },
    });
    const id = scratch.body.booking.id;

    const res = await api(`/trips/${id}/cancel`, {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { reason: "No longer needed" },
    });
    expect(res.status, "status").toBe(200);
    expect(res.body.booking.status, "status").toBe("CANCELLED");
  });

  test.known(
    "7.26",
    "a stranger must not be able to cancel someone else's trip",
    "POST /trips/:id/cancel has requireAuth but no ownership check — fix A2 (destructive)",
    async () => {
      const scratch = await api("/bookings", {
        method: "POST",
        token: ctx.rider.accessToken,
        body: {
          pickup: { address: "Marine Drive, Kochi", lat: 9.9312, lng: 76.2673 },
          drop: { address: "Thrissur Round, Thrissur", lat: 10.5276, lng: 76.2144 },
          vehicleType: "tataAce",
        },
      });
      const id = scratch.body.booking.id;

      const res = await api(`/trips/${id}/cancel`, { method: "POST", token: ctx.rider2.accessToken, body: {} });
      expect(res.status, "status").toBeOneOf([403, 404]);

      const row = await db.booking.findUniqueOrThrow({ where: { id } });
      expect(row.status, "booking survived").toBe("AWAITING_BIDS");
    },
  );

  test("7.27", "a delivered trip cannot be cancelled", async () => {
    const res = await api(`/trips/${state.deliveredBookingId}/cancel`, {
      method: "POST",
      token: ctx.rider.accessToken,
      body: {},
    });
    expect(res.status, "status").toBe(409);
  });

  /* -------------------------------------------------------------------- messages */

  test("7.28", "trip messages round-trip for a party to the trip", async () => {
    const post = await api(`/trips/${state.deliveredBookingId}/messages`, {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { text: "Left the gate open, thanks" },
    });
    expect(post.status, "POST status").toBe(201);
    expect(post.body.message.senderId, "senderId").toBe(ctx.rider.id);

    const get = await api(`/trips/${state.deliveredBookingId}/messages`, { token: ctx.driverA.accessToken });
    expect(get.status, "GET status").toBe(200);
    expect(get.body.messages.some((m: any) => m.text === "Left the gate open, thanks"), "message readable").toBe(true);
  });

  test("7.29", "an empty message is refused", async () => {
    const res = await api(`/trips/${state.deliveredBookingId}/messages`, {
      method: "POST",
      token: ctx.rider.accessToken,
      body: { text: "" },
    });
    expect(res.status, "status").toBe(400);
  });

  test.known(
    "7.30",
    "a stranger must not be able to read or inject trip messages",
    "GET/POST /trips/:id/messages have no ownership check — fix A3",
    async () => {
      const read = await api(`/trips/${state.deliveredBookingId}/messages`, { token: ctx.rider2.accessToken });
      expect(read.status, "read").toBeOneOf([403, 404]);

      const write = await api(`/trips/${state.deliveredBookingId}/messages`, {
        method: "POST",
        token: ctx.rider2.accessToken,
        body: { text: "injected" },
      });
      expect(write.status, "write").toBeOneOf([403, 404]);
    },
  );

  test("7.99", "disconnect", async () => {
    riderSocket?.close();
    riderSocket = null;
  });
});
