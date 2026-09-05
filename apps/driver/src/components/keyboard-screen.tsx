import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, type StyleProp, type ViewStyle } from 'react-native';

export type KeyboardScreenProps = {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** A fixed bar below the scroll area (e.g. `StickyBar`) that must stay put, not scroll. */
  footer?: ReactNode;
};

/**
 * Keyboard-avoidance + scroll for a form, combined once instead of hand-rolled per screen.
 *
 * Sits *inside* `Screen`, below an `AppBar` — it only owns the scrolling form area, not the
 * fixed header, so a screen looks like `<Screen><AppBar .../><KeyboardScreen>...</KeyboardScreen></Screen>`.
 *
 * The gap this closes: `KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' :
 * undefined}` — the pattern several screens used — does *nothing* on Android, because
 * `undefined` is a no-op behaviour. It relies entirely on the OS resizing the window, which
 * shrinks available space but never scrolls a `ScrollView` to keep the now-hidden focused
 * field in view. `"height"` actually participates on Android. A few other screens skipped
 * `KeyboardAvoidingView` altogether, which is the same gap by omission.
 *
 * Every screen with a form should render through this instead of assembling its own
 * `KeyboardAvoidingView` + `ScrollView` — fixing the behaviour once here fixes it
 * everywhere, including in screens written after this one.
 */
export function KeyboardScreen({ children, contentContainerStyle, footer }: KeyboardScreenProps) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
      <ScrollView
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
      {footer}
    </KeyboardAvoidingView>
  );
}
