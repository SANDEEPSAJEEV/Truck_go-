import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const devicesRouter = Router();

const registerSchema = z.object({
  // Expo tokens look like ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx] or ExpoPushToken[...].
  expoPushToken: z.string().min(10).max(200),
  platform: z.enum(["android", "ios", "web"]),
});

/**
 * Claim a push token for the signed-in user.
 *
 * Upsert on the token, not the user: a driver may have two devices, and a device may
 * change hands. Re-pointing an existing token at whoever is signed in now is what stops
 * the previous owner's loads following the hardware.
 */
devicesRouter.post("/register", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid device token." } });
  }

  const { expoPushToken, platform } = parsed.data;
  await prisma.device.upsert({
    where: { expoPushToken },
    create: { expoPushToken, platform, userId: req.auth!.sub },
    update: { userId: req.auth!.sub, platform, lastSeenAt: new Date() },
  });

  return res.status(204).end();
});

/**
 * Drop a token on sign-out, so a shared or resold phone stops receiving this driver's work.
 * Scoped to the caller's own rows — a token you don't own is not yours to delete.
 */
devicesRouter.delete("/:token", requireAuth, async (req: AuthedRequest, res) => {
  await prisma.device.deleteMany({
    where: { expoPushToken: req.params.token, userId: req.auth!.sub },
  });
  return res.status(204).end();
});
