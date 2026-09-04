import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Language preference.
 *
 * The app is English-only today: there is no i18n library, no message catalogues, and
 * every string is a hardcoded literal. This stores a real, persisted choice so the
 * preference survives and the plumbing exists — but it deliberately advertises only the
 * language that actually works. Listing Malayalam or Hindi here would put a control in
 * front of a driver that silently does nothing.
 */
export const LANGUAGES = [{ code: 'en', label: 'English' }] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

const KEY = 'truckgo.language';

export async function getLanguage(): Promise<LanguageCode> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored && LANGUAGES.some((l) => l.code === stored)) return stored as LanguageCode;
  } catch {
    // A missing preference is not an error — fall through to the default.
  }
  return 'en';
}

export async function setLanguage(code: LanguageCode): Promise<void> {
  await AsyncStorage.setItem(KEY, code);
}

export function languageLabel(code: LanguageCode): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? 'English';
}
