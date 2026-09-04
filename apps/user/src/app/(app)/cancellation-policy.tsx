import { ScrollView, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { Spacing } from '@/constants/theme';

// General policy text. The original also computes a live per-trip countdown via
// GET /trips/:id/cancellation-policy (secondsRemaining / windowEndsAt) — our backend
// implements that endpoint, but the tracking screen doesn't surface the countdown yet.
// See reference/UNKNOWNS-AND-ASSUMPTIONS.md #2 for what's confirmed vs. assumed.
export default function CancellationPolicy() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <AppText variant="headlineLg">Cancellation policy</AppText>
        <AppText variant="bodyLg" color="onSurfaceVariant">
          You can cancel a booking for free within a short window after it's created. Once that window
          closes, cancelling may no longer be free — check the trip's own cancellation screen for the exact
          time remaining.{'\n\n'}
          If the window has already closed, you can reach out to support instead of cancelling.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.md },
});
