import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";

export const ratingsRouter = Router();

const submitRatingSchema = z.object({
  bookingId: z.string(),
  toUserId: z.string(),
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

/**
 * A driver's average is what wins them work — it is the number on every bid card a rider
 * chooses from. So the write path needs the same guards as anything else that moves money.
 *
 * Previously this endpoint took `bookingId` and `toUserId` entirely on trust: it never checked
 * the booking existed, never checked the caller had any part in it, never checked the trip had
 * actually happened, and never checked the recipient was the counterparty. Anyone with an
 * account could have driven any driver's rating up or down at will, one request at a time. A
 * duplicate also surfaced as an unhandled 500 from the unique constraint rather than a 409.
 */
ratingsRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = submitRatingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.issues[0].message } });
  }
  const { bookingId, toUserId, stars, comment } = parsed.data;
  const me = req.auth!.sub;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { userId: true, driverId: true, status: true },
  });
  if (!booking) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Booking not found" } });
  }

  const isRider = booking.userId === me;
  const isDriver = booking.driverId === me;
  if (!isRider && !isDriver) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "You weren't part of this trip." } });
  }

  // Rating is feedback on a trip that happened. Before delivery there is nothing to rate, and
  // allowing it would let a rider threaten a driver's average mid-journey.
  if (booking.status !== "DELIVERED") {
    return res.status(409).json({
      error: { code: "NOT_DELIVERED", message: "You can rate this trip once it has been delivered." },
    });
  }

  // The rating can only go to the person on the other side of this specific trip.
  const counterparty = isRider ? booking.driverId : booking.userId;
  if (!counterparty || counterparty !== toUserId) {
    return res.status(400).json({
      error: { code: "NOT_COUNTERPARTY", message: "You can only rate the other party on this trip." },
    });
  }

  let rating;
  try {
    rating = await prisma.rating.create({
      data: { bookingId, fromUserId: me, toUserId, stars, comment },
    });
  } catch (e) {
    // One rating per person per booking — without this the same trip could be rated
    // repeatedly to inflate or tank someone's average.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ error: { code: "ALREADY_RATED", message: "You've already rated this trip." } });
    }
    throw e;
  }

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
    // A public reputation summary is comments and stars, not who left them — pairing a
    // comment with an author id would let anyone map a driver's riders.
    select: { id: true, stars: true, comment: true, createdAt: true },
  });
  return res.json({
    average: profile?.ratingAvg ?? 0,
    count: profile?.ratingCount ?? 0,
    recent,
  });
});
