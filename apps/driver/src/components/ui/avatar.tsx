import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Brand } from '@/constants/display';
import { Colors, FontFamily, Radii } from '@/constants/theme';

export type AvatarProps = {
  name?: string | null;
  size?: number;
  /** The orange ring on the Profile hero. */
  ring?: boolean;
};

/** First initial only — matches the reference, which shows "J" for "John". */
export function initial(name?: string | null): string {
  const first = name?.trim()?.[0];
  return first ? first.toUpperCase() : '?';
}

export function Avatar({ name, size = 64, ring = false }: AvatarProps) {
  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: Radii.pill,
          backgroundColor: ring ? Colors.primaryContainer : Colors.primary,
        },
        ring ? { borderWidth: 3, borderColor: Brand.orange } : null,
      ]}>
      <AppText
        color="onPrimary"
        style={{
          fontFamily: FontFamily.bold,
          fontSize: size * 0.4,
          lineHeight: size * 0.5,
        }}>
        {initial(name)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
});
