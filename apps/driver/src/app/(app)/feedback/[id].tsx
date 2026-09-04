import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { Colors, Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';

// Confirmed copy, reference/UI-COPY-user.md (shipmentId group: howWasCustomer).
export default function Feedback() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<{ booking: { userId: string } }>(`/bookings/${id}`)
      .then((d) => setCustomerId(d.booking.userId))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this trip."));
  }, [id]);

  async function onSubmit() {
    if (!customerId) return;
    if (stars === 0) {
      setError('Please tap a star rating first.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await apiFetch('/ratings', { method: 'POST', body: { bookingId: id, toUserId: customerId, stars, comment } });
      router.replace('/(app)/(tabs)/dashboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not submit your rating. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.container}>
        <AppText variant="headlineLg" align="center">
          Share Your Experience
        </AppText>
        <AppText variant="bodyLg" color="onSurfaceVariant" align="center">
          How was your customer?
        </AppText>

        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setStars(n)}>
              <MaterialIcons name={n <= stars ? 'star' : 'star-border'} size={36} color={Colors.primary} />
            </Pressable>
          ))}
        </View>
        <AppText variant="labelCaps" color="onSurfaceVariant" align="center" uppercase>
          Tap to rate
        </AppText>

        <TextField
          label="Additional Comments (Optional)"
          placeholder="Share your experience with us…"
          value={comment}
          onChangeText={setComment}
          multiline
        />

        {error ? (
          <AppText variant="bodySm" color="error" align="center">
            {error}
          </AppText>
        ) : null}

        <Button label="Submit Feedback" onPress={onSubmit} loading={submitting} disabled={!customerId} />
        <Button label="Not now" variant="ghost" onPress={() => router.replace('/(app)/(tabs)/dashboard')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: Spacing.lg, gap: Spacing.lg },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm },
});
