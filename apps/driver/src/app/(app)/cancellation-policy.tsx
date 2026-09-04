import { ScrollView, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { DisplayType } from '@/constants/display';
import { Spacing } from '@/constants/theme';

// General policy text. The original also computes a live per-trip countdown via
// GET /trips/:id/cancellation-policy (secondsRemaining / windowEndsAt) — our backend
// implements that endpoint, but the tracking screen doesn't surface the countdown yet.
// See reference/UNKNOWNS-AND-ASSUMPTIONS.md #2 for what's confirmed vs. assumed.
export default function CancellationPolicy() {
  return (
    <Screen>
      <AppBar back title="Cancellation Policy" />
      <ScrollView contentContainerStyle={styles.container}>
        <Card tone="info">
          <AppText style={DisplayType.bodyUi}>
            You can cancel a booking for free within a short window after it&apos;s created.
          </AppText>
        </Card>

        <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
          Once that window closes, cancelling may no longer be free — check the trip&apos;s own
          cancellation screen for the exact time remaining.
        </AppText>
        <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
          If the window has already closed, you can reach out to support instead of cancelling.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.containerMargin, gap: Spacing.md },
});
