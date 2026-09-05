import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/ui/button';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, FontFamily, Radii, Shadows, Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { getNotificationPrefs } from '@/lib/notification-prefs';
import { vehicleLabel } from '@/lib/vehicle';

type LoadPayload = {
  bookingId: string;
  reference: string;
  pickupAddress: string;
  dropAddress: string;
  vehicleType: string;
  distanceKm: number | null;
  estimatedFare: number | null;
};

/** How long an offer stays up before it dismisses itself. */
const AUTO_DISMISS_MS = 25000;

/**
 * Renders a new-load offer over whatever screen the driver is on.
 *
 * Mounted once in the authenticated layout rather than on the dashboard, which is the
 * whole point: a driver checking their earnings or fixing their bank details would
 * otherwise never learn a load had arrived until they navigated back and waited for a poll.
 */
export function LoadAlertHost() {
  const insets = useSafeAreaInsets();
  const [load, setLoad] = useState<LoadPayload | null>(null);
  const [busy, setBusy] = useState(false);
  // A failed Accept used to be indistinguishable from a successful one: the card slid away
  // either way. A driver who thinks they took a load and didn't will sit waiting for a trip.
  const [error, setError] = useState('');
  const slide = useRef(new Animated.Value(-200)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // No cached copy of the preference. This component is mounted in the authenticated layout
  // and lives for the whole session, so reading it once on mount meant switching "New load
  // alerts" off in settings did nothing until the driver relaunched the app. It is a local
  // AsyncStorage read on an event that arrives a few times an hour — reading it fresh each
  // time is cheaper than the bug was.

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(slide, { toValue: -240, duration: 180, useNativeDriver: true }).start(() =>
      setLoad(null),
    );
  }, [slide]);

  useEffect(() => {
    let cleanup = () => {};

    getSocket().then((socket) => {
      const onNew = async (payload: LoadPayload) => {
        const prefs = await getNotificationPrefs();
        if (!prefs.newLoadAlerts) return;
        setLoad(payload);
      };
      // If someone else wins it, the offer on screen is no longer real — pull it rather
      // than letting the driver tap Accept on something already gone.
      const onTaken = (payload: { bookingId: string }) => {
        setLoad((current) => (current?.bookingId === payload.bookingId ? null : current));
      };

      socket.on('load:new', onNew);
      socket.on('load:taken', onTaken);
      cleanup = () => {
        socket.off('load:new', onNew);
        socket.off('load:taken', onTaken);
      };
    });

    return () => cleanup();
  }, []);

  // Animate in and start the auto-dismiss whenever a new offer lands.
  useEffect(() => {
    if (!load) return;
    slide.setValue(-240);
    Animated.spring(slide, {
      toValue: 0,
      tension: 70,
      friction: 12,
      useNativeDriver: true,
    }).start();

    timer.current = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load, slide, dismiss]);

  if (!load) return null;

  async function accept() {
    if (!load) return;
    // The fare arrives over the socket and has to be a number the server will accept as a
    // bid. It used to be sent as a Prisma Decimal, which serialises to a string, so every
    // Accept here failed validation — and the catch-all below swallowed it, so it looked
    // like it had worked. The server side is fixed; this guards the value regardless.
    const amount = Number(load.estimatedFare);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Couldn't read the fare for this load. Open it from the dashboard to bid.");
      return;
    }

    setError('');
    setBusy(true);
    try {
      await apiFetch(`/bookings/${load.bookingId}/bids`, {
        method: 'POST',
        body: { amount },
      });
      dismiss();
    } catch (e) {
      // Losing the race is the common case and genuinely isn't worth a message — the card
      // is stale either way. Anything else is not: a driver who thinks they just accepted a
      // load and didn't will sit waiting for a trip that was never theirs.
      if (e instanceof ApiError && (e.code === 'NOT_OPEN' || e.code === 'NOT_FOUND')) {
        dismiss();
      } else {
        setError(e instanceof ApiError ? e.message : "Couldn't place that bid. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  function view() {
    if (!load) return;
    dismiss();
    router.push('/(app)/(tabs)/dashboard');
  }

  return (
    <Animated.View
      style={[
        styles.wrap,
        { paddingTop: insets.top + Spacing.sm, transform: [{ translateY: slide }] },
      ]}
      pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.badge}>
            <MaterialIcons name="bolt" size={14} color={Brand.orangeInk} />
            <AppText style={[DisplayType.capsLabel, { color: Brand.orangeInk }]}>New load</AppText>
          </View>
          <AppText style={DisplayType.fieldMono}>{load.reference}</AppText>
          <View style={styles.spacer} />
          <Pressable onPress={dismiss} hitSlop={10} accessibilityLabel="Dismiss">
            <MaterialIcons name="close" size={20} color={Colors.onSurfaceVariant} />
          </Pressable>
        </View>

        <View style={styles.legs}>
          <View style={styles.rail}>
            <View style={[styles.dot, { backgroundColor: Colors.primary }]} />
            <View style={styles.railLine} />
            <View style={[styles.dot, { backgroundColor: Brand.orange }]} />
          </View>
          <View style={styles.legText}>
            <AppText numberOfLines={1} style={DisplayType.rowLabel}>
              {load.pickupAddress}
            </AppText>
            <AppText numberOfLines={1} style={DisplayType.rowLabel}>
              {load.dropAddress}
            </AppText>
          </View>
        </View>

        <View style={styles.meta}>
          <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
            {vehicleLabel(load.vehicleType)}
            {load.distanceKm != null ? ` · ${load.distanceKm} km` : ''}
          </AppText>
          <AppText style={[DisplayType.amountMd, styles.mono]}>
            {load.estimatedFare != null ? `₹${load.estimatedFare}` : '—'}
          </AppText>
        </View>

        {error ? (
          <AppText color="error" style={DisplayType.bodyUi}>
            {error}
          </AppText>
        ) : null}

        <View style={styles.actions}>
          <Button label="View" variant="outlineNavy" style={styles.flex} onPress={view} />
          <Button
            label="Accept"
            variant="orange"
            style={styles.flex}
            loading={busy}
            disabled={load.estimatedFare == null}
            onPress={accept}
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.gutter,
    zIndex: 100,
  },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radii.xl,
    padding: Spacing.cardPadding,
    gap: Spacing.gutter,
    ...Shadows.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Brand.orange,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  spacer: { flex: 1 },
  legs: { flexDirection: 'row', gap: Spacing.gutter },
  rail: { alignItems: 'center', paddingTop: 6 },
  dot: { width: 9, height: 9, borderRadius: Radii.pill },
  railLine: { width: 2, flex: 1, minHeight: 14, backgroundColor: Colors.outlineVariant },
  legText: { flex: 1, gap: Spacing.gutter },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mono: { fontFamily: FontFamily.mono },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  flex: { flex: 1 },
});
