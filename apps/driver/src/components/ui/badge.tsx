import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { DisplayType } from '@/constants/display';
import { Radii, Spacing, StatusColors, type StatusTone } from '@/constants/theme';

export type BadgeProps = {
  label: string;
  tone: StatusTone;
  size?: 'sm' | 'md';
  uppercase?: boolean;
};

const FILL: Record<StatusTone, string> = {
  success: StatusColors.successBg,
  info: StatusColors.infoBg,
  warning: StatusColors.warningBg,
  danger: StatusColors.dangerBg,
};

const INK: Record<StatusTone, string> = {
  success: StatusColors.successFg,
  info: StatusColors.infoFg,
  warning: StatusColors.warningFg,
  danger: StatusColors.dangerFg,
};

/** Status pill — "Under Review", "UNDER REVIEW", payment states in the earnings table. */
export function Badge({ label, tone, size = 'md', uppercase = false }: BadgeProps) {
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: FILL[tone] },
        size === 'sm' ? styles.sm : styles.md,
      ]}>
      <AppText
        variant="labelCaps"
        uppercase={uppercase}
        style={[DisplayType.capsLabel, size === 'sm' ? styles.smText : null, { color: INK[tone] }]}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  // No alignSelf here — the parent decides. Forcing flex-start made the badge hug the
  // left edge of the centred profile hero.
  base: { borderRadius: Radii.pill },
  md: { paddingHorizontal: Spacing.md, paddingVertical: 5 },
  sm: { paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  smText: { fontSize: 11 },
});
