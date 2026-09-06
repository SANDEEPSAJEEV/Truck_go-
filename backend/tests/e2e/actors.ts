/**
 * The cast each run needs, built through the public API wherever possible.
 *
 * The only reason this can exist at all is `devCode`: `issueOtp` returns the plaintext code
 * while the mock SMS provider is active, so registration is scriptable end to end. Without it
 * the OTP would only ever reach a server log and no automated test could get past step one —
 * which is exactly the dead end a real driver hit on the last build.
 *
 * Names are deliberate. The mock KYC provider reports the licence holder as
 * "MOCK VERIFIED HOLDER" and the vehicle owner as "MOCK VERIFIED OWNER", and
 * `namesMatch` in lib/verification.ts requires at least two overlapping name tokens against
 * the registered `fullName`. "Mock Verified Holder Owner" satisfies both checks, which is what
 * lets a driver reach APPROVED without an admin in the loop.
 */

import crypto from "crypto";
import { OtpPurpose } from "@prisma/client";

import { api, apiOk, setTokenRefresher, sleep } from "./http";
import { db } from "./db";

/**
 * Whether the target deployment still echoes OTP codes back over HTTP.
 *
 * Flipped to false the first time a request comes back without one, which is what happens
 * the moment ALLOW_MOCK_PROVIDERS is removed and a real gateway takes over.
 */
let SMS_IS_MOCKED = true;

export const KOCHI = { lat: 9.9312, lng: 76.2673 };
/** ~5 km north of the pickup point — inside the first 15 km dispatch ring. */
export const KOCHI_NEARBY = { lat: 9.9762, lng: 76.2673 };
/** ~25 km out — outside ring one, inside ring two, which is what proves the ladder widens. */
export const RING_TWO = { lat: 10.1562, lng: 76.2673 };
/** Kozhikode, ~170 km — outside every ring. */
export const FAR_AWAY = { lat: 11.2588, lng: 75.7804 };

export type Actor = {
  label: string;
  role: "USER" | "DRIVER" | "ADMIN";
  id: string;
  phone: string;
  password: string;
  fullName: string;
  accessToken: string;
  refreshToken: string;
  vehicleType?: string;
  vehicleNumber?: string;
  drivingLicenseNumber?: string;
};

export type Ctx = {
  runId: string;
  phonePrefix: string;
  rider: Actor;
  /** A second rider, for every cross-tenant authorization case. */
  rider2: Actor;
  /** Approved, tataAce, parked near the pickup point. Wins bids and runs trips. */
  driverA: Actor;
  /** Approved, tataAce, same spot. The losing bidder, and the second half of race cases. */
  driverB: Actor;
  /** Approved, container. Proves the vehicle-type filter excludes him. */
  driverWrongVehicle: Actor;
  /** Approved, tataAce, 170 km away. Proves the radius filter excludes him. */
  driverFar: Actor;
  /** Registered but never verified. Proves every approval gate. */
  driverPending: Actor;
  admin?: Actor;
};

/** Filled by `buildActors` and read by every suite. */
export const ctx = {} as Ctx;

export const PASSWORD = "TestPass!2026";

/**
 * Which actor is behind a given access token, so an expired one can be renewed transparently.
 *
 * A full run outlives the 15-minute access-token lifetime several times over. Without this
 * every case past that point would fail with a 401 that has nothing to do with what it was
 * testing.
 */
const tokenOwners = new Map<string, Actor>();

export function trackToken(actor: Actor): void {
  tokenOwners.set(actor.accessToken, actor);
}

