import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/ui/button';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, FontFamily, Radii, Shadows, Spacing } from '@/constants/theme';
import { apiFetch } from '@/lib/api';
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
  const slide = useRef(new Animated.Value(-200)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside the socket handler, so toggling the preference takes effect without
  // re-subscribing.
  const alertsEnabled = useRef(true);

  useEffect(() => {
    getNotificationPrefs().then((p) => {
      alertsEnabled.current = p.newLoadAlerts;
    });
  }, []);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(slide, { toValue: -240, duration: 180, useNativeDriver: true }).start(() =>
      setLoad(null),
    );
  }, [slide]);

  useEffect(() => {
    let cleanup = () => {};

    getSocket().then((socket) => {
      const onNew = (payload: LoadPayload) => {
        if (!alertsEnabled.current) return;
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
    setBusy(true);
    try {
      await apiFetch(`/bookings/${load.bookingId}/bids`, {
        method: 'POST',
        body: { amount: load.estimatedFare ?? 0 },
      });
      dismiss();
    } catch {
      // Losing the race is the common case — the card is stale either way, so take it
      // down and let the dashboard feed show what's actually still open.
      dismiss();
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
