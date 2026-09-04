import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, FontFamily, Radii, Spacing, type StatusTone } from '@/constants/theme';

export type RideCardProps = {
  reference: string;
  vehicleLabel: string;
  pickupAddress: string;
  dropAddress: string;
  fare: number | null;
  distanceKm?: number | null;
  status?: string;
  /** `offer` is an open load being bid on; `history` is a trip that already happened. */
  variant: 'history' | 'offer';
  /** Bid controls, slotted in by the dashboard sheet. */
  children?: ReactNode;
  onPress?: () => void;
};

/** Human wording + tone for every booking status the driver can see. */
const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  AWAITING_BIDS: { label: 'Open', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'info' },
  EN_ROUTE_TO_PICKUP: { label: 'To pickup', tone: 'info' },
  ARRIVED_AT_PICKUP: { label: 'At pickup', tone: 'info' },
  LOADING: { label: 'Loading', tone: 'warning' },
  IN_TRANSIT: { label: 'In transit', tone: 'warning' },
  ARRIVED_AT_DROP: { label: 'At drop', tone: 'warning' },
  UNLOADING: { label: 'Unloading', tone: 'warning' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  NO_DRIVER_FOUND: { label: 'No driver', tone: 'danger' },
};

export function RideCard({
  reference,
  vehicleLabel,
  pickupAddress,
  dropAddress,
  fare,
  distanceKm,
  status,
  variant,
  children,
  onPress,
}: RideCardProps) {
  const meta = status ? STATUS_META[status] : undefined;

  const body = (
    <Card style={styles.card}>
      <View style={styles.head}>
        <AppText style={DisplayType.fieldMono} numberOfLines={1}>
          {reference}
        </AppText>
        {meta ? <Badge label={meta.label} tone={meta.tone} size="sm" /> : null}
      </View>

      {/* Pickup and drop as one leg, not two unrelated label/value stacks. */}
      <View style={styles.legs}>
        <View style={styles.rail}>
          <View style={[styles.dot, { backgroundColor: Colors.primary }]} />
          <View style={styles.railLine} />
          <View style={[styles.dot, { backgroundColor: Brand.orange }]} />
        </View>
        <View style={styles.legText}>
          <AppText numberOfLines={1} style={DisplayType.rowLabel}>
            {pickupAddress}
          </AppText>
          <AppText numberOfLines={1} style={[DisplayType.rowLabel, styles.dropText]}>
            {dropAddress}
          </AppText>
        </View>
      </View>

      <View style={styles.footer}>
        <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
          {vehicleLabel}
          {distanceKm != null ? ` · ${distanceKm} km` : ''}
        </AppText>
        <AppText style={[DisplayType.amountMd, styles.fare]}>
          {fare != null ? `₹${fare}` : '—'}
        </AppText>
      </View>

      {children ? <View style={styles.actions}>{children}</View> : null}
    </Card>
  );

  if (!onPress) return body;
  return <Pressable onPress={onPress}>{body}</Pressable>;
}

const styles = StyleSheet.create({
  card: { gap: Spacing.gutter },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  legs: { flexDirection: 'row', gap: Spacing.gutter },
  rail: { alignItems: 'center', paddingTop: 6 },
  dot: { width: 9, height: 9, borderRadius: Radii.pill },
  railLine: { width: 2, flex: 1, minHeight: 16, backgroundColor: Colors.outlineVariant },
  legText: { flex: 1, gap: Spacing.gutter },
  dropText: { marginTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fare: { fontFamily: FontFamily.mono },
  actions: { gap: Spacing.sm },
});
