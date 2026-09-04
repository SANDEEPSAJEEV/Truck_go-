import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/app-text';
import { Colors, FontFamily, Radii, Spacing, Typography } from '@/constants/theme';

type TextFieldProps = TextInputProps & {
  label?: string;
  error?: string;
};

export function TextField({ label, error, style, ...rest }: TextFieldProps) {
  return (
    <View style={styles.container}>
      {label ? (
        <AppText variant="labelCaps" color="onSurfaceVariant" uppercase>
          {label}
        </AppText>
      ) : null}
      <TextInput
        placeholderTextColor={Colors.onSurfaceVariant}
        style={[
          styles.input,
          { borderColor: error ? Colors.error : Colors.outlineVariant },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <AppText variant="bodySm" color="error">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.xs },
  input: {
    height: 48,
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    color: Colors.onSurface,
    fontFamily: FontFamily.regular,
    fontSize: Typography.bodyLg.fontSize,
  },
});
