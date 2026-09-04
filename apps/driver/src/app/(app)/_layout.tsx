import { useEffect } from 'react';
import { Redirect, router, Stack } from 'expo-router';
import { View } from 'react-native';

import { LoadAlertHost } from '@/components/load-alert-host';
import { useAuth } from '@/lib/auth-context';
import { addNotificationTapListener, registerForPush } from '@/lib/push';

/**
 * Authenticated area. A Stack, with the tab bar living one level down in `(tabs)`.
 *
 * Everything used to be a Tabs.Screen — the detail screens were registered with
 * `href: null` to hide them from the bar, which kept the bar rendered *on* them. Settings
 * sub-pages showing a tab bar is the tell of exactly that shortcut, so the detail screens
 * are now real stack screens and push over the tabs.
 */
export default function AppLayout() {
  const { user, loading } = useAuth();
  const signedIn = Boolean(user);

  // Claim a push token once the driver is actually signed in — the token is stored against
  // their account, so registering before we know who they are would file it under nobody.
  useEffect(() => {
    if (!signedIn) return;
    void registerForPush();
  }, [signedIn]);

  // A tapped notification should land on the work it's about, not just open the app.
  useEffect(() => {
    if (!signedIn) return;

    return addNotificationTapListener(({ type, bookingId }) => {
      if (!bookingId) return;
      // A load offer is still open work — the dashboard is where it can be bid on. Anything
      // else that carries a booking id refers to a trip already assigned.
      router.push(type === 'LOAD_NEW' ? '/(app)/(tabs)/dashboard' : `/(app)/trip/${bookingId}`);
    });
  }, [signedIn]);

  if (loading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      {/* Above the navigator, so an offer reaches the driver on whichever screen they're
          looking at rather than only on the dashboard. */}
      <LoadAlertHost />
    </View>
  );
}
