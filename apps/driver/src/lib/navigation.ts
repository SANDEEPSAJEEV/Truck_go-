import { Linking, Platform } from 'react-native';

/**
 * Hands the driver off to Google Maps for turn-by-turn navigation.
 *
 * The in-app map shows where the truck is and what the route looks like, but it does not
 * speak instructions, does not warn about a turn, and does not recalculate when one is
 * missed. Rather than rebuild all of that — and pay for a Directions call on every
 * re-route — this opens the app the driver already trusts, which brings voice guidance,
 * traffic and lane hints for free.
 *
 * `google.navigation:` starts guidance immediately rather than dropping the driver on a
 * preview screen. It is Android-only, so the universal maps URL is the fallback (and the
 * iOS path).
 */
export async function openTurnByTurn(lat: number, lng: number, label?: string): Promise<boolean> {
  const universal = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;

  if (Platform.OS === 'android') {
    const intent = `google.navigation:q=${lat},${lng}&mode=d`;
    try {
      if (await Linking.canOpenURL(intent)) {
        await Linking.openURL(intent);
        return true;
      }
    } catch {
      // Google Maps not installed, or the intent was refused — fall through to the URL,
      // which any browser can handle.
    }
  }

  try {
    await Linking.openURL(universal);
    return true;
  } catch {
    return false;
  }
}
