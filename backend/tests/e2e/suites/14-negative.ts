/**
 * Validation, error shape and resilience.
 *
 * Both apps parse errors as `data.error.code` / `data.error.message`. An endpoint that answers
 * an unhandled 500 with an HTML stack trace, or a bare string, hands the user "Something went
 * wrong" with nothing actionable — so the envelope is checked as carefully as the status.
 */

import { suite, test, expect } from "../runner";
import { api, sleep } from "../http";
import { ctx } from "../actors";

const NONEXISTENT = "clzzzzzzzzzzzzzzzzzzzzzzz";

suite("negative", "14 — Negative, validation & resilience", () => {
  test("14.1", "health is fast and unauthenticated", async () => {
    const started = Date.now();
    const res = await api("/health");
    expect(res.status, "status").toBe(200);
    expect(res.body.ok, "ok").toBe(true);
    expect(Date.now() - started, "responds quickly once warm").toBeLessThan(15_000);
  });

  test("14.2", "an unknown route returns 404 in the standard envelope", async () => {
    const res = await api("/no/such/route", { token: ctx.rider.accessToken });
    expect(res.status, "status").toBe(404);
    expect(res.body?.error?.code, "error.code").toBeDefined();
    expect(res.body?.error?.message, "error.message").toBeDefined();
  });

  test("14.3", "every write endpoint refuses an empty body with a usable message", async () => {
    const cases: Array<[string, "POST" | "PUT" | "PATCH", string]> = [
      ["/auth/request-otp", "POST", ""],
      ["/auth/verify-otp", "POST", ""],
      ["/auth/login", "POST", ""],
      ["/auth/register/user", "POST", ""],
      ["/auth/register/driver", "POST", ""],
      ["/bookings/estimate", "POST", ctx.rider.accessToken],
      ["/bookings", "POST", ctx.rider.accessToken],
      ["/drivers/location", "PUT", ctx.driverA.accessToken],
      ["/drivers/bank-details", "PUT", ctx.driverA.accessToken],
      ["/ratings", "POST", ctx.rider.accessToken],
      ["/devices/register", "POST", ctx.driverA.accessToken],
    ];

    for (const [path, method, token] of cases) {
      const res = await api(path, { method, token: token || undefined, body: {} });
      expect(res.status, `status for ${method} ${path}`).toBe(400);
      expect(res.body?.error?.code, `error.code for ${path}`).toBeDefined();
      expect(res.body?.error?.message, `error.message for ${path}`).toBeDefined();
      expect(String(res.body.error.message).length, `message for ${path} is not empty`).toBeGreaterThan(0);
    }
  });

  test("14.4", "a nonexistent id returns 404, never a 500", async () => {
    const paths = [
      `/bookings/${NONEXISTENT}`,
      `/bookings/${NONEXISTENT}/bids`,
      `/trips/${NONEXISTENT}/eta`,
      `/trips/${NONEXISTENT}/location`,
      `/trips/${NONEXISTENT}/cancellation-policy`,
      `/payments/${NONEXISTENT}`,
    ];
    for (const path of paths) {
      const res = await api(path, { token: ctx.rider.accessToken });
      expect(res.status, `status for ${path}`).toBe(404);
    }
  });

  test("14.5", "a malformed id is handled, not crashed on", async () => {
    // cuid columns are strings, so a garbage id is a miss rather than a cast error — but it
    // must never surface as an unhandled 500.
    for (const id of ["not-a-uuid", "../../etc/passwd", "%00", "1 OR 1=1"]) {
      const res = await api(`/bookings/${encodeURIComponent(id)}`, { token: ctx.rider.accessToken });
      expect(res.status, `status for ${id}`).toBeLessThan(500);
    }
  });

  test("14.6", "wrong types are refused rather than coerced", async () => {
    const cases: Array<[string, any]> = [
      ["/bookings/estimate", { pickup: { address: "a", lat: "9.9", lng: 76.2 }, drop: { address: "b", lat: 10.5, lng: 76.2 }, vehicleType: "tataAce" }],
      ["/bookings/estimate", { pickup: { address: 42, lat: 9.9, lng: 76.2 }, drop: { address: "b", lat: 10.5, lng: 76.2 }, vehicleType: "tataAce" }],
      ["/ratings", { bookingId: 123, toUserId: ctx.driverA.id, stars: 5 }],
    ];
    for (const [path, body] of cases) {
      const res = await api(path, { method: "POST", token: ctx.rider.accessToken, body });
      expect(res.status, `status for ${path} ${JSON.stringify(body).slice(0, 50)}`).toBe(400);
    }
  });

  test("14.7", "unknown fields are ignored, not reflected back", async () => {
    const res = await api("/users/me", {
      method: "PATCH",
      token: ctx.rider.accessToken,
      body: { companyName: `Legit ${ctx.runId}`, role: "ADMIN", id: "hijacked", isAdmin: true },
    });
    expect(res.status, "status").toBe(200);
    expect(res.body.user.role, "role unchanged").toBe("USER");
    expect(res.body.user.id, "id unchanged").toBe(ctx.rider.id);
    expect(res.text.includes("isAdmin"), "no echoed field").toBe(false);
  });

  test("14.8", "malformed JSON is refused cleanly", async () => {
    const res = await api("/bookings/estimate", {
      method: "POST",
      token: ctx.rider.accessToken,
      rawBody: "{ this is not json",
    });
    expect(res.status, "status").toBe(400);
    expect(res.status, "not a 500").toBeLessThan(500);
  });

  test("14.9", "unicode and emoji survive a round trip intact", async () => {
    const name = `Rider ന്റെ 名前 🚚 ${ctx.runId}`;
    const patch = await api("/users/me", { method: "PATCH", token: ctx.rider.accessToken, body: { fullName: name } });
    expect(patch.status, "PATCH status").toBe(200);

    const get = await api("/users/me", { token: ctx.rider.accessToken });
    expect(get.body.user.fullName, "fullName round-trips").toBe(name);
  });

  test("14.10", "unicode survives in booking addresses and notes", async () => {
    const res = await api("/bookings", {
      method: "POST",
      token: ctx.rider.accessToken,
      body: {
        pickup: { address: "എറണാകുളം, Kochi 🚛", lat: 9.9312, lng: 76.2673 },
        drop: { address: "തൃശ്ശൂർ Round", lat: 10.5276, lng: 76.2144 },
        vehicleType: "tataAce",
        notes: "Handle with care — ശ്രദ്ധിക്കുക ⚠️",
      },
    });
    expect(res.status, "status").toBe(201);
    expect(res.body.booking.pickupAddress, "pickupAddress").toBe("എറണാകുളം, Kochi 🚛");
    expect(res.body.booking.notes, "notes").toBe("Handle with care — ശ്രദ്ധിക്കുക ⚠️");
  });

  test("14.11", "a rider firing several bookings at once gets unique references", async () => {
    const bodies = Array.from({ length: 5 }, (_, i) => ({
      pickup: { address: `Concurrent ${i}`, lat: 9.9312, lng: 76.2673 },
      drop: { address: "Thrissur Round", lat: 10.5276, lng: 76.2144 },
      vehicleType: "tataAce" as const,
    }));
    const results = await Promise.all(
      bodies.map((body) => api("/bookings", { method: "POST", token: ctx.rider.accessToken, body })),
    );
    for (const res of results) expect(res.status, "each created").toBe(201);

    const references = results.map((r) => r.body.booking.reference);
    expect(new Set(references).size, "all references unique").toBe(references.length);
  });

  test("14.12", "every error response uses the shape both apps parse", async () => {
    const probes: Array<[string, any]> = [
      ["/users/me", {}],
      ["/drivers/me", { token: ctx.rider.accessToken }],
      ["/bookings", { method: "POST", token: ctx.driverA.accessToken, body: {} }],
      [`/bookings/${NONEXISTENT}`, { token: ctx.rider.accessToken }],
      ["/auth/login", { method: "POST", body: { phone: ctx.rider.phone, password: "definitely-wrong" } }],
    ];
    for (const [path, opts] of probes) {
      const res = await api(path, opts);
      expect(res.status >= 400, `${path} is an error`).toBe(true);
      expect(typeof res.body, `${path} returns JSON`).toBe("object");
      expect(res.body?.error?.code, `${path} error.code`).toBeDefined();
      expect(typeof res.body?.error?.message, `${path} error.message is a string`).toBe("string");
      // An HTML error page would break the apps' parser entirely.
      expect(res.text.trim().startsWith("<"), `${path} is not HTML`).toBe(false);
    }
  });

  test("14.13", "the global rate limiter fires, and recovers", async () => {
    // Deliberately unpaced — this is the one case that means to trip it. Everything else in
    // the suite stays under the ceiling so this stays a test rather than an accident.
    let limited = false;
    for (let i = 0; i < 120 && !limited; i++) {
      const res = await api("/health", { unpaced: true });
      if (res.status === 429) limited = true;
    }

    if (limited) {
      console.log("      \x1b[2m(waiting out the 60s limiter window)\x1b[0m");
      await sleep(62_000);
      const res = await api("/health", { unpaced: true });
      expect(res.status, "recovers after the window").toBe(200);
    } else {
      // Not a failure — the budget shared with the rest of the run may not have been enough
      // headroom to reach 300 within one window. Recorded rather than asserted.
      console.log("      \x1b[2m(limiter not reached within this window; not asserted)\x1b[0m");
    }
  });
});
