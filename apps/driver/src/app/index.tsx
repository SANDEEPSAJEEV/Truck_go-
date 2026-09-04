import { Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { Screen } from '@/components/screen';
import { useAuth } from '@/lib/auth-context';
import { Colors } from '@/constants/theme';

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.primary} />
      </Screen>
    );
  }

  // Signed-out drivers land on the pitch, not straight on a login form — this is the
  // recruiting surface, and most first-time visitors don't have an account yet.
  return <Redirect href={user ? '/(app)/(tabs)/dashboard' : '/(auth)/welcome'} />;
}
