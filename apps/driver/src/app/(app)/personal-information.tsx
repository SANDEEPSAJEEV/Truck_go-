import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ListGroup, ListRow } from '@/components/ui/list-row';
import { SectionLabel } from '@/components/ui/section-label';
import { Brand, DisplayType } from '@/constants/display';
import { Colors, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { vehicleLabel } from '@/lib/vehicle';
import { VERIFICATION_BADGE } from '@/lib/verification-badge';

/** Read-only identity summary. Editing lives one tap away in Edit Profile. */
export default function PersonalInformation() {
  const { user, logout } = useAuth();
  const profile = user?.driverProfile;
  const status = profile?.verificationStatus ?? 'PENDING';
  const badge = VERIFICATION_BADGE[status];
  const approved = status === 'APPROVED';

  return (
    <Screen>
      <AppBar back brand />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.identity}>
          <Avatar name={user?.fullName} size={116} />
          <AppText style={DisplayType.sectionTitle}>{user?.fullName}</AppText>
          <Badge label={badge.label} tone={badge.tone} />
        </View>

        <Button
          label="Edit Profile"
          variant="outlineNavy"
          size="lg"
          icon="edit"
          iconPosition="left"
          onPress={() => router.push('/(app)/edit-profile')}
        />

        {!approved ? (
          <Card tone="info" style={styles.kyc}>
            <MaterialIcons name="hourglass-empty" size={22} color={Brand.orangeInk} />
            <View style={styles.kycText}>
              <AppText style={DisplayType.rowLabel}>KYC {badge.label}</AppText>
              <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
                {profile?.rejectionReason ??
                  "Your documents are under review. We'll notify you once verification is complete."}
              </AppText>
            </View>
          </Card>
        ) : null}

        <View>
          <SectionLabel>Contact Information</SectionLabel>
          <ListGroup>
            <ListRow
              icon="mail"
              label="Email Address"
              subtitle={user?.email ?? 'Not provided'}
              subtitleMono={Boolean(user?.email)}
              chevron={false}
            />
            <ListRow
              icon="phone"
              label="Phone Number"
              subtitle={user?.phone ?? '—'}
              subtitleMono
              chevron={false}
            />
          </ListGroup>
        </View>

        <View>
          <SectionLabel>Identity</SectionLabel>
          <ListGroup>
            <ListRow
              icon="badge"
              label="Driving License Number"
              subtitle={profile?.drivingLicenseNumber ?? 'Not provided'}
              subtitleMono={Boolean(profile?.drivingLicenseNumber)}
              chevron={false}
            />
            <ListRow
              icon="local-shipping"
              label="Vehicle"
              subtitle={`${vehicleLabel(profile?.vehicleType)} · ${profile?.vehicleNumber ?? '—'}`}
              subtitleMono
              chevron={false}
            />
          </ListGroup>
        </View>

        <ListGroup>
          <ListRow
            icon="account-balance"
            label="Bank Account & Payouts"
            onPress={() => router.push('/(app)/bank-details')}
          />
        </ListGroup>

        <Button
          label="Sign Out"
          variant="danger"
          size="lg"
          icon="logout"
          iconPosition="left"
          onPress={logout}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xl },
  identity: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  kyc: { flexDirection: 'row', gap: Spacing.gutter, backgroundColor: Colors.surfaceContainer },
  kycText: { flex: 1, gap: 2 },
});
