import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { DocumentType, VerificationStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { getStorage, ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "../lib/storage";
import { runAllChecks, recomputeDriverStatus, REQUIRED_DOCUMENTS } from "../lib/verification";

export const documentsRouter = Router();

// Held in memory then handed to the storage provider, so nothing untrusted is ever written
// to a path derived from user input.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_UPLOAD_TYPES[file.mimetype]) {
      return cb(new Error("Only JPG, PNG, WebP or PDF files are accepted."));
    }
    cb(null, true);
  },
});

documentsRouter.use(requireAuth, requireRole("DRIVER"));

/** The driver's own checklist: what is required, what is uploaded, and what is blocking. */
documentsRouter.get("/", async (req: AuthedRequest, res) => {
  const driverId = req.auth!.sub;
  const profile = await prisma.driverProfile.findUnique({
    where: { userId: driverId },
    include: { documents: true },
  });
  if (!profile) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Driver profile not found." } });
  }

  const byType = new Map(profile.documents.map((d) => [d.type, d]));
  const documents = Object.values(DocumentType).map((type) => {
    const doc = byType.get(type);
    return {
      type,
      required: REQUIRED_DOCUMENTS.includes(type),
      status: doc?.status ?? VerificationStatus.PENDING,
      number: doc?.number ?? null,
      expiresAt: doc?.expiresAt ?? null,
      rejectionReason: doc?.rejectionReason ?? null,
      hasFile: Boolean(doc?.fileKey),
      documentId: doc?.id ?? null,
    };
  });

  return res.json({
    verificationStatus: profile.verificationStatus,
    rejectionReason: profile.rejectionReason,
    approvedAt: profile.approvedAt,
    documents,
  });
});

// Declared before `POST /:type`, otherwise "verify" is captured as a document type.
/** Runs the automated government checks against the numbers on file. */
documentsRouter.post("/verify", async (req: AuthedRequest, res) => {
  const driverId = req.auth!.sub;
  const profile = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
  if (!profile) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Driver profile not found." } });
  }
  if (profile.verificationStatus === VerificationStatus.SUSPENDED) {
    return res.status(403).json({ error: { code: "SUSPENDED", message: "Your account is suspended. Contact support." } });
  }

  let verificationStatus;
  try {
    verificationStatus = await runAllChecks(driverId);
  } catch (e) {
    // The government-records lookup is a network call to a vendor, and `getKycProvider()`
    // refuses outright when none is configured. Either way the rejection must not escape an
    // async handler: Express 4 does not catch that, so the request hangs until the host gives
    // up — which reaches the driver as a dead screen rather than "try again later".
    console.error("[documents] verification failed:", e);
    return res.status(503).json({
      error: {
        code: "VERIFICATION_UNAVAILABLE",
        message: "Document verification is unavailable right now. Please try again shortly.",
      },
    });
  }

  const documents = await prisma.driverDocument.findMany({ where: { driverId } });
  return res.json({ verificationStatus, documents });
});

const metaSchema = z.object({
  number: z.string().trim().min(3).optional(),
  // Accepts YYYY-MM-DD from a date picker.
  expiresAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
});

documentsRouter.post("/:type", upload.single("file"), async (req: AuthedRequest, res) => {
  const driverId = req.auth!.sub;

  const type = req.params.type as DocumentType;
  if (!Object.values(DocumentType).includes(type)) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "Unknown document type." } });
  }

  const parsedMeta = metaSchema.safeParse(req.body ?? {});
  if (!parsedMeta.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsedMeta.error.issues[0].message } });
  }

  if (!req.file && !parsedMeta.data.number) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "Attach a file or enter the document number." } });
  }

  let fileKey: string | undefined;
  if (req.file) {
    const ext = ALLOWED_UPLOAD_TYPES[req.file.mimetype];
    const stored = await getStorage().put(req.file.buffer, req.file.mimetype, ext);
    fileKey = stored.key;
  }

  const expiresAt = parsedMeta.data.expiresAt ? new Date(parsedMeta.data.expiresAt) : undefined;

  // A re-upload always resets the document to PENDING. Otherwise a driver could get a
  // document approved, then quietly swap the file for a different one.
  const existing = await prisma.driverDocument.findUnique({
    where: { driverId_type: { driverId, type } },
  });

  if (existing?.fileKey && fileKey) {
    await getStorage().delete(existing.fileKey);
  }

  await prisma.driverDocument.upsert({
    where: { driverId_type: { driverId, type } },
    create: { driverId, type, number: parsedMeta.data.number, fileKey, expiresAt, status: VerificationStatus.PENDING },
    update: {
      number: parsedMeta.data.number ?? existing?.number,
      fileKey: fileKey ?? existing?.fileKey,
      expiresAt: expiresAt ?? existing?.expiresAt,
      status: VerificationStatus.PENDING,
      rejectionReason: null,
      verifiedAt: null,
    },
  });

  const verificationStatus = await recomputeDriverStatus(driverId);
  return res.status(201).json({ ok: true, verificationStatus });
});

/** A driver may read back their own uploads, and only their own. */
documentsRouter.get("/:id/file", async (req: AuthedRequest, res) => {
  const doc = await prisma.driverDocument.findUnique({ where: { id: req.params.id } });
  if (!doc || doc.driverId !== req.auth!.sub || !doc.fileKey) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Document not found." } });
  }
  const file = await getStorage().get(doc.fileKey);
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(file.buffer);
});
