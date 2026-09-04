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
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';

// Confirmed copy, reference/UI-COPY-user.md (title (17 strings) group — Partner Login).
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
      router.replace('/(app)/(tabs)/dashboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in. Try again.');
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
            <AppText style={DisplayType.screenTitle}>Partner Login</AppText>
            <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
              Access your routes and earnings.
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
            />
            <TextField
              label="Password"
              icon="lock"
              placeholder="Your password"
              secureToggle
              value={password}
              onChangeText={setPassword}
            />
          </Card>

          {error ? (
            <Card tone="danger">
              <AppText color="error" style={DisplayType.bodyUi}>
                {error}
              </AppText>
            </Card>
          ) : null}

          <Button
            label="Log in"
            variant="orange"
            size="lg"
            onPress={onSubmit}
            loading={loading}
            disabled={!phone || !password}
          />

          <Link href="/(auth)/forgot-password" style={styles.link}>
            <AppText variant="bodySm" color="primary">
              Forgot Password?
            </AppText>
          </Link>
          <Link href="/(auth)/register" style={styles.link}>
            <AppText variant="bodySm" color="primary">
              Don&apos;t have an account? Apply to Drive
            </AppText>
          </Link>
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
