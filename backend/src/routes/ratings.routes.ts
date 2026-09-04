import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";

export const ratingsRouter = Router();

const submitRatingSchema = z.object({
  bookingId: z.string(),
  toUserId: z.string(),
  stars: z.number().int().min(1).max(5),
  comment: z.string().optional(),
});

ratingsRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = submitRatingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const { bookingId, toUserId, stars, comment } = parsed.data;

  const rating = await prisma.rating.create({
    data: { bookingId, fromUserId: req.auth!.sub, toUserId, stars, comment },
  });

  // Roll the new rating into the driver's running average.
  const profile = await prisma.driverProfile.findUnique({ where: { userId: toUserId } });
  if (profile) {
    const newCount = profile.ratingCount + 1;
    const newAvg = (profile.ratingAvg * profile.ratingCount + stars) / newCount;
    await prisma.driverProfile.update({
      where: { userId: toUserId },
      data: { ratingAvg: newAvg, ratingCount: newCount },
    });
  }

  return res.status(201).json({ rating });
});

// Confirmed path, decompiled_user.js:462031 (getRatingSummary) — /ratings/users/:id/summary.
ratingsRouter.get("/users/:id/summary", requireAuth, async (req, res) => {
  const profile = await prisma.driverProfile.findUnique({ where: { userId: req.params.id } });
  const recent = await prisma.rating.findMany({
    where: { toUserId: req.params.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return res.json({
    average: profile?.ratingAvg ?? 0,
    count: profile?.ratingCount ?? 0,
    recent,
  });
});
