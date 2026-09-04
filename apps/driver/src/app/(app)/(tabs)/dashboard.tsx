import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { FlatList, Pressable, StyleSheet, Switch, View, useWindowDimensions } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { LiveMap } from '@/components/live-map';
import { AppBar } from '@/components/ui/app-bar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { RideCard } from '@/components/ui/ride-card';
import { TextField } from '@/components/ui/text-field';
import { Wordmark } from '@/components/ui/wordmark';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, FontFamily, Radii, Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { getPositionOrNull } from '@/lib/location';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/lib/auth-context';
import { DEMO_MODE } from '@/lib/demo';
import { vehicleLabel } from '@/lib/vehicle';

type MyBid = { id: string; amount: number; status: string } | null;

type Booking = {
  id: string;
  reference: string;
  pickupAddress: string;
  dropAddress: string;
  distanceKm: number | null;
  estimatedFare: number | null;
  vehicleType: string;
  // Present on the /bookings/available feed only — this driver's own live bid on the
  // request, if they've placed one, so the card can show "bid placed" without a second call.
  myBid?: MyBid;
};

// The socket now pushes new loads the moment they're dispatched, so this poll is a
// reconnect safety net rather than the primary path — it can be far less frequent.
const POLL_INTERVAL_MS = 20000;

