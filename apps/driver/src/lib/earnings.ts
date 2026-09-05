export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

export type Trip = {
  id?: string;
  reference?: string;
  dropAddress?: string;
  completedAt: string | null;
  actualFare: number | null;
  estimatedFare: number;
  paymentStatus?: PaymentStatus;
};

export type EarningsResponse = {
  totalEarnings: number;
  completedTrips: number;
  trips: Trip[];
};

export function fareOf(t: Trip): number {
  return t.actualFare ?? t.estimatedFare ?? 0;
}

/**
 * Count of `trips` whose `completedAt` falls on the device's own local calendar day.
 *
 * Shared with the earnings chart's own day-bucketing so "today" means the same thing in
 * both places — deliberately local rather than a fixed timezone, so a driver whose phone
 * isn't on IST still sees a trip filed under the day it actually finished for them.
 */
export function countCompletedToday(trips: Trip[]): number {
  const today = new Date().toDateString();
  return trips.filter((t) => t.completedAt && new Date(t.completedAt).toDateString() === today).length;
}
