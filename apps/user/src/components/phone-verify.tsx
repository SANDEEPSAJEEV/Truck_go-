import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';

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
    try {
      await apiFetch('/auth/request-otp', { method: 'POST', body: { phone }, auth: false });
      setSent(true);
      startCooldown();
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
});
