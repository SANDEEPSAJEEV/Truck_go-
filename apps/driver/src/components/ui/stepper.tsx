import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { AppText } from '@/components/app-text';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, Radii, Spacing } from '@/constants/theme';

export type StepperProps = {
  steps: string[];
  /** 1-based. */
  current: number;
};

/** The Profile → Vehicle → Account rail at the top of registration. */
export function Stepper({ steps, current }: StepperProps) {
  return (
    <View style={styles.wrap}>
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;

        return (
          <Fragment key={label}>
            {i > 0 ? (
              <View style={[styles.connector, n <= current ? styles.connectorDone : null]} />
            ) : null}
            <View style={styles.step}>
              <View
                style={[
                  styles.circle,
                  done ? styles.circleDone : active ? styles.circleActive : styles.circleTodo,
                ]}>
                {done ? (
                  <MaterialIcons name="check" size={18} color={Colors.onPrimary} />
                ) : (
                  <AppText
                    style={[
                      DisplayType.capsLabel,
                      { color: active ? Brand.orangeInk : Colors.outline, fontSize: 14 },
                    ]}>
                    {n}
                  </AppText>
                )}
              </View>
              <AppText
                style={[
                  DisplayType.capsLabel,
                  styles.label,
                  { color: n <= current ? Colors.primary : Colors.onSurfaceVariant },
                ]}>
                {label}
              </AppText>
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}

const CIRCLE = 34;

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: Spacing.xs },
  step: { alignItems: 'center', width: 76 },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleDone: { backgroundColor: Colors.primary },
  circleActive: { backgroundColor: Brand.orange },
  circleTodo: { backgroundColor: Colors.surfaceContainerHigh },
  label: { marginTop: Spacing.xs, textAlign: 'center' },
  // Sits on the circle's vertical centre, not the step block's.
  connector: {
    flex: 1,
    height: 2,
    marginTop: CIRCLE / 2 - 1,
    backgroundColor: Colors.outlineVariant,
  },
  connectorDone: { backgroundColor: Colors.primary },
});
