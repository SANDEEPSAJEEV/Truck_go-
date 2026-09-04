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

  return <Redirect href={user ? '/(app)/booking' : '/(auth)/login'} />;
}
