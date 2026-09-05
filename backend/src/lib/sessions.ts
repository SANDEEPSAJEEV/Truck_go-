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
  constructor(public code: "INVALID_SIGNATURE" | "NOT_FOUND" | "EXPIRED" | "REUSE_DETECTED") {
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
    // The JWT itself did not verify: wrong signature, or past its 30-day expiry. Permanent,
    // and distinct from a token we simply cannot find — conflating the two made an
    // intermittent failure impossible to diagnose from the outside.
    throw new SessionError("INVALID_SIGNATURE");
  }

  // Reaching here means the JWT is genuinely ours, so a missing row is not the caller's
  // fault — and it may not even be true. A refresh fired moments after a login can run
  // before that login's own INSERT is visible to this query; measured against the deployed
  // database, a token left to age ten seconds was accepted 8 times out of 8, while one used
  // immediately after login failed roughly one time in three and succeeded on a retry.
  //
  // The cost of getting this wrong is not a retry, it is a logout: both apps call
  // `clearTokens()` when a refresh comes back 401. Only a miss pays the wait, and the
  // overwhelming majority of refreshes are for tokens minted long ago.
  const tokenHash = hashToken(presentedToken);
  let stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  let waitedMs = 0;
  for (const backoffMs of [250, 500, 1000, 1500, 2750]) {
    if (stored) break;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    waitedMs += backoffMs;
    stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  }
  if (!stored) throw new SessionError("NOT_FOUND");
  if (waitedMs > 0) {
    // Logged rather than silent: if this starts happening often, or the wait creeps up, that
    // is a storage problem worth knowing about rather than one permanently papered over.
    console.warn(`[sessions] refresh token row appeared only after ${waitedMs}ms`);
  }

  if (stored.rotatedAt || stored.revokedAt) {
    await revokeFamily(stored.familyId);
    throw new SessionError("REUSE_DETECTED");
  }

  if (stored.expiresAt < new Date()) throw new SessionError("EXPIRED");

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
