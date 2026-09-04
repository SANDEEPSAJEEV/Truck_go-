// The fare formula itself is server-side-only and never appears in the client bundle, so this
// stays a placeholder shape — base + per-km + a small weight surcharge, scaled by vehicle type.
// What IS confirmed from decompiled_user.js:472572-472594 is the response shape the client
// expects: { distanceKm, durationMin, fare: { total } } — nested, not a flat `estimatedFare`.

import { VehicleType } from "@prisma/client";

const BASE_FARE = 80;
const PER_KM: Record<VehicleType, number> = {
  miniTruck: 18,
  pickup: 22,
  tataAce: 20,
  tempo: 24,
  largeTruck: 40,
  container: 35,
};
const PER_TON = 15;
const AVG_SPEED_KMPH = 35;
const MINIMUM_FARE = 150;

export function estimateFare(distanceKm: number, vehicleType: VehicleType, weightTons?: number) {
  const raw = BASE_FARE + distanceKm * PER_KM[vehicleType] + (weightTons ?? 0) * PER_TON;
  const total = Math.max(Math.round(raw), MINIMUM_FARE);
  const durationMin = Math.round((distanceKm / AVG_SPEED_KMPH) * 60);
  return { total, durationMin };
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
