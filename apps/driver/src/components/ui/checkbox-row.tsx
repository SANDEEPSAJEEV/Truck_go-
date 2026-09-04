import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { Brand } from '@/constants/display';
import { Colors, Radii, Spacing } from '@/constants/theme';

export type CheckboxRowProps = {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export function CheckboxRow({ checked, onToggle, children }: CheckboxRowProps) {
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={6}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={styles.row}>
      <View style={[styles.box, checked ? styles.boxChecked : styles.boxEmpty]}>
        {checked ? <MaterialIcons name="check" size={16} color={Colors.white} /> : null}
      </View>
      <View style={styles.label}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.gutter },
  box: {
    width: 22,
    height: 22,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: Brand.orange },
  boxEmpty: { borderWidth: 1.5, borderColor: Colors.outline },
  label: { flex: 1 },
});
