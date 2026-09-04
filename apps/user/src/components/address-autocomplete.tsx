import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { TextField } from '@/components/ui/text-field';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { getPlaceDetails, type GeoPoint } from '@/lib/geocode';

type Suggestion = {
  placeId: string | null;
  description: string;
  mainText: string;
  secondaryText: string;
};

type Props = {
  placeholder: string;
  /** Biases results toward the caller's current area, when known. */
  near?: { lat: number; lng: number } | null;
  onSelect: (point: GeoPoint) => void;
  autoFocus?: boolean;
};

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

/**
 * Live suggestions as you type, resolving to coordinates on selection — the
 * Uber/Google-Maps pattern, replacing the old "type then press Search" flow.
 *
 * Debounced rather than firing on every keystroke: at typing speed a live search would
 * both hammer the Places quota and show a new list every ~100ms, which reads as flicker
 * more than help.
 */
export function AddressAutocomplete({ placeholder, near, onSelect, autoFocus }: Props) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against a slow earlier request overwriting a faster later one — without this,
  // typing "Ko" then quickly "Koch" can show results for "Ko" arriving after "Koch"'s.
  const requestSeq = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < MIN_CHARS) {
      setSuggestions([]);
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const seq = ++requestSeq.current;
      const params = new URLSearchParams({ q: trimmed });
      if (near) {
        params.set('lat', String(near.lat));
        params.set('lng', String(near.lng));
      }

      apiFetch<{ suggestions: Suggestion[] }>(`/places/autocomplete?${params.toString()}`)
        .then((d) => {
          if (seq !== requestSeq.current) return; // a newer keystroke already superseded this
          setSuggestions(d.suggestions);
          setError('');
        })
        .catch((e) => {
          if (seq !== requestSeq.current) return;
          setError(e instanceof ApiError ? e.message : 'Could not search right now.');
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, near]);

  async function selectSuggestion(s: Suggestion) {
    setResolvingId(s.placeId ?? s.description);
    setError('');
    try {
      const point = await getPlaceDetails(s.placeId, s.description);
      onSelect(point);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't resolve that address.");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <View style={{ gap: Spacing.xs }}>
      <TextField
        placeholder={placeholder}
        value={query}
        onChangeText={setQuery}
        autoFocus={autoFocus}
        autoCorrect={false}
      />

      {error ? (
        <AppText variant="bodySm" color="error">
          {error}
        </AppText>
      ) : null}

      {loading ? (
        <View style={{ paddingVertical: Spacing.sm, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={Colors.primary} />
        </View>
      ) : suggestions.length > 0 ? (
        <FlatList
          data={suggestions}
          keyExtractor={(s, i) => s.placeId ?? `${i}-${s.description}`}
          keyboardShouldPersistTaps="handled"
          style={{ maxHeight: 280 }}
          renderItem={({ item }) => {
            const busy = resolvingId === (item.placeId ?? item.description);
            return (
              <Pressable
                onPress={() => selectSuggestion(item)}
                disabled={resolvingId !== null}
                style={({ pressed }) => [
                  {
                    paddingVertical: Spacing.sm,
                    paddingHorizontal: Spacing.xs,
                    borderRadius: Radii.sm,
                    backgroundColor: pressed ? Colors.surfaceContainer : 'transparent',
                    opacity: busy ? 0.5 : 1,
                  },
                ]}
              >
                <AppText variant="bodyLg" numberOfLines={1}>
                  {item.mainText || item.description}
                </AppText>
                {item.secondaryText ? (
                  <AppText variant="bodySm" color="onSurfaceVariant" numberOfLines={1}>
                    {item.secondaryText}
                  </AppText>
                ) : null}
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: Colors.outlineVariant }} />
          )}
        />
      ) : query.trim().length >= MIN_CHARS ? (
        <AppText variant="bodySm" color="onSurfaceVariant" style={{ paddingVertical: Spacing.sm }}>
          No matches yet — keep typing or try a nearby landmark.
        </AppText>
      ) : null}
    </View>
  );
}
