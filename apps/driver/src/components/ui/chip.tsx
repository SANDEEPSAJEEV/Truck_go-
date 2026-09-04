import { Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { AppText } from '@/components/app-text';
import { DisplayType } from '@/constants/display';
import { Colors, Radii, Spacing } from '@/constants/theme';

export type ChipProps = {
  label: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  selected: boolean;
  onPress: () => void;
};

/** Vehicle-type selector on the registration wizard's Vehicle step. */
export function Chip({ label, icon, selected, onPress }: ChipProps) {
  const ink = selected ? Colors.primary : Colors.onSurfaceVariant;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.base, selected ? styles.selected : styles.unselected]}>
      {icon ? <MaterialIcons name={icon} size={18} color={ink} /> : null}
      <AppText style={[DisplayType.rowLabel, { color: ink }]}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: Radii.pill,
  },
  selected: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  unselected: {
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
});
