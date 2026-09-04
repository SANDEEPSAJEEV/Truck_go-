import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { AppText } from '@/components/app-text';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, Radii, Spacing } from '@/constants/theme';

/**
 * Structural prop type rather than `BottomTabBarProps`.
 *
 * Expo Router SDK 57 vendors react-navigation at
 * `expo-router/build/react-navigation/bottom-tabs` — `@react-navigation/bottom-tabs` is
 * not resolvable as a package here, and deep-importing that path breaks on any patch
 * bump. A handler that accepts a subset of the fields is a supertype, so this assigns to
 * the `tabBar` slot cleanly.
 */
export type AppTabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string } }>;
  navigation: {
    emit(e: { type: 'tabPress'; target: string; canPreventDefault: true }): {
      defaultPrevented: boolean;
    };
    navigate(name: string): void;
  };
};

const ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  dashboard: 'dashboard',
  rides: 'local-shipping',
  earnings: 'account-balance-wallet',
  'profile-account': 'person',
};

export function AppTabBar({ state, descriptors, navigation }: AppTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + Spacing.sm }]}>
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const label = descriptors[route.key]?.options.title ?? route.name;
        const ink = focused ? Brand.orangeInk : Colors.primary;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={styles.slot}>
            <View style={[styles.pill, focused ? styles.pillActive : null]}>
              <MaterialIcons name={ICONS[route.name] ?? 'circle'} size={22} color={ink} />
              <AppText style={[DisplayType.tabLabel, { color: ink }]} numberOfLines={1}>
                {label}
              </AppText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.outlineVariant,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Icon stacked over label, matching the reference. Laid out side by side, four tabs of
  // "Dashboard"/"Earnings" don't fit a 375px screen and the labels truncate to "Dash…".
  pill: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: 2,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.lg,
  },
  pillActive: { backgroundColor: Brand.orange },
});
