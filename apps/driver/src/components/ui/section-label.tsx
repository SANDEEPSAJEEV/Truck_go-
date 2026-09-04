import { StyleSheet } from 'react-native';

import { AppText } from '@/components/app-text';
import { DisplayType } from '@/constants/display';
import { Spacing } from '@/constants/theme';

/** The uppercase grey label that sits outside and above a card group. */
export function SectionLabel({ children }: { children: string }) {
  return (
    <AppText variant="labelCaps" color="onSurfaceVariant" uppercase style={styles.label}>
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  label: { ...DisplayType.capsLabel, marginBottom: Spacing.sm, marginLeft: Spacing.xs },
});
