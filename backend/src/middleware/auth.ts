import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, AccessTokenPayload } from "../lib/jwt";
import { prisma } from "../lib/prisma";

export interface AuthedRequest extends Request {
  auth?: AccessTokenPayload;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing bearer token" } });
  }
  try {
    req.auth = verifyAccessToken(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });
  }
}

export function requireRole(role: "USER" | "DRIVER" | "ADMIN") {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (req.auth?.role !== role) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: `Requires ${role} role` } });
    }
    next();
  };
}

/**
 * The real dispatch gate: a driver whose documents are not verified cannot go online,
 * bid, or accept a booking. This lives in middleware because hiding a button in the app
 * is not a control — anyone can call the API directly.
 *
 * The message explains the specific blocker so the driver knows what to fix.
 */
export async function requireApprovedDriver(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.auth?.role !== "DRIVER") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Requires DRIVER role" } });
  }

  const profile = await prisma.driverProfile.findUnique({
    where: { userId: req.auth.sub },
    select: { verificationStatus: true, rejectionReason: true },
  });

  if (!profile) {
    return res.status(403).json({ error: { code: "NO_DRIVER_PROFILE", message: "Driver profile not found." } });
  }

  if (profile.verificationStatus === "APPROVED") return next();

  const messages: Record<string, string> = {
    PENDING: "Your documents are still being verified. You'll be able to accept trips once approved.",
    IN_REVIEW: "Your documents are under review by our team. We'll notify you as soon as that's done.",
    REJECTED: profile.rejectionReason ?? "Your verification was rejected. Please update your documents.",
    EXPIRED: profile.rejectionReason ?? "One of your documents has expired. Update it to start accepting trips again.",
    SUSPENDED: "Your account is suspended. Contact support for help.",
  };

  return res.status(403).json({
    error: {
      code: "DRIVER_NOT_APPROVED",
      message: messages[profile.verificationStatus] ?? "Your account is not approved for trips yet.",
      status: profile.verificationStatus,
    },
  });
}
