import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { DisplayType } from '@/constants/display';
import { Colors, Spacing } from '@/constants/theme';
import { getLanguage, LANGUAGES, setLanguage, type LanguageCode } from '@/lib/language';

// Confirmed copy, reference/UI-COPY-driver.md (Language group).
export default function Language() {
  const [selected, setSelected] = useState<LanguageCode>('en');

  useEffect(() => {
    getLanguage().then(setSelected);
  }, []);

  async function choose(code: LanguageCode) {
    setSelected(code);
    await setLanguage(code);
  }

  return (
    <Screen>
      <AppBar back title="Language" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.intro}>
          <AppText style={DisplayType.screenTitle}>Choose your language</AppText>
          <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
            Applies across the whole app.
          </AppText>
        </View>

        <Card padded={false}>
          {LANGUAGES.map((lang) => (
            <Pressable
              key={lang.code}
              onPress={() => choose(lang.code)}
              accessibilityRole="radio"
              accessibilityState={{ selected: selected === lang.code }}
              style={styles.row}>
              <AppText style={DisplayType.rowLabel}>{lang.label}</AppText>
              {selected === lang.code ? (
                <MaterialIcons name="check" size={22} color={Colors.primary} />
              ) : null}
            </Pressable>
          ))}
        </Card>

        {/* Say the true thing. A settings screen listing one option looks broken unless it
            explains itself, and listing languages that don't work would be worse. */}
        <AppText color="onSurfaceVariant" style={DisplayType.bodyUi}>
          More languages are coming. English is the only language available in this version.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.containerMargin, gap: Spacing.md },
  intro: { gap: Spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.cardPadding,
    paddingVertical: 16,
  },
});
