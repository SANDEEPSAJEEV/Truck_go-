import { useState } from 'react';
import { Link, router } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { PhoneVerify } from '@/components/phone-verify';
import { Colors, Spacing } from '@/constants/theme';

export default function Signup() {
  const { register } = useAuth();
  // Phone ownership is proved first; the token it yields is what lets the account be
  // created at all. Until it exists there is nothing to fill in.
  const [phone, setPhone] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError('');
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    if (!acceptedTerms) {
      setError('Please accept the Terms of Service and Privacy Policy');
      return;
    }
    setLoading(true);
    try {
      await register({
        fullName,
        companyName: companyName || undefined,
        email: email || undefined,
        phone,
        password,
        confirmPassword,
        verificationToken,
        acceptTermsAndConditions: true,
        acceptPrivacyPolicy: true,
      });
      router.replace('/(app)/booking');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Registration failed. Please try again.');
      // A verification token is short-lived; if it lapsed, send them back to re-verify
      // rather than leaving them stuck on a form that can never submit.
      if (e instanceof ApiError && e.code === 'PHONE_NOT_VERIFIED') setVerificationToken('');
    } finally {
      setLoading(false);
    }
  }

  if (!verificationToken) {
    return (
      <Screen>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.container}>
            <PhoneVerify
              onVerified={(verifiedPhone, token) => {
                setPhone(verifiedPhone);
                setVerificationToken(token);
              }}
            />
            <Link href="/(auth)/login" style={styles.link}>
              <View style={styles.linkRow}>
                <AppText variant="bodySm" color="onSurfaceVariant">
                  Already have an account?{' '}
                </AppText>
                <AppText variant="bodySm" color="primary">
                  Login here
                </AppText>
              </View>
            </Link>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container}>
          <AppText variant="headlineLg">Create Account</AppText>
          <AppText variant="bodySm" color="onSurfaceVariant">
            {phone} verified
          </AppText>

          <TextField label="Full Name" placeholder="John Doe" value={fullName} onChangeText={setFullName} />
          <TextField
            label="Company Name"
            placeholder="Logistics Corp Inc."
            value={companyName}
            onChangeText={setCompanyName}
          />
          <TextField
            label="Email Address"
            placeholder="john@company.com"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextField
            label="Password"
            placeholder="At least 8 characters"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <TextField
            label="Confirm Password"
            placeholder="Re-enter password"
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />

          <Pressable style={styles.termsRow} onPress={() => setAcceptedTerms((v) => !v)}>
            <MaterialIcons
              name={acceptedTerms ? 'check-box' : 'check-box-outline-blank'}
              size={20}
              color={acceptedTerms ? Colors.primary : Colors.onSurfaceVariant}
            />
            <AppText variant="bodySm" color="onSurfaceVariant" style={{ flex: 1 }}>
              I agree to the Terms of Service and Privacy Policy
            </AppText>
          </Pressable>

          {error ? (
            <AppText variant="bodySm" color="error">
              {error}
            </AppText>
          ) : null}

          <Button
            label="Create Account"
            onPress={onSubmit}
            loading={loading}
            disabled={!fullName || !phone || !password || !confirmPassword}
          />

          <Link href="/(auth)/login" style={styles.link}>
            <View style={styles.linkRow}>
              <AppText variant="bodySm" color="onSurfaceVariant">
                Already have an account?{' '}
              </AppText>
              <AppText variant="bodySm" color="primary">
                Login here
              </AppText>
            </View>
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg, gap: Spacing.md },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  link: { marginTop: Spacing.sm },
  linkRow: { flexDirection: 'row', justifyContent: 'center' },
});
