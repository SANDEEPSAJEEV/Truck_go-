import { useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { apiFetch, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

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
      <ScrollView contentContainerStyle={styles.container}>
        <AppText variant="headlineLg">Change Password</AppText>
        <AppText variant="bodyLg" color="onSurfaceVariant">
          Choose a strong password of at least 8 characters.
        </AppText>

        <TextField
          label="Current Password"
          placeholder="Leave blank if you use OTP login"
          secureTextEntry
          value={currentPassword}
          onChangeText={setCurrentPassword}
        />
        <TextField
          label="New Password"
          placeholder="At least 8 characters"
          secureTextEntry
          value={newPassword}
          onChangeText={setNewPassword}
        />
        <TextField
          label="Confirm New Password"
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
          onPress={onSubmit}
          loading={loading}
          disabled={!newPassword || !confirmPassword}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.md },
});
