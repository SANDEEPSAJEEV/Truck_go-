import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Alert preferences.
 *
 * Only settings the app actually honours live here. A toggle that writes a value nothing
 * ever reads is worse than no toggle — the driver turns it off, assumes something changed,
 * and it didn't.
 *
 * - `newLoadAlerts`   — show the full-screen load popup, and auto-expand the dashboard
 *                       sheet when a matching load arrives. Read by the load alert host.
 * - `autoOpenAcceptedTrip` — when a bid is accepted, jump straight into the trip screen
 *                       instead of surfacing a dismissible card. Read by the dashboard.
 *
 * System-level push delivery is controlled by Android's own per-app notification settings,
 * not here — duplicating that switch in-app just creates two sources of truth.
 */
export type NotificationPrefs = {
  newLoadAlerts: boolean;
  autoOpenAcceptedTrip: boolean;
};

export const DEFAULT_PREFS: NotificationPrefs = {
  newLoadAlerts: true,
  autoOpenAcceptedTrip: true,
};

const KEY = 'truckgo.notificationPrefs';

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    // Corrupt or absent — the defaults are the safe answer (alerts on).
    return DEFAULT_PREFS;
  }
}

export async function setNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(prefs));
}
