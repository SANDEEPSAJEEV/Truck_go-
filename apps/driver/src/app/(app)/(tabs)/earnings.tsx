import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { Badge } from '@/components/ui/badge';
import { BarChart } from '@/components/ui/bar-chart';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionLabel } from '@/components/ui/section-label';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, FontFamily, Spacing, type StatusTone } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { fareOf, type EarningsResponse, type PaymentStatus, type Trip } from '@/lib/earnings';

const PAYMENT_TONE: Record<PaymentStatus, StatusTone> = {
  // Delivered, payment not opened yet — informational, not a warning about anything.
  NONE: 'info',
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'danger',
  REFUNDED: 'danger',
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function money(n: number): string {
  return `₹${n.toFixed(2)}`;
}

/**
 * Buckets the last seven days from `completedAt`, in the device's own timezone.
 *
 * Deliberately client-side: bucketing on the server would mean picking a fixed timezone,
 * and a driver whose phone isn't on that timezone would see trips filed under the wrong
 * day. The phone already knows what "today" means to the person holding it.
 */
function useWeek(trips: Trip[]) {
  return useMemo(() => {
    const days: { label: string; value: number; key: string }[] = [];
    const now = new Date();

    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      days.push({ label: DAY_LABELS[d.getDay()], value: 0, key: d.toDateString() });
    }

    const index = new Map(days.map((d, i) => [d.key, i]));
    for (const t of trips) {
      if (!t.completedAt) continue;
      const i = index.get(new Date(t.completedAt).toDateString());
      if (i !== undefined) days[i].value += fareOf(t);
    }

    const weekTotal = days.reduce((sum, d) => sum + d.value, 0);
    return { days, weekTotal, today: days[days.length - 1]?.value ?? 0 };
  }, [trips]);
}

// Confirmed copy, reference/UI-COPY-user.md (earnings group).
export default function Earnings() {
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch<EarningsResponse>('/drivers/earnings')
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load your earnings.'));
  }, []);

  useFocusEffect(load);

  const trips = data?.trips ?? [];
  const { days, weekTotal, today } = useWeek(trips);
  const avgDaily = weekTotal / 7;

  return (
    <Screen>
      <AppBar brand />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.titleBlock}>
          <SectionLabel>Financial summary</SectionLabel>
          <AppText style={DisplayType.screenTitle}>Earnings</AppText>
        </View>

        {error ? <EmptyState icon="error-outline" message={error} /> : null}

        <Card tone="info" style={styles.total}>
          <View style={styles.totalHead}>
            <MaterialIcons name="account-balance-wallet" size={18} color={Colors.primary} />
            <AppText variant="labelCaps" uppercase style={DisplayType.capsLabel}>
              Total earned
            </AppText>
          </View>
          <AppText style={[DisplayType.amountXl, styles.mono, { color: Colors.primary }]}>
            {money(data?.totalEarnings ?? 0)}
          </AppText>
          <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
            Across {data?.completedTrips ?? 0} completed rides
          </AppText>
        </Card>

        <View style={styles.pair}>
          <Card style={styles.pairItem}>
            <AppText variant="labelCaps" color="onSurfaceVariant" uppercase style={DisplayType.capsLabel}>
              Today
            </AppText>
            <AppText style={[DisplayType.amountMd, styles.mono]}>{money(today)}</AppText>
          </Card>
          <Card style={styles.pairItem}>
            <AppText variant="labelCaps" color="onSurfaceVariant" uppercase style={DisplayType.capsLabel}>
              Last 7 days
            </AppText>
            <AppText style={[DisplayType.amountMd, styles.mono]}>{money(weekTotal)}</AppText>
          </Card>
        </View>

        <Card style={styles.chartCard}>
          <AppText style={DisplayType.sectionTitle}>Last 7 Days</AppText>
          <BarChart data={days.map(({ label, value }) => ({ label, value }))} />
          <AppText color="onSurfaceVariant" align="center" style={[DisplayType.bodyUi, styles.avg]}>
            Average daily payout: {money(avgDaily)}
          </AppText>
        </Card>

        <AppText style={DisplayType.sectionTitle}>Recent Payments</AppText>
        <Card padded={false}>
          <View style={styles.tableHead}>
            <AppText style={[DisplayType.capsLabel, styles.colId]} uppercase>
              Ride ID
            </AppText>
            <AppText style={[DisplayType.capsLabel, styles.colAmount]} uppercase>
              Amount
            </AppText>
            <AppText style={[DisplayType.capsLabel, styles.colStatus]} uppercase>
              Status
            </AppText>
          </View>

          {trips.length === 0 ? (
            <EmptyState
              icon="account-balance-wallet"
              message="No earnings yet — completed rides show up here."
            />
          ) : (
            trips.map((t, i) => (
              <View key={t.id ?? `${t.completedAt}-${i}`} style={styles.tableRow}>
                <AppText numberOfLines={1} style={[DisplayType.fieldMono, styles.colId]}>
                  {t.reference ?? '—'}
                </AppText>
                <AppText style={[DisplayType.fieldMono, styles.colAmount]}>
                  {money(fareOf(t))}
                </AppText>
                <View style={styles.colStatus}>
                  <Badge
                    label={t.paymentStatus ?? 'PENDING'}
                    tone={PAYMENT_TONE[t.paymentStatus ?? 'PENDING']}
                    size="sm"
                  />
                </View>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xl },
  titleBlock: { gap: 2 },
  mono: { fontFamily: FontFamily.mono },
  total: { gap: Spacing.xs },
  totalHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pair: { flexDirection: 'row', gap: Spacing.gutter },
  pairItem: { flex: 1, gap: Spacing.xs },
  chartCard: { gap: Spacing.md },
  avg: { fontStyle: 'italic' },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Brand.infoSurface,
    paddingHorizontal: Spacing.cardPadding,
    paddingVertical: Spacing.gutter,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.cardPadding,
    paddingVertical: Spacing.gutter,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.outlineVariant,
  },
  colId: { flex: 1.2 },
  colAmount: { flex: 1, textAlign: 'right' },
  colStatus: { flex: 1, alignItems: 'flex-end' },
});
