import { StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { AppText } from '@/components/app-text';
import { DisplayType } from '@/constants/display';
import { Colors, Spacing } from '@/constants/theme';

export type EmptyStateProps = {
  icon: keyof typeof MaterialIcons.glyphMap;
  message: string;
};

export function EmptyState({ icon, message }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <MaterialIcons name={icon} size={44} color={Colors.onSurfaceVariant} />
      <AppText color="onSurfaceVariant" align="center" style={DisplayType.bodyUi}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing.gutter, paddingVertical: Spacing.xl },
});
