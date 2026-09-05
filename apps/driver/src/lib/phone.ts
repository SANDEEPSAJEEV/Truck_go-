/**
 * Strips everything except an optional leading + and digits, matching the backend's
 * `phoneSchema` (`/^\+?[0-9]{10,15}$/`).
 *
 * Every phone field's own placeholder shows "+91 98765 43210" — spaced, the way a person
 * actually reads a phone number, and the way one arrives when pasted from Contacts. The
 * backend rejects that exact shape outright. Without this, typing or pasting a phone
 * number the way the UI itself suggests fails registration before OTP is ever reached.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/\D/g, '');
}
