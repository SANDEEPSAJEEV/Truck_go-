/**
 * Display names for the vehicle enum the API speaks.
 *
 * Lived inside dashboard.tsx until the Rides tab needed it too — and until then
 * profile-account.tsx was printing the raw enum (`tataAce`) straight at the driver.
 */
export const VEHICLE_LABEL: Record<string, string> = {
  miniTruck: 'Mini Truck',
  pickup: 'Pickup',
  tataAce: 'Tata Ace',
  tempo: 'Tempo',
  largeTruck: 'Large Truck',
  container: 'Container',
};

export function vehicleLabel(value?: string | null): string {
  if (!value) return '—';
  return VEHICLE_LABEL[value] ?? value;
}
