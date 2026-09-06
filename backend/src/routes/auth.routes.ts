import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { OtpPurpose } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { signVerificationToken, verifyVerificationToken } from "../lib/jwt";
import { issueSession, rotateSession, revokeToken, revokeAllForUser, SessionError } from "../lib/sessions";
import { issueOtp, verifyOtp, OtpError } from "../lib/otp";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { otpRequestLimiter, otpVerifyLimiter, loginLimiter } from "../middleware/rate-limit";

export const authRouter = Router();

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60_000;

// India-first: accepts an optional +country prefix, stores digits only so the same person
// can't register twice as "+919876543210" and "9876543210".
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, "Enter a valid phone number.")
  .transform((v) => v.replace(/\D/g, ""));

const passwordSchema = z.string().min(8, "Choose a strong password of at least 8 characters.");

/* -------------------------------------------------------------------------- */
/* Phone verification                                                          */
/* -------------------------------------------------------------------------- */

authRouter.post("/request-otp", otpRequestLimiter, async (req, res) => {
  const parsed = z.object({ phone: phoneSchema }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.issues[0].message } });
  }
  const { phone } = parsed.data;

  let devCode: string | undefined;
  try {
    ({ devCode } = await issueOtp(phone, OtpPurpose.PHONE_VERIFICATION, (code) => `${code} is your TruckGo verification code.`));
  } catch (e) {
    if (e instanceof OtpError) {
      return res.status(429).json({ error: { code: e.code, message: e.message } });
    }
    // A gateway that rejects the send — an unverified number on a Twilio trial, an expired
    // balance, an outage — must not escape an async handler. Express 4 does not catch that:
    // the rejection goes unhandled and the request hangs until the client times out, which
    // reads to the user as a dead app rather than a failed send.
    console.error("[auth] request-otp: SMS provider failed:", e);
    return res.status(502).json({
      error: { code: "SMS_FAILED", message: "Could not send the code right now. Please try again." },
    });
  }

  // `devCode` only exists while the mock SMS provider is active (no DLT registration yet)
  // — it is never present once a real provider is configured, so this can't leak a real
  // code and doesn't need its own separate flag to gate it.
  return res.status(200).json({ message: "Verification code sent", ...(devCode ? { devCode } : {}) });
});

// Returns a signed, short-lived token proving this phone was verified. Registration
// requires it — previously this endpoint returned `{verified:true}` and nothing checkable,
// so registration accepted any phone number the client typed.
authRouter.post("/verify-otp", otpVerifyLimiter, async (req, res) => {
  const parsed = z.object({ phone: phoneSchema, code: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "phone and code are required" } });
  }
  const { phone, code } = parsed.data;

  let ok: boolean;
  try {
    ok = await verifyOtp(phone, OtpPurpose.PHONE_VERIFICATION, code);
  } catch (e) {
    if (e instanceof OtpError) {
      return res.status(429).json({ error: { code: e.code, message: e.message } });
    }
    throw e;
  }

  if (!ok) {
    return res.status(400).json({ error: { code: "INVALID_OTP", message: "Code is invalid or expired" } });
  }

  return res.status(200).json({ verified: true, verificationToken: signVerificationToken(phone) });
});

/** Confirms the caller holds a verification token minted for exactly this phone. */
function assertPhoneVerified(verificationToken: unknown, phone: string): string | null {
  if (typeof verificationToken !== "string" || !verificationToken) {
    return "Verify your phone number before creating an account.";
  }
  try {
    const payload = verifyVerificationToken(verificationToken);
    if (payload.phone !== phone) return "This verification code was issued for a different number.";
    return null;
  } catch {
    return "Phone verification expired. Request a new code.";
  }
}

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

// Confirmed request shape, decompiled_user.js:483307 — includes companyName (optional rider
// metadata) and confirmPassword (validated, never persisted). `verificationToken` is ours.
const registerUserSchema = z
  .object({
    fullName: z.string().trim().min(2),
    companyName: z.string().trim().optional(),
    phone: phoneSchema,
    email: z.string().email().optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
    verificationToken: z.string(),
    acceptTermsAndConditions: z.literal(true, {
      errorMap: () => ({ message: "You must accept the Terms of Service to continue." }),
    }),
    acceptPrivacyPolicy: z.literal(true, {
      errorMap: () => ({ message: "You must accept the Privacy Policy to continue." }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

authRouter.post("/register/user", async (req, res) => {
  const parsed = registerUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.issues[0].message } });
  }
  const { fullName, companyName, phone, email, password, verificationToken } = parsed.data;

  const verificationProblem = assertPhoneVerified(verificationToken, phone);
  if (verificationProblem) {
    return res.status(400).json({ error: { code: "PHONE_NOT_VERIFIED", message: verificationProblem } });
  }

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    return res.status(409).json({ error: { code: "PHONE_TAKEN", message: "Phone already registered" } });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      role: "USER",
      fullName,
      companyName,
      phone,
      email,
      passwordHash,
      phoneVerifiedAt: new Date(),
    },
  });

  return res.status(201).json({ user: toPublicUser(user) });
});

