import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListGroup, ListRow } from '@/components/ui/list-row';
import { SectionLabel } from '@/components/ui/section-label';
import { DisplayType } from '@/constants/display';
import { Colors, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getLanguage, languageLabel, type LanguageCode } from '@/lib/language';
import { VERIFICATION_BADGE } from '@/lib/verification-badge';

// Confirmed copy and menu structure, reference/UI-COPY-user.md (signOut (11 strings) group).
export default function ProfileAccount() {
  const { user, logout } = useAuth();
  const [language, setLanguageState] = useState<LanguageCode>('en');

  useFocusEffect(
    useCallback(() => {
      getLanguage().then(setLanguageState);
    }, []),
  );

  const status = user?.driverProfile?.verificationStatus ?? 'PENDING';
  const badge = VERIFICATION_BADGE[status];
  const approved = status === 'APPROVED';

  return (
    <Screen>
      <AppBar title="Profile" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Avatar name={user?.fullName} size={112} ring />
          <AppText style={[DisplayType.sectionTitle, styles.name]}>{user?.fullName}</AppText>
          <Badge label={badge.label} tone={badge.tone} />
          <AppText style={[DisplayType.fieldMono, styles.phone]}>{user?.phone}</AppText>
        </View>

        <View style={styles.body}>
          <View style={styles.section}>
            <SectionLabel>Account</SectionLabel>
            <ListGroup>
              <ListRow
                icon="person"
                label="Personal Information"
                onPress={() => router.push('/(app)/personal-information')}
              />
              <ListRow
                icon="account-balance"
                label="Bank Account & Payouts"
                onPress={() => router.push('/(app)/bank-details')}
              />
              <ListRow
                icon="lock"
                label="Security & Password"
                onPress={() => router.push('/(app)/change-password')}
              />
            </ListGroup>
          </View>

          <View style={styles.section}>
            <SectionLabel>Compliance</SectionLabel>
            <ListGroup>
              <ListRow
                icon="description"
                label="Documents & KYC"
                badge={approved ? undefined : { label: badge.label, tone: badge.tone }}
                onPress={() => router.push('/(app)/documents')}
              />
            </ListGroup>
          </View>

          <View style={styles.section}>
            <SectionLabel>Preferences</SectionLabel>
            <ListGroup>
              <ListRow
                icon="notifications"
                label="Notification Settings"
                onPress={() => router.push('/(app)/notification-settings')}
              />
              {/* The reference drops this, but it's a route the app already ships and a
                  driver needs when a customer disputes a cancellation. */}
              <ListRow
                icon="info"
                label="Cancellation Policy"
                onPress={() => router.push('/(app)/cancellation-policy')}
              />
            </ListGroup>
          </View>

          <View style={styles.section}>
            <SectionLabel>Language</SectionLabel>
            <ListGroup>
              <ListRow
                icon="language"
                iconTone="circle"
                label="Language"
                value={languageLabel(language)}
                onPress={() => router.push('/(app)/language')}
              />
            </ListGroup>
          </View>

          <Button label="Sign Out" variant="danger" size="lg" icon="logout" iconPosition="left" onPress={logout} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: Spacing.xl },
  hero: {
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.containerMargin,
  },
  name: { color: Colors.onPrimary },
  phone: { color: Colors.onPrimaryContainer },
  body: { padding: Spacing.containerMargin, gap: Spacing.lg },
  section: { gap: 0 },
});
