// Address autocomplete sits behind a provider interface for the same reason routing does:
// it works today with no key via Nominatim, and upgrades to Google Places (New) the moment
// GOOGLE_MAPS_SERVER_KEY exists — same as GoogleRouteProvider in routing.ts.
//
// This is deliberately proxied through the backend rather than called from the app. The
// original TruckGo app embedded its Places key directly in the APK bundle — decompiling it
// is exactly how that key was recovered during this rebuild — so a server key must never
// ship inside either app.

export type PlaceSuggestion = {
  /** Stable id for this specific place, or null when the provider has none (Nominatim). */
  placeId: string | null;
  /** Full text shown in the dropdown row. */
  description: string;
  /** Short lead text a UI can bold, e.g. the place name before the locality. */
  mainText: string;
  secondaryText: string;
};

export type PlaceDetails = {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
};

export interface PlacesProvider {
  readonly name: string;
  autocomplete(query: string, opts?: { lat?: number; lng?: number }): Promise<PlaceSuggestion[]>;
  /** Resolves a suggestion's placeId to coordinates. Nominatim suggestions carry no id, so
   * this is only called for Google's provider — see the route below. */
  details(placeId: string): Promise<PlaceDetails>;
  /** Coordinates -> a full, formatted address (used by "Use my current location"). This is
   * distinct from routing.ts's reverseGeocode, which returns only a short locality name
   * for the live-tracking "truck near X" line. */
  reverse(lat: number, lng: number): Promise<string>;
}

/* -------------------------------------------------------------------------- */
/* Nominatim — free, no key                                                    */
/* -------------------------------------------------------------------------- */

const NOMINATIM_HEADERS = { "User-Agent": "TruckGo/1.0 (logistics dispatch)" };

export class NominatimPlacesProvider implements PlacesProvider {
  readonly name = "nominatim";

  async autocomplete(query: string, opts?: { lat?: number; lng?: number }): Promise<PlaceSuggestion[]> {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "6");
    url.searchParams.set("addressdetails", "1");
    // This is an India-only freight app, so results are scoped to India unconditionally —
    // without it, a short prefix like "Koc" ranks a New Caledonia airport ahead of Kochi,
    // because Nominatim's global text match has no notion of which country the app serves.
    url.searchParams.set("countrycodes", "in");
    // A viewbox around the caller's location further narrows an already-India-scoped
    // search, without excluding a real match outside it (bounded=0).
    if (opts?.lat != null && opts?.lng != null) {
      const d = 2; // ~2 degrees, generous enough not to hide a real match
      url.searchParams.set("viewbox", `${opts.lng - d},${opts.lat + d},${opts.lng + d},${opts.lat - d}`);
      url.searchParams.set("bounded", "0");
    }

    const res = await fetch(url.toString(), { headers: NOMINATIM_HEADERS });
    if (!res.ok) throw new Error(`Nominatim search failed: ${res.status}`);
    const data = (await res.json()) as any[];

    // Nominatim returns coordinates directly, so there is no separate details() call for
    // this provider — the route below packs lat/lng straight into placeId as a fallback
    // path, decoded on the way back out.
    return data.map((r) => {
      const parts = String(r.display_name).split(",");
      return {
        placeId: `nominatim:${r.lat},${r.lon}:${encodeURIComponent(r.display_name)}`,
        description: r.display_name,
        mainText: parts[0]?.trim() ?? r.display_name,
        secondaryText: parts.slice(1).join(",").trim(),
      };
    });
  }

  async details(placeId: string): Promise<PlaceDetails> {
    // Encoded as nominatim:<lat>,<lng>:<address> by autocomplete() above — decoded here
    // rather than making a second network call, since Nominatim already gave us the point.
    const m = placeId.match(/^nominatim:(-?[\d.]+),(-?[\d.]+):(.+)$/);
    if (!m) throw new Error("Invalid Nominatim place id");
    return { lat: Number(m[1]), lng: Number(m[2]), address: decodeURIComponent(m[3]) };
  }

  async reverse(lat: number, lng: number): Promise<string> {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, { headers: NOMINATIM_HEADERS });
    if (!res.ok) throw new Error(`Nominatim reverse failed: ${res.status}`);
    const data: any = await res.json();
    return data?.display_name ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Google Places API (New)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The classic Places API was marked Legacy in March 2025 and can no longer be enabled on a
 * new Cloud project — Places API (New) is its replacement: POST with a JSON body and a
 * required field mask, instead of GET with query params.
 */
export class GooglePlacesProvider implements PlacesProvider {
  readonly name = "google";

  constructor(private readonly apiKey: string) {}

  async autocomplete(query: string, opts?: { lat?: number; lng?: number }): Promise<PlaceSuggestion[]> {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.apiKey },
      body: JSON.stringify({
        input: query,
        // Biases results toward the caller without excluding matches elsewhere — a
        // driver near a state border should still find an address just across it.
        ...(opts?.lat != null && opts?.lng != null
          ? { locationBias: { circle: { center: { latitude: opts.lat, longitude: opts.lng }, radius: 50_000 } } }
          : {}),
        includedRegionCodes: ["in"],
      }),
    });

    const data: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Places autocomplete failed (${res.status}): ${data?.error?.message ?? ""}`);

    return (data?.suggestions ?? [])
      .map((s: any) => s.placePrediction)
      .filter(Boolean)
      .map((p: any) => ({
        placeId: p.placeId,
        description: p.text?.text ?? "",
        mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
      }));
  }

  async details(placeId: string): Promise<PlaceDetails> {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": "id,formattedAddress,location",
      },
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Place details failed (${res.status}): ${data?.error?.message ?? ""}`);

    return {
      placeId: data.id,
      address: data.formattedAddress,
      lat: data.location.latitude,
      lng: data.location.longitude,
    };
  }

  async reverse(lat: number, lng: number): Promise<string> {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("key", this.apiKey);
    const res = await fetch(url.toString());
    const data: any = await res.json().catch(() => null);
    return data?.results?.[0]?.formatted_address ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

let provider: PlacesProvider | null = null;

export function getPlacesProvider(): PlacesProvider {
  if (provider) return provider;
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  provider = key ? new GooglePlacesProvider(key) : new NominatimPlacesProvider();
  return provider;
}