// Confirmed camelCase vehicle types (decompiled_user.js ~403688-403694) and the complete
// registerDriver FormData field set (decompiled_driver.js:422407+).
//
// Document NUMBERS are captured here; they are not trusted until Phase C verifies them
// against government records and an admin approves the driver. Until then the driver
// cannot go online or bid — enforced in middleware, not by hiding a button.
const registerDriverSchema = z
  .object({
    fullName: z.string().trim().min(2),
    phone: phoneSchema,
    email: z.string().email().optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
    verificationToken: z.string(),
    vehicleType: z.enum(["miniTruck", "pickup", "tataAce", "tempo", "largeTruck", "container"]),
    // Indian commercial plates, e.g. KL07AB1234. Normalised so spacing and dashes don't
    // create duplicate-looking vehicles.
    vehicleNumber: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase().replace(/[\s-]/g, ""))
      .refine((v) => /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/.test(v), "Enter a valid vehicle number, e.g. KL07AB1234."),
    drivingLicenseNumber: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase().replace(/[\s-]/g, ""))
      .refine((v) => /^[A-Z]{2}[0-9]{2}[0-9]{11}$/.test(v), "Enter a valid driving licence number, e.g. KL0120110012345."),
    panCardNumber: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .refine((v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), "Enter a valid PAN, e.g. ABCDE1234F.")
      .optional(),
    accountHolderName: z.string().trim().optional(),
    bankAccountNumber: z.string().trim().regex(/^[0-9]{9,18}$/, "Enter a valid bank account number.").optional(),
    ifscCode: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .refine((v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "Enter a valid IFSC code, e.g. HDFC0001234.")
      .optional(),
    acceptTermsAndConditions: z.literal(true, {
      errorMap: () => ({ message: "You must accept the Terms of Service to continue." }),
    }),
    acceptPrivacyPolicy: z.literal(true, {
      errorMap: () => ({ message: "You must accept the Privacy Policy to continue." }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

authRouter.post("/register/driver", async (req, res) => {
  const parsed = registerDriverSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.issues[0].message } });
  }
  const {
    fullName,
    phone,
    email,
    password,
    verificationToken,
    vehicleType,
    vehicleNumber,
    drivingLicenseNumber,
    panCardNumber,
    accountHolderName,
    bankAccountNumber,
    ifscCode,
  } = parsed.data;

  const verificationProblem = assertPhoneVerified(verificationToken, phone);
  if (verificationProblem) {
    return res.status(400).json({ error: { code: "PHONE_NOT_VERIFIED", message: verificationProblem } });
  }

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    return res.status(409).json({ error: { code: "PHONE_TAKEN", message: "Phone already registered" } });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      role: "DRIVER",
      fullName,
      phone,
      email,
      passwordHash,
      phoneVerifiedAt: new Date(),
      driverProfile: {
        create: {
          vehicleType,
          vehicleNumber,
          drivingLicenseNumber,
          panCardNumber,
          accountHolderName,
          bankAccountNumber,
          ifscCode,
        },
      },
    },
    include: { driverProfile: true },
  });

  return res.status(201).json({ user: toPublicUser(user) });
});

/* -------------------------------------------------------------------------- */
/* Login                                                                       */
/* -------------------------------------------------------------------------- */

const loginSchema = z.object({ phone: phoneSchema, password: z.string() });

async function login(role: "USER" | "DRIVER" | "ADMIN", req: any, res: any) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "Enter your phone number and password." } });
  }
  const { phone, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { phone }, include: { driverProfile: true } });

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    return res.status(429).json({
      error: { code: "ACCOUNT_LOCKED", message: `Too many failed attempts. Try again in ${minutes} minute(s).` },
    });
  }

  const passwordOk = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || user.role !== role || !passwordOk) {
    // Count failures only when the account exists, so this can't be used to enumerate
    // which phone numbers are registered.
    if (user && !passwordOk) {
      const failedLoginCount = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount,
          lockedUntil: failedLoginCount >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null,
        },
      });
    }
    return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Wrong phone or password" } });
  }

  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  }

  const session = await issueSession({ sub: user.id, role: user.role });
  return res.json({ user: toPublicUser(user), ...session });
}

authRouter.post("/login", loginLimiter, (req, res) => login("USER", req, res));
// Driver login — recovered as its own path rather than a shared /login
authRouter.post("/driver", loginLimiter, (req, res) => login("DRIVER", req, res));
// Staff login for the verification review queue. Separate path so a leaked rider or driver
// credential can never authenticate into the admin surface by role confusion.
authRouter.post("/admin", loginLimiter, (req, res) => login("ADMIN", req, res));

