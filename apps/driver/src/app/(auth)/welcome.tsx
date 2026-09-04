import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/ui/button';
import { Wordmark } from '@/components/ui/wordmark';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, Radii, Spacing } from '@/constants/theme';

const PERKS: { icon: keyof typeof MaterialIcons.glyphMap; label: string }[] = [
  { icon: 'payments', label: 'High Rates' },
  { icon: 'event', label: 'Flexible Hours' },
  { icon: 'bolt', label: 'Weekly Payouts' },
];

/** First screen a driver who isn't signed in ever sees. */
export default function Welcome() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { paddingTop: insets.top + Spacing.lg }]}>
        {/* Oversized glyph rather than an image asset — one less thing in the bundle, and
            it scales cleanly on every density. */}
        <MaterialIcons
          name="local-shipping"
          size={340}
          color={Brand.watermark}
          style={styles.watermark}
          pointerEvents="none"
        />

        <View style={styles.heroContent}>
          <View style={styles.brandRow}>
            <Wordmark onDark withIcon />
            <View style={styles.driverPill}>
              <AppText style={[DisplayType.capsLabel, { color: Colors.white }]}>Driver</AppText>
            </View>
          </View>

          <View style={styles.hiringBadge}>
            <MaterialIcons name="verified" size={14} color={Colors.white} />
            <AppText style={[DisplayType.capsLabel, { color: Colors.white }]}>
              Now Hiring Drivers
            </AppText>
          </View>

          <AppText style={[DisplayType.hero, { color: Colors.white }]}>
            Earn More on Every <AppText style={[DisplayType.hero, styles.heroAccent]}>Mile.</AppText>
          </AppText>
          <AppText style={[DisplayType.bodyUi, styles.heroSub]}>
            Flexible schedules, high rates, and weekly payouts.
          </AppText>

          <View style={styles.perks}>
            {PERKS.map((perk) => (
              <View key={perk.label} style={styles.perk}>
                <MaterialIcons name={perk.icon} size={22} color={Colors.white} />
                <AppText align="center" style={[DisplayType.capsLabel, { color: Colors.white }]}>
                  {perk.label}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
        <Button
          label="Become a Driver"
          variant="orange"
          size="lg"
          icon="arrow-forward"
          onPress={() => router.push('/(auth)/register')}
        />
        <Button
          label="Log In"
          variant="outlineNavy"
          size="lg"
          onPress={() => router.push('/(auth)/login')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  hero: {
    flex: 1,
    backgroundColor: Brand.orange,
    justifyContent: 'flex-end',
    borderBottomLeftRadius: Radii.xl,
    borderBottomRightRadius: Radii.xl,
    overflow: 'hidden',
  },
  watermark: { position: 'absolute', right: -70, bottom: 40 },
  heroContent: { padding: Spacing.lg, gap: Spacing.gutter },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.gutter },
  driverPill: {
    borderWidth: 1.5,
    borderColor: Colors.white,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.gutter,
    paddingVertical: 3,
  },
  hiringBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Brand.onOrangeCard,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.gutter,
    paddingVertical: 6,
  },
  heroAccent: { color: Colors.primary },
  heroSub: { color: Colors.white, opacity: 0.9 },
  perks: { flexDirection: 'row', gap: Spacing.gutter, marginTop: Spacing.sm },
  perk: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Brand.onOrangeCard,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  footer: {
    gap: Spacing.gutter,
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.md,
  },
});
