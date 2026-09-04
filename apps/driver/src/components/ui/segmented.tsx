import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { DisplayType } from '@/constants/display';
import { Colors, Radii } from '@/constants/theme';

export type SegmentedProps<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

/** All / Active / Completed / Cancelled on the Rides tab. */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <View style={styles.track}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.item, active ? styles.itemActive : null]}>
            <AppText
              numberOfLines={1}
              style={[
                DisplayType.capsLabel,
                { color: active ? Colors.onPrimary : Colors.onSurfaceVariant },
              ]}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radii.pill,
    padding: 3,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: Radii.pill,
  },
  itemActive: { backgroundColor: Colors.primary },
});
