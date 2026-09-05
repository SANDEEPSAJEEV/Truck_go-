import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { Radii, Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { normalizePhone } from '@/lib/phone';

const RESEND_SECONDS = 60;

type Props = {
  /** Called once the server confirms the code, with the token registration must present. */
  onVerified: (phone: string, verificationToken: string) => void;
};

/**
 * Phone ownership check that runs before an account can be created. The server issues a
 * short-lived token on success; registration refuses without it, so a phone number can no
 * longer be claimed by simply typing it into the form.
 */
export function PhoneVerify({ onVerified }: Props) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  // Present only while real SMS isn't wired up yet (DLT registration pending) — the
  // backend omits this field entirely once a real provider is configured, so there is
  // nothing to remove here when that day comes.
  const [devCode, setDevCode] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function startCooldown() {
    setCooldown(RESEND_SECONDS);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1 && timer.current) clearInterval(timer.current);
        return s - 1;
      });
    }, 1000);
  }

  async function sendCode() {
    setError('');
    setBusy(true);
    // The field's own placeholder shows "+91 98765 43210" — spaced, the way a person
    // actually reads a number and the way one arrives pasted from Contacts. The backend
    // rejects that exact shape. Normalizing here, once, before it's sent anywhere, means
    // every screen that reuses this component gets the fix for free.
    const normalized = normalizePhone(phone);
    try {
      const data = await apiFetch<{ devCode?: string }>('/auth/request-otp', {
        method: 'POST',
        body: { phone: normalized },
        auth: false,
      });
      setPhone(normalized);
      setSent(true);
      startCooldown();
      // Real SMS isn't live yet — auto-fill so there's nothing to go looking for.
      if (data.devCode) {
        setDevCode(data.devCode);
        setCode(data.devCode);
      } else {
        setDevCode(null);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    setError('');
    setBusy(true);
    try {
      // `phone` is already normalized by sendCode() by the time this can run — the field
      // is read-only once `sent` is true, so the same value that was actually accepted by
      // request-otp is what gets sent here too.
      const data = await apiFetch<{ verificationToken: string }>('/auth/verify-otp', {
        method: 'POST',
        body: { phone, code },
        auth: false,
      });
      onVerified(phone, data.verificationToken);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not verify the code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <AppText variant="headlineLg">Verify your phone</AppText>
      <AppText variant="bodyLg" color="onSurfaceVariant">
        {sent
          ? `Enter the 6-digit code we sent to ${phone}.`
          : "We'll text you a code to confirm this number is yours."}
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
        <TextField
          label="Verification Code"
          placeholder="123456"
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={setCode}
          style={styles.code}
        />
      ) : null}

      {devCode ? (
        <View style={styles.devBanner}>
          <AppText variant="bodySm" color="onSecondaryContainer">
            Testing mode — real SMS isn&apos;t connected yet, so the code has been filled in for
            you. It was: {devCode}
          </AppText>
        </View>
      ) : null}

      {error ? (
        <AppText variant="bodySm" color="error">
          {error}
        </AppText>
      ) : null}

      {sent ? (
        <>
          <Button label="Verify" onPress={submitCode} loading={busy} disabled={code.length < 6} />
          <Button
            label={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            variant="ghost"
            onPress={sendCode}
            disabled={cooldown > 0 || busy}
          />
          <Button
            label="Change number"
            variant="ghost"
            onPress={() => {
              setSent(false);
              setCode('');
              setError('');
              setDevCode(null);
            }}
            disabled={busy}
          />
        </>
      ) : (
        <Button label="Send code" onPress={sendCode} loading={busy} disabled={phone.trim().length < 10} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.md },
  code: { letterSpacing: 8, textAlign: 'center' },
  devBanner: {
    borderRadius: Radii.lg,
    padding: Spacing.md,
    backgroundColor: 'rgba(237,137,54,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(237,137,54,0.5)',
  },
});
