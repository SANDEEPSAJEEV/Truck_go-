import { useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

// Confirmed copy, reference/UI-COPY-user.md (title/noChanges group).
export default function EditProfile() {
  const { user, refreshUser } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [companyName, setCompanyName] = useState(user?.companyName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function onSave() {
    setSaving(true);
    setError('');
    try {
      await apiFetch('/users/me', {
        method: 'PATCH',
        body: { fullName, companyName: companyName || undefined, email: email || undefined },
      });
      await refreshUser();
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your changes.');
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <AppText variant="headlineLg">Edit Profile</AppText>

        <TextField label="Full Name" placeholder="Your name" value={fullName} onChangeText={setFullName} />
        <TextField label="Company Name" placeholder="Optional" value={companyName} onChangeText={setCompanyName} />
        <TextField
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextField label="Phone" value={user?.phone} editable={false} />
        <AppText variant="bodySm" color="onSurfaceVariant" style={styles.hint}>
          Contact support to change your phone number.
        </AppText>

        {error ? (
          <AppText variant="bodySm" color="error">
            {error}
          </AppText>
        ) : null}

        <Button label="Save Changes" onPress={onSave} loading={saving} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.md },
  hint: { marginTop: -Spacing.sm },
});
