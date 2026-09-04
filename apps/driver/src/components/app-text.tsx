import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import {
  Colors,
  LINE_HEIGHT_SCALE,
  Typography,
  type ThemeColor,
  type TypeVariant,
} from '@/constants/theme';

export type AppTextProps = TextProps & {
  variant?: TypeVariant;
  color?: ThemeColor;
  align?: TextStyle['textAlign'];
  uppercase?: boolean;
};

/**
 * Mirrors the original app's AppText: same prop names, same defaults
 * (variant `bodyMd`, color `onSurface`), and the same lineHeight multiplier.
 */
export function AppText({
  variant = 'bodyMd',
  color = 'onSurface',
  align,
  uppercase,
  style,
  ...rest
}: AppTextProps) {
  const type = Typography[variant];

  return (
    <Text
      style={[
        type,
        { lineHeight: type.lineHeight * LINE_HEIGHT_SCALE, color: Colors[color] },
        align ? { textAlign: align } : null,
        uppercase ? styles.uppercase : null,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  uppercase: { textTransform: 'uppercase' },
});
