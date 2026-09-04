import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole, requireApprovedDriver, AuthedRequest } from "../middleware/auth";
import { toPublicUser } from "./auth.routes";
import { toAmount, sumAmounts } from "../lib/money";

export const driversRouter = Router();

driversRouter.get("/me", requireAuth, requireRole("DRIVER"), async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.sub },
    include: { driverProfile: true },
  });
  return res.json({ user: toPublicUser(user) });
});

const updateMeSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  vehicleNumber: z.string().optional(),
});

driversRouter.patch("/me", requireAuth, requireRole("DRIVER"), async (req: AuthedRequest, res) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const { fullName, email, vehicleNumber } = parsed.data;
  const user = await prisma.user.update({
    where: { id: req.auth!.sub },
    data: {
      fullName,
      email,
      driverProfile: vehicleNumber ? { update: { vehicleNumber } } : undefined,
    },
    include: { driverProfile: true },
  });
  return res.json({ user: toPublicUser(user) });
});

// Coordinates are optional so a driver can always go offline, even with no GPS fix.
const locationSchema = z.object({
  lat: z.number().optional(),
  lng: z.number().optional(),
  isOnline: z.boolean().optional(),
});

// REST fallback for the socket-based `driver:location` event — same data, for when a
// socket connection isn't live (background updates, retries).
// Confirmed PUT, not POST — decompiled_user.js:438228 (publishDriverLocation).
driversRouter.put("/location", requireAuth, requireApprovedDriver, async (req: AuthedRequest, res) => {
  const parsed = locationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const { lat, lng, isOnline } = parsed.data;
  const hasFix = lat !== undefined && lng !== undefined;
  await prisma.driverProfile.update({
    where: { userId: req.auth!.sub },
    data: hasFix
      ? { currentLat: lat, currentLng: lng, locationAt: new Date(), isOnline }
      : { isOnline },
  });
  return res.status(204).send();
});

/** Bounds the payload. The chart only spans a week; the table is a recent-activity list. */
const EARNINGS_PAGE = 100;

driversRouter.get("/earnings", requireAuth, requireRole("DRIVER"), async (req: AuthedRequest, res) => {
  const where = { driverId: req.auth!.sub, status: "DELIVERED" as const };

  // Totals come from the whole history; the list is only the recent page. Deriving
  // `completedTrips` from `trips.length` would silently cap a busy driver's lifetime
  // count at the page size.
  const [trips, completedTrips, allFares] = await Promise.all([
    prisma.booking.findMany({
      where,
      // Previously unordered, so "Recent Payments" was in whatever order Postgres returned.
      orderBy: { completedAt: "desc" },
      take: EARNINGS_PAGE,
      select: {
        id: true,
        reference: true,
        dropAddress: true,
        actualFare: true,
        estimatedFare: true,
        completedAt: true,
        payment: { select: { status: true } },
      },
    }),
    prisma.booking.count({ where }),
    prisma.booking.findMany({ where, select: { actualFare: true, estimatedFare: true } }),
  ]);

  // Exact decimal addition. Summing floats here would drift by fractions of a paisa per
  // trip, and this is the number a driver checks against their bank statement.
  const total = sumAmounts(allFares.map((t) => t.actualFare ?? t.estimatedFare));

  return res.json({
    totalEarnings: total,
    completedTrips,
    // Serialised back to numbers so the app isn't handed Decimal strings.
    trips: trips.map((t) => ({
      id: t.id,
      reference: t.reference,
      dropAddress: t.dropAddress,
      completedAt: t.completedAt,
      actualFare: toAmount(t.actualFare),
      estimatedFare: toAmount(t.estimatedFare),
      // A delivered trip with no payment row has not been paid for yet.
      paymentStatus: t.payment?.status ?? "PENDING",
    })),
  });
});

// Field names confirmed from the driver-registration multipart body,
// decompiled_driver.js:422407+ — accountHolderName / bankAccountNumber / ifscCode.
const bankDetailsSchema = z.object({
  accountHolderName: z.string(),
  bankAccountNumber: z.string(),
  ifscCode: z.string(),
});

driversRouter.get("/bank-details", requireAuth, requireRole("DRIVER"), async (req: AuthedRequest, res) => {
  const profile = await prisma.driverProfile.findUnique({ where: { userId: req.auth!.sub } });
  return res.json({
    accountHolderName: profile?.accountHolderName ?? null,
    bankAccountNumber: profile?.bankAccountNumber ?? null,
    ifscCode: profile?.ifscCode ?? null,
  });
});

driversRouter.put("/bank-details", requireAuth, requireRole("DRIVER"), async (req: AuthedRequest, res) => {
  const parsed = bankDetailsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  await prisma.driverProfile.update({ where: { userId: req.auth!.sub }, data: parsed.data });
  return res.status(204).send();
});
