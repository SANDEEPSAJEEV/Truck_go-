import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { apiFetch } from '@/lib/api';
import { DEMO_MODE } from '@/lib/demo';

/**
 * Push registration.
 *
 * Notifications are what make dispatch work when the app is closed — without them a driver
 * only learns about a load by opening the app and looking, which is not a job you can do
 * while driving.
 *
 * The FCM credential lives in EAS, not here. Until it's uploaded, `getExpoPushTokenAsync`
 * throws on Android; that's handled as "no push yet", never as a crash, because everything
 * else on the screen still works.
 */

/**
 * High-importance channel. Android collapses default-importance notifications straight
 * into the shade with no sound — which for a load offer is the same as not sending it.
 */
const LOADS_CHANNEL = 'loads';

let registeredToken: string | null = null;

/** Foreground behaviour: a load alert should be visible even with the app already open. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureLoadsChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(LOADS_CHANNEL, {
    name: 'Load offers',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    sound: 'default',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    enableVibrate: true,
  });
}

/**
 * Ask for permission, get a token, hand it to the backend.
 *
 * Returns the token, or null when push isn't available — a simulator, a declined prompt,
 * or FCM not yet configured. Callers treat null as "in-app alerts only".
 */
export async function registerForPush(): Promise<string | null> {
  if (DEMO_MODE) return null;
  // Emulators can't obtain a token; asking anyway just throws.
  if (!Device.isDevice) return null;

  try {
    await ensureLoadsChannel();

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    if (!token) return null;

    await apiFetch('/devices/register', {
      method: 'POST',
      body: { expoPushToken: token, platform: Platform.OS },
    });
    registeredToken = token;
    return token;
  } catch (e) {
    // Most commonly: FCM credentials not yet uploaded to EAS. Not fatal, and not the
    // driver's problem — the socket path still delivers while the app is open.
    console.warn('[push] registration unavailable', e);
    return null;
  }
}

/**
 * Release this device on sign-out.
 *
 * Skipping this is how the next person to sign in on a shared phone starts receiving the
 * previous driver's loads.
 */
export async function unregisterPush(): Promise<void> {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  await apiFetch(`/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => {
    // Signing out must succeed even when the network doesn't.
  });
}

export type LoadNotificationData = { type?: string; bookingId?: string };

/**
 * Subscribe to notification taps.
 *
 * Wrapped here rather than imported directly by the layout so that `expo-notifications`
 * has exactly one entry point in the app — which is what lets `push.web.ts` stub the
 * whole module out. (It has no web build: importing it there fails to resolve
 * `getDevicePushTokenAsync` and takes the browser bundle down with it.)
 */
export function addNotificationTapListener(
  handler: (data: LoadNotificationData) => void,
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as LoadNotificationData | undefined;
    handler(data ?? {});
  });
  return () => sub.remove();
}
