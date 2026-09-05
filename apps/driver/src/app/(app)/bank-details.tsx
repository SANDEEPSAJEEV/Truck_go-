import { useEffect, useState } from 'react';
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

// Confirmed copy and field names, reference/UI-COPY-user.md (title (12 strings) group) /
// decompiled_driver.js:422407+ (accountHolderName / bankAccountNumber / ifscCode).
export default function BankDetails() {
  const [accountHolderName, setAccountHolderName] = useState('');
  // Left empty on load, deliberately. The server returns the account number masked, and
  // putting that mask in an editable field means a driver correcting a typo in their name
  // would save "••••••9012" back as their account number.
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [savedAccountMask, setSavedAccountMask] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    setLoadError('');
    apiFetch<{
      accountHolderName: string | null;
      bankAccountNumber: string | null;
      hasBankAccountNumber?: boolean;
      ifscCode: string | null;
    }>('/drivers/bank-details')
      .then((d) => {
        setAccountHolderName(d.accountHolderName ?? '');
        setSavedAccountMask(d.hasBankAccountNumber === false ? '' : (d.bankAccountNumber ?? ''));
        setBankAccountNumber('');
        setIfscCode(d.ifscCode ?? '');
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Could not load your bank details.'));
  }

  useEffect(load, []);

  // Nothing saved on file and nothing typed means there is no account to pay into — and the
  // fields used to accept empty strings all the way through to the database, quietly wiping
  // whatever was there.
  const needsAccountNumber = !savedAccountMask && !bankAccountNumber.trim();
  const canSave = Boolean(accountHolderName.trim()) && Boolean(ifscCode.trim()) && !needsAccountNumber;

  async function onSave() {
    setSaving(true);
    setSaveError('');
    try {
      await apiFetch('/drivers/bank-details', {
        method: 'PUT',
        body: {
          accountHolderName: accountHolderName.trim(),
          ifscCode: ifscCode.trim().toUpperCase(),
          // Omitted entirely when untouched, which the server reads as "leave it as it is".
          ...(bankAccountNumber.trim() ? { bankAccountNumber: bankAccountNumber.trim() } : {}),
        },
      });
      router.back();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Could not save your bank details.');
      setSaving(false);
    }
  }

  return (
    <Screen>
      <AppBar back title="Bank Details" />
      <KeyboardScreen contentContainerStyle={styles.container}>
        <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
          Update the account where your payouts are deposited. For security your saved account
          number is only ever shown masked — leave the field blank to keep it as it is.
        </AppText>

        {loadError ? (
          <>
            <AppText variant="bodySm" color="error">
              {loadError}
            </AppText>
            <Button label="Retry" variant="outline" onPress={load} />
          </>
        ) : null}

        <TextField
          label="Account Holder Name"
          icon="person"
          placeholder="As per bank records"
          value={accountHolderName}
          onChangeText={setAccountHolderName}
        />
        <TextField
          label="Account Number"
          icon="account-balance"
          placeholder={savedAccountMask || 'Bank account number'}
          mono
          value={bankAccountNumber}
          onChangeText={setBankAccountNumber}
          keyboardType="number-pad"
          helper={
            savedAccountMask
              ? `Currently ${savedAccountMask}. Type a new number only if you're changing it.`
              : undefined
          }
        />
        <TextField
          label="IFSC Code"
          icon="tag"
          placeholder="ABCD0123456"
          mono
          autoCapitalize="characters"
          value={ifscCode}
          onChangeText={setIfscCode}
        />

        {saveError ? (
          <AppText variant="bodySm" color="error">
            {saveError}
          </AppText>
        ) : null}

        <Button
          label="Save Bank Details"
          variant="primary"
          size="lg"
          icon="check"
          onPress={onSave}
          loading={saving}
          disabled={!canSave}
        />
      </KeyboardScreen>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.containerMargin, gap: Spacing.md },
});
