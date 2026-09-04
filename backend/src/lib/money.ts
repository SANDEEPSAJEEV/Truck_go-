import { Prisma } from "@prisma/client";

/**
 * Money is stored as Postgres `numeric` (Prisma `Decimal`), because binary floating point
 * cannot represent most decimal fractions exactly. A Float column drifts by fractions of a
 * paisa per row, and those errors accumulate the moment you sum a driver's earnings or
 * reconcile a payout against a gateway.
 *
 * The trade-off is that `Prisma.Decimal` serialises to a JSON *string*, which would silently
 * break every client doing arithmetic or comparison on a fare. These helpers convert at the
 * API boundary so the wire format stays exactly what the apps already expect: numbers.
 */

export type Money = Prisma.Decimal | number | null | undefined;

/** Decimal -> number for JSON responses. Null and undefined pass through unchanged. */
export function toAmount(value: Money): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : value.toNumber();
}

/** number -> Decimal for writes, so callers never hand Prisma a float. */
export function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

/**
 * Exact addition over stored amounts. Deliberately not `reduce((a, b) => a + b)` on numbers —
 * that is the bug this module exists to prevent.
 */
export function sumAmounts(values: Money[]): number {
  return values
    .reduce<Prisma.Decimal>((total, v) => {
      if (v === null || v === undefined) return total;
      return total.plus(typeof v === "number" ? new Prisma.Decimal(v.toFixed(2)) : v);
    }, new Prisma.Decimal(0))
    .toNumber();
}

/** Compares a client-supplied number against a stored amount without going through float. */
export function isBelow(candidate: number, floor: Money): boolean {
  if (floor === null || floor === undefined) return false;
  const f = typeof floor === "number" ? new Prisma.Decimal(floor.toFixed(2)) : floor;
  return new Prisma.Decimal(candidate.toFixed(2)).lessThan(f);
}
