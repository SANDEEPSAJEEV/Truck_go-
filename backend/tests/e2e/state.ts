/**
 * Handoff between suites that share one scenario.
 *
 * The trip lifecycle is a state machine: bidding needs an open booking, the lifecycle needs an
 * accepted bid, payments need a delivered trip, ratings need a completed one. Re-running the
 * whole chain inside each suite would triple the request count against a rate-limited server
 * for no extra coverage, so the chain runs once and each suite picks it up where the last one
 * left it.
 *
 * A suite that finds its prerequisite missing fails loudly rather than silently skipping —
 * a skipped payment suite reported as green is exactly the kind of false pass this whole
 * exercise exists to eliminate.
 */

export const state: {
  /** The booking driven through the full custody chain in suite 07. */
  tripBookingId?: string;
  /** Set once that booking reaches DELIVERED. */
  deliveredBookingId?: string;
  /** Razorpay order id from suite 08, needed to sign the webhook. */
  gatewayOrderId?: string;
} = {};

export function require<K extends keyof typeof state>(key: K, why: string): NonNullable<(typeof state)[K]> {
  const value = state[key];
  if (value === undefined) {
    throw new Error(`Missing ${key}: ${why}. An earlier suite did not complete — run the full suite, not just this one.`);
  }
  return value as NonNullable<(typeof state)[K]>;
}
