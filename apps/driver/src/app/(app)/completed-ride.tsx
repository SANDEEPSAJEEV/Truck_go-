import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/ui/button';
import { Colors, FontFamily, Radii, Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { getSocket, subscribeToTrip } from '@/lib/socket';

type PaymentStatus = 'NONE' | 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

const PAYMENT_COPY: Record<PaymentStatus, { label: string; tone: 'pending' | 'paid' | 'failed' }> = {
  NONE: { label: 'Awaiting payment', tone: 'pending' },
  PENDING: { label: 'Payment in progress', tone: 'pending' },
  PAID: { label: 'Paid', tone: 'paid' },
  FAILED: { label: 'Payment failed', tone: 'failed' },
  REFUNDED: { label: 'Refunded', tone: 'failed' },
};

type Booking = {
  id: string;
  pickupAddress: string;
  dropAddress: string;
  distanceKm: number | null;
  durationMin: number | null;
  estimatedFare: number;
  actualFare: number | null;
};

// Confirmed copy, reference/UI-COPY-user.md (durationHm group).
export default function CompletedRide() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('NONE');

  const load = useCallback(() => {
    setError('');
    apiFetch<{ booking: Booking }>(`/bookings/${id}`)
      .then((d) => setBooking(d.booking))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load this trip.'));
  }, [id]);

  const loadPaymentStatus = useCallback(() => {
    apiFetch<{ status: PaymentStatus }>(`/payments/${id}`)
      .then((d) => setPaymentStatus(d.status))
      .catch(() => {
        // Non-fatal — the rest of the completed-trip summary still renders without it.
      });
  }, [id]);

  useEffect(load, [load]);
  useEffect(loadPaymentStatus, [loadPaymentStatus]);

  // Pushed the moment the rider's payment clears (or fails) — the webhook is the only
  // thing that ever writes this status, so this is a live reflection of that, not a guess.
  useEffect(() => {
    let cleanup = () => {};
    getSocket().then((socket) => {
      const leaveTrip = subscribeToTrip(socket, id);
      const onUpdate = (payload: { bookingId: string; status: string }) => {
        if (payload.bookingId === id) setPaymentStatus(payload.status as PaymentStatus);
      };
      socket.on('payment:update', onUpdate);
      cleanup = () => {
        leaveTrip();
        socket.off('payment:update', onUpdate);
      };
    });
    return () => cleanup();
  }, [id]);

  if (!booking) {
    return (
      <Screen>
        <View style={styles.container}>
          {error ? (
            <>
              <AppText variant="headlineMd" align="center">
                Delivery completed
              </AppText>
              <AppText variant="bodyMd" color="error" align="center">
                {error}
              </AppText>
              <Button label="Retry" variant="outline" onPress={load} />
              <Button label="Go To Dashboard" onPress={() => router.replace('/(app)/(tabs)/dashboard')} />
            </>
          ) : (
            <ActivityIndicator color={Colors.primary} />
          )}
        </View>
      </Screen>
    );
  }

  const hours = booking.durationMin ? Math.floor(booking.durationMin / 60) : 0;
  const minutes = booking.durationMin ? booking.durationMin % 60 : 0;
  const duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.badge}>
          <AppText variant="labelCaps" color="onPrimaryContainer" uppercase>
            Completed
          </AppText>
        </View>
        <AppText variant="displayLg" align="center">
          Delivery Successful
        </AppText>
        <AppText variant="bodyLg" color="onSurfaceVariant" align="center">
          Trip completed.
        </AppText>

        <View style={styles.earningsCard}>
          <AppText variant="labelCaps" color="onSurfaceVariant" uppercase>
            Earnings
          </AppText>
          <AppText variant="displayLg" color="primary" style={styles.mono}>
            ₹{booking.actualFare ?? booking.estimatedFare}
          </AppText>
          <View style={[styles.paymentPill, PAYMENT_PILL_STYLE[PAYMENT_COPY[paymentStatus].tone]]}>
            <AppText variant="labelCaps" color={PAYMENT_PILL_TEXT[PAYMENT_COPY[paymentStatus].tone]} uppercase>
              {PAYMENT_COPY[paymentStatus].label}
            </AppText>
          </View>
        </View>

        <View style={styles.row}>
          <Stat label="Distance" value={`${booking.distanceKm ?? '—'} km`} />
          <Stat label="Duration" value={duration} />
        </View>

        <AppText variant="labelCaps" color="onSurfaceVariant" uppercase>
          Route
        </AppText>
        <AppText variant="bodyLg">Pickup: {booking.pickupAddress}</AppText>
        <AppText variant="bodyLg">Drop-off: {booking.dropAddress}</AppText>

        <Button label="View Earnings" variant="navy" onPress={() => router.replace('/(app)/(tabs)/earnings')} />
        <Button label="Go To Dashboard" onPress={() => router.replace('/(app)/(tabs)/dashboard')} />
      </View>
    </Screen>
  );
}

const PAYMENT_PILL_STYLE: Record<'pending' | 'paid' | 'failed', { backgroundColor: string }> = {
  pending: { backgroundColor: 'rgba(148,75,0,0.12)' },
  paid: { backgroundColor: 'rgba(22,163,74,0.12)' },
  failed: { backgroundColor: Colors.errorContainer },
};
const PAYMENT_PILL_TEXT: Record<'pending' | 'paid' | 'failed', keyof typeof Colors> = {
  pending: 'secondary',
  paid: 'success',
  failed: 'error',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <AppText variant="labelCaps" color="onSurfaceVariant" uppercase>
        {label}
      </AppText>
      <AppText variant="headlineMd">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.lg, gap: Spacing.md, justifyContent: 'center' },
  badge: {
    alignSelf: 'center',
    backgroundColor: Colors.primaryContainer,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  earningsCard: {
    alignItems: 'center',
    gap: Spacing.xs,
    padding: Spacing.lg,
    borderRadius: Radii.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  row: { flexDirection: 'row', gap: Spacing.md },
  mono: { fontFamily: FontFamily.mono },
  paymentPill: {
    marginTop: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radii.pill,
  },
});