setTokenRefresher(async (staleToken) => {
  const actor = tokenOwners.get(staleToken);
  if (!actor) return null; // a forged or hand-built token — the 401 is the real answer

  // Refresh first: it has no per-phone rate limiter, where login is capped at 10 per 15
  // minutes and would run out over a long run.
  const rotated = await api<{ accessToken: string; refreshToken: string }>("/auth/refresh", {
    method: "POST",
    body: { refreshToken: actor.refreshToken },
    noRefresh: true,
  });
  if (rotated.status === 200 && rotated.body?.accessToken) {
    tokenOwners.delete(staleToken);
    actor.accessToken = rotated.body.accessToken;
    actor.refreshToken = rotated.body.refreshToken;
    trackToken(actor);
    return actor.accessToken;
  }

  // The refresh token can itself be gone — a password change revokes every session, and some
  // cases do exactly that. Falling back to a fresh login keeps the actor usable.
  const session = await api<{ accessToken: string; refreshToken: string }>(
    actor.role === "DRIVER" ? "/auth/driver" : actor.role === "ADMIN" ? "/auth/admin" : "/auth/login",
    { method: "POST", body: { phone: actor.phone, password: actor.password }, noRefresh: true },
  );
  if (session.status === 200 && session.body?.accessToken) {
    tokenOwners.delete(staleToken);
    actor.accessToken = session.body.accessToken;
    actor.refreshToken = session.body.refreshToken;
    trackToken(actor);
    return actor.accessToken;
  }

  return null;
});

let phoneCounter = 0;

/**
 * A phone unique to this run, so per-phone rate limiters (5 OTP requests / 15 min, 10 login
 * attempts / 15 min, both keyed on phone+IP) never bleed between cases.
 */
export function nextPhone(prefix: string): string {
  phoneCounter += 1;
  return `${prefix}${String(phoneCounter).padStart(3, "0")}`;
}

/**
 * Plants a challenge the suite already knows the code for.
 *
 * Used once a real SMS provider is configured and `devCode` stops coming back. It writes the
 * same row `issueOtp` would, hashed the same way — `sha256(phone:purpose:code)` — so
 * `verifyOtp` is still exercised for real against a real row. Nothing in the server changes
 * shape for tests: there is no test-only endpoint and no branch in production code.
 *
 * It also avoids the other half of the problem. With a live gateway, every fixture actor in
 * every run would send an actual SMS to a fabricated number — money spent, and on a Twilio
 * trial an outright failure, since trials only deliver to numbers you have verified.
 */
