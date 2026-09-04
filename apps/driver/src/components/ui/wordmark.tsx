import { StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { AppText } from '@/components/app-text';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, Spacing } from '@/constants/theme';

export type WordmarkProps = {
  /** White treatment for the orange landing hero; orange everywhere else. */
  onDark?: boolean;
  withIcon?: boolean;
  size?: number;
};

export function Wordmark({ onDark = false, withIcon = false, size }: WordmarkProps) {
  const ink = onDark ? Colors.white : Brand.orange;
  return (
    <View style={styles.row}>
      {withIcon ? <MaterialIcons name="local-shipping" size={(size ?? 22) + 4} color={ink} /> : null}
      <AppText style={[DisplayType.wordmark, size ? { fontSize: size } : null, { color: ink }]}>
        TruckGo
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