// Confirmed copy, reference/UI-COPY-user.md (goOnline group).
export default function Dashboard() {
  const { user } = useAuth();
  const { height: screenH } = useWindowDimensions();

  // The server is what actually blocks an unapproved driver; this only explains why, so the
  // toggle never fails silently.
  const verificationStatus = user?.driverProfile?.verificationStatus ?? 'PENDING';
  const approved = verificationStatus === 'APPROVED';

  const [online, setOnline] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  // Feed errors and action errors are tracked separately: a background poll succeeding
  // must never erase the message explaining why the driver's last tap failed.
  const [feedError, setFeedError] = useState('');
  const [actionError, setActionError] = useState('');
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);

  const loadFeed = useCallback(() => {
    setLoading(true);
    apiFetch<{ bookings: Booking[] }>('/bookings/available')
      .then((d) => {
        setBookings(d.bookings);
        setFeedError('');
      })
      .catch((e) => {
        // An unapproved driver is *expected* to be refused the feed, and the verification
        // card already explains why — repeating it as an error would just be noise.
        if (e instanceof ApiError && e.code === 'DRIVER_NOT_APPROVED') return;
        setFeedError(e instanceof ApiError ? e.message : 'Could not load nearby loads.');
      })
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(loadFeed);

  // Centre the map on the driver. Read-only — going online is what actually publishes a
  // position, so a driver browsing the map offline isn't broadcasting anything.
  useEffect(() => {
    if (DEMO_MODE) return;
    getPositionOrNull().then((pos) => {
      if (pos) setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    });
  }, []);

  // Re-fetch immediately when going online, and keep polling while online so new
  // requests appear even if the socket dropped.
  useEffect(() => {
    if (!online) return;
    loadFeed();
    const interval = setInterval(loadFeed, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [online, loadFeed]);

  async function toggleOnline(next: boolean) {
    setOnline(next);
    setActionError('');
    try {
      // Going offline must never depend on GPS — a driver who denied location, or is
      // parked underground, still has to be able to stop receiving requests.
      let nextCoords: { lat: number; lng: number } | undefined;
      // Demo mode has no real trip to dispatch, so it doesn't ask for a location
      // permission the viewer would have to grant just to look at the screen.
      if (next && !DEMO_MODE) {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          setActionError('Location permission is needed to go online.');
          setOnline(false);
          return;
        }
        const pos = await getPositionOrNull();
        if (!pos) {
          setActionError("Couldn't get your location. Check GPS and try again.");
          setOnline(false);
          return;
        }
        nextCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(nextCoords);
      }
      // Confirmed PUT, not POST — decompiled_user.js:438228 (publishDriverLocation).
      await apiFetch('/drivers/location', { method: 'PUT', body: { ...nextCoords, isOnline: next } });
      if (next) setSheetIndex(1);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not update your status. Please try again.');
      setOnline(!next);
    }
  }

  // Custom-amount bidding is an inline field per card, opened one at a time.
  const [biddingId, setBiddingId] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState('');

  // Listen for the rider's decision on this driver's own bids, and for dispatch pushing
  // new work. Reuses the private `user:<id>` room every socket auto-joins on connect
  // (backend/src/sockets/liveops.ts) — no extra subscribe call needed.
  useEffect(() => {
    let cleanup = () => {};
    getSocket().then((socket) => {
      const onAccepted = (payload: { bookingId: string }) => {
        // The rider chose this driver's bid — go straight to the trip rather than waiting
        // for the next poll to notice the booking left the feed.
        router.push(`/(app)/trip/${payload.bookingId}`);
      };
      const onRejected = () => loadFeed();
      // A load was dispatched to this driver, or taken by someone else. Either way the
      // feed just changed under them, so pull the authoritative list.
      const onLoadNew = () => {
        loadFeed();
        setSheetIndex((i) => Math.max(i, 1));
      };
      const onLoadTaken = (payload: { bookingId: string }) => {
        setBookings((list) => list.filter((b) => b.id !== payload.bookingId));
      };
      socket.on('bid:accepted', onAccepted);
      socket.on('bid:rejected', onRejected);
      socket.on('load:new', onLoadNew);
      socket.on('load:taken', onLoadTaken);
      cleanup = () => {
        socket.off('bid:accepted', onAccepted);
        socket.off('bid:rejected', onRejected);
        socket.off('load:new', onLoadNew);
        socket.off('load:taken', onLoadTaken);
      };
    });
    return () => cleanup();
    // Subscribe once for the life of the screen. `loadFeed` is memoised with no deps, so
    // it never changes identity — listing it would be noise, and anything that did change
    // here would tear down and rebuild the socket listeners on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function placeBid(id: string, amount: number) {
    setAcceptingId(id);
    setActionError('');
    try {
      await apiFetch(`/bookings/${id}/bids`, { method: 'POST', body: { amount } });
      setBiddingId(null);
      setBidAmount('');
      loadFeed();
    } catch (e) {
      setActionError(
        e instanceof ApiError && e.code === 'BELOW_FLOOR'
          ? e.message
          : e instanceof ApiError && e.code === 'NOT_OPEN'
            ? 'This request is no longer open — someone else was already chosen.'
            : e instanceof ApiError
              ? e.message
              : 'Could not place your bid. Please try again.',
      );
      loadFeed();
    } finally {
      setAcceptingId(null);
    }
  }

  async function withdrawBid(id: string, bidId: string) {
    setAcceptingId(id);
    setActionError('');
    try {
      await apiFetch(`/bookings/${id}/bids/${bidId}`, { method: 'DELETE' });
      loadFeed();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not withdraw your bid.');
    } finally {
      setAcceptingId(null);
    }
  }

  const snapPoints = [140, Math.round(screenH * 0.45), Math.round(screenH * 0.85)];

  return (
    <Screen>
      <View style={styles.root}>
        <LiveMap style={StyleSheet.absoluteFill} center={coords ?? undefined} showsUserLocation />

        {/* box-none throughout: an invisible full-screen overlay that swallows touches
            would leave the map unpannable, which reads as "the map is frozen". */}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <AppBar
            overlay
            left={
              // The reference puts a hamburger here, but this app has no drawer and the
              // Profile tab already holds that menu. The online switch is the most
              // important control on the screen and the reference only omits it because
              // its driver is KYC-pending — so it takes the slot.
              <View style={styles.onlinePill}>
                <View
                  style={[
                    styles.onlineDot,
                    { backgroundColor: online ? Colors.success : Colors.outline },
                  ]}
                />
                <AppText style={DisplayType.capsLabel}>{online ? 'Online' : 'Offline'}</AppText>
                <Switch
                  value={online}
                  onValueChange={toggleOnline}
                  disabled={!approved}
                  trackColor={{ true: Brand.orange, false: Colors.outlineVariant }}
                  thumbColor={Colors.white}
                />
              </View>
            }
            right={
              <Pressable
                onPress={() => router.push('/(app)/notifications')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Notifications">
                <MaterialIcons name="notifications" size={24} color={Colors.primary} />
              </Pressable>
            }
          />

          <View style={styles.statRow} pointerEvents="box-none">
            <Card elevated style={styles.statCard}>
              <AppText variant="labelCaps" color="onSurfaceVariant" uppercase style={DisplayType.capsLabel}>
                Today&apos;s trips
              </AppText>
              <AppText style={[DisplayType.amountMd, styles.mono, { color: Colors.primary }]}>
                {bookings.filter((b) => b.myBid?.status === 'PENDING').length || 0}
              </AppText>
            </Card>
            <Card elevated style={styles.statCard}>
              <AppText variant="labelCaps" color="onSurfaceVariant" uppercase style={DisplayType.capsLabel}>
                Your vehicle
              </AppText>
              <AppText style={[DisplayType.amountMd, { color: Brand.orange }]} numberOfLines={1}>
                {vehicleLabel(user?.driverProfile?.vehicleType)}
              </AppText>
            </Card>
          </View>

          {actionError || feedError ? (
            <View style={styles.errorWrap} pointerEvents="box-none">
              <Card tone="danger">
                <AppText color="onErrorContainer" style={DisplayType.bodyUi}>
                  {actionError || feedError}
                </AppText>
              </Card>
            </View>
          ) : null}

          {!approved ? (
            <View style={styles.kycWrap} pointerEvents="box-none">
              <Pressable onPress={() => router.push('/(app)/documents')}>
                <Card elevated style={styles.kycCard}>
                  <View style={styles.kycIcon}>
                    <MaterialIcons name="hourglass-empty" size={26} color={Brand.orangeInk} />
                  </View>
                  <AppText align="center" style={DisplayType.sectionTitle}>
                    {verificationStatus === 'REJECTED' || verificationStatus === 'EXPIRED'
                      ? 'Action needed on your documents'
                      : 'Verification Pending'}
                  </AppText>
                  <AppText align="center" color="onSurfaceVariant" style={DisplayType.bodyUi}>
                    {user?.driverProfile?.rejectionReason ??
                      "Your documents are under review. We'll notify you once verification is complete."}
                  </AppText>
                </Card>
              </Pressable>

              <View style={styles.lockBar}>
                <MaterialIcons name="lock" size={18} color={Colors.onSurfaceVariant} />
                <AppText color="onSurfaceVariant" style={DisplayType.rowLabel}>
                  Awaiting KYC Approval
                </AppText>
              </View>
            </View>
          ) : null}
        </View>

        {approved ? (
          <BottomSheet
            snapPoints={snapPoints}
            index={sheetIndex}
            onIndexChange={setSheetIndex}
            header={
              <View style={styles.sheetHeader}>
                <AppText style={DisplayType.sectionTitle}>
                  {online ? 'Available loads' : 'You are offline'}
                </AppText>
                <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
                  {online
                    ? `${bookings.length} nearby`
                    : 'Go online to start receiving loads'}
                </AppText>
              </View>
            }>
            <FlatList
              data={online ? bookings : []}
              keyExtractor={(b) => b.id}
              contentContainerStyle={styles.list}
              onRefresh={loadFeed}
              refreshing={loading}
              ListEmptyComponent={
                <EmptyState
                  icon={online ? 'inbox' : 'wifi-off'}
                  message={online ? 'No new requests right now' : 'Go online to see nearby loads'}
                />
              }
              renderItem={({ item }) => {
                const busy = acceptingId === item.id;
                const disabledOther = acceptingId !== null && !busy;
                const hasBid = item.myBid && item.myBid.status === 'PENDING';

                return (
                  <RideCard
                    variant="offer"
                    reference={item.reference}
                    vehicleLabel={vehicleLabel(item.vehicleType)}
                    pickupAddress={item.pickupAddress}
                    dropAddress={item.dropAddress}
                    distanceKm={item.distanceKm}
                    fare={item.estimatedFare}>
                    {hasBid ? (
                      <View style={styles.bidState}>
                        <AppText color="onSurfaceVariant" style={[DisplayType.bodyUi, styles.mono]}>
                          Your bid: ₹{item.myBid!.amount}
                        </AppText>
                        <Button
                          label="Withdraw"
                          variant="outline"
                          onPress={() => withdrawBid(item.id, item.myBid!.id)}
                          loading={busy}
                          disabled={disabledOther}
                        />
                      </View>
                    ) : (
                      <View style={styles.actionRow}>
                        <Button
                          label="Accept Ride"
                          variant="orange"
                          style={styles.flex}
                          onPress={() => placeBid(item.id, item.estimatedFare ?? 0)}
                          loading={busy}
                          disabled={disabledOther || item.estimatedFare == null}
                        />
                        <Button
                          label="Place bid"
                          variant="outlineNavy"
                          style={styles.flex}
                          onPress={() => {
                            setBiddingId(item.id);
                            setBidAmount(item.estimatedFare ? String(item.estimatedFare) : '');
                          }}
                          disabled={disabledOther}
                        />
                      </View>
                    )}

                    {biddingId === item.id ? (
                      <View style={styles.bidRow}>
                        <View style={styles.flex}>
                          <TextField
                            placeholder={`Minimum ₹${item.estimatedFare ?? 0}`}
                            keyboardType="number-pad"
                            mono
                            value={bidAmount}
                            onChangeText={setBidAmount}
                          />
                        </View>
                        <Button
                          label="Submit"
                          variant="orange"
                          onPress={() => placeBid(item.id, Number(bidAmount))}
                          loading={busy}
                          disabled={!bidAmount || Number(bidAmount) < (item.estimatedFare ?? 0)}
                        />
                      </View>
                    ) : null}
                  </RideCard>
                );
              }}
            />
          </BottomSheet>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  mono: { fontFamily: FontFamily.mono },
  flex: { flex: 1 },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radii.pill,
    paddingLeft: Spacing.gutter,
    paddingRight: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  onlineDot: { width: 8, height: 8, borderRadius: Radii.pill },
  statRow: {
    flexDirection: 'row',
    gap: Spacing.gutter,
    paddingHorizontal: Spacing.containerMargin,
  },
  statCard: { flex: 1, gap: 2 },
  errorWrap: { padding: Spacing.containerMargin },
  kycWrap: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.gutter,
    padding: Spacing.containerMargin,
  },
  kycCard: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  kycIcon: {
    width: 56,
    height: 56,
    borderRadius: Radii.pill,
    backgroundColor: Brand.infoSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainer,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.md,
  },
  sheetHeader: { gap: 2, paddingBottom: Spacing.sm },
  list: { padding: Spacing.containerMargin, paddingTop: 0, gap: Spacing.gutter },
  bidState: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  actionRow: { flexDirection: 'row', gap: Spacing.sm },
  bidRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
});
