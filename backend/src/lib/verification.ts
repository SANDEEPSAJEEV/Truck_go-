import { DocumentType, VerificationStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { getKycProvider } from "./kyc";

// Documents a driver must hold before they can be dispatched. PAN, Aadhaar and photo are
// collected for payouts and identity but are not gating.
export const REQUIRED_DOCUMENTS: DocumentType[] = [
  DocumentType.DRIVING_LICENSE,
  DocumentType.VEHICLE_RC,
  DocumentType.INSURANCE,
  DocumentType.FITNESS_CERTIFICATE,
  DocumentType.PERMIT,
];

/** Licence classes that permit commercial goods carriage. LMV alone does not. */
const COMMERCIAL_DL_CLASSES = ["HGMV", "HMV", "HTV", "MGV", "HGV", "TRANS", "TRAILER"];

/** Loose name match — government records use different spacing, initials and ordering. */
function namesMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z\s]/g, "")
      .split(/\s+/)
      .filter(Boolean);
  const at = norm(a);
  const bt = norm(b);
  if (at.length === 0 || bt.length === 0) return false;
  const overlap = at.filter((t) => bt.includes(t)).length;
  return overlap >= Math.min(2, Math.min(at.length, bt.length));
}

export type CheckOutcome = {
  status: VerificationStatus;
  reason?: string;
};

/**
 * Runs the driving licence against government records and applies the cross-checks a human
 * reviewer cannot do by eye: does the licence exist, is it still valid, does the holder
 * match the person who registered, and does its class actually permit goods carriage.
 */
export async function runDrivingLicenseCheck(driverId: string): Promise<CheckOutcome> {
  const profile = await prisma.driverProfile.findUniqueOrThrow({
    where: { userId: driverId },
    include: { user: true },
  });

  const result = await getKycProvider().verifyDrivingLicense(profile.drivingLicenseNumber);

  const persist = async (outcome: CheckOutcome, expiresAt?: Date | null) => {
    await prisma.driverDocument.upsert({
      where: { driverId_type: { driverId, type: DocumentType.DRIVING_LICENSE } },
      create: {
        driverId,
        type: DocumentType.DRIVING_LICENSE,
        number: profile.drivingLicenseNumber,
        status: outcome.status,
        rejectionReason: outcome.reason,
        expiresAt: expiresAt ?? undefined,
        providerData: JSON.stringify(result.raw),
        verifiedAt: outcome.status === VerificationStatus.APPROVED ? new Date() : undefined,
      },
      update: {
        number: profile.drivingLicenseNumber,
        status: outcome.status,
        rejectionReason: outcome.reason ?? null,
        expiresAt: expiresAt ?? undefined,
        providerData: JSON.stringify(result.raw),
        verifiedAt: outcome.status === VerificationStatus.APPROVED ? new Date() : null,
      },
    });
    return outcome;
  };

  if (!result.ok) {
    return persist({ status: VerificationStatus.REJECTED, reason: result.failureReason ?? "Licence not verified." });
  }

  const expiresAt = result.validUpto ? new Date(result.validUpto) : null;
  if (expiresAt && expiresAt < new Date()) {
    return persist({ status: VerificationStatus.EXPIRED, reason: "This driving licence has expired." }, expiresAt);
  }

  if (result.holderName && !namesMatch(result.holderName, profile.user.fullName)) {
    return persist(
      {
        status: VerificationStatus.REJECTED,
        reason: "The name on this licence does not match the registered account holder.",
      },
      expiresAt,
    );
  }

  const classes = result.vehicleClasses ?? [];
  const allowsGoods = classes.some((c) => COMMERCIAL_DL_CLASSES.some((allowed) => c.toUpperCase().includes(allowed)));
  if (classes.length > 0 && !allowsGoods) {
    return persist(
      {
        status: VerificationStatus.REJECTED,
        reason: `This licence (${classes.join(", ")}) does not permit commercial goods transport.`,
      },
      expiresAt,
    );
  }

  return persist({ status: VerificationStatus.APPROVED }, expiresAt);
}

/**
 * Runs the vehicle registration. One RC lookup returns registration, fitness, insurance and
 * permit validity, so it populates four document rows at once — each with its own expiry,
 * because they lapse independently.
 */
