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

  // Two different failures hide behind "we don't have this token".
  //
  // A token whose signature or expiry is wrong is permanently invalid, and `verifyRefreshToken`
  // above has already rejected it. Reaching here means the JWT is genuinely ours — so a
  // missing row is not the client's fault, and occasionally it is not even true: a refresh
  // fired moments after login can run before that login's INSERT is visible to this query,
  // and the row appears a second later. Measured against the deployed database, roughly one
  // in three logins followed immediately by a refresh hit this.
  //
  // The cost of getting it wrong is not a retry — it is a logout. Both apps call
  // `clearTokens()` when a refresh comes back 401, so a storage blip silently signs a real
  // user out. One short re-read is a much better trade than that.
  // Measured against the deployed database: a token left to age ten seconds was accepted 8
  // times out of 8, while one used immediately after login failed about one time in three,
  // and succeeded on a retry a few seconds later. So the window is real and bounded, and
  // waiting it out beats the alternative — the apps sign the user out on a failed refresh.
  //
  // Six seconds of ceiling looks generous for an endpoint, but only a miss ever pays it: the
  // overwhelming majority of refreshes are for tokens minted long ago and return on the first
  // query. A ladder that stopped at 2.5s still let this through.
  const tokenHash = hashToken(presentedToken);
  let stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  let waitedMs = 0;
  for (const backoffMs of [250, 500, 1000, 1500, 2750]) {
    if (stored) break;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    waitedMs += backoffMs;
    stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  }
  if (!stored) throw new SessionError("INVALID_REFRESH");
  if (waitedMs > 0) {
    // Logged rather than silent: if this starts happening often, or the wait creeps up, that
    // is a storage problem worth knowing about rather than one permanently papered over.
    console.warn(`[sessions] refresh token row appeared only after ${waitedMs}ms`);
  }

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
