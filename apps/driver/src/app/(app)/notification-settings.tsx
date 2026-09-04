import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { SectionLabel } from '@/components/ui/section-label';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, Spacing } from '@/constants/theme';
import {
  DEFAULT_PREFS,
  getNotificationPrefs,
  setNotificationPrefs,
  type NotificationPrefs,
} from '@/lib/notification-prefs';

export default function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    getNotificationPrefs().then(setPrefs);
  }, []);

  async function update(patch: Partial<NotificationPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    await setNotificationPrefs(next);
  }

  return (
    <Screen>
      <AppBar back title="Notifications" />
      <ScrollView contentContainerStyle={styles.container}>
        <View>
          <SectionLabel>In-app alerts</SectionLabel>
          <Card padded={false}>
            <Row
              label="New load alerts"
              description="Show a popup on any screen when a matching load comes in."
              value={prefs.newLoadAlerts}
              onChange={(v) => update({ newLoadAlerts: v })}
            />
            <View style={styles.divider} />
            <Row
              label="Open accepted trips"
              description="Jump straight to the trip when a customer accepts your bid."
              value={prefs.autoOpenAcceptedTrip}
              onChange={(v) => update({ autoOpenAcceptedTrip: v })}
            />
          </Card>
        </View>

        {/* Android owns the system-level switch. Mirroring it here would create a second
            source of truth that can disagree with the real one. */}
        <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
          Alerts that reach you while the app is closed are controlled by your phone's
          notification settings for TruckGo.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

function Row({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <AppText style={DisplayType.rowLabel}>{label}</AppText>
        <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
          {description}
        </AppText>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: Brand.orange, false: Colors.outlineVariant }}
        thumbColor={Colors.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.containerMargin, gap: Spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.gutter,
    paddingHorizontal: Spacing.cardPadding,
    paddingVertical: 14,
  },
  rowText: { flex: 1, gap: 2 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.outlineVariant,
    marginLeft: Spacing.cardPadding,
  },
});
