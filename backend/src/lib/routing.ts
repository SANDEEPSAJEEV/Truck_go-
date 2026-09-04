import { haversineKm } from "./fare";

// Road routing sits behind an interface for the same reason SMS and KYC do: the app needs
// real routes now, and the Google key can arrive later without touching any caller.
//
// A straight line between two points is not a route. Haversine under-quotes every fare
// (a 55 km straight line is often 70+ km of actual road), and drawing a dashed line
// between pickup and drop is a placeholder, not navigation.

export type LatLng = { lat: number; lng: number };

export type Route = {
  distanceKm: number;
  durationMin: number;
  /** Encoded polyline (Google's algorithm, precision 5) — the shape the map draws. */
  polyline: string;
  /** Which provider answered, so a cached route can be invalidated on a provider switch. */
  provider: string;
};

export interface RouteProvider {
  readonly name: string;
  route(origin: LatLng, destination: LatLng): Promise<Route>;
}

/* -------------------------------------------------------------------------- */
/* Polyline encoding                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Google's encoded-polyline format. Both providers emit it so the client only ever has to
 * decode one shape, and a route stored today still renders after switching providers.
 */
export function encodePolyline(points: LatLng[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = "";

  const encodeValue = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let chunk = "";
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    chunk += String.fromCharCode(v + 63);
    return chunk;
  };

  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    result += encodeValue(lat - lastLat);
    result += encodeValue(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * OSRM — real road routing, free, no API key. Used so routing works today rather than
 * waiting on Google billing setup.
 *
 * The public demo server is rate-limited and carries no uptime guarantee, so it is a
 * development default only: set OSRM_URL to a self-hosted instance, or configure Google,
 * before this serves real traffic.
 */
export class OsrmRouteProvider implements RouteProvider {
  readonly name = "osrm";

  constructor(private readonly baseUrl = process.env.OSRM_URL ?? "https://router.project-osrm.org") {}

  async route(origin: LatLng, destination: LatLng): Promise<Route> {
    const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const url = `${this.baseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM responded ${res.status}`);

    const data: any = await res.json();
    const leg = data?.routes?.[0];
    if (!leg) throw new Error("OSRM returned no route");

    // GeoJSON is [lng, lat]; everything else here is {lat, lng}.
    const points: LatLng[] = (leg.geometry?.coordinates ?? []).map((c: [number, number]) => ({
      lat: c[1],
      lng: c[0],
    }));

    return {
      distanceKm: Number((leg.distance / 1000).toFixed(2)),
      durationMin: Math.round(leg.duration / 60),
      polyline: encodePolyline(points),
      provider: this.name,
    };
  }
}

/**
 * Google Routes API.
 *
 * The original app used the Directions API (decompiled_user.js:461276,
 * `fetchGoogleRoute`), but Directions became a Legacy SKU in March 2025 and can no longer
 * be enabled on a newly created Cloud project — so replicating it exactly would produce a
 * provider that simply cannot be switched on. Routes API is its replacement: POST instead
 * of GET, a required field mask, and duration as a string like "165s".
 *
 * The key stays here on the server. The original shipped it inside the APK, which means
 * anyone who decompiles the app can bill the account.
 */
export class GoogleRouteProvider implements RouteProvider {
  readonly name = "google";

  constructor(private readonly apiKey: string) {}

  async route(origin: LatLng, destination: LatLng): Promise<Route> {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        // Routes API bills partly on what you ask for, so request exactly the three
        // fields used and nothing else.
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: "DRIVE",
        // TRAFFIC_AWARE gives a real-world ETA rather than free-flow, which is the number
        // a customer is actually waiting on. It bills at the Pro tier rather than
        // Essentials — set GOOGLE_ROUTES_TRAFFIC_UNAWARE=1 to trade accuracy for cost.
        routingPreference: process.env.GOOGLE_ROUTES_TRAFFIC_UNAWARE === "1" ? "TRAFFIC_UNAWARE" : "TRAFFIC_AWARE",
      }),
    });

    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.routes?.length) {
      throw new Error(`Google Routes failed (${res.status}): ${data?.error?.message ?? "no route"}`);
    }

    const route = data.routes[0];
    // Duration comes back as a protobuf duration string, e.g. "1234s".
    const seconds = Number(String(route.duration ?? "0s").replace("s", "")) || 0;

    return {
      distanceKm: Number((route.distanceMeters / 1000).toFixed(2)),
      durationMin: Math.round(seconds / 60),
      polyline: route.polyline.encodedPolyline,
      provider: this.name,
    };
  }
}

/** Straight-line fallback so a routing outage degrades the fare rather than failing the booking. */
export class HaversineRouteProvider implements RouteProvider {
  readonly name = "haversine";

  async route(origin: LatLng, destination: LatLng): Promise<Route> {
    const straight = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng);
    // Roads are not straight. ~1.3x is the usual planar detour factor and beats quoting the
    // straight-line distance as if it were drivable.
    const distanceKm = Number((straight * 1.3).toFixed(2));
    return {
      distanceKm,
      durationMin: Math.round((distanceKm / 35) * 60),
      polyline: encodePolyline([origin, destination]),
      provider: this.name,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Reverse geocoding                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Turns the truck's coordinates into a place a customer recognises — "Near Angamaly"
 * rather than "10.1963, 76.3860".
 *
 * Called only from the ETA endpoint, which is cached per trip, so this runs about once a
 * minute per active trip rather than on every GPS tick. That matters: reverse geocoding is
 * billed per call on Google and rate-limited on Nominatim.
 */
export async function reverseGeocode(point: LatLng): Promise<string | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;

  try {
    if (key) {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("latlng", `${point.lat},${point.lng}`);
      // Locality-level is what a person actually says out loud; street addresses are noise
      // for "where is my truck right now".
      url.searchParams.set("result_type", "locality|sublocality|neighborhood");
      url.searchParams.set("key", key);

      const res = await fetch(url.toString());
      const data: any = await res.json().catch(() => null);
      const first = data?.results?.[0];
      if (first) {
        const locality = first.address_components?.find((c: any) =>
          c.types?.some((t: string) => ["locality", "sublocality", "neighborhood"].includes(t)),
        );
        return locality?.long_name ?? first.formatted_address ?? null;
      }
      return null;
    }

    // Nominatim: free, no key. Its usage policy requires an identifying User-Agent.
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${point.lat}&lon=${point.lng}&format=json&zoom=14`;
    const res = await fetch(url, { headers: { "User-Agent": "TruckGo/1.0 (logistics dispatch)" } });
    const data: any = await res.json().catch(() => null);
    const a = data?.address;
    return (
      a?.suburb ?? a?.village ?? a?.town ?? a?.city_district ?? a?.city ?? a?.county ?? null
    );
  } catch {
    // A missing place name must never break the tracking screen — the map and ETA stand
    // on their own.
    return null;
  }
}

let provider: RouteProvider | null = null;

export function getRouteProvider(): RouteProvider {
  if (provider) return provider;
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  provider = key ? new GoogleRouteProvider(key) : new OsrmRouteProvider();
  return provider;
}

/**
 * Routing is a paid, rate-limited, network-dependent call, so it never fails a booking:
 * on any error this falls back to the straight-line estimate and the caller carries on.
 */
export async function routeOrFallback(origin: LatLng, destination: LatLng): Promise<Route> {
  try {
    return await getRouteProvider().route(origin, destination);
  } catch (e) {
    console.error("[routing] falling back to straight-line:", (e as Error)?.message ?? e);
    return new HaversineRouteProvider().route(origin, destination);
  }
}
