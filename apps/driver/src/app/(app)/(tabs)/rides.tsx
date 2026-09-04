import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { EmptyState } from '@/components/ui/empty-state';
import { RideCard } from '@/components/ui/ride-card';
import { SearchField } from '@/components/ui/search-field';
import { Segmented } from '@/components/ui/segmented';
import { DisplayType } from '@/constants/display';
import { Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { vehicleLabel } from '@/lib/vehicle';

type Booking = {
  id: string;
  reference: string;
  status: string;
  pickupAddress: string;
  dropAddress: string;
  vehicleType: string;
  distanceKm: number | null;
  estimatedFare: number | null;
  actualFare: number | null;
};

type Filter = 'all' | 'active' | 'completed' | 'cancelled';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const ACTIVE_STATUSES = [
  'ACCEPTED',
  'EN_ROUTE_TO_PICKUP',
  'ARRIVED_AT_PICKUP',
  'LOADING',
  'IN_TRANSIT',
  'ARRIVED_AT_DROP',
  'UNLOADING',
];

/**
 * The driver's own trip history.
 *
 * `GET /bookings` has always filtered by `driverId` for drivers — the driver app just
 * never called it, so a driver had no way to look back at a trip they'd finished.
 */
export default function Rides() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<{ bookings: Booking[] }>('/bookings', { query: { filter, search } })
      .then((d) => {
        setBookings(d.bookings);
        setError('');
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load your rides.'))
      .finally(() => setLoading(false));
  }, [filter, search]);

  useFocusEffect(load);

  return (
    <Screen>
      <AppBar brand />
      <View style={styles.header}>
        <AppText style={DisplayType.screenTitle}>Ride History</AppText>
        <SearchField placeholder="Search by Ride ID or Destination" onChangeText={setSearch} />
        <Segmented options={FILTERS} value={filter} onChange={setFilter} />
      </View>

      <FlatList
        data={bookings}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={
          error ? (
            <EmptyState icon="error-outline" message={error} />
          ) : loading ? null : (
            <EmptyState
              icon="receipt-long"
              message={
                search
                  ? 'No rides match that search.'
                  : 'No rides yet — accepted rides appear here.'
              }
            />
          )
        }
        renderItem={({ item }) => (
          <RideCard
            variant="history"
            reference={item.reference}
            vehicleLabel={vehicleLabel(item.vehicleType)}
            pickupAddress={item.pickupAddress}
            dropAddress={item.dropAddress}
            distanceKm={item.distanceKm}
            fare={item.actualFare ?? item.estimatedFare}
            status={item.status}
            onPress={() => {
              // A live trip goes to the working screen; anything finished goes to its
              // summary. Sending a delivered trip back into the PIN flow would be a trap.
              if (ACTIVE_STATUSES.includes(item.status)) {
                router.push(`/(app)/trip/${item.id}`);
              } else if (item.status === 'DELIVERED') {
                router.push(`/(app)/completed-ride?id=${item.id}`);
              }
            }}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, gap: Spacing.gutter },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.gutter },
});