async function seedOtp(phone: string, purpose: OtpPurpose): Promise<string> {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const codeHash = crypto.createHash("sha256").update(`${phone}:${purpose}:${code}`).digest("hex");

  // Retire any live challenge first, exactly as issueOtp does — verifyOtp reads the newest
  // unconsumed row, so a leftover would otherwise win.
  await db.otpChallenge.updateMany({
    where: { phone, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await db.otpChallenge.create({
    data: { phone, purpose, codeHash, expiresAt: new Date(Date.now() + 5 * 60_000) },
  });
  return code;
}

/**
 * A usable code for this phone.
 *
 * Prefers the real endpoint: while the mock provider is active it returns `devCode`, so the
 * suite drives exactly what the app drives. Once a real provider is configured that field is
 * gone by design, and the challenge is seeded directly instead.
 */
export async function getOtp(phone: string, purpose: "verify" | "reset" = "verify"): Promise<string> {
  const otpPurpose = purpose === "verify" ? OtpPurpose.PHONE_VERIFICATION : OtpPurpose.PASSWORD_RESET;

  if (SMS_IS_MOCKED) {
    const path = purpose === "verify" ? "/auth/request-otp" : "/auth/forgot-password";
    // Deliberately not apiOk: against a live gateway this call is *expected* to fail, because
    // fixture phone numbers are invented and a trial account only delivers to numbers someone
    // verified by hand. Treating that as a broken fixture would stop the whole run.
    const res = await api<{ devCode?: string }>(path, { method: "POST", body: { phone } });
    if (res.status === 200 && res.body?.devCode) return res.body.devCode;

    // No devCode means a real provider is configured. Remember it, so the rest of the run
    // stops asking a paid gateway to text numbers that do not exist.
    SMS_IS_MOCKED = false;
  }

  return seedOtp(phone, otpPurpose);
}

/** Full phone-ownership handshake, returning the token registration requires. */
export async function verifyPhone(phone: string): Promise<string> {
  const code = await getOtp(phone, "verify");
  const body = await apiOk<{ verificationToken: string }>("/auth/verify-otp", {
    method: "POST",
    body: { phone, code },
  });
  return body.verificationToken;
}

export async function login(
  phone: string,
  password: string,
  role: "USER" | "DRIVER" | "ADMIN",
): Promise<{ user: any; accessToken: string; refreshToken: string }> {
  const path = role === "DRIVER" ? "/auth/driver" : role === "ADMIN" ? "/auth/admin" : "/auth/login";
  return apiOk(path, { method: "POST", body: { phone, password } });
}

async function registerRider(label: string, runId: string, phonePrefix: string): Promise<Actor> {
  const phone = nextPhone(phonePrefix);
  const fullName = `Test Rider ${label} ${runId}`;
  const verificationToken = await verifyPhone(phone);

  await apiOk("/auth/register/user", {
    method: "POST",
    body: {
      fullName,
      phone,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      verificationToken,
      acceptTermsAndConditions: true,
      acceptPrivacyPolicy: true,
    },
  });

  const session = await login(phone, PASSWORD, "USER");
  const actor: Actor = {
    label,
    role: "USER",
    id: session.user.id,
    phone,
    password: PASSWORD,
    fullName,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  };
  trackToken(actor);
  return actor;
}

type DriverSpec = {
  label: string;
  vehicleType: string;
  vehicleNumber: string;
  drivingLicenseNumber: string;
  /** Leave undefined to keep the driver unverified. */
  position?: { lat: number; lng: number };
  approve: boolean;
};

async function registerDriver(spec: DriverSpec, runId: string, phonePrefix: string): Promise<Actor> {
  const phone = nextPhone(phonePrefix);
  // Matches both mock KYC identities, so `namesMatch` clears the licence and the RC.
  const fullName = `Mock Verified Holder Owner ${runId}`;
  const verificationToken = await verifyPhone(phone);

  await apiOk("/auth/register/driver", {
    method: "POST",
    body: {
      fullName,
      phone,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      verificationToken,
      vehicleType: spec.vehicleType,
      vehicleNumber: spec.vehicleNumber,
      drivingLicenseNumber: spec.drivingLicenseNumber,
      acceptTermsAndConditions: true,
      acceptPrivacyPolicy: true,
    },
  });

  const session = await login(phone, PASSWORD, "DRIVER");
  const actor: Actor = {
    label: spec.label,
    role: "DRIVER",
    id: session.user.id,
    phone,
    password: PASSWORD,
    fullName,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    vehicleType: spec.vehicleType,
    vehicleNumber: spec.vehicleNumber,
    drivingLicenseNumber: spec.drivingLicenseNumber,
  };
  trackToken(actor);

  if (spec.approve) {
    const result = await apiOk<{ verificationStatus: string }>("/drivers/documents/verify", {
      method: "POST",
      token: actor.accessToken,
    });
    if (result.verificationStatus !== "APPROVED") {
      throw new Error(
        `setup: driver ${spec.label} reached ${result.verificationStatus}, not APPROVED. ` +
          `Check that ALLOW_MOCK_PROVIDERS=1 is set and that the fixture name still satisfies namesMatch.`,
      );
    }
  }

  if (spec.position) {
    await goOnline(actor, spec.position);
  }

  return actor;
}

/** Puts a driver on the dispatch board at a specific point. */
export async function goOnline(actor: Actor, at: { lat: number; lng: number }): Promise<void> {
  const res = await api("/drivers/location", {
    method: "PUT",
    token: actor.accessToken,
    body: { lat: at.lat, lng: at.lng, isOnline: true },
  });
  if (res.status !== 204) {
    throw new Error(`setup: ${actor.label} could not go online (${res.status} ${res.text.slice(0, 200)})`);
  }
}

export async function goOffline(actor: Actor): Promise<void> {
  await api("/drivers/location", { method: "PUT", token: actor.accessToken, body: { isOnline: false } });
}

export async function buildActors(runId: string, phonePrefix: string): Promise<Ctx> {
  ctx.runId = runId;
  ctx.phonePrefix = phonePrefix;

  // Sequential, not parallel. `otpRequestLimiter` is keyed on phone+IP but the general
  // limiter is IP-only, and a burst of eight registrations is the fastest way to spend the
  // budget before the suite has run a single case.
  ctx.rider = await registerRider("rider", runId, phonePrefix);
  ctx.rider2 = await registerRider("rider2", runId, phonePrefix);

  ctx.driverA = await registerDriver(
    {
      label: "driverA",
      vehicleType: "tataAce",
      vehicleNumber: "KL07AB1234",
      drivingLicenseNumber: "KL0120240001234",
      position: KOCHI_NEARBY,
      approve: true,
    },
    runId,
    phonePrefix,
  );

  ctx.driverB = await registerDriver(
    {
      label: "driverB",
      vehicleType: "tataAce",
      vehicleNumber: "KL07AB5678",
      drivingLicenseNumber: "KL0120240005678",
      position: KOCHI_NEARBY,
      approve: true,
    },
    runId,
    phonePrefix,
  );

  ctx.driverWrongVehicle = await registerDriver(
    {
      label: "driverWrongVehicle",
      vehicleType: "container",
      vehicleNumber: "KL07CD1111",
      drivingLicenseNumber: "KL0120240001111",
      position: KOCHI_NEARBY,
      approve: true,
    },
    runId,
    phonePrefix,
  );

  ctx.driverFar = await registerDriver(
    {
      label: "driverFar",
      vehicleType: "tataAce",
      vehicleNumber: "KL11EF2222",
      drivingLicenseNumber: "KL0120240002222",
      position: FAR_AWAY,
      approve: true,
    },
    runId,
    phonePrefix,
  );

  ctx.driverPending = await registerDriver(
    {
      label: "driverPending",
      vehicleType: "tataAce",
      vehicleNumber: "KL07GH3333",
      drivingLicenseNumber: "KL0120240003333",
      approve: false,
    },
    runId,
    phonePrefix,
  );

  return ctx;
}

/**
 * A throwaway rider for cases that burn a per-phone rate limiter or lock an account out.
 * Carries the run id so teardown collects it with everything else.
 */
export async function disposableRider(label: string): Promise<Actor> {
  return registerRider(label, ctx.runId, ctx.phonePrefix);
}

/**
 * An access token that is definitely still valid, for opening a socket.
 *
 * Socket handshakes don't go through `api()`, so the transparent refresh that keeps HTTP
 * calls alive never sees them. A run outlives the 15-minute token lifetime several times
 * over, so a socket opened with a fixture's cached token is simply refused — and the case
 * fails with "unauthorized", which looks exactly like a real authorization defect.
 *
 * Touching an authenticated endpoint first is enough: `api()` refreshes on the 401 and
 * updates the actor in place.
 */
export async function liveToken(actor: Actor): Promise<string> {
  await api("/users/me", { token: actor.accessToken });
  return actor.accessToken;
}

/** A booking in the standard Kochi corridor, ready for the dispatch and bidding suites. */
export async function createBooking(
  rider: Actor,
  overrides: Record<string, unknown> = {},
): Promise<any> {
  const body = await apiOk<{ booking: any }>("/bookings", {
    method: "POST",
    token: rider.accessToken,
    body: {
      pickup: { address: "Marine Drive, Kochi", lat: KOCHI.lat, lng: KOCHI.lng },
      drop: { address: "Thrissur Round, Thrissur", lat: 10.5276, lng: 76.2144 },
      vehicleType: "tataAce",
      weightTons: 2,
      goodsType: "General cargo",
      ...overrides,
    },
  });
  // Dispatch fans out asynchronously after the 201.
  await sleep(600);
  return body.booking;
}

/** Reads the driver profile straight from the database, for side-effect assertions. */
export async function profileOf(actor: Actor) {
  return db.driverProfile.findUniqueOrThrow({ where: { userId: actor.id } });
}
