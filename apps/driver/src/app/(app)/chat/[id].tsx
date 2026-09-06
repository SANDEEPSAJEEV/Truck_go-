import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { EmptyState } from '@/components/ui/empty-state';
import { KeyboardScreen } from '@/components/keyboard-screen';
import { DisplayType } from '@/constants/display';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getSocket, subscribeToTrip } from '@/lib/socket';
import { timeAgo } from '@/lib/time-ago';

type Message = {
  id: string;
  bookingId: string;
  senderId: string;
  text: string;
  createdAt: string;
};

/**
 * Trip chat.
 *
 * The endpoints and the socket relay have existed since the backend was built; nothing in
 * either app ever called them. "Which gate?", "I'm at the second warehouse", "running twenty
 * minutes late" — without this the only channel is a phone call, and neither side has the
 * other's number by design.
 */
export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<FlatList<Message> | null>(null);

  const load = useCallback(() => {
    apiFetch<{ messages: Message[] }>(`/trips/${id}/messages`)
      .then((d) => {
        setMessages(d.messages);
        setError('');
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load messages.'));
  }, [id]);

  useEffect(load, [load]);

  // Live delivery. The REST list is the source of truth on open; this keeps it current while
  // the screen is up, so a reply arrives without the driver pulling to refresh.
  useEffect(() => {
    let cleanup = () => {};
    getSocket().then((socket) => {
      const leaveTrip = subscribeToTrip(socket, id);
      const onMessage = (msg: Message) => {
        if (msg?.bookingId !== id) return;
        setMessages((current) => {
          if (!current) return [msg];
          // The sender gets its own message back from the room as well as from the POST
          // response — de-duplicate on id rather than showing it twice.
          if (current.some((m) => m.id === msg.id)) return current;
          return [...current, msg];
        });
      };
      socket.on('chat:message', onMessage);
      cleanup = () => {
        socket.off('chat:message', onMessage);
        leaveTrip();
      };
    });
    return () => cleanup();
  }, [id]);

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setError('');
    try {
      const d = await apiFetch<{ message: Message }>(`/trips/${id}/messages`, {
        method: 'POST',
        body: { text },
      });
      setDraft('');
      setMessages((current) =>
        current?.some((m) => m.id === d.message.id) ? current : [...(current ?? []), d.message],
      );
    } catch (e) {
      // Deliberately keeps the draft — retyping a message the app lost is worse than the
      // failure itself.
      setError(e instanceof ApiError ? e.message : 'Could not send that message.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen>
      <AppBar back title="Message customer" />

      {messages === null && error ? (
        // A failed load left `messages` null, so the spinner below ran forever and the error
        // was only ever rendered inside the composer — which does not exist yet at that
        // point. The driver saw a screen that never finished loading and never said why.
        <View style={styles.centered}>
          <AppText variant="bodyLg" color="error" style={styles.centredText}>
            {error}
          </AppText>
          <Button label="Retry" variant="outline" onPress={load} />
        </View>
      ) : messages === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <KeyboardScreen
          contentContainerStyle={styles.body}
          footer={
            <View style={styles.composer}>
              {error ? (
                <AppText variant="bodySm" color="error">
                  {error}
                </AppText>
              ) : null}
              <View style={styles.composerRow}>
                <View style={styles.flex}>
                  <TextField
                    placeholder="Message the customer"
                    value={draft}
                    onChangeText={setDraft}
                    multiline
                    maxLength={2000}
                  />
                </View>
                <Button
                  label="Send"
                  onPress={send}
                  loading={sending}
                  disabled={!draft.trim()}
                />
              </View>
            </View>
          }
        >
          {messages.length === 0 ? (
            <EmptyState icon="chat-bubble-outline" message="No messages yet. Say hello, or ask where to park." />
          ) : (
            messages.map((m) => {
              const mine = m.senderId === user?.id;
              return (
                <View key={m.id} style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
                  <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                    <AppText style={DisplayType.bodyUi} color={mine ? 'onPrimary' : 'onSurface'}>
                      {m.text}
                    </AppText>
                    <AppText variant="bodySm" color={mine ? 'onPrimary' : 'onSurfaceVariant'}>
                      {timeAgo(m.createdAt)}
                    </AppText>
                  </View>
                </View>
              );
            })
          )}
        </KeyboardScreen>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.lg },
  centredText: { textAlign: 'center' },
  body: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xl },
  flex: { flex: 1 },
  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: Radii.lg, padding: Spacing.md, gap: 2 },
  mine: { backgroundColor: Colors.primary, borderBottomRightRadius: Radii.sm },
  theirs: { backgroundColor: Colors.surfaceContainer, borderBottomLeftRadius: Radii.sm },
  composer: {
    gap: Spacing.xs,
    padding: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surface,
  },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
});
