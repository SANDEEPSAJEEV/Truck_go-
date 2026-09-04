# TruckGo — rebuild

A from-scratch rebuild of the TruckGo user and driver apps, based on reverse-engineering the
two original APKs (no source was available from the original developer). See `reference/`
for the full recovered contract, design system, UI copy, and — importantly —
`reference/UNKNOWNS-AND-ASSUMPTIONS.md` for what's confirmed vs. inferred.

## Layout

- `backend/` — Node/Express + Prisma (SQLite for local dev) + Socket.IO API, implementing the
  endpoint contract recovered from the decompiled bundles.
- `apps/user/` — the rider app (Expo SDK 57, expo-router, TypeScript). Package `com.truckgo.user`.
- `apps/driver/` — the driver app, same stack. Package `com.truckgo.driver`.
- `reference/` — decompiled JS bundles, extracted assets, and five reference documents
  (`API-CONTRACT.md`, `DESIGN-SYSTEM.md`, `SCREENS-AND-REALTIME.md`, `UI-COPY-*.md`,
  `UNKNOWNS-AND-ASSUMPTIONS.md`) documenting exactly what was recovered from the APKs and how.

## Running it locally

**Backend** (start this first — both apps talk to it):

```
cd backend
cp .env.example .env
npm install
npm run prisma:migrate
npm run dev
```

Runs on `http://localhost:3001`.

**Either app:**

```
cd apps/user   # or apps/driver
cp .env.example .env
npm install
npm start
```

`EXPO_PUBLIC_API_URL` in each app's `.env` points at the backend — defaults to
`http://localhost:3001`, which works for web and iOS simulator. For the Android emulator, use
`http://10.0.2.2:3001`; for a physical device over Expo Go, use your machine's LAN IP.

## What's implemented

Corrected against the real contract confirmed by grepping the decompiled bundles — see
`reference/API-CONTRACT.md` for every endpoint and `reference/DESIGN-SYSTEM.md` for the exact
tokens. Key points:

- **Exact design system** — real Material3 color palettes (both apps' `primary`/`secondary`/
  status-color roles), the real 10-variant typography scale (with its 1.18 lineHeight
  multiplier), real spacing/radii/shadow tokens. No app images exist in either APK (verified:
  zero inline base64, zero SVG) — the UI is entirely styled views + icon fonts + Inter, plus
  one extracted logo PNG, so visual parity has no missing artwork.
- **Two service surfaces**, matching the original's split: `/bookings` (pre-trip lifecycle,
  including `GET /bookings` for trip history) and `/trips` (the active-trip surface — status
  advance, OTP, cancellation policy, chat). One consolidated backend here instead of the
  original's three Railway services — a hosting simplification, not a functional difference.
- **Real status flow**: `REQUESTED → ACCEPTED → EN_ROUTE_TO_PICKUP → ARRIVED_AT_PICKUP →
  IN_TRANSIT → ARRIVED_AT_DROP → DELIVERED`, plus `CANCELLED` / `NO_DRIVER_FOUND`.
- **Real vehicle types**: `miniTruck`, `pickup`, `tataAce`, `tempo`, `largeTruck`, `container`.
- **Pickup PIN shown to the rider**, not the driver — big digit tiles on the tracking screen,
  pushed privately over the corrected socket contract (`trip:otp` to the rider's own room,
  never the shared `trip:<id>` room the driver is also in).
- **Real socket event names** (`trip:subscribe`, `trip:status`, `trip:location`, `trip:otp`,
  `presence:location`, `chat:*`) replacing the placeholder events from the first pass.
- **Real screen routes**: `/booking`, `/confirm-ride`, `/track/[id]`, `/feedback/[id]`, `/trips`
  (history), plus the driver's `/completed-ride` — matching the original's actual paths.

**Backend:** registration (user + driver, with the confirmed KYC/bank field names), login, JWT
refresh, password reset, phone OTP, fare estimate, the full booking + trip lifecycle including
cancellation policy and trip chat, driver location (`PUT`, confirmed — not `POST`), ratings,
notifications.

**User app:** login/signup (with company name + terms acceptance), editable booking form,
confirm-ride screen (with weight/goods/notes), live trip tracking with the pickup-PIN card,
Trip History, notifications, profile, post-trip rating.

**Driver app:** login/registration, online/offline toggle, live loads feed, the full
accept → en-route → arrived → PIN-verify → in-transit → arrived-at-drop → delivered lifecycle
with GPS streaming, a completed-ride summary screen, earnings, bank details, profile.

## What's next

See `reference/UNKNOWNS-AND-ASSUMPTIONS.md` for the full list with evidence. Highlights:

- **Genuinely unrecoverable from the APK** (server-side only): the real fare formula,
  cancellation-fee amounts, and dispatch/matching logic. Current versions are functional
  placeholders — plug in real business rules before shipping.
- **Confirmed real but not built yet**: `/landing` and `/searching/[id]` screens, driver
  document upload (KYC), Google Places Autocomplete + the `/routes/directions` proxy (currently
  using free Nominatim geocoding instead), a live map view, push notifications, the multi-
  category rating selector, and the driver's 3-step registration wizard (currently one screen).
- Swap in your own restricted Google Maps API key before going live — the original's key is
  hardcoded and unrestricted (see the security flag in the original recovery report).
