import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { AppText } from '@/components/app-text';
import { Wordmark } from '@/components/ui/wordmark';
import { DisplayType } from '@/constants/display';
import { Colors, Spacing } from '@/constants/theme';

export type AppBarProps = {
  back?: boolean;
  /** Navy screen title — "Edit Profile", "Bank Details". */
  title?: string;
  /** Orange TruckGo wordmark, used instead of a title on the tab-level screens. */
  brand?: boolean;
  /** Right-aligned "STEP 2/3" on the registration wizard. */
  step?: { current: number; total: number };
  right?: ReactNode;
  left?: ReactNode;
  /** Transparent, for sitting over the dashboard map. */
  overlay?: boolean;
};

export function AppBar({ back, title, brand, step, right, left, overlay }: AppBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        { paddingTop: insets.top },
        overlay ? styles.overlay : styles.solid,
      ]}>
      <View style={styles.inner}>
        {back ? (
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color={Colors.primary} />
          </Pressable>
        ) : null}

        {left}

        {brand ? <Wordmark /> : null}
        {title ? (
          <AppText style={[DisplayType.sectionTitle, styles.title]} numberOfLines={1}>
            {title}
          </AppText>
        ) : null}

        <View style={styles.spacer} />

        {step ? (
          <AppText variant="labelCaps" color="onSurfaceVariant" uppercase style={DisplayType.capsLabel}>
            Step {step.current}/{step.total}
          </AppText>
        ) : null}
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { width: '100%' },
  solid: {
    backgroundColor: Colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.outlineVariant,
  },
  overlay: { backgroundColor: 'transparent' },
  inner: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.gutter,
    paddingHorizontal: Spacing.containerMargin,
  },
  backBtn: { marginRight: -Spacing.xs },
  title: { flexShrink: 1 },
  spacer: { flex: 1 },
});
