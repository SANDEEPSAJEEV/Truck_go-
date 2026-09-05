/** Notifications and push-device registration. */

import { suite, test, expect } from "../runner";
import { api, sleep } from "../http";
import { ctx, createBooking, disposableRider } from "../actors";
import { db } from "../db";

suite("notifications", "09 — Notifications & devices", () => {
  test("9.1", "a brand-new user has no notifications", async () => {
    const fresh = await disposableRider("notifprobe");
    const res = await api("/notifications", { token: fresh.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.notifications.length, "count").toBe(0);
  });

  test("9.2", "dispatch writes a durable LOAD_NEW row for each eligible driver", async () => {
    // The socket event only reaches a driver with the app open. The row is what survives in
    // the Alerts tab for everyone else — without it a driver who was offline never learns
    // the load existed.
    const before = await db.notification.count({ where: { userId: ctx.driverA.id, type: "LOAD_NEW" } });
    const booking = await createBooking(ctx.rider);

    // Dispatch is deliberately not awaited into the create response — a dispatch failure
    // must never turn an accepted booking into an error the customer retries. So the row
    // arrives shortly after the 201, and a single fixed delay is a race under load.
    let after: { id: string }[] = [];
    for (let i = 0; i < 10 && after.length === 0; i++) {
      after = await db.notification.findMany({
        where: { userId: ctx.driverA.id, type: "LOAD_NEW", bookingId: booking.id },
        select: { id: true },
      });
      if (after.length === 0) await sleep(1000);
    }
    expect(after.length, "a row for this booking").toBe(1);
    expect(await db.notification.count({ where: { userId: ctx.driverA.id, type: "LOAD_NEW" } }), "count grew")
      .toBeGreaterThan(before);

    const row = await db.notification.findUniqueOrThrow({ where: { id: after[0].id } });
    expect(row.title, "title").toBeDefined();
    expect(row.body, "body names both ends of the trip").toContain("→");
    expect(row.isRead, "starts unread").toBe(false);
  });

  test("9.3", "an ineligible driver gets no notification", async () => {
    const booking = await createBooking(ctx.rider);
    const wrongVehicle = await db.notification.count({
      where: { userId: ctx.driverWrongVehicle.id, bookingId: booking.id },
    });
    expect(wrongVehicle, "container driver").toBe(0);

    const tooFar = await db.notification.count({ where: { userId: ctx.driverFar.id, bookingId: booking.id } });
    expect(tooFar, "distant driver").toBe(0);
  });

  test("9.4", "the list is the caller's own, newest first, and capped", async () => {
    const res = await api("/notifications", { token: ctx.driverA.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.notifications.length, "capped at 50").toBeLessThan(51);

    for (const n of res.body.notifications) expect(n.userId, "every row is the caller's").toBe(ctx.driverA.id);

    const times = res.body.notifications.map((n: any) => Date.parse(n.createdAt));
    for (let i = 1; i < times.length; i++) {
      expect(times[i] <= times[i - 1], "newest first").toBe(true);
    }
  });

  test("9.5", "marking one read persists", async () => {
    const list = await api("/notifications", { token: ctx.driverA.accessToken });
    const unread = list.body.notifications.find((n: any) => !n.isRead);
    expect(unread, "an unread notification exists").toBeDefined();

    const res = await api(`/notifications/${unread.id}/read`, { method: "PATCH", token: ctx.driverA.accessToken });
    expect(res.status, "status").toBe(204);

    const row = await db.notification.findUniqueOrThrow({ where: { id: unread.id } });
    expect(row.isRead, "isRead").toBe(true);
  });

  test("9.6", "one user cannot mark another user's notification read", async () => {
    const target = await db.notification.findFirstOrThrow({ where: { userId: ctx.driverA.id } });
    const res = await api(`/notifications/${target.id}/read`, { method: "PATCH", token: ctx.driverB.accessToken });
    expect(res.status, "status").toBe(404);
  });

  test("9.7", "read-all clears only the caller's unread rows", async () => {
    await createBooking(ctx.rider); // guarantee at least one unread for driverB

    // Compared by row id, not by count. Dispatch keeps writing new rows for driverA while
    // this runs, so a count taken before and after measures the background noise rather
    // than whether driverB's read-all reached across to another driver.
    const othersBefore = await db.notification.findMany({
      where: { userId: ctx.driverA.id, isRead: false },
      select: { id: true },
    });

    const res = await api("/notifications/read-all", { method: "PATCH", token: ctx.driverB.accessToken });
    expect(res.status, "status").toBe(204);

    expect(await db.notification.count({ where: { userId: ctx.driverB.id, isRead: false } }), "driverB has none unread").toBe(0);

    const stillUnread = await db.notification.count({
      where: { id: { in: othersBefore.map((n) => n.id) }, isRead: false },
    });
    expect(stillUnread, "every one of driverA's unread rows is still unread").toBe(othersBefore.length);
  });

  test("9.8", "notifications require authentication", async () => {
    expect((await api("/notifications")).status, "GET").toBe(401);
    expect((await api("/notifications/read-all", { method: "PATCH" })).status, "PATCH").toBe(401);
  });

  /* -------------------------------------------------------------------- devices */

  const tokenA = `ExponentPushToken[e2e-a-${Date.now()}]`;

  test("9.9", "registering a push token stores one row", async () => {
    const res = await api("/devices/register", {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { expoPushToken: tokenA, platform: "android" },
    });
    expect(res.status, "status").toBe(204);

    const row = await db.device.findUniqueOrThrow({ where: { expoPushToken: tokenA } });
    expect(row.userId, "owner").toBe(ctx.driverA.id);
    expect(row.platform, "platform").toBe("android");
  });

  test("9.10", "registering the same token twice does not duplicate it", async () => {
    const again = await api("/devices/register", {
      method: "POST",
      token: ctx.driverA.accessToken,
      body: { expoPushToken: tokenA, platform: "android" },
    });
    expect(again.status, "second registration").toBe(204);

    // The unique constraint on the token is what guarantees this, so one row is the only
    // possible answer — but give the write a beat to land before counting.
    await sleep(500);
    const count = await db.device.count({ where: { expoPushToken: tokenA } });
    expect(count, "one row").toBe(1);
  });

  test("9.11", "a handset changing hands re-points the token to its new owner", async () => {
    // Otherwise the previous driver's loads would follow the hardware.
    const res = await api("/devices/register", {
      method: "POST",
      token: ctx.driverB.accessToken,
      body: { expoPushToken: tokenA, platform: "android" },
    });
    expect(res.status, "status").toBe(204);

    const row = await db.device.findUniqueOrThrow({ where: { expoPushToken: tokenA } });
    expect(row.userId, "new owner").toBe(ctx.driverB.id);
    expect(await db.device.count({ where: { expoPushToken: tokenA } }), "still one row").toBe(1);
  });

  test("9.12", "a malformed device registration is refused", async () => {
    for (const body of [
      { expoPushToken: "short", platform: "android" },
      { expoPushToken: `ExponentPushToken[ok-${Date.now()}]`, platform: "symbian" },
      { platform: "android" },
    ]) {
      const res = await api("/devices/register", { method: "POST", token: ctx.driverA.accessToken, body });
      expect(res.status, `status for ${JSON.stringify(body)}`).toBe(400);
    }
  });

  test("9.13", "a token you do not own is not yours to delete", async () => {
    const res = await api(`/devices/${encodeURIComponent(tokenA)}`, {
      method: "DELETE",
      token: ctx.driverA.accessToken,
    });
    // Scoped delete: 204 either way, but the row must survive since driverB owns it now.
    expect(res.status, "status").toBe(204);
    expect(await db.device.count({ where: { expoPushToken: tokenA } }), "row survived").toBe(1);
  });

  test("9.14", "the owner can delete their own token", async () => {
    const res = await api(`/devices/${encodeURIComponent(tokenA)}`, {
      method: "DELETE",
      token: ctx.driverB.accessToken,
    });
    expect(res.status, "status").toBe(204);
    expect(await db.device.count({ where: { expoPushToken: tokenA } }), "row gone").toBe(0);
  });

  test("9.15", "device registration requires authentication", async () => {
    const res = await api("/devices/register", {
      method: "POST",
      body: { expoPushToken: `ExponentPushToken[anon-${Date.now()}]`, platform: "android" },
    });
    expect(res.status, "status").toBe(401);
  });
});
