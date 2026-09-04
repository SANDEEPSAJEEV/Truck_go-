import { useState } from 'react';
import { Link, router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { PhoneVerify } from '@/components/phone-verify';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckboxRow } from '@/components/ui/checkbox-row';
import { Chip } from '@/components/ui/chip';
import { SectionLabel } from '@/components/ui/section-label';
import { Stepper } from '@/components/ui/stepper';
import { StickyBar } from '@/components/ui/sticky-bar';
import { TextField } from '@/components/ui/text-field';
import { DisplayType } from '@/constants/display';
import { Spacing } from '@/constants/theme';
import { useAuth, type VehicleType } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { VEHICLE_LABEL } from '@/lib/vehicle';

// Confirmed copy, reference/UI-COPY-user.md (step1Title (33 strings) group). The original
// is a 3-step wizard (Profile → Vehicle → Account), restored here.
//
// State stays in one component rather than three routes: the verification token is
// short-lived and has real failure handling (a lapsed token bounces the driver back to
// phone verification), which is a great deal harder to keep correct across route
// boundaries than across a `step` integer.
const VEHICLE_TYPES = Object.keys(VEHICLE_LABEL) as VehicleType[];

const STEPS = ['Profile', 'Vehicle', 'Account'];

export default function Register() {
  const { register } = useAuth();

  const [step, setStep] = useState(1);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  // Phone ownership is proved before anything else; the token it yields is what lets the
  // account be created at all.
  const [phone, setPhone] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('tataAce');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [drivingLicenseNumber, setDrivingLicenseNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!agreeTerms || !agreePrivacy) {
      setError('Please accept the Terms and Privacy Policy');
      return;
    }
    setLoading(true);
    try {
      await register({
        fullName,
        email: email || undefined,
        phone,
        password,
        confirmPassword,
        verificationToken,
        vehicleType,
        vehicleNumber,
        drivingLicenseNumber,
        acceptTermsAndConditions: true,
        acceptPrivacyPolicy: true,
      });
      router.replace('/(app)/(tabs)/dashboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Registration failed. Please try again.');
      // Verification tokens are short-lived; if one lapsed, send them back to re-verify
      // rather than leaving them on a form that can never submit.
      if (e instanceof ApiError && e.code === 'PHONE_NOT_VERIFIED') {
        setVerificationToken('');
        setStep(1);
      }
    } finally {
      setLoading(false);
    }
  }

  // Step 0: prove the phone before collecting anything else.
  if (!verificationToken) {
    return (
      <Screen>
        <AppBar back brand />
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.body}>
            <PhoneVerify
              onVerified={(verifiedPhone, token) => {
                setPhone(verifiedPhone);
                setVerificationToken(token);
              }}
            />
            <Link href="/(auth)/login" style={styles.link}>
              <AppText variant="bodySm" color="primary">
                Already have an account? Login here
              </AppText>
            </Link>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  const canContinue =
    step === 1
      ? Boolean(fullName.trim())
      : step === 2
        ? Boolean(vehicleNumber.trim() && drivingLicenseNumber.trim())
        : Boolean(password && confirmPassword);

  return (
    <Screen>
      <AppBar back brand step={{ current: step, total: 3 }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body}>
          <Stepper steps={STEPS} current={step} />

          {step === 1 ? (
            <>
              <Heading title="Join TruckGo" subtitle="Start your driver profile. High reliability, industrial precision." />
              <Card style={styles.card}>
                <TextField
                  label="Full Name"
                  icon="person"
                  placeholder="Your full name"
                  value={fullName}
                  onChangeText={setFullName}
                />
                <TextField label="Phone Number" icon="phone" readOnlyValue={phone} />
                <TextField
                  label="Email Address (Optional)"
                  icon="mail"
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                />
              </Card>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Heading title="Vehicle Details" subtitle="Tell us what you drive." />
              <Card style={styles.card}>
                <SectionLabel>Vehicle details</SectionLabel>
                <View style={styles.chips}>
                  {VEHICLE_TYPES.map((v) => (
                    <Chip
                      key={v}
                      label={VEHICLE_LABEL[v]}
                      icon="local-shipping"
                      selected={vehicleType === v}
                      onPress={() => setVehicleType(v)}
                    />
                  ))}
                </View>
                <TextField
                  label="Vehicle Number"
                  placeholder="MH12AB1234"
                  mono
                  autoCapitalize="characters"
                  value={vehicleNumber}
                  onChangeText={setVehicleNumber}
                />
                {/* Not in the reference, but the server requires a 15-character licence and
                    the column is non-nullable — without it every registration 400s. */}
                <TextField
                  label="Driving Licence Number"
                  placeholder="KL0120110012345"
                  mono
                  autoCapitalize="characters"
                  value={drivingLicenseNumber}
                  onChangeText={setDrivingLicenseNumber}
                />
              </Card>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Heading title="Account Setup" subtitle="Set up your password to finish." />
              <Card style={styles.card}>
                <SectionLabel>Security</SectionLabel>
                <TextField
                  label="Password"
                  placeholder="At least 8 characters"
                  secureToggle
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
              </Card>

              <View style={styles.terms}>
                <CheckboxRow checked={agreeTerms} onToggle={() => setAgreeTerms((v) => !v)}>
                  <AppText style={DisplayType.bodyUi}>I agree to the Terms of Service.</AppText>
                </CheckboxRow>
                <CheckboxRow checked={agreePrivacy} onToggle={() => setAgreePrivacy((v) => !v)}>
                  <AppText style={DisplayType.bodyUi}>I agree to the Privacy Policy.</AppText>
                </CheckboxRow>
              </View>
            </>
          ) : null}

          {error ? (
            <Card tone="danger">
              <AppText color="error" style={DisplayType.bodyUi}>
                {error}
              </AppText>
            </Card>
          ) : null}
        </ScrollView>

        <StickyBar>
          {step > 1 ? (
            <Button
              label="Back"
              variant="outlineNavy"
              size="lg"
              style={styles.back}
              onPress={() => {
                setError('');
                setStep((s) => s - 1);
              }}
            />
          ) : null}
          {step < 3 ? (
            <Button
              label="Continue"
              variant="orange"
              size="lg"
              icon="arrow-forward"
              style={styles.next}
              disabled={!canContinue}
              onPress={() => {
                setError('');
                setStep((s) => s + 1);
              }}
            />
          ) : (
            <Button
              label="Complete Registration"
              variant="orange"
              size="lg"
              icon="check-circle"
              style={styles.next}
              loading={loading}
              disabled={!canContinue}
              onPress={onSubmit}
            />
          )}
        </StickyBar>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.heading}>
      <AppText style={DisplayType.screenTitle}>{title}</AppText>
      <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
        {subtitle}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: Spacing.containerMargin, gap: Spacing.lg, paddingBottom: Spacing.xl },
  heading: { gap: Spacing.xs },
  card: { gap: Spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  terms: { gap: Spacing.gutter },
  link: { textAlign: 'center', marginTop: Spacing.sm },
  back: { flex: 1 },
  next: { flex: 1.6 },
});
