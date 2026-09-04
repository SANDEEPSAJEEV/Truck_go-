import crypto from "crypto";
import { prisma } from "./prisma";
import { signAccessToken, signRefreshToken, verifyRefreshToken, type AccessTokenPayload } from "./jwt";

const REFRESH_TTL_MS = 30 * 86400_000;

/** Stored hashed so a database dump does not hand over usable sessions. */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export type IssuedSession = { accessToken: string; refreshToken: string };

/** Starts a new session family — one login, one family. */
export async function issueSession(payload: AccessTokenPayload): Promise<IssuedSession> {
  const familyId = crypto.randomUUID();
  const refreshToken = signRefreshToken({ ...payload, familyId });

  await prisma.refreshToken.create({
    data: {
      userId: payload.sub,
      tokenHash: hashToken(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });

  return { accessToken: signAccessToken(payload), refreshToken };
}

export class SessionError extends Error {
  constructor(public code: "INVALID_REFRESH" | "REUSE_DETECTED") {
    super(code);
  }
}

/**
 * Rotates a refresh token.
 *
 * A token that was already rotated should never be presented again by an honest client,
 * so seeing one means a token leaked and is being replayed. The response is to revoke the
 * entire family: both the attacker and the legitimate holder lose the session and must log
 * in again. Ending one real session is a far better outcome than letting a thief keep an
 * indefinitely-renewable one.
 */
export async function rotateSession(presentedToken: string): Promise<IssuedSession> {
  let payload: AccessTokenPayload & { familyId: string };
  try {
    payload = verifyRefreshToken(presentedToken);
  } catch {
    throw new SessionError("INVALID_REFRESH");
  }

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(presentedToken) } });
  if (!stored) throw new SessionError("INVALID_REFRESH");

  if (stored.rotatedAt || stored.revokedAt) {
    await revokeFamily(stored.familyId);
    throw new SessionError("REUSE_DETECTED");
  }

  if (stored.expiresAt < new Date()) throw new SessionError("INVALID_REFRESH");

  const nextToken = signRefreshToken({ sub: payload.sub, role: payload.role, familyId: stored.familyId });

  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: stored.id }, data: { rotatedAt: new Date() } }),
    prisma.refreshToken.create({
      data: {
        userId: payload.sub,
        tokenHash: hashToken(nextToken),
        familyId: stored.familyId,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    }),
  ]);

  return {
    accessToken: signAccessToken({ sub: payload.sub, role: payload.role }),
    refreshToken: nextToken,
  };
}

export async function revokeFamily(familyId: string) {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Used on logout for a single device. */
export async function revokeToken(token: string, userId: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(token), userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Used on password change — every device must re-authenticate. */
export async function revokeAllForUser(userId: string) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
