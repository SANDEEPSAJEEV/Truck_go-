import { Router } from "express";
import { z } from "zod";
import { VerificationStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { getStorage } from "../lib/storage";
import { runAllChecks, recomputeDriverStatus } from "../lib/verification";
import { toPublicUser } from "./auth.routes";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("ADMIN"));

/** Review queue. Defaults to everything awaiting a human decision. */
adminRouter.get("/drivers", async (req, res) => {
  const status = req.query.status as VerificationStatus | undefined;
  const where = status
    ? { verificationStatus: status }
    : { verificationStatus: { in: [VerificationStatus.PENDING, VerificationStatus.IN_REVIEW] } };

  const drivers = await prisma.driverProfile.findMany({
    where,
    include: { user: true, documents: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  return res.json({
    drivers: drivers.map((d) => ({
      driverId: d.userId,
      fullName: d.user.fullName,
      phone: d.user.phone,
      vehicleType: d.vehicleType,
      vehicleNumber: d.vehicleNumber,
      drivingLicenseNumber: d.drivingLicenseNumber,
      verificationStatus: d.verificationStatus,
      rejectionReason: d.rejectionReason,
      registeredAt: d.createdAt,
      documents: d.documents.map((doc) => ({
        id: doc.id,
        type: doc.type,
        status: doc.status,
        number: doc.number,
        expiresAt: doc.expiresAt,
        rejectionReason: doc.rejectionReason,
        hasFile: Boolean(doc.fileKey),
        verifiedAt: doc.verifiedAt,
      })),
    })),
  });
});

adminRouter.get("/drivers/:id", async (req, res) => {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId: req.params.id },
    include: { user: true, documents: true },
  });
  if (!profile) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Driver not found." } });
  }
  return res.json({
    driver: { ...profile, user: toPublicUser(profile.user) },
  });
});

/** Reviewers must be able to look at the actual scan before deciding. */
adminRouter.get("/documents/:id/file", async (req, res) => {
  const doc = await prisma.driverDocument.findUnique({ where: { id: req.params.id } });
  if (!doc?.fileKey) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Document not found." } });
  }
  const file = await getStorage().get(doc.fileKey);
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(file.buffer);
});

/** Re-runs the automated government checks — used when a driver disputes a rejection. */
adminRouter.post("/drivers/:id/recheck", async (req, res) => {
  const verificationStatus = await runAllChecks(req.params.id);
  return res.json({ verificationStatus });
});

const decisionSchema = z.object({ reason: z.string().trim().min(3).optional() });

/**
 * Manual override for the cases automation cannot settle — a fleet-owned vehicle whose RC
 * name legitimately differs, or a document the API could not read. The reviewer is recorded.
 */
adminRouter.post("/drivers/:id/approve", async (req: AuthedRequest, res) => {
  const driverId = req.params.id;
  const profile = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
  if (!profile) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Driver not found." } });
  }

  await prisma.driverDocument.updateMany({
    where: { driverId, status: { in: [VerificationStatus.IN_REVIEW, VerificationStatus.PENDING] } },
    data: { status: VerificationStatus.APPROVED, reviewedBy: req.auth!.sub, verifiedAt: new Date(), rejectionReason: null },
  });

  await prisma.driverProfile.update({
    where: { userId: driverId },
    data: {
      verificationStatus: VerificationStatus.APPROVED,
      approvedAt: new Date(),
      approvedBy: req.auth!.sub,
      rejectionReason: null,
    },
  });

  await prisma.notification.create({
    data: {
      userId: driverId,
      title: "You're approved",
      body: "Your documents were verified. You can go online and start accepting trips.",
    },
  });

  return res.json({ verificationStatus: VerificationStatus.APPROVED });
});

adminRouter.post("/drivers/:id/reject", async (req: AuthedRequest, res) => {
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success || !parsed.data.reason) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "A rejection reason is required." } });
  }
  const driverId = req.params.id;

  await prisma.driverProfile.update({
    where: { userId: driverId },
    data: {
      verificationStatus: VerificationStatus.REJECTED,
      rejectionReason: parsed.data.reason,
      approvedAt: null,
      approvedBy: req.auth!.sub,
      // Rejection must also take them off the dispatch board immediately.
      isOnline: false,
    },
  });

  await prisma.notification.create({
    data: { userId: driverId, title: "Verification rejected", body: parsed.data.reason },
  });

  return res.json({ verificationStatus: VerificationStatus.REJECTED });
});

adminRouter.post("/drivers/:id/suspend", async (req: AuthedRequest, res) => {
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success || !parsed.data.reason) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "A suspension reason is required." } });
  }
  const driverId = req.params.id;

  await prisma.driverProfile.update({
    where: { userId: driverId },
    data: {
      verificationStatus: VerificationStatus.SUSPENDED,
      rejectionReason: parsed.data.reason,
      isOnline: false,
      approvedBy: req.auth!.sub,
    },
  });

  await prisma.notification.create({
    data: { userId: driverId, title: "Account suspended", body: parsed.data.reason },
  });

  return res.json({ verificationStatus: VerificationStatus.SUSPENDED });
});

/** Lifts a suspension and lets the document state decide the outcome again. */
adminRouter.post("/drivers/:id/reinstate", async (req, res) => {
  const driverId = req.params.id;
  await prisma.driverProfile.update({
    where: { userId: driverId },
    data: { verificationStatus: VerificationStatus.PENDING, rejectionReason: null },
  });
  const verificationStatus = await recomputeDriverStatus(driverId);
  return res.json({ verificationStatus });
});
