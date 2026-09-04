import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { Colors, Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/time-ago';

type Notification = { id: string; title: string; body: string; isRead: boolean; createdAt: string };

// Confirmed copy, reference/UI-COPY-user.md (title (8 strings) group) — driver's
// notifications screen has its own "allCaughtUp"/"No notifications right now." strings.
export default function Notifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch<{ notifications: Notification[] }>('/notifications')
      .then((d) => {
        setItems(d.notifications);
        setError('');
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load notifications.'));
  }, []);

  useFocusEffect(load);

  async function markAllRead() {
    setItems((list) => list.map((n) => ({ ...n, isRead: true })));
    await apiFetch('/notifications/read-all', { method: 'PATCH' }).catch(() => {});
  }

  async function markRead(id: string) {
    setItems((list) => list.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }).catch(() => {});
  }

  return (
    <Screen>
      <AppBar back title="Notifications" />
      <View style={styles.header}>
        {items.some((n) => !n.isRead) ? (
          <Pressable onPress={markAllRead}>
            <AppText variant="headlineSm" color="primary">
              Mark all read
            </AppText>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        contentContainerStyle={styles.list}
        data={items}
        keyExtractor={(n) => n.id}
        ListEmptyComponent={
          error ? (
            <View style={styles.empty}>
              <AppText variant="bodyMd" color="error" align="center">
                {error}
              </AppText>
              <Pressable onPress={load} style={styles.retry}>
                <AppText variant="headlineSm" color="primary" align="center">
                  Retry
                </AppText>
              </Pressable>
            </View>
          ) : (
            <AppText variant="bodyLg" color="onSurfaceVariant" align="center" style={styles.empty}>
              No notifications right now.
            </AppText>
          )
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => markRead(item.id)} style={styles.row}>
            {!item.isRead ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
            <View style={{ flex: 1 }}>
              <View style={styles.rowHeader}>
                <AppText variant="headlineSm" style={{ flex: 1 }}>
                  {item.title}
                </AppText>
                <AppText variant="bodySm" color="onSurfaceVariant">
                  {timeAgo(item.createdAt)}
                </AppText>
              </View>
              <AppText variant="bodyMd" color="onSurfaceVariant">
                {item.body}
              </AppText>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Right-aligned on its own row now that the title lives in the app bar.
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  list: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  empty: { marginTop: Spacing.xxl, gap: Spacing.sm },
  retry: { paddingVertical: Spacing.sm },
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.outlineVariant,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 6 },
  dotSpacer: { width: 8 },
});