export async function runVehicleRcCheck(driverId: string): Promise<CheckOutcome> {
  const profile = await prisma.driverProfile.findUniqueOrThrow({
    where: { userId: driverId },
    include: { user: true },
  });

  const result = await getKycProvider().verifyVehicleRc(profile.vehicleNumber);

  const upsert = async (
    type: DocumentType,
    status: VerificationStatus,
    expiresAt?: Date | null,
    reason?: string,
  ) => {
    await prisma.driverDocument.upsert({
      where: { driverId_type: { driverId, type } },
      create: {
        driverId,
        type,
        number: profile.vehicleNumber,
        status,
        expiresAt: expiresAt ?? undefined,
        rejectionReason: reason,
        providerData: JSON.stringify(result.raw),
        verifiedAt: status === VerificationStatus.APPROVED ? new Date() : undefined,
      },
      update: {
        number: profile.vehicleNumber,
        status,
        expiresAt: expiresAt ?? undefined,
        rejectionReason: reason ?? null,
        providerData: JSON.stringify(result.raw),
        verifiedAt: status === VerificationStatus.APPROVED ? new Date() : null,
      },
    });
  };

  if (!result.ok) {
    const reason = result.failureReason ?? "Vehicle not verified.";
    for (const type of [
      DocumentType.VEHICLE_RC,
      DocumentType.INSURANCE,
      DocumentType.FITNESS_CERTIFICATE,
      DocumentType.PERMIT,
    ]) {
      await upsert(type, VerificationStatus.REJECTED, null, reason);
    }
    return { status: VerificationStatus.REJECTED, reason };
  }

  if (result.ownerName && !namesMatch(result.ownerName, profile.user.fullName)) {
    const reason = "The registered owner of this vehicle does not match the account holder.";
    await upsert(DocumentType.VEHICLE_RC, VerificationStatus.IN_REVIEW, null, reason);
    // Not an outright rejection: driving a vehicle owned by a fleet or family member is
    // normal in this industry. It goes to a human with the discrepancy spelled out.
    return { status: VerificationStatus.IN_REVIEW, reason };
  }

  const dateOrNull = (s?: string) => (s ? new Date(s) : null);
  const statusFor = (d: Date | null) =>
    !d ? VerificationStatus.IN_REVIEW : d < new Date() ? VerificationStatus.EXPIRED : VerificationStatus.APPROVED;

  const insuranceUpto = dateOrNull(result.insuranceUpto);
  const fitnessUpto = dateOrNull(result.fitnessUpto);
  const permitUpto = dateOrNull(result.permitUpto);

  await upsert(DocumentType.VEHICLE_RC, VerificationStatus.APPROVED);
  await upsert(DocumentType.INSURANCE, statusFor(insuranceUpto), insuranceUpto, expiredReason(insuranceUpto, "insurance"));
  await upsert(DocumentType.FITNESS_CERTIFICATE, statusFor(fitnessUpto), fitnessUpto, expiredReason(fitnessUpto, "fitness certificate"));
  await upsert(DocumentType.PERMIT, statusFor(permitUpto), permitUpto, expiredReason(permitUpto, "goods permit"));

  const worst = [insuranceUpto, fitnessUpto, permitUpto].some((d) => d && d < new Date());
  if (worst) return { status: VerificationStatus.EXPIRED, reason: "One or more vehicle documents have expired." };

  return { status: VerificationStatus.APPROVED };
}

function expiredReason(d: Date | null, label: string): string | undefined {
  if (!d) return `Could not read ${label} validity — needs manual review.`;
  return d < new Date() ? `The vehicle's ${label} has expired.` : undefined;
}

/**
 * Recomputes the driver's overall status from their documents. Approval requires every
 * gating document to be APPROVED; a single expired or rejected one blocks dispatch.
 */
export async function recomputeDriverStatus(driverId: string): Promise<VerificationStatus> {
  const documents = await prisma.driverDocument.findMany({ where: { driverId } });
  const byType = new Map(documents.map((d) => [d.type, d]));

  let status: VerificationStatus = VerificationStatus.APPROVED;
  let rejectionReason: string | null = null;

  for (const type of REQUIRED_DOCUMENTS) {
    const doc = byType.get(type);
    if (!doc || doc.status === VerificationStatus.PENDING) {
      status = VerificationStatus.PENDING;
      rejectionReason = null;
      break;
    }
    if (doc.status === VerificationStatus.REJECTED) {
      status = VerificationStatus.REJECTED;
      rejectionReason = doc.rejectionReason ?? `${type} was rejected.`;
      break;
    }
    if (doc.status === VerificationStatus.EXPIRED) {
      status = VerificationStatus.EXPIRED;
      rejectionReason = doc.rejectionReason ?? `${type} has expired.`;
      break;
    }
    if (doc.status === VerificationStatus.IN_REVIEW) {
      status = VerificationStatus.IN_REVIEW;
      rejectionReason = doc.rejectionReason ?? null;
    }
  }

  const current = await prisma.driverProfile.findUniqueOrThrow({ where: { userId: driverId } });
  // A human suspension is deliberate and must not be undone by a background recompute.
  if (current.verificationStatus === VerificationStatus.SUSPENDED) return VerificationStatus.SUSPENDED;

  await prisma.driverProfile.update({
    where: { userId: driverId },
    data: {
      verificationStatus: status,
      rejectionReason,
      approvedAt: status === VerificationStatus.APPROVED ? (current.approvedAt ?? new Date()) : null,
      // Losing approval must also take the driver off the dispatch board immediately.
      isOnline: status === VerificationStatus.APPROVED ? current.isOnline : false,
    },
  });

  return status;
}

/** Runs both automated checks then recomputes the overall gate. */
export async function runAllChecks(driverId: string) {
  await runDrivingLicenseCheck(driverId);
  await runVehicleRcCheck(driverId);
  return recomputeDriverStatus(driverId);
}

/**
 * Daily watchdog. Compliance is not a one-time event: a driver approved last year whose
 * insurance lapsed this morning must stop being dispatchable without anyone noticing
 * manually.
 */
export async function expireLapsedDocuments(): Promise<number> {
  const now = new Date();
  const lapsed = await prisma.driverDocument.findMany({
    where: { expiresAt: { lt: now }, status: VerificationStatus.APPROVED },
    select: { id: true, driverId: true, type: true },
  });
  if (lapsed.length === 0) return 0;

  await prisma.driverDocument.updateMany({
    where: { id: { in: lapsed.map((d) => d.id) } },
    data: { status: VerificationStatus.EXPIRED, rejectionReason: "This document has expired." },
  });

  for (const driverId of new Set(lapsed.map((d) => d.driverId))) {
    await recomputeDriverStatus(driverId);
    await prisma.notification.create({
      data: {
        userId: driverId,
        title: "Action needed: document expired",
        body: "One of your documents has expired. Update it to start accepting trips again.",
      },
    });
  }

  return lapsed.length;
}
