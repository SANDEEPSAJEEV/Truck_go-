import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { AppText } from '@/components/app-text';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, Radii, Spacing } from '@/constants/theme';

/**
 * Matches the original's Button: height 48, pill radius, and the same four variants
 * (`primary` / `navy` / `outline` / `ghost`) found in the decompiled bundle
 * (`decompiled_user.js:410092`).
 *
 * The exact fill for `navy` wasn't traceable through the decompiled control flow;
 * primaryContainer is used as the closest match. See reference/UNKNOWNS-AND-ASSUMPTIONS.md.
 *
 * `orange` / `outlineNavy` / `danger`, the icon slot and the `lg` size are additions the
 * redesign needs. The four recovered variants keep their exact metrics so every existing
 * call site renders byte-identically.
 */
export type ButtonVariant =
  | 'primary'
  | 'navy'
  | 'outline'
  | 'ghost'
  | 'orange'
  | 'outlineNavy'
  | 'danger';

type ButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: keyof typeof MaterialIcons.glyphMap;
  iconPosition?: 'left' | 'right';
  /** `md` is the recovered 48px pill; `lg` is the 56px rounded-rect the reference uses. */
  size?: 'md' | 'lg';
  fullWidth?: boolean;
};

const BACKGROUND: Record<ButtonVariant, string> = {
  primary: Colors.primary,
  navy: Colors.primaryContainer,
  outline: 'transparent',
  ghost: 'transparent',
  orange: Brand.orange,
  outlineNavy: 'transparent',
  danger: 'transparent',
};

const FOREGROUND: Record<ButtonVariant, string> = {
  primary: Colors.onPrimary,
  navy: Colors.onPrimary,
  outline: Colors.primary,
  ghost: Colors.primary,
  orange: Brand.orangeInk,
  outlineNavy: Colors.primary,
  danger: Colors.error,
};

const BORDER: Partial<Record<ButtonVariant, { width: number; color: string }>> = {
  outline: { width: 1, color: Colors.outline },
  outlineNavy: { width: 1.5, color: Colors.primary },
  danger: { width: 1.5, color: Colors.error },
};

export function Button({
  label,
  variant = 'primary',
  loading,
  disabled,
  icon,
  iconPosition = 'right',
  size = 'md',
  fullWidth,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const ink = FOREGROUND[variant];
  const border = BORDER[variant];

  const glyph = icon ? <MaterialIcons name={icon} size={size === 'lg' ? 20 : 18} color={ink} /> : null;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        { backgroundColor: BACKGROUND[variant] },
        border ? { borderWidth: border.width, borderColor: border.color } : null,
        fullWidth ? styles.fullWidth : null,
        isDisabled && styles.disabled,
        state.pressed && styles.pressed,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={ink} />
      ) : (
        <View style={styles.content}>
          {iconPosition === 'left' ? glyph : null}
          {/* The reference's own "Complete Registration ✓" clips at this width — giving the
              label two lines is the cheap fix the mock didn't make. */}
          <AppText
            variant="headlineSm"
            numberOfLines={2}
            style={[size === 'lg' ? DisplayType.rowLabel : null, { color: ink }]}>
            {label}
          </AppText>
          {iconPosition === 'right' ? glyph : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  md: { height: 48, borderRadius: Radii.pill },
  lg: { height: 56, borderRadius: Radii.lg },
  fullWidth: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 1 },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
});
