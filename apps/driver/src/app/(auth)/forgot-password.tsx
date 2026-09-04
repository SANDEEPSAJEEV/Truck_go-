import { useState } from 'react';
import { Link, router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { DisplayType } from '@/constants/display';
import { Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';

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
      setError('Passwords do not match');
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
      <AppBar back brand />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.heading}>
            <AppText style={DisplayType.screenTitle}>Forgot your password?</AppText>
            <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
              {sent
                ? 'Enter the code we sent and choose a new password.'
                : "Enter your phone number and we'll send you a reset code."}
            </AppText>
          </View>

          <Card style={styles.card}>
            <TextField
              label="Phone Number"
              icon="phone"
              placeholder="+91 98765 43210"
              keyboardType="phone-pad"
              autoCapitalize="none"
              value={phone}
              onChangeText={setPhone}
              editable={!sent}
            />

            {sent ? (
              <>
                <TextField
                  label="Reset Code"
                  icon="pin"
                  placeholder="Enter the code"
                  mono
                  value={code}
                  onChangeText={setCode}
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
                  label="Confirm Password"
                  icon="lock"
                  placeholder="Re-enter new password"
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
              </>
            ) : null}
          </Card>

          {error ? (
            <Card tone="danger">
              <AppText color="error" style={DisplayType.bodyUi}>
                {error}
              </AppText>
            </Card>
          ) : null}

          {sent ? (
            <Button
              label="Update Password"
              variant="orange"
              size="lg"
              onPress={onReset}
              loading={loading}
              disabled={!code || !newPassword || !confirmPassword}
            />
          ) : (
            <Button
              label="Send Reset Code"
              variant="orange"
              size="lg"
              onPress={onSendCode}
              loading={loading}
              disabled={!phone}
            />
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
  flex: { flex: 1 },
  body: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xl },
  heading: { gap: Spacing.xs, marginBottom: Spacing.xs },
  card: { gap: Spacing.md },
  link: { textAlign: 'center', marginTop: Spacing.sm },
});
