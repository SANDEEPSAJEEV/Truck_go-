import * as Location from 'expo-location';

const DEFAULT_TIMEOUT_MS = 18_000;

/**
 * A GPS fix that never resolves would leave a button spinning forever, so every
 * location read is bounded. Returns null when permission is missing, the device
 * can't get a fix, or the read takes too long — callers decide what that means.
 *
 * `Accuracy.High` (real GPS), not `Balanced` (network/WiFi-based) — this is the same fix
 * used for every one-shot read: centering the dashboard map, publishing the position that
 * flips "Go Online" on, and stamping a trip status change. All three feed the exact
 * coordinate the backend's radius-based dispatch matches drivers against
 * (`DriverProfile.currentLat/currentLng`); a coarse network fix that's off by kilometers
 * doesn't just mis-center a map, it silently breaks which loads a driver is shown as
 * nearby. `trip/[id].tsx`'s live-tracking `watchPositionAsync` was already High for the
 * same reason — this brings every other read in line with it. The bounded timeout is
 * raised slightly because a real GPS fix, especially the first one or one taken indoors,
 * can genuinely take longer than a network-based guess did.
 */
export async function getPositionOrNull(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const perm = await Location.getForegroundPermissionsAsync();
  if (perm.status !== 'granted') return null;
  return Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}
