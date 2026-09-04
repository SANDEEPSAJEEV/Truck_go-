# TruckGo — recovered design system

Every value below is read verbatim out of the decompiled bundle
(`decompiled_user.js:395195-395360`), which contains **both** apps' themes
(they ship a shared theme module). Nothing here is estimated.

Theme object shape: `{name, colors, status, type, spacing, radii, shadows, fonts}`
exported as `userTheme` and `driverTheme`.

> **Light mode only.** Only two palettes exist in the bundle — one per app. There is
> no dark palette, despite `userInterfaceStyle: "automatic"` in `app.config`.

---

## Typography

Custom variant scale (not stock Material). `AppText` takes
`variant` (default `bodyMd`), `color` (default `onSurface`), `align`, `uppercase`, `style`.

**Rendered `lineHeight` = the value below × 1.18** (`decompiled_user.js:397546+`).
`fontSize` is **not** scaled.

| Variant | fontSize | lineHeight (raw → ×1.18) | letterSpacing | Weight |
|---|---|---|---|---|
| `displayLg` | 24 | 30 → 35.4 | -0.48 | bold (700) |
| `headlineLg` | 24 | 30 → 35.4 | -0.48 | bold (700) |
| `headlineLgMobile` | 18 | 24 → 28.3 | -0.18 | bold (700) |
| `headlineMd` | 15 | 21 → 24.8 | — | semibold (600) |
| `headlineSm` | 14 | 20 → 23.6 | — | semibold (600) |
| `bodyLg` | 12 | 18 → 21.2 | — | regular (400) |
| `bodyMd` | 11 | 16 → 18.9 | — | regular (400) |
| `bodySm` | 11 | 16 → 18.9 | — | regular (400) |
| `labelCaps` | 10 | 14 → 16.5 | +0.5 | semibold (600) |
| `dataMono` | 11 | 16 → 18.9 | -0.11 | mono medium (500) |

`bodyMd` and `bodySm` are genuinely identical in the original — kept as-is for parity.

### Font families
```
regular    Inter_400Regular
medium     Inter_500Medium
semibold   Inter_600SemiBold
bold       Inter_700Bold
extrabold  Inter_800ExtraBold
black      Inter_900Black
mono       user app:   Inter_500Medium
           driver app: JetBrainsMono_500Medium
```

---

## Colors — userTheme

```
primary                   #001e40    onPrimary                 #ffffff
primaryContainer          #003366    onPrimaryContainer        #799dd6
inversePrimary            #a7c8ff
secondary                 #904d00    onSecondary               #ffffff
secondaryContainer        #fd8b00    onSecondaryContainer      #603100
tertiary                  #1a1f22    onTertiary                #ffffff
tertiaryContainer         #2f3437    onTertiaryContainer       #989ca0
error                     #ba1a1a    onError                   #ffffff
errorContainer            #ffdad6    onErrorContainer          #93000a
background                #f8f9ff    onBackground              #0b1c30
surface                   #f8f9ff    onSurface                 #0b1c30
surfaceDim                #cbdbf5    surfaceBright             #f8f9ff
surfaceContainerLowest    #ffffff    surfaceContainerLow       #eff4ff
surfaceContainer          #e5eeff    surfaceContainerHigh      #dce9ff
surfaceContainerHighest   #d3e4fe
surfaceVariant            #d3e4fe    onSurfaceVariant          #43474f
inverseSurface            #213145    inverseOnSurface          #eaf1ff
outline                   #737780    outlineVariant            #c3c6d1
surfaceTint               #3a5f94
primaryFixed              #d5e3ff    primaryFixedDim           #a7c8ff
onPrimaryFixed            #001b3c    onPrimaryFixedVariant     #1f477b
secondaryFixed            #ffdcc3    secondaryFixedDim         #ffb77d
onSecondaryFixed          #2f1500    onSecondaryFixedVariant   #6e3900
tertiaryFixed             #dfe3e7    tertiaryFixedDim          #c3c7cb
onTertiaryFixed           #171c1f    onTertiaryFixedVariant    #43474b
white  #ffffff   black  #000000   success  #10B981   onSuccess  #ffffff
```

### userTheme.status
```
successBg  rgba(16,185,129,0.15)   successFg  #10B981
infoBg     rgba(253,139,0,0.15)    infoFg     #904d00
warningBg  rgba(253,139,0,0.15)    warningFg  #904d00
dangerBg   rgba(239,68,68,0.15)    dangerFg   #EF4444
```

---

## Colors — driverTheme

