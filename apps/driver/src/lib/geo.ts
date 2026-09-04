export type LatLng = { lat: number; lng: number };

/**
 * Decodes Google's encoded-polyline format (precision 5), which is what the backend's
 * routing layer emits regardless of which provider answered.
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

/**
 * Compass bearing from one point to the next, in degrees clockwise from north — this is
 * what rotates the truck marker to face its direction of travel.
 */
export function bearingBetween(from: LatLng, to: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;

  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Metres between two points — used to decide whether a GPS fix moved enough to matter. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Picks the heading to draw the truck at.
 *
 * The device's own GPS heading is authoritative at speed, but it is pure noise when nearly
 * stationary — a parked truck would spin on the spot. Below a walking pace we derive the
 * bearing from actual movement between fixes instead, and if there wasn't any, we keep the
 * previous heading rather than snapping to an arbitrary one.
 */
const MIN_SPEED_FOR_GPS_HEADING = 2; // m/s, roughly walking pace
const MIN_MOVE_FOR_DERIVED_HEADING = 8; // metres

export function resolveHeading(
  prev: LatLng | null,
  next: LatLng,
  gpsHeading: number | undefined,
  speed: number | undefined,
  fallback: number,
): number {
  if (speed != null && speed >= MIN_SPEED_FOR_GPS_HEADING && gpsHeading != null && !Number.isNaN(gpsHeading)) {
    return gpsHeading;
  }
  if (prev && distanceMeters(prev, next) >= MIN_MOVE_FOR_DERIVED_HEADING) {
    return bearingBetween(prev, next);
  }
  return fallback;
}

/** Bounding box for a set of points, so the map can frame the whole route on load. */
export function boundsOf(points: LatLng[]) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}
