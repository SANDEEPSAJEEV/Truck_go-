import crypto from "crypto";
import { OtpPurpose } from "@prisma/client";
import { prisma } from "./prisma";
import { getSmsProvider } from "./sms";

const CODE_LENGTH = 6;
const TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;

/** Six digits, uniformly distributed, from a cryptographic source. */
export function generateOtp(): string {
  const max = 10 ** CODE_LENGTH;
  return crypto.randomInt(0, max).toString().padStart(CODE_LENGTH, "0");
}

// Trip custody PINs are a separate concern from account security: the rider reads them
// aloud to the driver, and both apps render them as four tiles. They stay 4 digits.
export function generateTripPin(): string {
  return crypto.randomInt(0, 10_000).toString().padStart(4, "0");
}

/**
 * SMS backup for a trip PIN. The PIN is shown in the rider's app as the primary channel;
 * this covers the rider whose app is closed. Failure to send must not fail the trip
 * transition, so it is logged rather than thrown.
 */
export function sendTripPin(phone: string, pin: string, stage = "pickup") {
  getSmsProvider()
    .send(phone, `${pin} is your TruckGo ${stage} PIN. Share it with your driver.`)
    .catch((e) => console.error(`[otp] trip PIN SMS to ${phone} failed:`, e?.message ?? e));
}

// Codes are short and low-entropy, so a slow hash buys little against an attacker who
// already has the database — but storing them in plain text would hand over live codes
// outright. SHA-256 with the code bound to phone+purpose keeps a stolen row from being
// replayed anywhere else.
function hashCode(phone: string, purpose: OtpPurpose, code: string): string {
  return crypto.createHash("sha256").update(`${phone}:${purpose}:${code}`).digest("hex");
}

export class OtpError extends Error {
  constructor(
    public code: "COOLDOWN" | "INVALID_OTP" | "TOO_MANY_ATTEMPTS",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Issues a code and sends it. Throws `OtpError('COOLDOWN')` if one was requested for the
 * same phone and purpose within the cooldown, which is what stops this endpoint from being
 * used to bomb someone with SMS at our expense.
 *
 * Returns the plaintext code only when the mock provider is active — real SMS never
 * echoes it back over HTTP. This is what lets a driver actually onboard on a staging
 * deployment before DLT registration clears: without it, the only place the code exists
 * is a server log the driver has no way to reach, which is a dead end disguised as a
 * feature.
 */
export async function issueOtp(
  phone: string,
  purpose: OtpPurpose,
  message: (code: string) => string,
): Promise<{ devCode?: string }> {
  const recent = await prisma.otpChallenge.findFirst({
    where: { phone, purpose, consumedAt: null, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    const waitMs = RESEND_COOLDOWN_MS - (Date.now() - recent.createdAt.getTime());
    throw new OtpError("COOLDOWN", `Please wait ${Math.ceil(waitMs / 1000)}s before requesting another code.`);
  }

  // Any earlier live challenge for this phone+purpose is retired, so only the newest code works.
  await prisma.otpChallenge.updateMany({
    where: { phone, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = generateOtp();
  await prisma.otpChallenge.create({
    data: {
      phone,
      purpose,
      codeHash: hashCode(phone, purpose, code),
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });

  const provider = getSmsProvider();
  await provider.send(phone, message(code));
  return provider.name === "mock" ? { devCode: code } : {};
}

/**
 * Consumes a code. Returns true only for a live, unexpired, correct code, and burns it so
 * it cannot be reused. Wrong guesses count toward a cap, so the 6-digit space can't simply
 * be walked.
 */
export async function verifyOtp(phone: string, purpose: OtpPurpose, code: string): Promise<boolean> {
  const challenge = await prisma.otpChallenge.findFirst({
    where: { phone, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge || challenge.expiresAt < new Date()) return false;

  if (challenge.attemptCount >= MAX_ATTEMPTS) {
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    throw new OtpError("TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Request a new code.");
  }

  const expected = Buffer.from(challenge.codeHash);
  const actual = Buffer.from(hashCode(phone, purpose, code));
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!ok) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attemptCount: { increment: 1 } },
    });
    return false;
  }

  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
  return true;
}

/** Housekeeping so consumed and expired rows don't accumulate forever. */
export async function purgeExpiredOtps() {
  await prisma.otpChallenge.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 24 * 3600_000) } },
  });
}
