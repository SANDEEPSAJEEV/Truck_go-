import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/ui/button';
import { Colors, Radii, Spacing, type StatusTone } from '@/constants/theme';
import { statusTone } from '@/hooks/use-theme';
import { apiFetch, ApiError } from '@/lib/api';
import { getSocket, subscribeToTrip } from '@/lib/socket';
import { LiveMap } from '@/components/live-map';

type Booking = {
  id: string;
  status: string;
  pickupAddress: string;
  dropAddress: string;
  estimatedFare: number;
  // Set once the rider accepts a bid — may differ from estimatedFare, since that's the
  // whole point of bidding. Once set, it's the real price and must be shown instead.
  actualFare: number | null;
  driverId: string | null;
  pickupLat: number;
  pickupLng: number;
  dropLat: number;
  dropLng: number;
  /** Encoded road route, resolved once when the booking was created. */
  routePolyline: string | null;
  // Three custody gates. The server only ever sends these to the rider who owns the
  // booking — the driver must not know a code before asking for it.
  pickupOtp: string | null;
  startOtp: string | null;
  dropOtp: string | null;
};

type Bid = {
  id: string;
  amount: number;
  note: string | null;
  createdAt: string;
  driver: {
    id: string;
    fullName: string;
    ratingAvg: number;
    ratingCount: number;
    vehicleType: string;
    vehicleNumber: string;
  };
};

type OtpStage = 'pickup' | 'start' | 'drop';

// Which PIN is live at each point in the trip, and how to describe it.
const STAGE_BY_STATUS: Record<string, { stage: OtpStage; field: keyof Booking; label: string; hint: string }> = {
  ARRIVED_AT_PICKUP: {
    stage: 'pickup',
    field: 'pickupOtp',
    label: 'Pickup Pin',
    hint: 'Share with driver to begin loading',
  },
  LOADING: {
    stage: 'start',
    field: 'startOtp',
    label: 'Start Ride Pin',
    hint: 'Share with driver to start',
  },
  ARRIVED_AT_DROP: {
    stage: 'drop',
    field: 'dropOtp',
    label: 'Unload Pin',
    hint: 'Share with driver to begin unloading',
  },
};

// Confirmed set + tones, decompiled_driver.js:460539-460642 (bookingStatusMeta) and the
// finer-grained driver nextAction state machine (:460821-461010).
const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  REQUESTED: { label: 'Looking for a driver…', tone: 'warning' },
  AWAITING_BIDS: { label: 'Waiting for driver offers…', tone: 'warning' },
  SCHEDULED: { label: 'Scheduled', tone: 'info' },
  ACCEPTED: { label: 'Driver assigned', tone: 'info' },
  EN_ROUTE_TO_PICKUP: { label: 'Driver is on the way', tone: 'info' },
  ARRIVED_AT_PICKUP: { label: 'Driver has arrived', tone: 'info' },
  LOADING: { label: 'Loading your goods', tone: 'info' },
  IN_TRANSIT: { label: 'On the way to drop-off', tone: 'warning' },
  ARRIVED_AT_DROP: { label: 'Arrived at drop-off', tone: 'info' },
  UNLOADING: { label: 'Unloading your goods', tone: 'info' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  NO_DRIVER_FOUND: { label: 'No driver found', tone: 'danger' },
  REJECTED: { label: 'Cancelled', tone: 'danger' },
};

const CANCELLABLE = ['AWAITING_BIDS', 'ACCEPTED', 'EN_ROUTE_TO_PICKUP'];

// Once a driver is assigned there is a real vehicle to follow, so the map takes over from
// the plain status card.
const TRACKABLE = [
  'ACCEPTED',
  'EN_ROUTE_TO_PICKUP',
  'ARRIVED_AT_PICKUP',
  'LOADING',
  'IN_TRANSIT',
  'ARRIVED_AT_DROP',
  'UNLOADING',
];

