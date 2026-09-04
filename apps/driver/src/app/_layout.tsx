import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';

import { AuthProvider } from '@/lib/auth-context';
import { warmUp } from '@/lib/api';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // FontFamily.black (Inter_900Black) is deliberately not registered — nothing references
  // it, and every font here is one more thing that can fail on a cold start.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // Backs FontFamily.extrabold — the landing hero and the TruckGo wordmark.
    Inter_800ExtraBold,
    // Backs FontFamily.mono / the `dataMono` variant — used for fares, references and IDs.
    // Never registered here before, so every mono-styled figure silently fell back to the
    // system font on every platform, not just this web preview.
    JetBrainsMono_500Medium,
  });

  // Render on failure as well as success. If a font never resolves, `fontsLoaded` stays
  // false forever, the splash is never hidden, and the app looks — from the outside —
  // exactly like a launch crash. A missing typeface should degrade to a fallback face,
  // never to a dead splash screen.
  const ready = fontsLoaded || Boolean(fontError);

  // Fired as early as possible, so the server is already waking while the driver is still
  // reading the first screen.
  useEffect(() => {
    warmUp();
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* The landing screen is orange and every in-app surface is light, so the status bar
          content stays dark regardless of the OS theme. */}
      <StatusBar style="dark" />
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </AuthProvider>
    </ThemeProvider>
  );
}
