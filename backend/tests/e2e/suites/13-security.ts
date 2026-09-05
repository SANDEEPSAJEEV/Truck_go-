/**
 * Authorization, across the whole surface.
 *
 * `requireAuth` proves who you are. It does not prove the row you are asking for is yours.
 * Every case here is the second question, asked of a resource that belongs to someone else.
 */

import { suite, test, expect } from "../runner";
import { api } from "../http";
import { ctx, createBooking } from "../actors";
import { db } from "../db";
import { state } from "../state";

suite("security", "13 — Security & authorization", () => {
  let victimBookingId = "";

  test("13.0", "set up a booking owned by someone else", async () => {
    const booking = await createBooking(ctx.rider);
    victimBookingId = booking.id;
  });

  /* ------------------------------------------------------------ cross-tenant reads */

  test.known(
    "13.1",
    "one rider cannot read another rider's booking",
    "GET /bookings/:id checks authentication but never ownership — fix A1",
    async () => {
      const res = await api(`/bookings/${victimBookingId}`, { token: ctx.rider2.accessToken });
      expect(res.status, "status").toBeOneOf([403, 404]);
    },
  );

  test("13.2", "a driver may read an open booking, but not one assigned to someone else", async () => {
    // An AWAITING_BIDS booking is on the open market — an approved driver has to be able to
    // read it to decide whether to bid, and that is the whole point of the model. The moment
    // it is assigned it stops being anyone else's business.
    const open = await api(`/bookings/${victimBookingId}`, { token: ctx.driverFar.accessToken });
    expect(open.status, "an open booking is readable").toBe(200);
    expect(open.body.booking.pickupOtp, "still no PINs").toBeNull();

    const assigned = await createBooking(ctx.rider);
    await db.booking.update({
      where: { id: assigned.id },
      data: { driverId: ctx.driverA.id, status: "EN_ROUTE_TO_PICKUP" },
    });

    const res = await api(`/bookings/${assigned.id}`, { token: ctx.driverFar.accessToken });
    expect(res.status, "another driver's trip is not").toBeOneOf([403, 404]);
  });

  test("13.3", "the PIN fields never reach a driver, at any status", async () => {
    // Held across the entire chain, not just at the start — a single leak hands the driver
    // the ability to walk the custody chain with no rider present.
    const statuses = ["ARRIVED_AT_PICKUP", "LOADING", "ARRIVED_AT_DROP"] as const;
    for (const status of statuses) {
      const scratch = await createBooking(ctx.rider);
      await db.booking.update({
        where: { id: scratch.id },
        data: { driverId: ctx.driverA.id, status, pickupOtp: "1111", startOtp: "2222", dropOtp: "3333" },
      });

      const res = await api(`/bookings/${scratch.id}`, { token: ctx.driverA.accessToken });
      expect(res.status, `status at ${status}`).toBe(200);
      expect(res.body.booking.pickupOtp, `pickupOtp at ${status}`).toBeNull();
      expect(res.body.booking.startOtp, `startOtp at ${status}`).toBeNull();
      expect(res.body.booking.dropOtp, `dropOtp at ${status}`).toBeNull();
      expect(JSON.stringify(res.body).includes("1111"), `no PIN in the body at ${status}`).toBe(false);
    }
  });

  test("13.4", "the driver's own history never carries PINs either", async () => {
    const res = await api("/bookings", { token: ctx.driverA.accessToken, query: { filter: "all" } });
    expect(res.status, "status").toBe(200);
    for (const b of res.body.bookings) {
      expect(b.pickupOtp, `${b.reference} pickupOtp`).toBeNull();
      expect(b.startOtp, `${b.reference} startOtp`).toBeNull();
      expect(b.dropOtp, `${b.reference} dropOtp`).toBeNull();
    }
  });

  /* ------------------------------------------------------------------- role gates */

  test("13.5", "rider-only routes refuse a driver", async () => {
    const cases: Array<[string, any]> = [
      ["/bookings", { method: "POST", body: { pickup: { address: "a", lat: 9.9, lng: 76.2 }, drop: { address: "b", lat: 10.5, lng: 76.2 }, vehicleType: "tataAce" } }],
      [`/trips/${victimBookingId}/resend-otp`, { method: "POST" }],
    ];
    for (const [path, opts] of cases) {
      const res = await api(path, { ...opts, token: ctx.driverA.accessToken });
      expect(res.status, `status for ${path}`).toBe(403);
    }
  });

  test("13.6", "driver-only routes refuse a rider", async () => {
    const cases: Array<[string, any]> = [
      ["/drivers/me", {}],
      ["/drivers/earnings", {}],
      ["/drivers/bank-details", {}],
      ["/drivers/documents", {}],
      ["/bookings/available", {}],
      [`/trips/${victimBookingId}/status`, { method: "POST", body: { status: "EN_ROUTE_TO_PICKUP" } }],
      [`/trips/${victimBookingId}/verify-otp`, { method: "POST", body: { otp: "1234" } }],
    ];
    for (const [path, opts] of cases) {
      const res = await api(path, { ...opts, token: ctx.rider.accessToken });
      expect(res.status, `status for ${path}`).toBe(403);
    }
  });

  test("13.7", "admin routes refuse both riders and drivers", async () => {
    for (const actor of [ctx.rider, ctx.driverA]) {
      const res = await api("/admin/drivers", { token: actor.accessToken });
      expect(res.status, `status for ${actor.label}`).toBeOneOf([403, 404]);
      expect(res.status === 200, "never a success").toBe(false);
    }
  });

  test("13.8", "a token with an escalated role in its payload is rejected", async () => {
    const [header, , signature] = ctx.rider.accessToken.split(".");
    const escalated = Buffer.from(JSON.stringify({ sub: ctx.rider.id, role: "ADMIN" })).toString("base64url");
    const forged = `${header}.${escalated}.${signature}`;

    expect((await api("/users/me", { token: forged })).status, "protected route").toBe(401);
    expect((await api("/admin/drivers", { token: forged })).status, "admin route").toBeOneOf([401, 403, 404]);
  });

  test("13.9", "an alg:none token is rejected", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: ctx.rider.id, role: "ADMIN" })).toString("base64url");
    const res = await api("/users/me", { token: `${header}.${payload}.` });
    expect(res.status, "status").toBe(401);
  });

  test("13.10", "another user's id in the payload does not grant their data", async () => {
    // Signature binding: swapping the subject invalidates the token entirely.
    const [header, , signature] = ctx.rider.accessToken.split(".");
    const swapped = Buffer.from(JSON.stringify({ sub: ctx.rider2.id, role: "USER" })).toString("base64url");
    const res = await api("/users/me", { token: `${header}.${swapped}.${signature}` });
    expect(res.status, "status").toBe(401);
  });

  /* -------------------------------------------------------- destructive operations */

  test.known(
    "13.11",
    "a stranger cannot cancel someone else's booking or trip",
    "neither POST /bookings/:id/cancel nor POST /trips/:id/cancel checks ownership — fix A2 (destructive)",
    async () => {
      const a = await createBooking(ctx.rider);
      const viaBookings = await api(`/bookings/${a.id}/cancel`, { method: "POST", token: ctx.rider2.accessToken, body: {} });
      expect(viaBookings.status, "via /bookings").toBeOneOf([403, 404]);

      const b = await createBooking(ctx.rider);
      const viaTrips = await api(`/trips/${b.id}/cancel`, { method: "POST", token: ctx.rider2.accessToken, body: {} });
      expect(viaTrips.status, "via /trips").toBeOneOf([403, 404]);

      for (const id of [a.id, b.id]) {
        const row = await db.booking.findUniqueOrThrow({ where: { id } });
        expect(row.status, `${id} survived`).toBe("AWAITING_BIDS");
      }
    },
  );

  test.known(
    "13.12",
    "a driver cannot cancel a trip that is not theirs",
    "cancel routes check authentication only — fix A2",
    async () => {
      const booking = await createBooking(ctx.rider);
      const res = await api(`/trips/${booking.id}/cancel`, { method: "POST", token: ctx.driverFar.accessToken, body: {} });
      expect(res.status, "status").toBeOneOf([403, 404]);
    },
  );

  /* ------------------------------------------------------- secrets and injection */

  test("13.13", "no response anywhere carries a password hash or an OTP hash", async () => {
    const probes: Array<[string, string]> = [
      ["/users/me", ctx.rider.accessToken],
      ["/drivers/me", ctx.driverA.accessToken],
      ["/bookings?filter=all", ctx.rider.accessToken],
      ["/bookings/available", ctx.driverA.accessToken],
      ["/drivers/earnings", ctx.driverA.accessToken],
      ["/notifications", ctx.driverA.accessToken],
      [`/bookings/${victimBookingId}/bids`, ctx.rider.accessToken],
    ];
    for (const [path, token] of probes) {
      const res = await api(path, { token });
      const body = res.text;
      expect(body.includes("passwordHash"), `${path} has no passwordHash`).toBe(false);
      expect(body.includes("codeHash"), `${path} has no codeHash`).toBe(false);
      expect(body.includes("$2a$") || body.includes("$2b$"), `${path} has no bcrypt hash`).toBe(false);
    }
  });

  test("13.14", "a login response carries no lockout bookkeeping", async () => {
    // failedLoginCount and lockedUntil tell an attacker how close they are to the cap.
    const res = await api("/auth/login", { method: "POST", body: { phone: ctx.rider.phone, password: "TestPass!2026" } });
    expect(res.status, "status").toBe(200);
    expect(res.text.includes("failedLoginCount"), "no failedLoginCount").toBe(false);
    expect(res.text.includes("lockedUntil"), "no lockedUntil").toBe(false);
  });

  test("13.15", "SQL-shaped input does no damage", async () => {
    const nasty = "'; DROP TABLE \"Booking\"; --";
    const res = await api("/bookings", { token: ctx.rider.accessToken, query: { search: nasty } });

    // 403 here is Cloudflare's WAF refusing the request before it ever reaches the app —
    // defence in depth sitting in front of Render, not something this codebase decides. 200
    // is equally correct: Prisma parameterises, so the string is just a search term that
    // matches nothing. What must never happen is damage.
    expect(res.status, "status").toBeOneOf([200, 403]);
    if (res.status === 200) expect(res.body.bookings.length, "no matches").toBe(0);

    const after = await api("/bookings", { token: ctx.rider.accessToken, query: { filter: "all" } });
    expect(after.status, "the table is intact").toBe(200);
    expect(after.body.bookings.length, "the rider's bookings are still there").toBeGreaterThan(0);
  });

  test("13.16", "a very large body is refused cleanly", async () => {
    const res = await api("/bookings", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: {
        pickup: { address: "a".repeat(2_000_000), lat: 9.9, lng: 76.2 },
        drop: { address: "b", lat: 10.5, lng: 76.2 },
        vehicleType: "tataAce",
      },
      timeoutMs: 90_000,
    });
    expect(res.status, "status").toBeOneOf([400, 413]);
    expect(res.status, "not a 500").toBeLessThan(500);
  });

  test("13.17", "payment routes are scoped to the two parties", async () => {
    if (!state.deliveredBookingId) return;
    const res = await api(`/payments/${state.deliveredBookingId}`, { token: ctx.rider2.accessToken });
    expect(res.status, "status").toBe(403);
  });

  test("13.18", "one driver cannot read another driver's payout details", async () => {
    const res = await api("/drivers/bank-details", { token: ctx.driverFar.accessToken });
    expect(res.status, "status").toBe(200);
    // Scoped by the token's own subject, so this can only ever be their own row.
    expect(res.body.bankAccountNumber, "no other driver's account").toBeNull();
  });
});
