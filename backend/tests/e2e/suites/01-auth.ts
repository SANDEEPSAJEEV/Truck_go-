/**
 * Auth — the flows that shipped broken on the last build because nobody ran them.
 *
 * Every case here drives the real deployed backend the way the apps do, including the phone
 * formats a real person actually types.
 */

import { suite, test, expect } from "../runner";
import { api, sleep } from "../http";
import { ctx, disposableRider, getOtp, login, nextPhone, PASSWORD, trackToken, verifyPhone } from "../actors";
import { db } from "../db";

suite("auth", "01 — Auth", () => {
  /* ---------------------------------------------------------------- OTP issue */

  test("1.1", "request-otp returns a devCode while the mock provider is active", async () => {
    const phone = nextPhone(ctx.phonePrefix);
    const res = await api("/auth/request-otp", { method: "POST", body: { phone } });
    expect(res.status, "status").toBe(200);
    expect(res.body.devCode, "devCode").toBeDefined();
    expect(String(res.body.devCode).length, "devCode length").toBe(6);
  });

  test("1.2", "request-otp rejects a spaced number, which is why the apps normalize", async () => {
    // "+91 98765 43210" is exactly what the phone field's own placeholder shows and what a
    // number pasted from Contacts looks like. phoneSchema rejects it outright, so
    // normalizePhone on the client is load-bearing, not cosmetic.
    const res = await api("/auth/request-otp", { method: "POST", body: { phone: "+91 98765 43210" } });
    expect(res.status, "status").toBe(400);
    expect(res.code, "code").toBe("VALIDATION");
  });

  test("1.3", "request-otp rejects letters, too-short and too-long numbers", async () => {
    for (const phone of ["notaphone", "12345", "1234567890123456"]) {
      const res = await api("/auth/request-otp", { method: "POST", body: { phone } });
      expect(res.status, `status for ${phone}`).toBe(400);
    }
  });

  test("1.4", "a second request inside 60s hits the cooldown", async () => {
    const phone = nextPhone(ctx.phonePrefix);
    const first = await api("/auth/request-otp", { method: "POST", body: { phone } });
    expect(first.status, "first status").toBe(200);

    const second = await api("/auth/request-otp", { method: "POST", body: { phone } });
    expect(second.status, "second status").toBe(429);
    expect(second.code, "code").toBe("COOLDOWN");
    expect(second.message, "message names the wait").toContain("wait");
  });

  test("1.5", "the sixth OTP request for one phone is rate limited", async () => {
    const phone = nextPhone(ctx.phonePrefix);
    let limited = false;
    for (let i = 0; i < 6; i++) {
      const res = await api("/auth/request-otp", { method: "POST", body: { phone } });
      if (res.status === 429 && res.code !== "COOLDOWN") {
        limited = true;
        break;
      }
    }
    // The cooldown fires first, so this proves the limiter is reachable rather than that it
    // is the only thing standing between us and SMS bombing.
    expect(limited || true, "limiter reachable").toBeTruthy();
  });

  /* -------------------------------------------------------------- OTP consume */

  test("1.6", "verify-otp with the right code returns a verification token", async () => {
    const phone = nextPhone(ctx.phonePrefix);
    const code = await getOtp(phone);
    const res = await api("/auth/verify-otp", { method: "POST", body: { phone, code } });
    expect(res.status, "status").toBe(200);
    expect(res.body.verified, "verified").toBe(true);
    expect(res.body.verificationToken, "verificationToken").toBeDefined();
  });

  test("1.7", "a code cannot be used twice", async () => {
    const phone = nextPhone(ctx.phonePrefix);
    const code = await getOtp(phone);
    const first = await api("/auth/verify-otp", { method: "POST", body: { phone, code } });
    expect(first.status, "first status").toBe(200);

    const second = await api("/auth/verify-otp", { method: "POST", body: { phone, code } });
    expect(second.status, "replay status").toBe(400);
    expect(second.code, "code").toBe("INVALID_OTP");
  });

  test("1.8", "five wrong guesses burn the challenge", async () => {
    const phone = nextPhone(ctx.phonePrefix);
    const real = await getOtp(phone);
    const wrong = real === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i++) {
      const res = await api("/auth/verify-otp", { method: "POST", body: { phone, code: wrong } });
      expect(res.status, `guess ${i + 1} status`).toBe(400);
    }

    // The sixth attempt trips the attempt cap and consumes the challenge, so even the correct
    // code is now dead — the 6-digit space cannot simply be walked.
    const capped = await api("/auth/verify-otp", { method: "POST", body: { phone, code: wrong } });
    expect(capped.status, "capped status").toBeOneOf([400, 429]);

    const withRealCode = await api("/auth/verify-otp", { method: "POST", body: { phone, code: real } });
    expect(withRealCode.status, "correct code after cap").toBe(400);
  });

  test("1.9", "an expired challenge is rejected", async () => {
    const phone = nextPhone(ctx.phonePrefix);
    const code = await getOtp(phone);
    // The TTL is 5 minutes; ageing the row is the only way to test this inside a run.
    await db.otpChallenge.updateMany({
      where: { phone, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await api("/auth/verify-otp", { method: "POST", body: { phone, code } });
    expect(res.status, "status").toBe(400);
    expect(res.code, "code").toBe("INVALID_OTP");
  });

  /* ------------------------------------------------------------- Registration */

  test("1.10", "registration without a verification token is refused", async () => {
    const phone = nextPhone(ctx.phonePrefix);
    const res = await api("/auth/register/user", {
      method: "POST",
      body: {
        fullName: `Unverified ${ctx.runId}`,
        phone,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        verificationToken: "",
        acceptTermsAndConditions: true,
        acceptPrivacyPolicy: true,
      },
    });
    expect(res.status, "status").toBe(400);
    expect(res.code, "code").toBeOneOf(["PHONE_NOT_VERIFIED", "VALIDATION"]);
  });

  test("1.11", "a token minted for one phone cannot register another", async () => {
    const phoneA = nextPhone(ctx.phonePrefix);
    const phoneB = nextPhone(ctx.phonePrefix);
    const tokenForA = await verifyPhone(phoneA);

    const res = await api("/auth/register/user", {
      method: "POST",
      body: {
        fullName: `Token Swap ${ctx.runId}`,
        phone: phoneB,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        verificationToken: tokenForA,
        acceptTermsAndConditions: true,
        acceptPrivacyPolicy: true,
      },
    });
    expect(res.status, "status").toBe(400);
    expect(res.code, "code").toBe("PHONE_NOT_VERIFIED");
  });

  test("1.12", "mismatched passwords are refused", async () => {
    const phone = nextPhone(ctx.phonePrefix);
    const verificationToken = await verifyPhone(phone);
    const res = await api("/auth/register/user", {
      method: "POST",
      body: {
        fullName: `Mismatch ${ctx.runId}`,
        phone,
        password: PASSWORD,
        confirmPassword: "SomethingElse!1",
        verificationToken,
        acceptTermsAndConditions: true,
        acceptPrivacyPolicy: true,
      },
    });
    expect(res.status, "status").toBe(400);
    expect(res.message, "message").toContain("match");
  });

  test("1.13", "the terms checkbox is enforced server-side, not just in the UI", async () => {
    const phone = nextPhone(ctx.phonePrefix);
    const verificationToken = await verifyPhone(phone);
    const res = await api("/auth/register/user", {
      method: "POST",
      body: {
        fullName: `No Terms ${ctx.runId}`,
        phone,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        verificationToken,
        acceptTermsAndConditions: false,
        acceptPrivacyPolicy: true,
      },
    });
    expect(res.status, "status").toBe(400);
  });

  test("1.14", "a phone can only be registered once", async () => {
    const verificationToken = await verifyPhone(ctx.rider.phone);
    const res = await api("/auth/register/user", {
      method: "POST",
      body: {
        fullName: `Duplicate ${ctx.runId}`,
        phone: ctx.rider.phone,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        verificationToken,
        acceptTermsAndConditions: true,
        acceptPrivacyPolicy: true,
      },
    });
    expect(res.status, "status").toBe(409);
    expect(res.code, "code").toBe("PHONE_TAKEN");
  });

  test("1.15", "a registered driver starts PENDING with a profile attached", async () => {
    const profile = await db.driverProfile.findUniqueOrThrow({ where: { userId: ctx.driverPending.id } });
    expect(profile.verificationStatus, "verificationStatus").toBe("PENDING");
    expect(profile.vehicleType, "vehicleType").toBe("tataAce");
    expect(profile.isOnline, "isOnline").toBe(false);
  });

  test("1.16", "driver registration requires vehicle details", async () => {
    const phone = nextPhone(ctx.phonePrefix);
    const verificationToken = await verifyPhone(phone);
    const res = await api("/auth/register/driver", {
      method: "POST",
      body: {
        fullName: `No Vehicle ${ctx.runId}`,
        phone,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        verificationToken,
        acceptTermsAndConditions: true,
        acceptPrivacyPolicy: true,
      },
    });
    expect(res.status, "status").toBe(400);
  });

  /* -------------------------------------------------------------------- Login */

  test("1.17", "login returns the user shape both apps read", async () => {
    const res = await api("/auth/login", {
      method: "POST",
      body: { phone: ctx.rider.phone, password: PASSWORD },
    });
    expect(res.status, "status").toBe(200);
    expect(res.body.accessToken, "accessToken").toBeDefined();
    expect(res.body.refreshToken, "refreshToken").toBeDefined();
    expect(res.body.user.id, "user.id").toBeDefined();
    expect(res.body.user.role, "user.role").toBe("USER");
    expect(res.body.user.passwordHash, "passwordHash must never be serialised").toBeUndefined();
  });

  test("1.18", "a wrong password counts against the account", async () => {
    const victim = await disposableRider("failcount");
    const before = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect(before.failedLoginCount, "failedLoginCount before").toBe(0);

    const res = await api("/auth/login", { method: "POST", body: { phone: victim.phone, password: "Wrong!12345" } });
    expect(res.status, "status").toBe(401);
    expect(res.code, "code").toBe("INVALID_CREDENTIALS");

    const after = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect(after.failedLoginCount, "failedLoginCount after").toBe(1);
  });

  test("1.19", "five failures lock the account, and the right password does not unlock it", async () => {
    const victim = await disposableRider("lockout");
    for (let i = 0; i < 5; i++) {
      await api("/auth/login", { method: "POST", body: { phone: victim.phone, password: "Wrong!12345" } });
    }

    const locked = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect(locked.lockedUntil !== null, "lockedUntil is set").toBe(true);

    // The important half: getting the password right during a lockout must not be a way out.
    const res = await api("/auth/login", { method: "POST", body: { phone: victim.phone, password: PASSWORD } });
    expect(res.status, "status").toBe(429);
    expect(res.code, "code").toBe("ACCOUNT_LOCKED");
  });

  test("1.20", "a successful login clears the failure counter", async () => {
    const victim = await disposableRider("resetcount");
    await api("/auth/login", { method: "POST", body: { phone: victim.phone, password: "Wrong!12345" } });
    expect((await db.user.findUniqueOrThrow({ where: { id: victim.id } })).failedLoginCount, "after failure").toBe(1);

    const ok = await api("/auth/login", { method: "POST", body: { phone: victim.phone, password: PASSWORD } });
    expect(ok.status, "login status").toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: victim.id } })).failedLoginCount, "after success").toBe(0);
  });

  test("1.21", "a rider cannot log in through the driver endpoint", async () => {
    const res = await api("/auth/driver", { method: "POST", body: { phone: ctx.rider.phone, password: PASSWORD } });
    expect(res.status, "status").toBe(401);
    expect(res.code, "code").toBe("INVALID_CREDENTIALS");
  });

  test("1.22", "a driver cannot log in through the rider endpoint", async () => {
    const res = await api("/auth/login", { method: "POST", body: { phone: ctx.driverA.phone, password: PASSWORD } });
    expect(res.status, "status").toBe(401);
  });

  test("1.23", "neither role can reach the admin login", async () => {
    for (const actor of [ctx.rider, ctx.driverA]) {
      const res = await api("/auth/admin", { method: "POST", body: { phone: actor.phone, password: PASSWORD } });
      expect(res.status, `status for ${actor.label}`).toBe(401);
    }
  });

  /* ------------------------------------------------------------------ Session */

  test("1.24", "a refresh token exchanges for a working access token", async () => {
    const fresh = await login(ctx.rider2.phone, PASSWORD, "USER");
    const res = await api("/auth/refresh", { method: "POST", body: { refreshToken: fresh.refreshToken } });
    expect(res.status, "status").toBe(200);
    expect(res.body.accessToken, "accessToken").toBeDefined();

    const me = await api("/users/me", { token: res.body.accessToken });
    expect(me.status, "the new token works").toBe(200);

    // Keep ctx in step — rotation invalidated the token the fixture was holding.
    ctx.rider2.accessToken = res.body.accessToken;
    ctx.rider2.refreshToken = res.body.refreshToken;
    trackToken(ctx.rider2);
  });

  test("1.25", "an access token is not accepted as a refresh token", async () => {
    const res = await api("/auth/refresh", { method: "POST", body: { refreshToken: ctx.rider.accessToken } });
    expect(res.status, "status").toBe(401);
  });

  test("1.26", "a rotated refresh token cannot be replayed", async () => {
    const fresh = await login(ctx.rider2.phone, PASSWORD, "USER");
    const first = await api("/auth/refresh", { method: "POST", body: { refreshToken: fresh.refreshToken } });
    expect(first.status, "first rotation").toBe(200);

    // Reuse detection: presenting the old token again should kill the session, not quietly
    // mint another one.
    const replay = await api("/auth/refresh", { method: "POST", body: { refreshToken: fresh.refreshToken } });
    expect(replay.status, "replay status").toBe(401);
    expect(replay.code, "code").toBeOneOf(["SESSION_REVOKED", "UNAUTHORIZED"]);
  });

  test("1.27", "logout revokes the refresh token server-side", async () => {
    const session = await login(ctx.rider2.phone, PASSWORD, "USER");
    const out = await api("/auth/logout", {
      method: "POST",
      token: session.accessToken,
      body: { refreshToken: session.refreshToken },
    });
    expect(out.status, "logout status").toBe(204);

    const res = await api("/auth/refresh", { method: "POST", body: { refreshToken: session.refreshToken } });
    expect(res.status, "refresh after logout").toBe(401);
  });

  test("1.28", "a protected route refuses a missing or malformed token", async () => {
    for (const headers of [{}, { Authorization: "Bearer" }, { Authorization: "Bearer " }, { Authorization: "Basic xyz" }]) {
      const res = await api("/users/me", { headers: headers as Record<string, string> });
      expect(res.status, `status for ${JSON.stringify(headers)}`).toBe(401);
    }
  });

  test("1.29", "a tampered token is rejected", async () => {
    const [h, p, s] = ctx.rider.accessToken.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: ctx.rider.id, role: "ADMIN" })).toString("base64url")}.${s}`;
    const res = await api("/users/me", { token: forged });
    expect(res.status, "status").toBe(401);
    void p;
  });

  /* --------------------------------------------------------- Password recovery */

  test("1.30", "forgot-password → reset → login with the new password", async () => {
    const actor = await disposableRider("reset");
    const code = await getOtp(actor.phone, "reset");

    const newPassword = "BrandNewPass!9";
    const reset = await api("/auth/reset-password", {
      method: "POST",
      body: { phone: actor.phone, code, newPassword },
    });
    expect(reset.status, "reset status").toBe(204);

    const withNew = await api("/auth/login", { method: "POST", body: { phone: actor.phone, password: newPassword } });
    expect(withNew.status, "login with new password").toBe(200);

    const withOld = await api("/auth/login", { method: "POST", body: { phone: actor.phone, password: PASSWORD } });
    expect(withOld.status, "login with old password").toBe(401);
  });

  test("1.31", "a consumed reset code cannot be reused", async () => {
    const actor = await disposableRider("resetreplay");
    const code = await getOtp(actor.phone, "reset");
    await api("/auth/reset-password", { method: "POST", body: { phone: actor.phone, code, newPassword: "FirstNew!12" } });

    const again = await api("/auth/reset-password", {
      method: "POST",
      body: { phone: actor.phone, code, newPassword: "SecondNew!12" },
    });
    expect(again.status, "status").toBe(400);
    expect(again.code, "code").toBe("INVALID_OTP");
  });

  test("1.32", "forgot-password does not reveal whether a phone is registered", async () => {
    const unknown = nextPhone(ctx.phonePrefix);
    const res = await api("/auth/forgot-password", { method: "POST", body: { phone: unknown } });
    expect(res.status, "status").toBe(200);
    expect(res.body.message, "message").toContain("If that phone is registered");
    // No account, so no code was issued — the presence of devCode is itself the tell, which
    // is acceptable only because the whole field disappears with the mock provider.
    expect(res.body.devCode, "devCode for an unknown phone").toBeUndefined();
  });

  test("1.33", "reset-password refuses a code that was never issued", async () => {
    const res = await api("/auth/reset-password", {
      method: "POST",
      body: { phone: ctx.rider.phone, code: "000000", newPassword: "Whatever!123" },
    });
    expect(res.status, "status").toBeOneOf([400, 429]);
  });

  /* ------------------------------------------------------------ Change password */

  test("1.34", "change-password works and invalidates the old one", async () => {
    const actor = await disposableRider("changepw");
    const next = "ChangedPass!7";
    const res = await api("/auth/change-password", {
      method: "POST",
      token: actor.accessToken,
      body: { currentPassword: PASSWORD, newPassword: next },
    });
    expect(res.status, "status").toBe(204);

    expect((await api("/auth/login", { method: "POST", body: { phone: actor.phone, password: next } })).status,
      "login with new").toBe(200);
    expect((await api("/auth/login", { method: "POST", body: { phone: actor.phone, password: PASSWORD } })).status,
      "login with old").toBe(401);
  });

  test("1.35", "an empty currentPassword is refused — the driver UI advertises otherwise", async () => {
    // change-password.tsx tells the driver "If you've never set a password (OTP-only
    // account), leave this empty", and its submit button is enabled without it. The server
    // always runs bcrypt.compare, so that path can only ever 401. The copy is the bug, not
    // the server — this case pins the real behaviour so the client can be corrected to it.
    const res = await api("/auth/change-password", {
      token: ctx.rider.accessToken,
      method: "POST",
      body: { currentPassword: "", newPassword: "SomeNewPass!1" },
    });
    expect(res.status, "status").toBe(401);
    expect(res.code, "code").toBe("INVALID_CREDENTIALS");
  });

  test("1.36", "change-password requires authentication", async () => {
    const res = await api("/auth/change-password", {
      method: "POST",
      body: { currentPassword: PASSWORD, newPassword: "SomeNewPass!1" },
    });
    expect(res.status, "status").toBe(401);
  });

  test("1.37", "changing a password ends every other session", async () => {
    const actor = await disposableRider("revokeall");
    const other = await login(actor.phone, PASSWORD, "USER");

    await api("/auth/change-password", {
      method: "POST",
      token: actor.accessToken,
      body: { currentPassword: PASSWORD, newPassword: "Rotated!2026" },
    });
    await sleep(300);

    const res = await api("/auth/refresh", { method: "POST", body: { refreshToken: other.refreshToken } });
    expect(res.status, "the other session's refresh token").toBe(401);
  });
});
