import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { AppText } from '@/components/app-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, Radii, Spacing, type StatusTone } from '@/constants/theme';

export type ListRowProps = {
  icon?: keyof typeof MaterialIcons.glyphMap;
  /** `circle` puts the icon on a tinted disc; `danger` tints it red. */
  iconTone?: 'navy' | 'circle' | 'danger';
  label: string;
  /** Inline status chip under the label — "UNDER REVIEW" on Documents & KYC. */
  badge?: { label: string; tone: StatusTone };
  /** Right-aligned trailing value — "English" on the Language row. */
  value?: string;
  /** Stacked value under the label — the read-only Personal Information rows. */
  subtitle?: string;
  subtitleMono?: boolean;
  chevron?: boolean;
  destructive?: boolean;
  onPress?: () => void;
};

export function ListRow({
  icon,
  iconTone = 'navy',
  label,
  badge,
  value,
  subtitle,
  subtitleMono = false,
  chevron,
  destructive = false,
  onPress,
}: ListRowProps) {
  const showChevron = chevron ?? Boolean(onPress);
  const ink = destructive ? Colors.error : Colors.primary;

  const body = (
    <View style={styles.row}>
      {icon ? (
        <View style={[styles.iconSlot, iconTone === 'circle' ? styles.iconDisc : null]}>
          <MaterialIcons name={icon} size={22} color={ink} />
        </View>
      ) : null}

      <View style={styles.body}>
        <AppText style={[DisplayType.rowLabel, destructive ? { color: Colors.error } : null]}>
          {label}
        </AppText>
        {badge ? (
          <View style={styles.badgeWrap}>
            <Badge label={badge.label} tone={badge.tone} size="sm" />
          </View>
        ) : null}
        {subtitle ? (
          <AppText
            color="onSurfaceVariant"
            style={subtitleMono ? DisplayType.fieldMono : DisplayType.bodyUi}>
            {subtitle}
          </AppText>
        ) : null}
      </View>

      {value ? (
        <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
          {value}
        </AppText>
      ) : null}
      {showChevron ? (
        <MaterialIcons name="chevron-right" size={22} color={Colors.onSurfaceVariant} />
      ) : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} android_ripple={{ color: Colors.surfaceContainer }}>
      {body}
    </Pressable>
  );
}

/**
 * Wraps rows in a card and draws a hairline *between* them.
 *
 * Every screen used to hang `borderBottomWidth` on the row itself, which meant the last
 * row in every list drew a divider against the card's own edge. Owning the separator here
 * makes that impossible to get wrong.
 */
export function ListGroup({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <Card padded={false}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={styles.divider} /> : null}
          {row}
        </Fragment>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.gutter,
    paddingHorizontal: Spacing.cardPadding,
    paddingVertical: 14,
  },
  iconSlot: { width: 28, alignItems: 'center', justifyContent: 'center' },
  iconDisc: {
    height: 40,
    width: 40,
    borderRadius: Radii.pill,
    backgroundColor: Brand.infoSurface,
  },
  body: { flex: 1, gap: 2 },
  badgeWrap: { marginTop: 2, alignItems: 'flex-start' },
  // Inset to clear the icon column so the rule starts under the label, not the icon.
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.outlineVariant,
    marginLeft: Spacing.cardPadding + 28 + Spacing.gutter,
  },
});
