import { StyleSheet, View, type ViewProps } from 'react-native';

import { Brand } from '@/constants/display';
import { Colors, Radii, Shadows, Spacing, StatusColors } from '@/constants/theme';

export type CardTone = 'plain' | 'info' | 'warning' | 'danger' | 'success' | 'navy';

export type CardProps = ViewProps & {
  tone?: CardTone;
  /** Inner padding. Off for cards whose children draw their own edges (list groups, tables). */
  padded?: boolean;
  /** Drop shadow — for cards that float over the map, not for cards in a scroll. */
  elevated?: boolean;
  bordered?: boolean;
};

const TONE: Record<CardTone, { backgroundColor: string; borderColor: string }> = {
  plain: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.outlineVariant },
  info: { backgroundColor: Brand.infoSurface, borderColor: 'transparent' },
  warning: { backgroundColor: StatusColors.warningBg, borderColor: 'rgba(237,137,54,0.5)' },
  danger: { backgroundColor: StatusColors.dangerBg, borderColor: 'transparent' },
  success: { backgroundColor: StatusColors.successBg, borderColor: 'transparent' },
  navy: { backgroundColor: Colors.primary, borderColor: 'transparent' },
};

/**
 * The redesign's single most-reused surface. Before this existed every screen re-declared
 * its own rounded box, which is why the borders and radii had drifted apart.
 */
export function Card({
  tone = 'plain',
  padded = true,
  elevated = false,
  bordered = true,
  style,
  ...rest
}: CardProps) {
  const palette = TONE[tone];
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: palette.backgroundColor },
        bordered && palette.borderColor !== 'transparent'
          ? { borderWidth: 1, borderColor: palette.borderColor }
          : null,
        padded ? styles.padded : null,
        elevated ? Shadows.sm : null,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: Radii.lg, overflow: 'hidden' },
  padded: { padding: Spacing.cardPadding },
});
