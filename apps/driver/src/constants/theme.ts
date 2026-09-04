/**
 * TruckGo driver app design tokens.
 *
 * Read verbatim from the original's decompiled bundle
 * (`reference/decompiled/decompiled_user.js:395195-395360`, which ships both themes) —
 * see `reference/DESIGN-SYSTEM.md`. Do not "improve" these; they match the shipped app.
 *
 * Light-mode only, as in the original. The driver theme is deliberately denser than the
 * user theme (smaller gutter / containerMargin / cardPadding) and uses neutral shadows.
 */

import { Platform } from 'react-native';

export const Colors = {
  primary: '#002045',
  onPrimary: '#ffffff',
  primaryContainer: '#1a365d',
  onPrimaryContainer: '#86a0cd',
  inversePrimary: '#adc7f7',

  secondary: '#944b00',
  onSecondary: '#ffffff',
  secondaryContainer: '#ED8936',
  onSecondaryContainer: '#6b3500',

  tertiary: '#00213e',
  onTertiary: '#ffffff',
  tertiaryContainer: '#003762',
  onTertiaryContainer: '#58a2f0',

  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',

  background: '#f9f9ff',
  onBackground: '#121c2c',
  surface: '#f9f9ff',
  onSurface: '#121c2c',
  surfaceDim: '#d0daf0',
  surfaceBright: '#f9f9ff',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#f0f3ff',
  surfaceContainer: '#e7eeff',
  surfaceContainerHigh: '#dee8ff',
  surfaceContainerHighest: '#d9e3f9',
  surfaceVariant: '#d9e3f9',
  onSurfaceVariant: '#43474e',
  inverseSurface: '#273141',
  inverseOnSurface: '#ebf1ff',

  outline: '#74777f',
  outlineVariant: '#c4c6cf',
  surfaceTint: '#455f88',

  primaryFixed: '#d6e3ff',
  primaryFixedDim: '#adc7f7',
  onPrimaryFixed: '#001b3c',
  onPrimaryFixedVariant: '#2d476f',
  secondaryFixed: '#ffdcc5',
  secondaryFixedDim: '#ffb783',
  onSecondaryFixed: '#301400',
  onSecondaryFixedVariant: '#703700',
  tertiaryFixed: '#d2e4ff',
  tertiaryFixedDim: '#9fcaff',
  onTertiaryFixed: '#001d37',
  onTertiaryFixedVariant: '#00497e',

  white: '#ffffff',
  black: '#000000',
  success: '#16a34a',
  onSuccess: '#ffffff',
} as const;

export type ThemeColor = keyof typeof Colors;

/** Driver status colors are solid tints, unlike the user app's alpha overlays. */
export const StatusColors = {
  successBg: '#dcfce7',
  successFg: '#166534',
  infoBg: '#dbeafe',
  infoFg: '#1e40af',
  warningBg: 'rgba(254,151,67,0.2)',
  warningFg: '#6b3500',
  dangerBg: '#ffdad6',
  dangerFg: '#93000a',
} as const;

export type StatusTone = 'success' | 'info' | 'warning' | 'danger';

export const FontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  black: 'Inter_900Black',
  // The driver app uses JetBrains Mono for its mono role (the user app uses Inter).
  mono: 'JetBrainsMono_500Medium',
} as const;

/** Rendered lineHeight is the raw value x this, applied in AppText. */
export const LINE_HEIGHT_SCALE = 1.18;

type TypeStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
};

export const Typography = {
  displayLg: { fontFamily: FontFamily.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.48 },
  headlineLg: { fontFamily: FontFamily.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.48 },
  headlineLgMobile: { fontFamily: FontFamily.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.18 },
  headlineMd: { fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 21 },
  headlineSm: { fontFamily: FontFamily.semibold, fontSize: 14, lineHeight: 20 },
  bodyLg: { fontFamily: FontFamily.regular, fontSize: 12, lineHeight: 18 },
  bodyMd: { fontFamily: FontFamily.regular, fontSize: 11, lineHeight: 16 },
  // Identical to bodyMd in the original — kept for parity.
  bodySm: { fontFamily: FontFamily.regular, fontSize: 11, lineHeight: 16 },
  labelCaps: { fontFamily: FontFamily.semibold, fontSize: 10, lineHeight: 14, letterSpacing: 0.5 },
  dataMono: { fontFamily: FontFamily.mono, fontSize: 11, lineHeight: 16, letterSpacing: -0.11 },
} satisfies Record<string, TypeStyle>;

export type TypeVariant = keyof typeof Typography;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  gutter: 12,
  containerMargin: 16,
  cardPadding: 16,
  stackGap: 12,
} as const;

export const Radii = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 9999,
} as const;

export const Shadows = {
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 2,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  lg: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 12,
  },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
