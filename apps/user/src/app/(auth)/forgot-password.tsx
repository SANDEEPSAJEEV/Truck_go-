import { useState } from 'react';
import { Link, router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { apiFetch, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

export default function ForgotPassword() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSendCode() {
    setError('');
    setLoading(true);
    try {
      await apiFetch('/auth/forgot-password', { method: 'POST', body: { phone }, auth: false });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the reset code.');
    } finally {
      setLoading(false);
    }
  }

  async function onReset() {
    setError('');
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: { phone, code, newPassword },
        auth: false,
      });
      router.replace('/(auth)/login');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reset your password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container}>
          <AppText variant="headlineLg">Forgot your password?</AppText>
          <AppText variant="bodyLg" color="onSurfaceVariant">
            {sent
              ? 'Enter the code we sent and choose a new password.'
              : "Enter your phone number and we'll send you a reset code."}
          </AppText>

          <TextField
            label="Phone Number"
            placeholder="+91 98765 43210"
            keyboardType="phone-pad"
            autoCapitalize="none"
            value={phone}
            onChangeText={setPhone}
            editable={!sent}
          />

          {sent ? (
            <>
              <TextField label="Reset Code" placeholder="Enter the code" value={code} onChangeText={setCode} />
              <TextField
                label="New Password"
                placeholder="At least 8 characters"
                secureTextEntry
                value={newPassword}
                onChangeText={setNewPassword}
              />
              <TextField
                label="Confirm Password"
                placeholder="Re-enter new password"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
            </>
          ) : null}

          {error ? (
            <AppText variant="bodySm" color="error">
              {error}
            </AppText>
          ) : null}

          {sent ? (
            <Button
              label="Update Password"
              onPress={onReset}
              loading={loading}
              disabled={!code || !newPassword || !confirmPassword}
            />
          ) : (
            <Button label="Send Reset Code" onPress={onSendCode} loading={loading} disabled={!phone} />
          )}

          {sent ? (
            <AppText
              variant="bodySm"
              color="primary"
              style={styles.link}
              onPress={() => {
                setSent(false);
                setError('');
              }}>
              Use a different number
            </AppText>
          ) : (
            <Link href="/(auth)/login" style={styles.link}>
              <AppText variant="bodySm" color="primary">
                Back to login
              </AppText>
            </Link>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg, gap: Spacing.md },
  link: { textAlign: 'center', marginTop: Spacing.sm },
});
