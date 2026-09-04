import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { AppText } from '@/components/app-text';
import { Colors, Radii, Spacing } from '@/constants/theme';

/**
 * Matches the original's Button: height 48, pill radius, and the same four variants
 * (`primary` / `navy` / `outline` / `ghost`) found in the decompiled bundle
 * (`decompiled_user.js:410092`).
 *
 * The exact fill for `navy` wasn't traceable through the decompiled control flow;
 * primaryContainer is used as the closest match. See reference/UNKNOWNS-AND-ASSUMPTIONS.md.
 */
export type ButtonVariant = 'primary' | 'navy' | 'outline' | 'ghost';

type ButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
};

const BACKGROUND: Record<ButtonVariant, string> = {
  primary: Colors.primary,
  navy: Colors.primaryContainer,
  outline: 'transparent',
  ghost: 'transparent',
};

const FOREGROUND: Record<ButtonVariant, keyof typeof Colors> = {
  primary: 'onPrimary',
  navy: 'onPrimary',
  outline: 'primary',
  ghost: 'primary',
};

export function Button({ label, variant = 'primary', loading, disabled, style, ...rest }: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        { backgroundColor: BACKGROUND[variant] },
        variant === 'outline' && { borderWidth: 1, borderColor: Colors.outline },
        isDisabled && styles.disabled,
        state.pressed && styles.pressed,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={Colors[FOREGROUND[variant]]} />
      ) : (
        <AppText variant="headlineSm" color={FOREGROUND[variant]}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 48,
    borderRadius: Radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
});
