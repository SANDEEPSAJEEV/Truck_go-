/**
 * TruckGo user app design tokens.
 *
 * Every value here is read verbatim out of the original app's decompiled bundle
 * (`reference/decompiled/decompiled_user.js:395195-395360`) — see
 * `reference/DESIGN-SYSTEM.md`. Do not "improve" these; they exist to match the
 * shipped app exactly.
 *
 * The original is light-mode only — there is no dark palette in the bundle.
 */

import { Platform } from 'react-native';

export const Colors = {
  primary: '#001e40',
  onPrimary: '#ffffff',
  primaryContainer: '#003366',
  onPrimaryContainer: '#799dd6',
  inversePrimary: '#a7c8ff',

  secondary: '#904d00',
  onSecondary: '#ffffff',
  secondaryContainer: '#fd8b00',
  onSecondaryContainer: '#603100',

  tertiary: '#1a1f22',
  onTertiary: '#ffffff',
  tertiaryContainer: '#2f3437',
  onTertiaryContainer: '#989ca0',

  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',

  background: '#f8f9ff',
  onBackground: '#0b1c30',
  surface: '#f8f9ff',
  onSurface: '#0b1c30',
  surfaceDim: '#cbdbf5',
  surfaceBright: '#f8f9ff',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#eff4ff',
  surfaceContainer: '#e5eeff',
  surfaceContainerHigh: '#dce9ff',
  surfaceContainerHighest: '#d3e4fe',
  surfaceVariant: '#d3e4fe',
  onSurfaceVariant: '#43474f',
  inverseSurface: '#213145',
  inverseOnSurface: '#eaf1ff',

  outline: '#737780',
  outlineVariant: '#c3c6d1',
  surfaceTint: '#3a5f94',

  primaryFixed: '#d5e3ff',
  primaryFixedDim: '#a7c8ff',
  onPrimaryFixed: '#001b3c',
  onPrimaryFixedVariant: '#1f477b',
  secondaryFixed: '#ffdcc3',
  secondaryFixedDim: '#ffb77d',
  onSecondaryFixed: '#2f1500',
  onSecondaryFixedVariant: '#6e3900',
  tertiaryFixed: '#dfe3e7',
  tertiaryFixedDim: '#c3c7cb',
  onTertiaryFixed: '#171c1f',
  onTertiaryFixedVariant: '#43474b',

  white: '#ffffff',
  black: '#000000',
  success: '#10B981',
  onSuccess: '#ffffff',
} as const;

export type ThemeColor = keyof typeof Colors;

/** Status pill / banner colors — separate from the main palette in the original. */
export const StatusColors = {
  successBg: 'rgba(16,185,129,0.15)',
  successFg: '#10B981',
  infoBg: 'rgba(253,139,0,0.15)',
  infoFg: '#904d00',
  warningBg: 'rgba(253,139,0,0.15)',
  warningFg: '#904d00',
  dangerBg: 'rgba(239,68,68,0.15)',
  dangerFg: '#EF4444',
} as const;

export type StatusTone = 'success' | 'info' | 'warning' | 'danger';

export const FontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  black: 'Inter_900Black',
  // The user app uses Inter for its mono role; only the driver app ships JetBrains Mono.
  mono: 'Inter_500Medium',
} as const;

/**
 * Rendered lineHeight is the raw value x LINE_HEIGHT_SCALE — the original applies this
 * multiplier in its AppText component rather than baking it into the scale.
 */
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
  // bodySm is genuinely identical to bodyMd in the original — kept for parity.
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
  gutter: 16,
  containerMargin: 24,
  cardPadding: 20,
  stackGap: 12,
} as const;

export const Radii = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 9999,
} as const;

/** User app shadows are navy-tinted; the driver app's are neutral black. */
export const Shadows = {
  sm: {
    shadowColor: '#003366',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#003366',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
  },
  lg: {
    shadowColor: '#001428',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 12,
  },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
