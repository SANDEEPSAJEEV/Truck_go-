# TruckGo — reverse-engineering reference

Everything recovered from `TruckGo-USER-latest.apk` and `TruckGo-driver-release.apk`.
These are the source of truth for the rebuild in `../backend`, `../apps/user`,
`../apps/driver`.

Both APKs are Expo SDK 57 / React Native, compiled to Hermes bytecode, with **no custom
native code** — all business logic lives in the JS bundle, which decompiles with original
function names intact.

## Documents

| File | Contents |
|---|---|
| `API-CONTRACT.md` | Every endpoint, method, request/response field, across all three original services. Ends with the concrete deltas vs. our build. |
| `DESIGN-SYSTEM.md` | Exact colors, typography scale, spacing, radii, shadows for both apps. Plus proof there is no missing artwork. |
| `SCREENS-AND-REALTIME.md` | Full route inventory (with what we have/don't), Socket.IO event contract, key screen behaviours. |
| `UI-COPY-user.md` / `UI-COPY-driver.md` | All 712 UI strings, verbatim. |
| `UNKNOWNS-AND-ASSUMPTIONS.md` | **Read before trusting pricing/dispatch/policy.** What is not in the APK, what we assume instead, and the confidence level for each. |

## Raw material

| Path | Contents |
|---|---|
| `decompiled/decompiled_user.js` | ~485k lines, user app bytecode decompiled |
| `decompiled/decompiled_driver.js` | ~490k lines, driver app |
| `decompiled/*-app.config.json` | original Expo config from each APK |
| `assets/user/`, `assets/driver/` | every extracted `res/` + `assets/` file (~780 each) |
| `i18n-user-raw.txt`, `i18n-driver-raw.txt` | raw i18n regions, source for the copy catalogs |

## Tools

- `parse_i18n.py <raw.txt> <out.md> <label>` — turn a raw i18n region into a readable catalog.
- `font_names.py <dir>` — read TTF name tables to identify bundled fonts.

## How this was recovered

Hermes bytecode decompiled with [hermes-dec](https://github.com/P1sec/hermes-dec)
(`pip install hermes-dec`, then `hbc-decompiler <bundle> <out.js>`). The bundle is at
`assets/index.android.bundle` inside each APK. Original function names survive, so
`grep "Original name: registerUser"` finds real call sites.

A live traffic capture (emulator + mitmproxy) was attempted to resolve the server-side
unknowns and did not succeed — see the last section of `UNKNOWNS-AND-ASSUMPTIONS.md`
for status and the untried next approach.
