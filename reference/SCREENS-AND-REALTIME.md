# TruckGo — screens & realtime contract

Routes read from navigation call sites (`router.push` / `router.replace` / `href`) in
the decompiled bundles. Socket event names and payload fields read from the live
subscription setup.

---

## User app routes

| Route | Purpose | Have it? |
|---|---|---|
| `/index` | boot / auth redirect | yes |
| `/landing` | marketing / onboarding hero | **no** |
| `/login` | login | yes |
| `/signup` | registration | yes |
| `/forgot-password` | password reset | **no** |
| `/change-password` | change password | **no** |
| `/booking` | booking entry form | yes (named `/book`) |
| `/confirm-ride` | route preview + fare + confirm | yes |
| `/searching/[id]` | "Searching for nearby drivers…" | **no** |
| `/track/[id]` | live tracking | yes (named `/tracking/[id]`) |
| `/feedback/[id]` | post-trip rating | yes (named `/rate/[id]`) |
| `/trips` | Trip History / Shipments | **no** |
| `/notifications` | notification feed | yes |
| `/profile` | profile | yes |
| `/edit-profile` | edit profile | yes |
| `/cancellation-policy` | policy text | yes |

## Driver app routes

| Route | Purpose | Have it? |
|---|---|---|
| `/index` | boot / auth redirect | yes |
| `/landing` | onboarding hero | **no** |
| `/login` | login | yes |
| `/register` | KYC registration | partial |
| `/forgot-password` | password reset | **no** |
| `/change-password` | change password | **no** |
| `/dashboard` | online toggle + load feed | yes |
| `/trip/[id]` | active trip | yes |
| `/completed-ride` | trip completion summary | **no** |
| `/earnings` | earnings | yes |
| `/bank-details` | payout details | yes |
| `/notifications` | notification feed | **no** |
| `/profile-account` | profile | yes |
| `/edit-profile` | edit profile | **no** |
| `/feedback/[id]` | rate the customer | **no** |
| `/cancellation-policy` | policy text | **no** |

Route naming corrections for our rebuild: `/book` → `/booking`,
`/tracking/[id]` → `/track/[id]`, `/rate/[id]` → `/feedback/[id]`.

---

## Socket.IO contract

Path `/socket.io`, socket.io-client v3, auth token in the handshake.

### Client → server (emit)

| Event | Emitted by | Notes |
|---|---|---|
| `trip:subscribe` | user | subscribe to a trip's live feed |
| `trip:unsubscribe` | user | teardown |
| `track:join` | user | join the tracking channel |
| `chat:send` | both | send a chat message |
| `chat:delivered` | both | delivery receipt |
| `chat:typing` | both | typing indicator |
| `chat:read` | both | read receipt |
| `presence:location` | driver | driver presence ping |
| `driver:location` | driver | GPS publish |
| `location:update` | — | location channel |

### Server → client (listen)

| Event | Payload fields (confirmed) |
|---|---|
| `trip:location` | `{lat, lng, heading, ts}` |
| `trip:status` | `{status}` |
| `trip:eta` | `{etaMinutes}` |
| `trip:otp` | `{otp}` / `{pickupOtp}` |
| `trip:signal_lost` | driver GPS gone stale |
| `chat:message` | incoming chat message |
| `chat:typing` | peer typing |
| `chat:read` | peer read |
| `location:unavailable` | location not obtainable |

**The pickup PIN is pushed over the socket** as `trip:otp`. Our rebuild re-fetches
`GET /bookings/:id` on every update instead — functionally equivalent but not how the
original does it. Worth switching to match.

`trip:signal_lost` backs the tracking screen's `Driver's signal lost — {{count}} min ago`
copy; we have neither the event nor the UI.

Observed timing constants in the tracking module: `2000` ms and `5000` ms.

---

## Screen behaviours worth copying

**`/searching/[id]`** (`SearchingForDriverScreen`, `decompiled_user.js:474612`) is a
dedicated full screen between "booking created" and "driver assigned". It watches the
booking's `.status` and `.driver` and transitions when a driver attaches. No client-side
timeout constant — `NO_DRIVER_FOUND` is decided server-side.

**Cancellation** is a live server-driven window. `GET /trips/:id/cancellation-policy`
returns `{secondsRemaining, windowEndsAt}`; the client parses `windowEndsAt` with
`Date.parse` and runs `Math.max(0, Math.round(...))` as a countdown. When it hits zero
the UI switches to the "contact support" path (`The free-cancellation window has closed…`
/ `Email support`). Cancelling asks for a reason first — `Driver taking too long`,
`Booked by mistake`, `Plans changed`, `Other` — posted as `POST /trips/:id/cancel {reason}`.

**Currency** is INR, rendered with `₹`.

---

## Translations

All five languages are fully present in the bundle, not just English:

| Code | Script | Approx. bundle location (`decompiled_user.js`) |
|---|---|---|
| `en` | Latin | ~403600-403800 |
| `hi` | Devanagari | ~403900+ |
| `te` | Telugu | ~404092+ |
| `ta` | Tamil | ~404261+ |
| `ml` | Malayalam | ~404430+ |

`reference/UI-COPY-user.md` and `UI-COPY-driver.md` currently carry the **English**
strings only. The other four are extractable with the same method if/when we localise.
