import { Colors, FontFamily } from '@/constants/theme';

/**
 * Additive display scale.
 *
 * `theme.ts` holds the tokens recovered from the original APK and is deliberately left
 * byte-identical — its `Typography` tops out at 24px with 11-12px body text, which is a
 * scale the reference design is visibly larger than (hero ~30, screen titles ~27, body
 * ~14-15). Rather than "improve" the recovered artifact, everything the redesign needs
 * that the original didn't have lives here.
 *
 * Applied through `AppText`'s `style` prop, which is already last in its style array:
 *
 *     <AppText variant="headlineLg" style={DisplayType.screenTitle}>
 *
 * so the variant supplies colour/line-height defaults and this overrides the metrics.
 */
export const DisplayType = {
  /** Landing hero — the only place extrabold is used. */
  hero: { fontFamily: FontFamily.extrabold, fontSize: 30, lineHeight: 38, letterSpacing: -0.6 },
  /** "Ride History", "Earnings", "Account Setup" — the big navy line under an app bar. */
  screenTitle: { fontFamily: FontFamily.bold, fontSize: 27, lineHeight: 34, letterSpacing: -0.5 },
  /** "Recent Payments", "Last 7 Days" — a heading inside a scroll, below the screen title. */
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 21, lineHeight: 28, letterSpacing: -0.3 },
  /** The single big money figure on Earnings. */
  amountXl: { fontFamily: FontFamily.bold, fontSize: 30, lineHeight: 38, letterSpacing: -0.6 },
  /** TODAY / LAST 7 DAYS card figures. */
  amountMd: { fontFamily: FontFamily.bold, fontSize: 19, lineHeight: 26 },
  /** List-row labels and large button labels. */
  rowLabel: { fontFamily: FontFamily.medium, fontSize: 15, lineHeight: 22 },
  /** Running text — intros, explanations, empty states. */
  bodyUi: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 21 },
  /** Text the driver types into a field. */
  fieldText: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 22 },
  /** Vehicle numbers, IFSC, account numbers, references — anything read out or compared. */
  fieldMono: { fontFamily: FontFamily.mono, fontSize: 14, lineHeight: 21 },
  /** Uppercase section labels and field labels. */
  capsLabel: { fontFamily: FontFamily.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.6 },
  tabLabel: { fontFamily: FontFamily.semibold, fontSize: 12, lineHeight: 16 },
  wordmark: { fontFamily: FontFamily.extrabold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
} as const;

/**
 * Surfaces the recovered palette has no name for. Everything here either aliases a
 * recovered colour (so the two can never drift) or is a tint the reference introduces.
 */
export const Brand = {
  /** Primary CTA / active tab. The recovered palette files this under `secondaryContainer`. */
  orange: Colors.secondaryContainer,
  /** Readable ink on `orange`. */
  orangeInk: Colors.onSecondaryContainer,
  /** Light-blue informational fill — TOTAL EARNED, the KYC notice, the Language icon disc. */
  infoSurface: '#dbe4fb',
  /** Unfilled bar on the earnings chart. */
  chartBar: Colors.surfaceContainer,
  chartBarFill: Colors.primaryContainer,
  /** Translucent card on the orange landing hero. */
  onOrangeCard: 'rgba(255,255,255,0.16)',
  /** The oversized truck glyph behind the landing hero. */
  watermark: 'rgba(255,255,255,0.10)',
  hairline: Colors.outlineVariant,
} as const;
