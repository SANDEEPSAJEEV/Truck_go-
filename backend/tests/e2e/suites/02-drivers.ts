/** Driver profile, location publishing, earnings and payout details. */

import { suite, test, expect } from "../runner";
import { api } from "../http";
import { ctx, goOnline, KOCHI_NEARBY, profileOf } from "../actors";

suite("drivers", "02 — Drivers & profile", () => {
  test("2.1", "GET /drivers/me returns every field the driver app reads", async () => {
    const res = await api("/drivers/me", { token: ctx.driverA.accessToken });
    expect(res.status, "status").toBe(200);
    const user = res.body.user;
    expect(user.id, "id").toBe(ctx.driverA.id);
    expect(user.role, "role").toBe("DRIVER");
    expect(user.driverProfile, "driverProfile").toBeDefined();
    expect(user.driverProfile.vehicleType, "vehicleType").toBe("tataAce");
    expect(user.driverProfile.verificationStatus, "verificationStatus").toBe("APPROVED");
    expect(user.driverProfile.vehicleNumber, "vehicleNumber").toBeDefined();
    expect(user.driverProfile.drivingLicenseNumber, "drivingLicenseNumber").toBeDefined();
    expect(typeof user.driverProfile.isOnline, "isOnline is a boolean").toBe("boolean");
    expect(typeof user.driverProfile.ratingAvg, "ratingAvg is a number").toBe("number");
    expect(user.passwordHash, "passwordHash").toBeUndefined();
  });

  test("2.2", "a rider cannot read the driver profile endpoint", async () => {
    const res = await api("/drivers/me", { token: ctx.rider.accessToken });
    expect(res.status, "status").toBe(403);
  });

  test("2.3", "PATCH /drivers/me persists a name change", async () => {
    const newName = `Mock Verified Holder Owner ${ctx.runId}`;
    const res = await api("/drivers/me", {
      method: "PATCH",
      token: ctx.driverA.accessToken,
      body: { fullName: newName, email: `driver.${ctx.runId}@example.com` },
    });
    expect(res.status, "status").toBe(200);

    const after = await api("/drivers/me", { token: ctx.driverA.accessToken });
    expect(after.body.user.fullName, "fullName round-trips").toBe(newName);
    expect(after.body.user.email, "email round-trips").toBe(`driver.${ctx.runId}@example.com`);
  });

  test("2.4", "PATCH /drivers/me cannot change the phone or self-approve", async () => {
    const before = await profileOf(ctx.driverPending);
    expect(before.verificationStatus, "starts PENDING").toBe("PENDING");

    const res = await api("/drivers/me", {
      method: "PATCH",
      token: ctx.driverPending.accessToken,
      body: { phone: "9999999999", verificationStatus: "APPROVED", role: "ADMIN" },
    });
    expect(res.status, "status").toBeOneOf([200, 400]);

    const after = await profileOf(ctx.driverPending);
    expect(after.verificationStatus, "still PENDING").toBe("PENDING");
    const user = await api("/drivers/me", { token: ctx.driverPending.accessToken });
    expect(user.body.user.phone, "phone unchanged").toBe(ctx.driverPending.phone);
    expect(user.body.user.role, "role unchanged").toBe("DRIVER");
  });

  test("2.5", "publishing a location stamps coordinates and the time", async () => {
    const res = await api("/drivers/location", {
      method: "PUT",
      token: ctx.driverA.accessToken,
      body: { lat: KOCHI_NEARBY.lat, lng: KOCHI_NEARBY.lng, isOnline: true },
    });
    expect(res.status, "status").toBe(204);

    const profile = await profileOf(ctx.driverA);
    expect(profile.isOnline, "isOnline").toBe(true);
    expect(profile.currentLat, "currentLat").toBeCloseTo(KOCHI_NEARBY.lat, 0.0001);
    expect(profile.currentLng, "currentLng").toBeCloseTo(KOCHI_NEARBY.lng, 0.0001);
    expect(profile.locationAt, "locationAt").toBeDefined();
    expect(Date.now() - profile.locationAt!.getTime() < 60_000, "locationAt is fresh").toBe(true);
  });

  test("2.6", "going offline without a fix leaves the last known position intact", async () => {
    const before = await profileOf(ctx.driverB);
    const res = await api("/drivers/location", {
      method: "PUT",
      token: ctx.driverB.accessToken,
      body: { isOnline: false },
    });
    expect(res.status, "status").toBe(204);

    const after = await profileOf(ctx.driverB);
    expect(after.isOnline, "isOnline").toBe(false);
    expect(after.currentLat, "currentLat preserved").toBe(before.currentLat);

    await goOnline(ctx.driverB, KOCHI_NEARBY); // restore for later suites
  });

  test("2.7", "malformed coordinates are refused", async () => {
    for (const body of [
      { lat: "nine", lng: 76, isOnline: true },
      { lat: null, lng: 76, isOnline: true },
      { lat: 9.9, lng: 76.2, isOnline: "yes" },
    ]) {
      const res = await api("/drivers/location", { method: "PUT", token: ctx.driverA.accessToken, body });
      expect(res.status, `status for ${JSON.stringify(body)}`).toBe(400);
    }
  });

  test("2.8", "an unapproved driver cannot go online", async () => {
    const res = await api("/drivers/location", {
      method: "PUT",
      token: ctx.driverPending.accessToken,
      body: { lat: KOCHI_NEARBY.lat, lng: KOCHI_NEARBY.lng, isOnline: true },
    });
    expect(res.status, "status").toBe(403);
    expect(res.code, "code").toBe("DRIVER_NOT_APPROVED");

    const profile = await profileOf(ctx.driverPending);
    expect(profile.isOnline, "still offline").toBe(false);
  });

  test("2.9", "a driver with no history sees zeroed earnings, not an error", async () => {
    const res = await api("/drivers/earnings", { token: ctx.driverFar.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.totalEarnings, "totalEarnings").toBe(0);
    expect(res.body.completedTrips, "completedTrips").toBe(0);
    expect(Array.isArray(res.body.trips), "trips is an array").toBe(true);
    expect(res.body.trips.length, "trips length").toBe(0);
  });

  test("2.10", "earnings fares serialise as numbers, not Decimal strings", async () => {
    // The driver app does arithmetic on these (fareOf, the week chart, avgDaily). A Decimal
    // arriving as a JSON string would concatenate instead of adding, silently.
    const res = await api("/drivers/earnings", { token: ctx.driverA.accessToken });
    expect(res.status, "status").toBe(200);
    expect(typeof res.body.totalEarnings, "totalEarnings type").toBe("number");
    for (const trip of res.body.trips) {
      expect(typeof (trip.actualFare ?? trip.estimatedFare ?? 0), `fare type on ${trip.reference}`).toBe("number");
      expect(trip.paymentStatus, "paymentStatus").toBeOneOf(["PENDING", "PAID", "FAILED", "REFUNDED"]);
    }
  });

  test("2.11", "a rider cannot read driver earnings", async () => {
    const res = await api("/drivers/earnings", { token: ctx.rider.accessToken });
    expect(res.status, "status").toBe(403);
  });

  test("2.12", "bank details are empty before anything is saved", async () => {
    const res = await api("/drivers/bank-details", { token: ctx.driverFar.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.accountHolderName, "accountHolderName").toBeNull();
    expect(res.body.bankAccountNumber, "bankAccountNumber").toBeNull();
  });

  test("2.13", "saved bank details round-trip", async () => {
    const details = {
      accountHolderName: "Mock Verified Holder Owner",
      bankAccountNumber: "123456789012",
      ifscCode: "HDFC0001234",
    };
    const put = await api("/drivers/bank-details", { method: "PUT", token: ctx.driverA.accessToken, body: details });
    expect(put.status, "PUT status").toBe(204);

    const get = await api("/drivers/bank-details", { token: ctx.driverA.accessToken });
    expect(get.body.accountHolderName, "accountHolderName").toBe(details.accountHolderName);
    expect(get.body.ifscCode, "ifscCode").toBe(details.ifscCode);
  });

  test("2.14", "empty strings must not blank a saved payout account", async () => {
    const res = await api("/drivers/bank-details", {
      method: "PUT",
      token: ctx.driverA.accessToken,
      body: { accountHolderName: "", bankAccountNumber: "", ifscCode: "" },
    });
    expect(res.status, "status").toBe(400);

    // Checked through the masked view, which is all the server hands back now — the last
    // four digits are enough to prove the stored account is the one saved in 2.13, and not
    // a blank left behind by the rejected write.
    const after = await api("/drivers/bank-details", { token: ctx.driverA.accessToken });
    expect(after.body.hasBankAccountNumber, "an account is still on file").toBe(true);
    expect(String(after.body.bankAccountNumber).endsWith("9012"), "it is the same account").toBe(true);
  });

  test("2.14b", "omitting the account number leaves the saved one alone", async () => {
    // What the driver app does when someone edits their name without retyping the number.
    const res = await api("/drivers/bank-details", {
      method: "PUT",
      token: ctx.driverA.accessToken,
      body: { accountHolderName: "Mock Verified Holder Owner", ifscCode: "HDFC0001234" },
    });
    expect(res.status, "status").toBe(204);

    const after = await api("/drivers/bank-details", { token: ctx.driverA.accessToken });
    expect(after.body.hasBankAccountNumber, "account still on file").toBe(true);
    expect(String(after.body.bankAccountNumber).endsWith("9012"), "unchanged").toBe(true);
  });

  test("2.15", "the account number should come back masked, as the driver UI claims", async () => {
    // Re-saved here rather than relying on 2.13's value: while the empty-string bug in 2.14
    // stands, that case blanks the account, and this one would then pass for the wrong
    // reason — a masked-looking empty string rather than an actually masked number.
    await api("/drivers/bank-details", {
      method: "PUT",
      token: ctx.driverA.accessToken,
      body: {
        accountHolderName: "Mock Verified Holder Owner",
        bankAccountNumber: "123456789012",
        ifscCode: "HDFC0001234",
      },
    });

    const res = await api("/drivers/bank-details", { token: ctx.driverA.accessToken });
    const shown = String(res.body.bankAccountNumber ?? "");
    expect(shown.length, "something is returned").toBeGreaterThan(0);
    expect(shown.includes("123456789012"), "full number is exposed").toBe(false);
    expect(shown.endsWith("9012"), "the last four are still recognisable").toBe(true);
  });

  test("2.16", "bank details are scoped to the calling driver", async () => {
    const res = await api("/drivers/bank-details", { token: ctx.driverB.accessToken });
    expect(res.status, "status").toBe(200);
    // driverB never saved anything; seeing driverA's account here would be a leak.
    expect(res.body.bankAccountNumber, "driverB sees nothing of driverA's").toBeNull();
  });

  test("2.17", "a rider cannot read or write bank details", async () => {
    expect((await api("/drivers/bank-details", { token: ctx.rider.accessToken })).status, "GET").toBe(403);
    expect(
      (
        await api("/drivers/bank-details", {
          method: "PUT",
          token: ctx.rider.accessToken,
          body: { accountHolderName: "X", bankAccountNumber: "1", ifscCode: "Y" },
        })
      ).status,
      "PUT",
    ).toBe(403);
  });

  test("2.18", "GET /users/me works for a rider and hides the password hash", async () => {
    const res = await api("/users/me", { token: ctx.rider.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.user.id, "id").toBe(ctx.rider.id);
    expect(res.body.user.passwordHash, "passwordHash").toBeUndefined();
  });

  test("2.19", "PATCH /users/me updates rider profile fields", async () => {
    const res = await api("/users/me", {
      method: "PATCH",
      token: ctx.rider.accessToken,
      body: { companyName: `Acme ${ctx.runId}`, email: `rider.${ctx.runId}@example.com` },
    });
    expect(res.status, "status").toBe(200);
    expect(res.body.user.companyName, "companyName").toBe(`Acme ${ctx.runId}`);
  });

  test("2.20", "PATCH /users/me rejects a malformed email", async () => {
    const res = await api("/users/me", { method: "PATCH", token: ctx.rider.accessToken, body: { email: "not-an-email" } });
    expect(res.status, "status").toBe(400);
  });
});
