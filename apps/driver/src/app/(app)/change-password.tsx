import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { KeyboardScreen } from '@/components/keyboard-screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { DisplayType } from '@/constants/display';
import { Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';

export default function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError('');
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      await apiFetch('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update your password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <AppBar back title="Change Password" />
      <KeyboardScreen contentContainerStyle={styles.container}>
        <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
          Choose a strong password of at least 8 characters.
        </AppText>

        <TextField
          label="Current Password"
          icon="lock-outline"
          placeholder="Your current password"
          secureTextEntry
          value={currentPassword}
          onChangeText={setCurrentPassword}
          helper="Forgotten it? Sign out and use 'Forgot Password' to reset it by SMS."
        />
        <TextField
          label="New Password"
          icon="lock"
          placeholder="At least 8 characters"
          secureToggle
          value={newPassword}
          onChangeText={setNewPassword}
        />
        <TextField
          label="Confirm New Password"
          icon="lock"
          placeholder="Re-enter new password"
          secureTextEntry
          value={confirmPassword}
          onChangeText={setConfirmPassword}
        />

        {error ? (
          <AppText variant="bodySm" color="error">
            {error}
          </AppText>
        ) : null}

        <Button
          label="Update Password"
          variant="primary"
          size="lg"
          icon="check"
          onPress={onSubmit}
          loading={loading}
          disabled={!currentPassword || !newPassword || !confirmPassword}
        />
      </KeyboardScreen>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.containerMargin, gap: Spacing.md },
});