```
primary                   #002045    onPrimary                 #ffffff
primaryContainer          #1a365d    onPrimaryContainer        #86a0cd
inversePrimary            #adc7f7
secondary                 #944b00    onSecondary               #ffffff
secondaryContainer        #ED8936    onSecondaryContainer      #6b3500
tertiary                  #00213e    onTertiary                #ffffff
tertiaryContainer         #003762    onTertiaryContainer       #58a2f0
error                     #ba1a1a    onError                   #ffffff
errorContainer            #ffdad6    onErrorContainer          #93000a
background                #f9f9ff    onBackground              #121c2c
surface                   #f9f9ff    onSurface                 #121c2c
surfaceDim                #d0daf0    surfaceBright             #f9f9ff
surfaceContainerLowest    #ffffff    surfaceContainerLow       #f0f3ff
surfaceContainer          #e7eeff    surfaceContainerHigh      #dee8ff
surfaceContainerHighest   #d9e3f9
surfaceVariant            #d9e3f9    onSurfaceVariant          #43474e
inverseSurface            #273141    inverseOnSurface          #ebf1ff
outline                   #74777f    outlineVariant            #c4c6cf
surfaceTint               #455f88
primaryFixed              #d6e3ff    primaryFixedDim           #adc7f7
onPrimaryFixed            #001b3c    onPrimaryFixedVariant     #2d476f
secondaryFixed            #ffdcc5    secondaryFixedDim         #ffb783
onSecondaryFixed          #301400    onSecondaryFixedVariant   #703700
tertiaryFixed             #d2e4ff    tertiaryFixedDim          #9fcaff
onTertiaryFixed           #001d37    onTertiaryFixedVariant    #00497e
white  #ffffff   black  #000000   success  #16a34a   onSuccess  #ffffff
```

### driverTheme.status
```
successBg  #dcfce7                 successFg  #166534
infoBg     #dbeafe                 infoFg     #1e40af
warningBg  rgba(254,151,67,0.2)    warningFg  #6b3500
dangerBg   #ffdad6                 dangerFg   #93000a
```

Note both apps carry navy **and** orange — the difference is which role each takes.
The user app's brand navy `#1a365d` and driver's `#ED8936` from `app.config` appear
here as `driverTheme.primaryContainer` and `driverTheme.secondaryContainer`.

---

## Spacing

| Token | user | driver |
|---|---|---|
| `xs` | 4 | 4 |
| `sm` | 8 | 8 |
| `md` | 16 | 16 |
| `lg` | 24 | 24 |
| `xl` | 32 | 32 |
| `xxl` | 48 | 48 |
| `gutter` | 16 | 12 |
| `containerMargin` | 24 | 16 |
| `cardPadding` | 20 | 16 |
| `stackGap` | 12 | 12 |

The driver app is deliberately denser (smaller gutter/margin/card padding).

## Radii — shared by both themes
```
sm 4    md 8    lg 12    xl 16    pill 9999
```

## Shadows

**userTheme** — navy-tinted:
| Level | color | opacity | radius | elevation | offset |
|---|---|---|---|---|---|
| sm | `#003366` | 0.06 | 4 | 2 | 0, 2 |
| md | `#003366` | 0.10 | 16 | 6 | 0, 10 |
| lg | `#001428` | 0.14 | 28 | 12 | 0, 20 |

**driverTheme** — neutral:
| Level | color | opacity | radius | elevation | offset |
|---|---|---|---|---|---|
| sm | `#000000` | 0.06 | 5 | 2 | 0, 2 |
| md | `#000000` | 0.10 | 12 | 5 | 0, 6 |
| lg | `#000000` | 0.16 | 20 | 12 | 0, 12 |

---

## Assets & iconography

The APK contains **essentially no bitmap artwork**. The 115 MB is native libs (83 MB),
dex (46 MB) and fonts. The only real image is the TruckGo logo — a truck with motion
lines, extracted to `reference/assets/user/res/S7.png` (1160×1160) and its smaller
density variant `St.png`. Everything else is drawn with styled views + icon fonts.

**Verified exhaustively** against `decompiled_user.js`:

| Check | Result |
|---|---|
| `data:image` (inline base64) | 0 |
| `react-native-svg` | 0 |
| `<svg` / `<Path` / SVG path data | 0 |
| app-registered assets outside `__node_modules` | none |
| filenames like `logo`/`hero`/`illustration`/`empty-state` | none |

So the entire UI is: **styled `View`s + icon fonts + Inter text + one logo PNG.**
There is no missing artwork, and exact visual parity is fully achievable from what we
already have extracted.

### Bundled icon fonts (89 font files total)
```
Material Symbols/Icons, MaterialCommunityIcons, FontAwesome (5 + 6, Free/Brands),
Ionicons, Feather, AntDesign, Entypo, EvilIcons, Octicons, Fontisto,
simple-line-icons, zocial, fontcustom
```
i.e. the full `@expo/vector-icons` set. Icons referenced in code use Material
Symbols names (e.g. `my-location`, `dns`).

### Text fonts
`Inter` (all 9 weights + italics), `JetBrains Mono` (all weights + italics), and
Noto Sans for **Devanagari, Malayalam, Tamil, Telugu**.

### Languages
`en`, `hi`, `ml`, `ta`, `te` — five, persisted under `truckgo.language`.