/* -------------------------------------------------------------------------- */
/* Session lifecycle                                                           */
/* -------------------------------------------------------------------------- */

authRouter.post("/refresh", async (req, res, next) => {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "refreshToken required" } });
  }

  try {
    const session = await rotateSession(refreshToken);
    return res.json(session);
  } catch (e) {
    if (e instanceof SessionError && e.code === "REUSE_DETECTED") {
      return res.status(401).json({
        error: {
          code: "SESSION_REVOKED",
          message: "Your session was ended for security reasons. Please sign in again.",
        },
      });
    }
    // Only a *decided* rejection ends the session. Anything else — a dropped database
    // connection, a constraint we did not anticipate — is our failure, not the client's, and
    // it must not be dressed up as "your token is invalid": both apps clear their tokens on a
    // 401 from this endpoint, so an unexpected exception here silently signed a real user
    // out and left nothing behind to explain why. It now surfaces as a 500, which the apps
    // treat as a transient error and retry.
    if (!(e instanceof SessionError)) {
      console.error("[auth] refresh failed unexpectedly:", e);
      // Handed to the error middleware explicitly. Express 4 does not catch a throw from an
      // async handler — it would become an unhandled rejection and the request would simply
      // hang, which is worse than the wrong status code.
      return next(e);
    }
    if (e.code === "NOT_FOUND") {
      console.warn("[auth] refresh presented a well-formed token we have no row for");
    }
    // The reason is carried through rather than flattened. Every one of these still ends the
    // session, but "we could not find this token" and "this token is not ours" are different
    // operational problems, and one opaque code for both left an intermittent failure with
    // nothing to go on.
    return res.status(401).json({ error: { code: e.code, message: "Invalid refresh token" } });
  }
});

authRouter.post("/logout", requireAuth, async (req: AuthedRequest, res) => {
  const { refreshToken } = req.body ?? {};
  if (refreshToken) await revokeToken(refreshToken, req.auth!.sub);
  return res.status(204).send();
});

authRouter.post("/change-password", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ currentPassword: z.string(), newPassword: passwordSchema })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.issues[0].message } });
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Current password is wrong" } });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
  });
  // Every other device must re-authenticate — a password change is how someone locks an
  // intruder out, so leaving existing sessions alive would defeat the point.
  await revokeAllForUser(user.id);

  return res.status(204).send();
});

/* -------------------------------------------------------------------------- */
/* Password reset                                                              */
/* -------------------------------------------------------------------------- */

authRouter.post("/forgot-password", otpRequestLimiter, async (req, res) => {
  const parsed = z.object({ phone: phoneSchema }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "Enter a valid phone number." } });
  }
  const { phone } = parsed.data;

  const user = await prisma.user.findUnique({ where: { phone } });
  let devCode: string | undefined;
  if (user) {
    try {
      ({ devCode } = await issueOtp(phone, OtpPurpose.PASSWORD_RESET, (code) => `${code} is your TruckGo password reset code.`));
    } catch (e) {
      if (!(e instanceof OtpError)) {
        // Same reasoning as request-otp: an unhandled rejection here would hang the request.
        // Logged, then swallowed — the response below must stay identical either way, or the
        // difference itself reveals whether this phone is registered.
        console.error("[auth] forgot-password: SMS provider failed:", e);
      }
      // Cooldown is swallowed deliberately: surfacing it would reveal that this phone
      // number is registered.
    }
  }

  // Always 200 — don't leak whether a phone number is registered. Note `devCode`'s
  // presence *does* reveal that, same as the message is deliberately identical either
  // way — acceptable only because this whole field only exists behind the mock-provider
  // escape hatch, which is itself staging-only and must be gone before real users arrive.
  return res
    .status(200)
    .json({ message: "If that phone is registered, a reset code was sent", ...(devCode ? { devCode } : {}) });
});

authRouter.post("/reset-password", otpVerifyLimiter, async (req, res) => {
  const parsed = z
    .object({ phone: phoneSchema, code: z.string(), newPassword: passwordSchema })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.issues[0].message } });
  }
  const { phone, code, newPassword } = parsed.data;

  let ok: boolean;
  try {
    ok = await verifyOtp(phone, OtpPurpose.PASSWORD_RESET, code);
  } catch (e) {
    if (e instanceof OtpError) {
      return res.status(429).json({ error: { code: e.code, message: e.message } });
    }
    throw e;
  }

  if (!ok) {
    return res.status(400).json({ error: { code: "INVALID_OTP", message: "Code is invalid or expired" } });
  }

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    return res.status(400).json({ error: { code: "INVALID_OTP", message: "Code is invalid or expired" } });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await revokeAllForUser(user.id);

  return res.status(204).send();
});

export function toPublicUser(user: any) {
  const { passwordHash, failedLoginCount, lockedUntil, ...rest } = user;
  return rest;
}
