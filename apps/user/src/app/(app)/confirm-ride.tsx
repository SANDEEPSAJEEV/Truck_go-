import { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import type { GeoPoint } from '@/lib/geocode';

type Estimate = { distanceKm: number; durationMin: number; fare: { total: number } };

export default function ConfirmRide() {
  const params = useLocalSearchParams<{ pickup: string; drop: string; vehicleType: string }>();
  // These arrive as JSON strings on the URL. A bare JSON.parse at render throws — and an
  // exception during render takes the whole screen down rather than showing anything — which
  // is what happens on a deep link, an app restart on this route, or a back-navigation that
  // lost its params.
  const points = useMemo(() => {
    try {
      const pickup = JSON.parse(params.pickup ?? '') as GeoPoint;
      const drop = JSON.parse(params.drop ?? '') as GeoPoint;
      if (!pickup?.address || !drop?.address) return null;
      return { pickup, drop };
    } catch {
      return null;
    }
  }, [params.pickup, params.drop]);
  const vehicleType = params.vehicleType;

  const [weightTons, setWeightTons] = useState('');
  const [goodsType, setGoodsType] = useState('');
  const [notes, setNotes] = useState('');

  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [error, setError] = useState('');
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    if (!points) return;
    apiFetch<Estimate>('/bookings/estimate', {
      method: 'POST',
      body: {
        pickup: points.pickup,
        drop: points.drop,
        vehicleType,
        weightTons: weightTons ? Number(weightTons) : undefined,
      },
    })
      .then(setEstimate)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't resolve pickup & drop-off"));
    // Re-estimate only when the weight actually changes — pickup/drop/vehicleType are
    // fixed for this screen's lifetime (set once via route params).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightTons]);

  async function onConfirm() {
    if (!points) return;
    setBooking(true);
    setError('');
    try {
      const data = await apiFetch<{ booking: { id: string } }>('/bookings', {
        method: 'POST',
        body: {
          pickup: points.pickup,
          drop: points.drop,
          vehicleType,
          weightTons: weightTons ? Number(weightTons) : undefined,
          goodsType: goodsType || undefined,
          notes: notes || undefined,
        },
      });
      router.replace(`/(app)/track/${data.booking.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the booking.');
    } finally {
      setBooking(false);
    }
  }

  if (!points) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.container}>
          <AppText variant="headlineLg">Something went missing</AppText>
          <AppText variant="bodyLg" color="onSurfaceVariant">
            We lost the pickup and drop-off for this booking. Choose them again and we&apos;ll
            pick up where you left off.
          </AppText>
          <Button label="Start over" onPress={() => router.replace('/(app)/booking')} />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <AppText variant="headlineLg">Confirm your ride</AppText>

        <AppText variant="bodyLg" numberOfLines={2}>
          From: {points.pickup.address}
        </AppText>
        <AppText variant="bodyLg" numberOfLines={2}>
          To: {points.drop.address}
        </AppText>

        <TextField
          label="Weight (tons, optional)"
          placeholder="Add weight"
          keyboardType="decimal-pad"
          value={weightTons}
          onChangeText={setWeightTons}
        />
        <TextField
          label="Goods type"
          placeholder="What are you transporting? (optional)"
          value={goodsType}
          onChangeText={setGoodsType}
        />
        <TextField
          label="Notes"
          placeholder="Notes for the driver (optional)"
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        {!estimate && !error ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.primary} />
            <AppText variant="bodyLg" color="onSurfaceVariant">
              Resolving pickup & drop-off…
            </AppText>
          </View>
        ) : null}

        {error ? (
          <AppText variant="bodySm" color="error">
            {error}
          </AppText>
        ) : null}

        {estimate ? (
          <View style={styles.estimateCard}>
            <AppText variant="headlineMd" color="onPrimaryContainer">
              {estimate.distanceKm} km · {estimate.durationMin} min
            </AppText>
            <AppText variant="displayLg" color="onPrimaryContainer">
              ₹{estimate.fare.total}
            </AppText>
            <Button label={booking ? 'Booking…' : 'Confirm booking'} onPress={onConfirm} loading={booking} />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.md },
  loading: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  estimateCard: { borderRadius: Radii.lg, padding: Spacing.lg, gap: Spacing.sm, backgroundColor: Colors.primaryContainer },
});
