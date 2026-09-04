import crypto from "crypto";

// Crockford base32 without I, L, O and U: no character pairs a person can confuse when
// reading a reference down the phone, and no accidental words.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Short, human-usable booking handle — "TRK-4F2A91".
 *
 * cuids are the primary key and stay that way: unguessable and collision-free. But nobody
 * can read `cmtj2442z0007xz6gcl87ucil` to a support agent or type it into a search box, and
 * the app already offers "Search by Shipment ID".
 *
 * 6 characters of this alphabet is ~1 in 10^9, and the column is UNIQUE, so the retry in
 * `generateUniqueReference` handles the rare clash rather than hoping it never happens.
 */
export function generateReference(): string {
  const bytes = crypto.randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `TRK-${out}`;
}

/**
 * Retries against the unique index rather than pre-checking, since a pre-check is racy —
 * two concurrent bookings can both see a reference as free.
 */
export async function generateUniqueReference(
  exists: (reference: string) => Promise<boolean>,
  attempts = 5,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const candidate = generateReference();
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("Could not allocate a unique booking reference");
}
