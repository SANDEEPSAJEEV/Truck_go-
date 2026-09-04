import type { StatusTone } from '@/constants/theme';
import type { VerificationStatus } from '@/lib/auth-context';

/**
 * One mapping from KYC status to what the driver is shown, shared by the Profile hero,
 * Personal Information and the dashboard. Three screens each inventing their own wording
 * for the same state is how "Under Review" and "Verification pending" end up on screen at
 * the same time for the same driver.
 */
export const VERIFICATION_BADGE: Record<VerificationStatus, { label: string; tone: StatusTone }> = {
  PENDING: { label: 'Under Review', tone: 'warning' },
  IN_REVIEW: { label: 'Under Review', tone: 'warning' },
  APPROVED: { label: 'Verified', tone: 'success' },
  REJECTED: { label: 'Action Needed', tone: 'danger' },
  EXPIRED: { label: 'Action Needed', tone: 'danger' },
  SUSPENDED: { label: 'Suspended', tone: 'danger' },
};
