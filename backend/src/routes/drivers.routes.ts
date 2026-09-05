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
// Each field was previously a bare `z.string()`, which accepts "" — so a save with an empty
// form silently wiped the account a driver gets paid into, and they'd only find out when a
// payout failed.
const bankDetailsSchema = z.object({
  accountHolderName: z.string().trim().min(2, "Enter the account holder's name."),
  bankAccountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{9,18}$/, "Enter a valid bank account number.")
    .optional(),
  ifscCode: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "Enter a valid IFSC code, e.g. HDFC0001234."),
});

/** Last four digits only, which is what a person recognises their own account by. */
function maskAccount(accountNumber: string | null): string | null {
  if (!accountNumber) return null;
  const tail = accountNumber.slice(-4);
  return `${"•".repeat(Math.max(0, accountNumber.length - 4))}${tail}`;
}

driversRouter.get("/bank-details", requireAuth, requireRole("DRIVER"), async (req: AuthedRequest, res) => {
  const profile = await prisma.driverProfile.findUnique({ where: { userId: req.auth!.sub } });
  return res.json({
    accountHolderName: profile?.accountHolderName ?? null,
    // The driver's own screen promises "your saved account number is always shown masked",
    // and it was returning the number in full. There is no reason to send it back: the
    // driver already knows it, and anything that reads this response — a log, a crash
    // report, a screenshot — no longer carries a payout account.
    bankAccountNumber: maskAccount(profile?.bankAccountNumber ?? null),
    hasBankAccountNumber: Boolean(profile?.bankAccountNumber),
    ifscCode: profile?.ifscCode ?? null,
  });
});

driversRouter.put("/bank-details", requireAuth, requireRole("DRIVER"), async (req: AuthedRequest, res) => {
  const parsed = bankDetailsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.issues[0].message } });
  }
  const { accountHolderName, bankAccountNumber, ifscCode } = parsed.data;

  const existing = await prisma.driverProfile.findUniqueOrThrow({
    where: { userId: req.auth!.sub },
    select: { bankAccountNumber: true },
  });
  // The number arrives masked when the driver edits their name or IFSC without retyping it,
  // so an omitted or masked value means "leave it as it is" rather than "clear it".
  if (!bankAccountNumber && !existing.bankAccountNumber) {
    return res.status(400).json({
      error: { code: "VALIDATION", message: "Enter a valid bank account number." },
    });
  }

  await prisma.driverProfile.update({
    where: { userId: req.auth!.sub },
    data: {
      accountHolderName,
      ifscCode,
      ...(bankAccountNumber ? { bankAccountNumber } : {}),
    },
  });
  return res.status(204).send();
});
