import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { AppText } from '@/components/app-text';
import { DisplayType } from '@/constants/display';
import { Colors, Radii, Spacing } from '@/constants/theme';

type TextFieldProps = TextInputProps & {
  label?: string;
  error?: string;
  /** Grey explanatory line under the field. */
  helper?: string;
  /** Leading glyph inside the field. */
  icon?: keyof typeof MaterialIcons.glyphMap;
  trailing?: ReactNode;
  /** Adds the eye / eye-off toggle and owns its own visibility state. */
  secureToggle?: boolean;
  /** For values that get read aloud or compared — vehicle numbers, IFSC, account numbers. */
  mono?: boolean;
  /**
   * Renders label + value as plain text with no input box. For fields that are shown but
   * can't be edited here, like the phone number on Edit Profile — a disabled `TextInput`
   * still looks tappable, which is a small lie.
   */
  readOnlyValue?: string;
};

export function TextField({
  label,
  error,
  helper,
  icon,
  trailing,
  secureToggle,
  mono,
  readOnlyValue,
  style,
  ...rest
}: TextFieldProps) {
  const [revealed, setRevealed] = useState(false);

  if (readOnlyValue !== undefined) {
    return (
      <View style={styles.container}>
        {label ? <FieldLabel>{label}</FieldLabel> : null}
        <AppText style={DisplayType.fieldMono}>{readOnlyValue}</AppText>
        {helper ? (
          <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
            {helper}
          </AppText>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <View style={[styles.shell, { borderColor: error ? Colors.error : Colors.outlineVariant }]}>
        {icon ? (
          <MaterialIcons name={icon} size={20} color={Colors.onSurfaceVariant} style={styles.icon} />
        ) : null}
        <TextInput
          placeholderTextColor={Colors.onSurfaceVariant}
          secureTextEntry={secureToggle ? !revealed : rest.secureTextEntry}
          style={[styles.input, mono ? DisplayType.fieldMono : DisplayType.fieldText, style]}
          {...rest}
        />
        {secureToggle ? (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            style={styles.trailing}>
            <MaterialIcons
              name={revealed ? 'visibility-off' : 'visibility'}
              size={20}
              color={Colors.onSurfaceVariant}
            />
          </Pressable>
        ) : null}
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {error ? (
        <AppText variant="bodySm" color="error">
          {error}
        </AppText>
      ) : null}
      {helper && !error ? (
        <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
          {helper}
        </AppText>
      ) : null}
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <AppText variant="labelCaps" color="onSurfaceVariant" uppercase style={DisplayType.capsLabel}>
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.xs },
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: Radii.lg,
    borderWidth: 1,
    backgroundColor: Colors.surfaceContainerLowest,
    paddingHorizontal: Spacing.md,
  },
  icon: { marginRight: Spacing.sm },
  input: { flex: 1, height: '100%', color: Colors.onSurface },
  trailing: { marginLeft: Spacing.sm },
});
