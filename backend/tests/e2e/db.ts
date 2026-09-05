/**
 * Direct database access, used for two things only:
 *
 *  1. Asserting side effects the API deliberately does not expose — that a consumed trip PIN
 *     is actually nulled, that a failed login incremented the counter, that a driver's
 *     `locationAt` was stamped. Asserting these through the API would only prove the API
 *     agrees with itself.
 *
 *  2. Setting up states the API has no route to, on purpose — a SUSPENDED driver, a stale
 *     `locationAt`, an expired OTP challenge.
 *
 * Everything else goes through HTTP, because HTTP is what is under test.
 *
 * DATABASE_URL points at the same Neon instance the deployed backend uses, so these reads see
 * exactly what the server wrote.
 */

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — the suite needs it for side-effect assertions.");
}

export const db = new PrismaClient({ log: ["warn", "error"] });

/**
 * Removes everything a run created. Ordered so foreign keys never block a delete.
 *
 * This runs against a live database shared with the deployed backend, so it is scoped
 * strictly by the run's own marker: it only ever touches users whose `fullName` ends with the
 * run id, and rows reachable from them.
 */
export async function purgeRun(runId: string, phonePrefix: string): Promise<number> {
  // Teardown is the last thing standing between a network blip and fixture rows left behind
  // in the live database, so it retries rather than giving up on the first failure.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await purgeOnce(runId, phonePrefix);
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function purgeOnce(runId: string, phonePrefix: string): Promise<number> {
  const users = await db.user.findMany({
    where: { fullName: { endsWith: runId } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);

  // Guard rail. This runs against the live database, and a short prefix here would match
  // every Indian mobile number in the table. Only a full run-specific prefix is ever used.
  const purgeOtps = async () => {
    if (phonePrefix.length < 7) return;
    await db.otpChallenge.deleteMany({ where: { phone: { startsWith: phonePrefix } } });
  };

  if (!ids.length) {
    await purgeOtps();
    return 0;
  }

  const bookings = await db.booking.findMany({
    where: { OR: [{ userId: { in: ids } }, { driverId: { in: ids } }] },
    select: { id: true },
  });
  const bookingIds = bookings.map((b) => b.id);

  await db.rating.deleteMany({ where: { OR: [{ fromUserId: { in: ids } }, { toUserId: { in: ids } }] } });
  await db.message.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await db.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await db.bid.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await db.device.deleteMany({ where: { userId: { in: ids } } });
  await db.notification.deleteMany({ where: { userId: { in: ids } } });
  await db.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await db.driverDocument.deleteMany({ where: { driverId: { in: ids } } });
  await db.driverProfile.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await purgeOtps();

  return ids.length;
}
