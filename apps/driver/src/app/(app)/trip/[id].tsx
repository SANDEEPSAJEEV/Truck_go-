import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { Colors, FontFamily, Radii, Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { getSocket, subscribeToTrip } from '@/lib/socket';
import { getPositionOrNull } from '@/lib/location';
import { LiveMap } from '@/components/live-map';
import { DEMO_MODE, currentDemoPin } from '@/lib/demo';
import { openTurnByTurn } from '@/lib/navigation';

type Booking = {
  id: string;
  status: string;
  pickupAddress: string;
  dropAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropLat: number;
  dropLng: number;
  /** Encoded road route for the whole journey, resolved once at booking. */
  routePolyline: string | null;
  estimatedFare: number;
  // Set once the rider accepts a bid — the driver's real payout may be above the asking
  // fare, and that's the number that must be shown here, not the original quote.
  actualFare: number | null;
};

const STATUS_LABEL: Record<string, string> = {
  ACCEPTED: 'Accepted',
  EN_ROUTE_TO_PICKUP: 'Heading to pickup',
  ARRIVED_AT_PICKUP: 'Arrived at pickup',
  LOADING: 'Loading goods',
  IN_TRANSIT: 'On the way to drop-off',
  ARRIVED_AT_DROP: 'Arrived at drop-off',
  UNLOADING: 'Unloading goods',
  DELIVERED: 'Delivered',
};

// Confirmed real driver progression, decompiled_driver.js:462651-462695 (postStatus) —
// POST /trips/:id/status {status, lat?, lng?}. No dedicated /arrived endpoint exists.
//
// Only these transitions are the driver's to make. The three custody hand-offs in between
// are opened by a PIN the customer holds, never by this button.
const NEXT_STATUS: Record<string, string> = {
  ACCEPTED: 'EN_ROUTE_TO_PICKUP',
  EN_ROUTE_TO_PICKUP: 'ARRIVED_AT_PICKUP',
  IN_TRANSIT: 'ARRIVED_AT_DROP',
  UNLOADING: 'DELIVERED',
};

const NEXT_LABEL: Record<string, string> = {
  ACCEPTED: 'Start driving to pickup',
  EN_ROUTE_TO_PICKUP: "I've arrived at pickup",
  IN_TRANSIT: 'Arrived at drop-off',
  UNLOADING: 'Finish & complete delivery',
};

// Which PIN the customer is holding at each point, and what to call it on screen.
type OtpStage = 'pickup' | 'start' | 'drop';

const STAGE_FOR_STATUS: Record<string, OtpStage> = {
  ARRIVED_AT_PICKUP: 'pickup',
  LOADING: 'start',
  ARRIVED_AT_DROP: 'drop',
};

const STAGE_COPY: Record<OtpStage, { label: string; hint: string; action: string }> = {
  pickup: {
    label: 'Pickup PIN from customer',
    hint: 'Ask the customer for their pickup PIN to begin loading.',
    action: 'Verify & start loading',
  },
  start: {
    label: 'Start PIN from customer',
    hint: 'Loading done? Ask for the start PIN to begin the journey.',
    action: 'Verify & start trip',
  },
  drop: {
    label: 'Unload PIN from customer',
    hint: 'Ask the consignee for their unload PIN before unloading.',
    action: 'Verify & start unloading',
  },
};

// GPS is streamed to the customer only while the truck is actually moving toward them —
// no reason to broadcast position while parked at a loading bay.
const TRACKED_STATUSES = ['EN_ROUTE_TO_PICKUP', 'IN_TRANSIT'];

// The map is shown for the whole active trip, not just the driving legs, so the driver can
// see where they are during loading and unloading too.
const MAP_STATUSES = [
  'ACCEPTED',
  'EN_ROUTE_TO_PICKUP',
  'ARRIVED_AT_PICKUP',
  'LOADING',
  'IN_TRANSIT',
  'ARRIVED_AT_DROP',
  'UNLOADING',
];

export default function Trip() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  // The driver's own position, drawn on their map as the moving truck.
  const [selfLoc, setSelfLoc] = useState<{ lat: number; lng: number; heading?: number } | null>(null);
  // The current leg: driver -> pickup before loading, driver -> drop after. Comes from the
  // server so the routing key and per-call cost stay on the backend.
  const [leg, setLeg] = useState<{ polyline: string | null; etaMinutes: number | null; distanceKm: number | null; target: string } | null>(null);

  const [loadError, setLoadError] = useState('');

  function load() {
    apiFetch<{ booking: Booking }>(`/bookings/${id}`)
      .then((d) => {
        setBooking(d.booking);
        setLoadError('');
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Couldn't load this trip."));
  }

  useEffect(() => {
    load();
    return () => {
      watchRef.current?.remove();
    };
  }, [id]);

  // Stream live GPS to the rider whenever the driver is actively moving toward them.
  useEffect(() => {
    if (!booking || !TRACKED_STATUSES.includes(booking.status)) return;
    let cancelled = false;
    let leaveTrip: (() => void) | null = null;

    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted' || cancelled) return;
      const socket = await getSocket();
      // Re-subscribes on every reconnect — rooms are tied to a socket id, so without this
      // a dropped connection would silently stop the customer's map from updating.
      leaveTrip = subscribeToTrip(socket, id);
      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 20 },
        (pos) => {
          // heading and speed ride along so the customer's map can rotate the truck to its
          // direction of travel instead of showing a fixed-orientation dot.
          socket.emit('presence:location', {
            bookingId: id,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading ?? undefined,
            speed: pos.coords.speed ?? undefined,
          });
          setSelfLoc({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading ?? undefined,
          });
        },
      );
    })();

    return () => {
      cancelled = true;
      leaveTrip?.();
      watchRef.current?.remove();
    };
  }, [booking?.status, id]);

  // The navigation leg retargets itself: heading to the customer before the goods are
  // loaded, heading to the drop-off once the trip has started. This is what makes the map
  // "load the drop-off for the rest of the journey" once the ride begins.
  useEffect(() => {
    if (!booking || !MAP_STATUSES.includes(booking.status)) {
      setLeg(null);
      return;
    }
    const load = () => {
      apiFetch<{ polyline: string | null; etaMinutes: number | null; distanceKm: number | null; target: string }>(
        `/trips/${id}/eta`,
      )
        .then(setLeg)
        .catch(() => {
          // Non-critical — the stored full route still draws without a live leg.
        });
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [booking?.status, id]);

  async function advanceTo(status: string) {
    setBusy(true);
    setError('');
    try {
      const pos = await getPositionOrNull();
      await apiFetch(`/trips/${id}/status`, {
        method: 'POST',
        body: { status, lat: pos?.coords.latitude, lng: pos?.coords.longitude },
      });
      // Only navigate once the server confirms DELIVERED — navigating first meant a
      // failed status update left the driver looking at a completed-ride screen for a
      // trip that was never actually marked delivered, with the error nowhere visible.
      if (status === 'DELIVERED') {
        router.replace(`/(app)/completed-ride?id=${id}`);
        return;
      }
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update the trip.');
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyOtp(stage: OtpStage) {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/trips/${id}/verify-otp`, { method: 'POST', body: { otp, stage } });
      setOtp('');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That code is wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!booking) {
    return (
      <Screen style={styles.centered}>
        {loadError ? (
          <>
            <AppText variant="bodyLg" color="error" align="center">
              {loadError}
            </AppText>
            <Button label="Retry" variant="outline" onPress={load} style={styles.retryButton} />
          </>
        ) : (
          <ActivityIndicator color={Colors.primary} />
        )}
      </Screen>
    );
  }

  // Leg 1 runs from wherever the driver starts (garage, home, previous drop) to the
  // customer's pickup. Leg 2 begins the moment the goods are loaded. The server's ETA
  // already knows which is active; falling back to `pickup` keeps the button sensible
  // before the first ETA lands.
  const navToPickup = leg ? leg.target === 'pickup' : true;

  const nextStatus = NEXT_STATUS[booking.status];
  // A custody gate takes precedence over any driver-side advance: while a PIN is
  // outstanding, entering it is the only way forward.
  const stage = STAGE_FOR_STATUS[booking.status];

  return (
    <Screen>
      <AppBar back title="Active Trip" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.statusCard}>
          <AppText variant="headlineMd" color="onPrimaryContainer">
            {STATUS_LABEL[booking.status] ?? booking.status}
          </AppText>
        </View>

        {MAP_STATUSES.includes(booking.status) ? (
          <LiveMap
            style={styles.map}
            pickup={{ lat: booking.pickupLat, lng: booking.pickupLng }}
            drop={{ lat: booking.dropLat, lng: booking.dropLng }}
            // Prefer the live leg (driver -> current target); fall back to the full
            // journey route until the first GPS fix lands.
            polyline={leg?.polyline ?? booking.routePolyline}
            driver={selfLoc}
          />
        ) : null}

        {MAP_STATUSES.includes(booking.status) ? (
          <View style={styles.navRow}>
            {leg?.etaMinutes != null ? (
              <AppText variant="headlineSm" color="primary" style={{ flex: 1 }}>
                {leg.etaMinutes} min to {leg.target === 'pickup' ? 'pickup' : 'drop-off'}
                {leg.distanceKm != null ? ` · ${leg.distanceKm} km` : ''}
              </AppText>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            {/* The in-app map shows position and route; Google Maps does the actual
                talking, rerouting and lane guidance.
                The destination follows the trip's own stage — wherever the driver is
                coming from, it routes to the pickup until the goods are loaded, then to
                the drop-off for the rest of the journey. The label says which, so the
                driver never has to guess where tapping it will send them. */}
            <Button
              label={navToPickup ? 'Navigate to pickup' : 'Navigate to drop'}
              variant="outline"
              onPress={() => {
                openTurnByTurn(
                  navToPickup ? booking.pickupLat : booking.dropLat,
                  navToPickup ? booking.pickupLng : booking.dropLng,
                ).then((ok) => {
                  if (!ok) setError('Could not open Google Maps on this device.');
                });
              }}
            />
          </View>
        ) : null}

        <AppText variant="bodyLg">Pickup: {booking.pickupAddress}</AppText>
        <AppText variant="bodyLg">Drop: {booking.dropAddress}</AppText>
        <AppText variant="bodyLg" style={styles.mono}>
          Fare: ₹{booking.actualFare ?? booking.estimatedFare}
        </AppText>

        {error ? (
          <AppText variant="bodySm" color="error">
            {error}
          </AppText>
        ) : null}

        {stage ? (
          <View style={{ gap: Spacing.sm }}>
            <AppText variant="bodySm" color="onSurfaceVariant">
              {STAGE_COPY[stage].hint}
            </AppText>
            {DEMO_MODE && currentDemoPin() ? (
              // In demo mode there is no customer device to read the PIN from, so it's
              // surfaced here. This block never renders against a real backend.
              <AppText variant="bodySm" color="primary">
                Demo — customer's PIN is {currentDemoPin()}
              </AppText>
            ) : null}
            <TextField
              label={STAGE_COPY[stage].label}
              keyboardType="number-pad"
              maxLength={4}
              value={otp}
              onChangeText={setOtp}
            />
            <Button
              label={STAGE_COPY[stage].action}
              onPress={() => onVerifyOtp(stage)}
              loading={busy}
              disabled={otp.length < 4}
            />
          </View>
        ) : nextStatus ? (
          <Button label={NEXT_LABEL[booking.status]} onPress={() => advanceTo(nextStatus)} loading={busy} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.md },
  mono: { fontFamily: FontFamily.mono },
  map: { height: 300, borderRadius: Radii.lg },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  centered: { alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.lg },
  retryButton: { minWidth: 160 },
  statusCard: {
    borderRadius: Radii.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.primaryContainer,
  },
});
