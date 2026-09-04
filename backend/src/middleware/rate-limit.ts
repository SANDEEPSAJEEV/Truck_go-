import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// There was previously no rate limiting anywhere. `/request-otp` could be hammered to bomb
// a stranger with SMS at our cost, and `/login` could be brute-forced indefinitely.
//
// Limits key on phone number AND IP together: keying on IP alone lets one attacker rotate
// addresses, while keying on phone alone lets one address walk through many numbers.
function phoneAndIpKey(req: { body?: { phone?: unknown }; ip?: string }): string {
  const phone = typeof req.body?.phone === "string" ? req.body.phone : "unknown";
  // ipKeyGenerator normalises IPv6 into a subnet so a single host cannot trivially rotate
  // through the enormous address space it is typically handed.
  return `${phone}:${ipKeyGenerator(req.ip ?? "")}`;
}

const shared = {
  standardHeaders: true as const,
  legacyHeaders: false as const,
  message: {
    error: { code: "RATE_LIMITED", message: "Too many attempts. Please wait a moment and try again." },
  },
};

/** SMS costs real money per send, so this is the tightest limit. */
export const otpRequestLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60_000,
  limit: 5,
  keyGenerator: phoneAndIpKey,
});

export const otpVerifyLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60_000,
  limit: 10,
  keyGenerator: phoneAndIpKey,
});

export const loginLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60_000,
  limit: 10,
  keyGenerator: phoneAndIpKey,
});

/** Broad backstop for everything else. */
export const generalLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 300,
});
