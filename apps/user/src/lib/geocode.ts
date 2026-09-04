// Address search now goes through the backend's /places proxy (backend/src/lib/places.ts)
// instead of calling Nominatim directly from the client. Two reasons: a server-side key
// never ships inside the app bundle when Google Places is configured (the original app
// embedded its key in the APK — decompiling it is exactly how that key was recovered
// during this rebuild), and per-keystroke autocomplete needs rate limiting the client
// can't enforce on itself.
import { apiFetch, ApiError } from '@/lib/api';

// Confirmed shape from decompiled_user.js:442526, 467744 — {address, lat, lng, placeId}.
export type GeoPoint = { address: string; lat: number; lng: number; placeId?: string };

export async function reverseGeocode(lat: number, lng: number): Promise<GeoPoint> {
  try {
    const data = await apiFetch<{ address: string }>(`/places/reverse?lat=${lat}&lng=${lng}`);
    return { address: data.address, lat, lng };
  } catch {
    // A missing address must never block "use my current location" — the coordinates
    // themselves are still a valid pickup point.
    return { address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng };
  }
}

/**
 * Resolves a suggestion from AddressAutocomplete to coordinates.
 *
 * `placeId` is null for the free Nominatim path (which already returns coordinates baked
 * into a synthetic id — see backend NominatimPlacesProvider), and set for Google Places,
 * which requires a separate Place Details call to get a location at all.
 */
export async function getPlaceDetails(placeId: string | null, fallbackAddress: string): Promise<GeoPoint> {
  if (!placeId) {
    throw new ApiError(0, 'NO_PLACE_ID', 'This suggestion has no resolvable location.');
  }
  const data = await apiFetch<{ address: string; lat: number; lng: number; placeId?: string }>(
    `/places/details?placeId=${encodeURIComponent(placeId)}`,
  );
  return { address: data.address || fallbackAddress, lat: data.lat, lng: data.lng, placeId: data.placeId };
}
