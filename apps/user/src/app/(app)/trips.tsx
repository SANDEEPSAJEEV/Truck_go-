import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { TextField } from '@/components/ui/text-field';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { apiFetch } from '@/lib/api';

type Booking = {
  id: string;
  status: string;
  pickupAddress: string;
  dropAddress: string;
  vehicleType: string;
  reference: string;
  estimatedFare: number;
  actualFare: number | null;
  createdAt: string;
};

const ACTIVE_STATUSES = [
  'AWAITING_BIDS',
  'ACCEPTED',
  'EN_ROUTE_TO_PICKUP',
  'ARRIVED_AT_PICKUP',
  'LOADING',
  'IN_TRANSIT',
  'ARRIVED_AT_DROP',
  'UNLOADING',
];

// Confirmed copy, reference/UI-COPY-user.md (title (20 strings) group) — data source is
// GET /bookings (listBookings), confirmed decompiled_user.js:438000+.
export default function Trips() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    apiFetch<{ bookings: Booking[] }>('/bookings', { query: { filter } })
      .then((d) => setBookings(d.bookings))
      .catch(() => setError('Could not load your trips.'))
      .finally(() => setLoading(false));
  }, [filter]);

  useFocusEffect(load);

  // Filters on the reference actually shown on the card ("TRK-4F2A91"), not the internal
  // cuid — searching by something the user can't see never matches.
  const visible = search.trim()
    ? bookings.filter((b) => b.reference?.toLowerCase().includes(search.trim().toLowerCase()))
    : bookings;

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="headlineLg">Trip History</AppText>
        <TextField placeholder="Search by Shipment ID..." value={search} onChangeText={setSearch} />
        <View style={styles.filterRow}>
          {(['all', 'active'] as const).map((f) => {
            const selected = filter === f;
            return (
              <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, selected && styles.chipSelected]}>
                <AppText variant="headlineSm" color={selected ? 'onPrimary' : 'onSurface'}>
                  {f === 'all' ? 'All' : 'Active'}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error ? (
        <AppText variant="bodySm" color="error" align="center">
          {error}
        </AppText>
      ) : null}

      <FlatList
        contentContainerStyle={styles.list}
        data={visible}
        keyExtractor={(b) => b.id}
        onRefresh={load}
        refreshing={loading}
        ListEmptyComponent={
          <AppText variant="bodyLg" color="onSurfaceVariant" align="center" style={styles.empty}>
            {search.trim() ? 'No trips match your search.' : "No trips yet — book your first shipment!"}
          </AppText>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => {
              // A delivered trip always goes to payment first, even if it was already paid
              // — the payment screen itself checks status on mount and moves straight on to
              // feedback when there's nothing left to collect, so this is never a dead end,
              // only ever a necessary stop for anything still unpaid.
              if (item.status === 'DELIVERED') return router.push(`/(app)/payment/${item.id}`);
              if (ACTIVE_STATUSES.includes(item.status)) return router.push(`/(app)/track/${item.id}`);
              // Cancelled, rejected and no-driver-found used to land on the feedback screen,
              // which asked the customer to rate a driver for a trip that never happened —
              // and, for a booking with no driver at all, could not submit anything anyway.
              // There is nothing to open for these, so the card simply isn't a link.
              return;
            }}>
            <View style={styles.cardHeader}>
              <AppText variant="labelCaps" color="onSurfaceVariant" uppercase>
                Shipment ID: {item.reference}
              </AppText>
              <AppText variant="bodySm" color="onSurfaceVariant">
                {new Date(item.createdAt).toLocaleDateString()}
              </AppText>
            </View>
            <AppText variant="bodyLg" numberOfLines={1}>
              From: {item.pickupAddress}
            </AppText>
            <AppText variant="bodyLg" numberOfLines={1}>
              To: {item.dropAddress}
            </AppText>
            <View style={styles.cardFooter}>
              <AppText variant="headlineSm">₹{item.actualFare ?? item.estimatedFare}</AppText>
              <AppText variant="bodySm" color="primary">
                {ACTIVE_STATUSES.includes(item.status) ? 'Live Tracking' : 'View Trip'}
              </AppText>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { padding: Spacing.lg, gap: Spacing.sm },
  filterRow: { flexDirection: 'row', gap: Spacing.sm },
  chip: { paddingVertical: Spacing.xs, paddingHorizontal: Spacing.md, borderRadius: Radii.pill, borderWidth: 1, borderColor: Colors.outlineVariant },
  chipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  list: { padding: Spacing.lg, gap: Spacing.md },
  empty: { marginTop: Spacing.xxl },
  card: { borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.xs, backgroundColor: Colors.surface },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.xs },
});
