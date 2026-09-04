import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { DisplayType } from '@/constants/display';
import { Colors, Radii, Spacing } from '@/constants/theme';

export type SearchFieldProps = {
  /** Fires debounced, not on every keystroke — this drives a network call. */
  onChangeText: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
};

export function SearchField({ onChangeText, placeholder, debounceMs = 300 }: SearchFieldProps) {
  const [text, setText] = useState('');
  const onChangeRef = useRef(onChangeText);
  onChangeRef.current = onChangeText;

  useEffect(() => {
    const t = setTimeout(() => onChangeRef.current(text.trim()), debounceMs);
    return () => clearTimeout(t);
  }, [text, debounceMs]);

  return (
    <View style={styles.shell}>
      <MaterialIcons name="search" size={20} color={Colors.onSurfaceVariant} />
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={Colors.onSurfaceVariant}
        autoCorrect={false}
        style={[styles.input, DisplayType.fieldText]}
      />
      {text ? (
        <Pressable onPress={() => setText('')} hitSlop={8} accessibilityLabel="Clear search">
          <MaterialIcons name="close" size={18} color={Colors.onSurfaceVariant} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 52,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
    paddingHorizontal: Spacing.md,
  },
  input: { flex: 1, height: '100%', color: Colors.onSurface },
});
