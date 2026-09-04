import { useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

// Confirmed copy, reference/UI-COPY-user.md (title (9 strings) group).
export default function EditProfile() {
  const { user, refreshUser } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function onSave() {
    setSaving(true);
    setError('');
    try {
      await apiFetch('/drivers/me', { method: 'PATCH', body: { fullName, email: email || undefined } });
      await refreshUser();
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your changes.');
      setSaving(false);
    }
  }

  return (
    <Screen>
      <AppBar back title="Edit Profile" />
      <ScrollView contentContainerStyle={styles.container}>
        <TextField
          label="Full Name"
          icon="person"
          placeholder="Your name"
          value={fullName}
          onChangeText={setFullName}
        />
        <TextField
          label="Email"
          icon="mail"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextField
          label="Phone"
          readOnlyValue={user?.phone ?? '—'}
          helper="Contact support to change your phone number."
        />

        {error ? (
          <AppText variant="bodySm" color="error">
            {error}
          </AppText>
        ) : null}

        <Button
          label="Save Changes"
          variant="primary"
          size="lg"
          icon="check"
          onPress={onSave}
          loading={saving}
          disabled={!fullName.trim()}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.containerMargin, gap: Spacing.md },
});