export default function Tracking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number; heading?: number } | null>(null);
  const [eta, setEta] = useState<{
    etaMinutes: number | null;
    distanceKm: number | null;
    target: string;
    // Where the truck is right now, in a place name the customer recognises.
    nearPlace?: string | null;
  } | null>(null);
  const [resending, setResending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');

  const [bids, setBids] = useState<Bid[]>([]);
  const [bidsError, setBidsError] = useState('');
  const [acceptingBidId, setAcceptingBidId] = useState<string | null>(null);

  function refetch() {
    apiFetch<{ booking: Booking }>(`/bookings/${id}`)
      .then((d) => {
        setBooking(d.booking);
        setError('');
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this trip."));
  }

  function refetchBids() {
    apiFetch<{ bids: Bid[] }>(`/bookings/${id}/bids`)
      .then((d) => {
        setBids(d.bids);
        setBidsError('');
      })
      .catch((e) => setBidsError(e instanceof ApiError ? e.message : 'Could not load offers.'));
  }

  useEffect(() => {
    refetch();

    // Seed the truck's position from the last known fix so someone opening the app
    // mid-trip sees the vehicle immediately, instead of an empty map until the driver
    // happens to move again.
    apiFetch<{ lat: number; lng: number }>(`/trips/${id}/location`)
      .then((loc) => setDriverLoc((current) => current ?? loc))
      .catch(() => {
        // No fix yet is normal early in a trip — the socket will deliver one shortly.
      });

    let cleanup = () => {};
    getSocket().then((socket) => {
      // Re-subscribes on every reconnect, so tracking survives a dropped connection.
      const leaveTrip = subscribeToTrip(socket, id);
      // `trip:status` never carries the OTP (the shared room has the driver in it too) —
      // `trip:otp` arrives separately on this rider's own private user room.
      const onStatus = () => refetch();
      const onOtp = (payload: { otp: string; stage?: OtpStage }) => {
        // The push names which gate it belongs to, so a start PIN never overwrites the
        // pickup PIN still on screen.
        const field: keyof Booking =
          payload.stage === 'start' ? 'startOtp' : payload.stage === 'drop' ? 'dropOtp' : 'pickupOtp';
        setBooking((b) => (b ? { ...b, [field]: payload.otp } : b));
      };
      const onLocation = (loc: { lat: number; lng: number; heading?: number }) => setDriverLoc(loc);
      // Pushed to this rider's own private room (every socket auto-joins it on connect) —
      // a new offer coming in should appear without waiting for a poll.
      const onBidNew = () => refetchBids();
      socket.on('trip:status', onStatus);
      socket.on('trip:otp', onOtp);
      socket.on('trip:location', onLocation);
      socket.on('bid:new', onBidNew);
      cleanup = () => {
        leaveTrip();
        socket.off('trip:status', onStatus);
        socket.off('trip:otp', onOtp);
        socket.off('trip:location', onLocation);
        socket.off('bid:new', onBidNew);
      };
    });

    return () => cleanup();
  }, [id]);

  useEffect(() => {
    // Payment comes before feedback — the trip isn't actually settled until the fare is
    // paid, and the payment screen itself moves on to feedback once that's confirmed.
    if (booking?.status === 'DELIVERED') router.replace(`/(app)/payment/${booking.id}`);
  }, [booking?.status]);

  useEffect(() => {
    if (booking?.status === 'AWAITING_BIDS') refetchBids();
    else setBids([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.status]);

  // ETA is polled rather than pushed: the server caches it for a minute because routing is
  // billed per call, so asking more often than that would cost money without telling the
  // customer anything new.
  useEffect(() => {
    if (!booking || !TRACKABLE.includes(booking.status)) {
      setEta(null);
      return;
    }
    const load = () => {
      apiFetch<{
        etaMinutes: number | null;
        distanceKm: number | null;
        target: string;
        nearPlace?: string | null;
      }>(`/trips/${id}/eta`)
        .then(setEta)
        .catch(() => {
          // Non-critical: the map and status still work without an ETA line.
        });
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [booking?.status, id]);

  async function onAcceptBid(bidId: string) {
    setAcceptingBidId(bidId);
    setBidsError('');
    try {
      await apiFetch(`/bookings/${id}/bids/${bidId}/accept`, { method: 'POST' });
      refetch();
    } catch (e) {
      setBidsError(e instanceof ApiError ? e.message : 'Could not accept this offer.');
    } finally {
      setAcceptingBidId(null);
    }
  }

  async function onCancel() {
    setCancelling(true);
    setError('');
    try {
      await apiFetch(`/trips/${id}/cancel`, { method: 'POST', body: {} });
      router.replace('/(app)/booking');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel this booking.');
      setCancelling(false);
    }
  }

  async function onResendPin() {
    setResending(true);
    try {
      await apiFetch(`/trips/${id}/resend-otp`, { method: 'POST' });
    } catch {
      // Best-effort — nothing actionable for the rider if this fails transiently.
    } finally {
      setResending(false);
    }
  }

  if (!booking) {
    return (
      <Screen style={styles.centered}>
        {error ? (
          <>
            <AppText variant="bodyLg" color="error" align="center">
              {error}
            </AppText>
            <Button label="Retry" variant="outline" onPress={refetch} style={styles.retryButton} />
          </>
        ) : (
          <ActivityIndicator color={Colors.primary} />
        )}
      </Screen>
    );
  }

  const meta = STATUS_META[booking.status] ?? { label: booking.status, tone: 'info' as const };
  const tone = statusTone(meta.tone);

  const isTrackable = TRACKABLE.includes(booking.status);

  // Exactly one custody gate is open at a time; show that PIN and nothing else.
  const stageInfo = STAGE_BY_STATUS[booking.status];
  const stageCode = stageInfo ? (booking[stageInfo.field] as string | null) : null;
  const activePin = stageInfo && stageCode ? { ...stageInfo, code: stageCode } : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        {error ? (
          <View style={styles.errorBanner}>
            <AppText variant="bodySm" color="onErrorContainer">
              {error}
            </AppText>
          </View>
        ) : null}

        <View style={styles.statusCard}>
          <View style={[styles.toneDot, { backgroundColor: tone.foreground }]} />
          <View style={{ flex: 1 }}>
            <AppText variant="headlineMd" color="onPrimaryContainer">
              {meta.label}
            </AppText>
            {eta?.etaMinutes != null ? (
              <AppText variant="bodySm" color="onPrimaryContainer">
                {eta.etaMinutes} min away
                {eta.distanceKm != null ? ` · ${eta.distanceKm} km` : ''}
                {eta.target === 'pickup' ? ' from pickup' : ' from drop-off'}
              </AppText>
            ) : null}
            {eta?.nearPlace ? (
              // Coordinates mean nothing to a customer; a place name is what they'd ask for
              // on the phone — "where's my truck?" — so it goes right under the status.
              <AppText variant="bodySm" color="onPrimaryContainer">
                Truck near {eta.nearPlace}
              </AppText>
            ) : null}
          </View>
        </View>

        {isTrackable ? (
          <LiveMap
            style={styles.map}
            pickup={{ lat: booking.pickupLat, lng: booking.pickupLng }}
            drop={{ lat: booking.dropLat, lng: booking.dropLng }}
            polyline={booking.routePolyline}
            driver={driverLoc}
          />
        ) : null}

        {booking.status === 'AWAITING_BIDS' ? (
          <View style={{ gap: Spacing.sm }}>
            <AppText variant="labelCaps" color="onSurfaceVariant" uppercase>
              Offers ({bids.length})
            </AppText>
            {bidsError ? (
              <AppText variant="bodySm" color="error">
                {bidsError}
              </AppText>
            ) : null}
            {bids.length === 0 ? (
              <AppText variant="bodyMd" color="onSurfaceVariant">
                No offers yet. Drivers nearby are being notified.
              </AppText>
            ) : (
              bids.map((bid) => (
                <View key={bid.id} style={styles.bidCard}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="headlineSm">{bid.driver.fullName}</AppText>
                    <AppText variant="bodySm" color="onSurfaceVariant">
                      ★ {bid.driver.ratingAvg.toFixed(1)} ({bid.driver.ratingCount}) · {bid.driver.vehicleNumber}
                    </AppText>
                    {bid.note ? (
                      <AppText variant="bodySm" color="onSurfaceVariant">
                        "{bid.note}"
                      </AppText>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: Spacing.xs }}>
                    <AppText variant="headlineMd" color="primary">
                      ₹{bid.amount}
                    </AppText>
                    <Button
                      label="Accept"
                      onPress={() => onAcceptBid(bid.id)}
                      loading={acceptingBidId === bid.id}
                      disabled={acceptingBidId !== null}
                    />
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}

        {activePin ? (
          <View style={styles.pinCard}>
            <AppText variant="labelCaps" color="onSurfaceVariant" uppercase style={styles.pinLabel}>
              {activePin.label}
            </AppText>
            <AppText variant="bodySm" color="onSurfaceVariant">
              {activePin.hint}
            </AppText>
            <View style={styles.pinDigits}>
              {activePin.code.split('').map((digit, i) => (
                <View key={i} style={styles.pinTile}>
                  <AppText variant="displayLg" color="primary">
                    {digit}
                  </AppText>
                </View>
              ))}
            </View>
            <Pressable onPress={onResendPin} disabled={resending}>
              <AppText variant="headlineSm" color="primary">
                {resending ? 'Resending…' : 'Resend PIN'}
              </AppText>
            </Pressable>
          </View>
        ) : null}

        <AppText variant="bodyLg">From: {booking.pickupAddress}</AppText>
        <AppText variant="bodyLg">To: {booking.dropAddress}</AppText>
        <AppText variant="bodyLg">
          {booking.status === 'AWAITING_BIDS' ? 'Asking fare' : 'Fare'}: ₹
          {booking.actualFare ?? booking.estimatedFare}
        </AppText>


        {CANCELLABLE.includes(booking.status) ? (
          <Button label="Cancel booking" variant="outline" onPress={onCancel} loading={cancelling} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.md },
  centered: { alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.lg },
  retryButton: { minWidth: 160 },
  errorBanner: { padding: Spacing.md, borderRadius: Radii.md, backgroundColor: Colors.errorContainer },
  statusCard: {
    borderRadius: Radii.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryContainer,
  },
  toneDot: { width: 10, height: 10, borderRadius: 5 },
  pinCard: {
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radii.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  pinLabel: { letterSpacing: 1 },
  pinDigits: { flexDirection: 'row', gap: Spacing.sm, marginVertical: Spacing.sm },
  pinTile: {
    width: 48,
    height: 56,
    borderWidth: 2,
    borderColor: Colors.primary,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  map: { height: 280, borderRadius: Radii.lg },
  bidCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surface,
  },
});
