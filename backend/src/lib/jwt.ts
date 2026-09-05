import crypto from "crypto";
import jwt from "jsonwebtoken";

// Previously these fell back to hardcoded strings. That meant a deploy which forgot to set
// the env vars would silently sign tokens with a secret published in this repository, so
// anyone could forge a token for any user. Missing secrets are now a startup failure.
function requireSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} must be set in production. Refusing to start with a known secret.`);
  }
  return devFallback;
}

const ACCESS_SECRET = requireSecret("JWT_ACCESS_SECRET", "dev-access-secret");
const REFRESH_SECRET = requireSecret("JWT_REFRESH_SECRET", "dev-refresh-secret");
const VERIFICATION_SECRET = requireSecret("JWT_VERIFICATION_SECRET", "dev-verification-secret");

export type AccessTokenPayload = {
  sub: string;
  role: "USER" | "DRIVER" | "ADMIN";
};

export function signAccessToken(payload: AccessTokenPayload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: "15m" });
}

/**
 * `jti` is what makes every refresh token a distinct string.
 *
 * Without it the payload is {sub, role, familyId, iat, exp}, and `iat` has one-second
 * resolution — so rotating a token in the same second it was issued produced a byte-identical
 * JWT. Identical token, identical hash, and the insert then collided with the row it was
 * meant to replace. It surfaced as a crash on exactly the sequence a person produces by
 * signing in on a second device or double-tapping the login button.
 */
export function signRefreshToken(payload: AccessTokenPayload & { familyId: string }) {
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, REFRESH_SECRET, { expiresIn: "30d" });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): AccessTokenPayload & { familyId: string } {
  return jwt.verify(token, REFRESH_SECRET) as AccessTokenPayload & { familyId: string };
}

// Proof that a phone number was verified moments ago. `/auth/verify-otp` used to return
// `{verified:true}` and nothing else, leaving the client to assert its own verification —
// registration simply believed whatever phone number it was handed. Registration now
// demands this token, so the claim is checkable server-side.
export type VerificationTokenPayload = { phone: string; purpose: "PHONE_VERIFICATION" };

export function signVerificationToken(phone: string) {
  return jwt.sign({ phone, purpose: "PHONE_VERIFICATION" } satisfies VerificationTokenPayload, VERIFICATION_SECRET, {
    expiresIn: "15m",
  });
}

export function verifyVerificationToken(token: string): VerificationTokenPayload {
  return jwt.verify(token, VERIFICATION_SECRET) as VerificationTokenPayload;
}
