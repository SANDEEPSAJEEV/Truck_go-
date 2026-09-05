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
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    setLoadError('');
    apiFetch<{ accountHolderName: string | null; bankAccountNumber: string | null; ifscCode: string | null }>(
      '/drivers/bank-details',
    )
      .then((d) => {
        setAccountHolderName(d.accountHolderName ?? '');
        setBankAccountNumber(d.bankAccountNumber ?? '');
        setIfscCode(d.ifscCode ?? '');
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Could not load your bank details.'));
  }

  useEffect(load, []);

  async function onSave() {
    setSaving(true);
    setSaveError('');
    try {
      await apiFetch('/drivers/bank-details', {
        method: 'PUT',
        body: { accountHolderName, bankAccountNumber, ifscCode },
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
          Update the account where your payouts are deposited. For security, your saved account number
          is always shown masked.
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
          placeholder="Bank account number"
          mono
          value={bankAccountNumber}
          onChangeText={setBankAccountNumber}
          keyboardType="number-pad"
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
        />
      </KeyboardScreen>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.containerMargin, gap: Spacing.md },
});
