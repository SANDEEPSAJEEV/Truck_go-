import { useState } from 'react';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/ui/button';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { reverseGeocode, type GeoPoint } from '@/lib/geocode';
import { AddressAutocomplete } from '@/components/address-autocomplete';

// Confirmed camelCase values, decompiled_user.js ~403688-403694.
const VEHICLE_TYPES = [
  { value: 'miniTruck', label: 'Mini Truck' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'tataAce', label: 'Tata Ace' },
  { value: 'tempo', label: 'Tempo' },
  { value: 'largeTruck', label: 'Large Truck' },
  { value: 'container', label: 'Container' },
] as const;

type LocationField = 'pickup' | 'drop';

export default function Booking() {
  const [pickup, setPickup] = useState<GeoPoint | null>(null);
  const [drop, setDrop] = useState<GeoPoint | null>(null);
  const [activeField, setActiveField] = useState<LocationField | null>(null);

  const [locating, setLocating] = useState(false);

  const [vehicleType, setVehicleType] = useState<(typeof VEHICLE_TYPES)[number]['value']>('tataAce');
  const [error, setError] = useState('');

  function openField(field: LocationField) {
    setActiveField(field);
    setError('');
  }

  function selectResult(point: GeoPoint) {
    if (activeField === 'pickup') setPickup(point);
    if (activeField === 'drop') setDrop(point);
    setActiveField(null);
  }

  async function useCurrentLocation() {
    setLocating(true);
    setError('');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setError('Location permission is needed to set your pickup point.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const point = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      point.placeId = 'current';
      setPickup(point);
      setActiveField(null);
    } catch {
      setError('Could not get your current location.');
    } finally {
      setLocating(false);
    }
  }

  function onContinue() {
    if (!pickup || !drop) {
      setError('Enter pickup & drop-off');
      return;
    }
    router.push({
      pathname: '/(app)/confirm-ride',
      params: { pickup: JSON.stringify(pickup), drop: JSON.stringify(drop), vehicleType },
    });
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <AppText variant="headlineLg">Where are we moving it?</AppText>

        <LocationRow label="Pickup" placeholder="Pickup location" value={pickup} onPress={() => openField('pickup')} />
        <LocationRow
          label="Drop-off"
          placeholder="Where are you dropping off?"
          value={drop}
          onPress={() => openField('drop')}
        />

        {activeField ? (
          <View style={styles.picker}>
            {activeField === 'pickup' ? (
              <Button
                label={locating ? 'Locating…' : 'Use my current location'}
                variant="navy"
                loading={locating}
                onPress={useCurrentLocation}
              />
            ) : null}
            <AddressAutocomplete
              placeholder="Search an address"
              near={pickup ? { lat: pickup.lat, lng: pickup.lng } : undefined}
              onSelect={selectResult}
              autoFocus
            />
          </View>
        ) : null}

        <View style={styles.field}>
          <AppText variant="labelCaps" color="onSurfaceVariant" uppercase>
            Vehicle
          </AppText>
          <View style={styles.vehicleRow}>
            {VEHICLE_TYPES.map((v) => {
              const selected = vehicleType === v.value;
              return (
                <Pressable
                  key={v.value}
                  onPress={() => setVehicleType(v.value)}
                  style={[styles.chip, selected && styles.chipSelected]}>
                  <AppText variant="headlineSm" color={selected ? 'onPrimary' : 'onSurface'}>
                    {v.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {error ? (
          <AppText variant="bodySm" color="error">
            {error}
          </AppText>
        ) : null}

        <Button label="See available trucks" onPress={onContinue} />
      </ScrollView>
    </Screen>
  );
}

function LocationRow({
  label,
  placeholder,
  value,
  onPress,
}: {
  label: string;
  placeholder: string;
  value: GeoPoint | null;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.field}>
      <AppText variant="labelCaps" color="onSurfaceVariant" uppercase>
        {label}
      </AppText>
      <View style={styles.locationBox}>
        <AppText variant="bodyLg" color={value ? 'onSurface' : 'onSurfaceVariant'} numberOfLines={2}>
          {value ? value.address : placeholder}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  field: { gap: Spacing.xs },
  locationBox: {
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radii.md,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
  },
  picker: {
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radii.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  vehicleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  chipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
});
