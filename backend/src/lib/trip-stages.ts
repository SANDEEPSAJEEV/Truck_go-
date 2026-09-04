import { BookingStatus } from "@prisma/client";

/**
 * The custody chain, in one place.
 *
 *   ACCEPTED → EN_ROUTE_TO_PICKUP → ARRIVED_AT_PICKUP
 *     → [pickup PIN] → LOADING
 *     → [start PIN]  → IN_TRANSIT → ARRIVED_AT_DROP
 *     → [drop PIN]   → UNLOADING → DELIVERED
 *
 * Goods change hands three times, and each hand-off is gated by a PIN only the rider holds.
 * The driver moves the trip between gates; the rider's PIN is what opens each one.
 */

export type OtpStage = "pickup" | "start" | "drop";

/** Transitions the driver may make on their own. Everything else needs a PIN. */
export const DRIVER_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus>> = {
  ACCEPTED: BookingStatus.EN_ROUTE_TO_PICKUP,
  EN_ROUTE_TO_PICKUP: BookingStatus.ARRIVED_AT_PICKUP,
  IN_TRANSIT: BookingStatus.ARRIVED_AT_DROP,
  UNLOADING: BookingStatus.DELIVERED,
};

/** Which timestamp column each status stamps, for the audit trail. */
export const STATUS_TIMESTAMP: Partial<Record<BookingStatus, string>> = {
  EN_ROUTE_TO_PICKUP: "enRouteAt",
  ARRIVED_AT_PICKUP: "arrivedAt",
  LOADING: "loadingAt",
  IN_TRANSIT: "startedAt",
  ARRIVED_AT_DROP: "arrivedDropAt",
  UNLOADING: "unloadingAt",
  DELIVERED: "completedAt",
};

type StageConfig = {
  /** Column holding this stage's PIN. */
  field: "pickupOtp" | "startOtp" | "dropOtp";
  /** Status the trip must be in for this PIN to be entered. */
  requiredStatus: BookingStatus;
  /** Status reached once the PIN is accepted. */
  nextStatus: BookingStatus;
  /** Status whose arrival mints this PIN. */
  issuedAt: BookingStatus;
  /** Shown to the rider above the digits. */
  label: string;
  hint: string;
  /** Used in the SMS backup. */
  smsLabel: string;
};

export const STAGES: Record<OtpStage, StageConfig> = {
  pickup: {
    field: "pickupOtp",
    requiredStatus: BookingStatus.ARRIVED_AT_PICKUP,
    nextStatus: BookingStatus.LOADING,
    issuedAt: BookingStatus.ARRIVED_AT_PICKUP,
    label: "PICKUP PIN",
    hint: "Share with driver to begin loading",
    smsLabel: "pickup",
  },
  start: {
    field: "startOtp",
    requiredStatus: BookingStatus.LOADING,
    nextStatus: BookingStatus.IN_TRANSIT,
    issuedAt: BookingStatus.LOADING,
    label: "START RIDE PIN",
    hint: "Share with driver to start",
    smsLabel: "start",
  },
  drop: {
    field: "dropOtp",
    requiredStatus: BookingStatus.ARRIVED_AT_DROP,
    nextStatus: BookingStatus.UNLOADING,
    issuedAt: BookingStatus.ARRIVED_AT_DROP,
    label: "UNLOAD PIN",
    hint: "Share with driver to begin unloading",
    smsLabel: "unload",
  },
};

/** The stage whose PIN is live for a given status, if any. */
export function stageForStatus(status: BookingStatus): OtpStage | null {
  const entry = Object.entries(STAGES).find(([, cfg]) => cfg.requiredStatus === status);
  return entry ? (entry[0] as OtpStage) : null;
}

/** The stage a status change should mint a PIN for, if any. */
export function stageIssuedAt(status: BookingStatus): OtpStage | null {
  const entry = Object.entries(STAGES).find(([, cfg]) => cfg.issuedAt === status);
  return entry ? (entry[0] as OtpStage) : null;
}
