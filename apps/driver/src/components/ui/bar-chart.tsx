import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, Radii, Spacing } from '@/constants/theme';

export type BarChartProps = {
  data: { label: string; value: number }[];
  height?: number;
};

/**
 * View-based bars — no react-native-svg. The chart is seven rectangles; pulling in a
 * native module for that would add a link surface and a build, for nothing.
 *
 * With no earnings at all every bar renders full-height in the pale fill, which is exactly
 * what the reference shows for a new driver: the shape of the week is there, waiting.
 */
export function BarChart({ data, height = 140 }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const empty = max <= 0;

  return (
    <View>
      <View style={[styles.plot, { height }]}>
        {data.map((d) => (
          <View key={d.label} style={styles.barColumn}>
            <View
              style={[
                styles.bar,
                {
                  height: empty ? '100%' : `${Math.max((d.value / max) * 100, 2)}%`,
                  backgroundColor: empty || d.value === 0 ? Brand.chartBar : Brand.chartBarFill,
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.axis} />
      <View style={styles.labels}>
        {data.map((d) => (
          <View key={d.label} style={styles.column}>
            <AppText color="onSurfaceVariant" align="center" style={DisplayType.capsLabel}>
              {d.label}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // `stretch`, not `flex-end`: a percentage bar height only resolves against a parent
  // with a definite height, and flex-end would shrink each column to its content — which
  // is the bar itself, so every bar computes to zero and the chart renders empty.
  plot: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.sm },
  barColumn: { flex: 1, justifyContent: 'flex-end' },
  column: { flex: 1 },
  bar: { width: '100%', borderTopLeftRadius: Radii.sm, borderTopRightRadius: Radii.sm },
  axis: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.outlineVariant,
    marginTop: Spacing.sm,
  },
  labels: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
});
