/**
 * Web stub for push.
 *
 * `expo-notifications` has no web build — importing it in a browser bundle fails to
 * resolve `getDevicePushTokenAsync` and takes the entire app down with it, which is
 * exactly what happened before this file existed. The browser is a development and
 * preview surface here, not a shipping target, so the honest behaviour is no push at all
 * rather than a half-working shim.
 *
 * The in-app load popup is socket-driven and works unchanged on web, so dispatch is still
 * fully previewable in the browser — only the out-of-app notification isn't.
 */

export type LoadNotificationData = { type?: string; bookingId?: string };

export async function ensureLoadsChannel(): Promise<void> {
  // No notification channels on web.
}

export async function registerForPush(): Promise<string | null> {
  return null;
}

export async function unregisterPush(): Promise<void> {
  // Nothing was ever registered.
}

export function addNotificationTapListener(
  _handler: (data: LoadNotificationData) => void,
): () => void {
  return () => {};
}
