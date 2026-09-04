import { useState } from 'react';
import { Link, router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

export default function Login() {
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError('');
    setLoading(true);
    try {
      await login(phone, password);
      router.replace('/(app)/booking');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container}>
          <AppText variant="displayLg" color="primary">
            TruckGo
          </AppText>
          <AppText variant="bodyLg" color="onSurfaceVariant" style={styles.subtitle}>
            Move anything, anywhere
          </AppText>

          <TextField
            label="Phone Number"
            placeholder="+91 98765 43210"
            keyboardType="phone-pad"
            autoCapitalize="none"
            value={phone}
            onChangeText={setPhone}
          />
          <TextField
            label="Password"
            placeholder="Your password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error ? (
            <AppText variant="bodySm" color="error">
              {error}
            </AppText>
          ) : null}

          <Button label="Log in" onPress={onSubmit} loading={loading} disabled={!phone || !password} />

          <Link href="/(auth)/forgot-password" style={styles.link}>
            <AppText variant="bodySm" color="primary">
              Forgot Password?
            </AppText>
          </Link>

          <Link href="/(auth)/signup" style={styles.link}>
            <AppText variant="bodySm" color="primary">
              Need an account? Sign up
            </AppText>
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg, gap: Spacing.md },
  subtitle: { marginBottom: Spacing.md },
  link: { textAlign: 'center', marginTop: Spacing.sm },
});
