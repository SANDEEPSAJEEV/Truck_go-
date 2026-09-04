import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/ui/button';
import { Colors, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

// Confirmed copy, reference/UI-COPY-user.md (defaultName group).
export default function Profile() {
  const { user, logout } = useAuth();

  return (
    <Screen>
      <View style={styles.container}>
        <AppText variant="headlineLg">{user?.fullName ?? 'TruckGo User'}</AppText>
        <AppText variant="bodyLg" color="onSurfaceVariant" style={styles.meta}>
          {user?.phone}
        </AppText>

        <AppText variant="labelCaps" color="onSurfaceVariant" uppercase style={styles.sectionLabel}>
          Account
        </AppText>
        <MenuRow icon="person-outline" label="Personal Information" onPress={() => router.push('/(app)/edit-profile')} />
        <MenuRow icon="lock-outline" label="Change Password" onPress={() => router.push('/(app)/change-password')} />
        <MenuRow icon="notifications-none" label="Notifications" onPress={() => router.push('/(app)/notifications')} />
        <MenuRow
          icon="info-outline"
          label="Cancellation policy"
          onPress={() => router.push('/(app)/cancellation-policy')}
        />

        <Button label="Sign Out" variant="outline" onPress={logout} style={styles.signOut} />
      </View>
    </Screen>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <MaterialIcons name={icon} size={20} color={Colors.onSurfaceVariant} />
      <AppText variant="headlineSm" style={{ flex: 1 }}>
        {label}
      </AppText>
      <MaterialIcons name="chevron-right" size={20} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.lg },
  meta: { marginBottom: Spacing.lg },
  sectionLabel: { marginBottom: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.outlineVariant,
  },
  signOut: { marginTop: Spacing.xl },
});
