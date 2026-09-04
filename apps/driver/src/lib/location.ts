import * as Location from 'expo-location';

const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * A GPS fix that never resolves would leave a button spinning forever, so every
 * location read is bounded. Returns null when permission is missing, the device
 * can't get a fix, or the read takes too long — callers decide what that means.
 */
export async function getPositionOrNull(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const perm = await Location.getForegroundPermissionsAsync();
  if (perm.status !== 'granted') return null;
  return Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}
