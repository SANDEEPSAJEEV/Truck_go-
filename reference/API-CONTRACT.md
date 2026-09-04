# TruckGo — recovered API contract

Every endpoint below was read out of the decompiled original bundles
(`reference/decompiled/`), not inferred. Function names in `code font` are the
original developer's own names, which survived Hermes decompilation.

The original ran **three separate services**. Base URLs, `decompiled_user.js:416400-416415`:

| Constant | Host | Owns |
|---|---|---|
| `API_BASE_URL` | `truck-application-backend-production.up.railway.app` | auth, users, drivers, ratings, notifications, directions |
| `BOOKING_API_BASE_URL` | `inspiring-simplicity-production-f465.up.railway.app` | booking pre-trip lifecycle |
| `LIVE_OPS_BASE_URL` | `liveops-service-production.up.railway.app` | active-trip surface |

Our rebuild consolidates these into one Express app at the same paths — a hosting
simplification, not a behavioural difference.

---

## Auth service

| Method | Path | Function | Body |
|---|---|---|---|
| POST | `/auth/register/user` | `registerUser` | `{fullName, companyName?, email, phone, password, confirmPassword}` |
| POST | `/auth/register/driver` | `registerDriver` | **multipart** — see below |
| POST | `/auth/login` | `login` | `{phone, password}` |
| POST | `/auth/driver` | driver login | `{phone, password}` |
| POST | `/auth/refresh` | `refresh` | `{refreshToken}` |
| POST | `/auth/logout` | `logout` | |
| POST | `/auth/change-password` | `changePassword` | |
| POST | `/auth/forgot-password` | `forgotPassword` | `{phone}` |
| POST | `/auth/reset-password` | `resetPassword` | |
| POST | `/auth/request-otp` | `requestOtp` | `{phone}` |
| POST | `/auth/verify-otp` | `verifyOtp` | `{phone, code}` |

### Driver registration multipart fields
`decompiled_driver.js:422407+` — every `FormData.append` key, in order:

```
fullName, phone, email, vehicleNumber, vehicleType,
panCardNumber, drivingLicenseNumber,
password, confirmPassword,
accountHolderName, bankAccountNumber, ifscCode,
acceptTermsAndConditions, acceptPrivacyPolicy,
panCardImage, drivingLicenseFrontImage, drivingLicenseBackImage   ← files
```

Note: bank details and KYC document photos are collected **at registration**, not in a
later settings screen. Three document images are part of the signup payload.

## Users / drivers / ratings / notifications

| Method | Path | Function |
|---|---|---|
| GET | `/users/me` | `getMe` |
| PATCH | `/users/me` | `updateMe` |
| PATCH | `/drivers/me` | `updateDriverMe` |
| GET | `/notifications` | notification feed |
| PATCH | `/notifications/:id/read` | `markNotificationRead` |
| PATCH | `/notifications/read-all` | `markAllNotificationsRead` |
| POST | `/ratings` | `submitRating` |
| GET | `/ratings/users/:id/summary` | `getRatingSummary` |
| GET | `/routes/directions` | `getDirections` — see below |

### Directions
`/routes/directions` proxies **Google Directions** and returns Google's own response
shape. The client reads `routes[0].overview_polyline.points` and decodes it with a
local `decodePolyline` (`decompiled_user.js:442052`), also touching `.legs` and
`.status`. So the server holds the Maps key; the client never calls Google directly
for routing.

### Geocoding
`geocodeAddress` (`decompiled_user.js:438440+`) calls **OpenStreetMap Nominatim**
directly with `?format=json&limit=1&countrycodes=in&q=` — India-restricted, single
result. Our rebuild's Nominatim usage matches; add `countrycodes=in`.

---

## Booking service — `/bookings`

`decompiled_user.js:437950-438500`

| Method | Path | Function |
|---|---|---|
| POST | `/bookings/estimate` | `estimateFare` |
| POST | `/bookings` | `createBooking` |
| GET | `/bookings` | **`listBookings`** — trip history |
| GET | `/bookings/:id` | `getBooking` |
| GET | `/bookings/available` | `getAvailableBookings` |
| POST | `/bookings/:id/accept` | `acceptBooking` |
| POST | `/bookings/:id/reject` | `rejectBooking` |
| POST | `/bookings/:id/cancel` | `cancelBooking` — body `{reason}` |
| PATCH | `/bookings/:id/status` | `advanceBookingStatus` — body `{status}` |
| **PUT** | `/drivers/location` | `publishDriverLocation` — note PUT, not POST |

### Request / response shapes

`estimateFare` request — `{pickup, drop, vehicleType, weightTons?}`
`createBooking` request — `{pickup, drop, vehicleType, notes?, weightTons?, goodsType?}`

`pickup` / `drop` are objects: `{lat, lng, address, placeId}`
(`placeId: 'current'` marks a device-location pick).

`estimateFare` response — `{distanceKm, durationMin, fare: {total}}`
(nested `fare.total`, not a flat `estimatedFare` — `decompiled_user.js:472572-472594`).

`vehicleType` values (camelCase): `miniTruck`, `pickup`, `tataAce`, `tempo`,
`largeTruck`, `container`.

---

## Liveops service — `/trips`

`decompiled_user.js:461900-462090` (`trackingApi`)

| Method | Path | Function |
|---|---|---|
| GET | `/trips/:id/tracking` | `getTracking` |
| GET | `/trips/:id/location` | `getLastLocation` |
| POST | `/trips/:id/status` | `postStatus` — body `{status, lat, lng}` |
| POST | `/trips/:id/verify-pickup-otp` | `verifyPickupOtp` — body `{otp}` |
| POST | `/trips/:id/resend-pickup-otp` | `resendPickupOtp` |
| GET | `/trips/:id/cancellation-policy` | `getCancellationPolicy` |
| POST | `/trips/:id/cancel` | `cancelTrip` — body `{reason}` |
| GET/POST | `/trips/:id/messages` | trip chat |
| GET | `/trips/:id/messages/unread-count` | unread badge |

`getCancellationPolicy` being a live per-trip GET means the free-cancellation window
is **server-computed**, which is what the tracking screen's "the free-cancellation
window has closed" copy keys off.

Note both services expose a cancel: `POST /bookings/:id/cancel` (booking service) and
`POST /trips/:id/cancel` (liveops). Both are real in the client SDK.

---

## Status enum

`bookingStatusMeta`, `decompiled_driver.js:460539-460642`, plus the driver
`nextAction` machine at `:460821-461010`:

```
REQUESTED → ACCEPTED → EN_ROUTE_TO_PICKUP → ARRIVED_AT_PICKUP
          → IN_TRANSIT → ARRIVED_AT_DROP → DELIVERED
```

Terminal / exceptional: `CANCELLED`, `NO_DRIVER_FOUND`, `SCHEDULED`.
Tone mapping used for the status pill: warning (REQUESTED, IN_TRANSIT), info
(SCHEDULED, ACCEPTED, ARRIVED_AT_PICKUP), success (DELIVERED), danger (CANCELLED,
NO_DRIVER_FOUND).

---

## Client-side persistence

Only auth/session and settings — no draft or active-booking state
(`decompiled_user.js:417190`, `:401362`):

```
truckgo.accessToken, truckgo.refreshToken, truckgo.user,
truckgo.backendHost, truckgo.language
```

`truckgo.backendHost` backs a "Server Settings" screen that lets you repoint the app
at a different backend at runtime — which is how the hardcoded `http://10.158.98.105:3001`
placeholder ended up in the bundle.

---

## Deltas against our current rebuild

Confirmed wrong or missing in what we have now:

1. `publishDriverLocation` is **PUT** `/drivers/location`; we built POST.
2. `listBookings` = **GET `/bookings`** exists — we have no trip-history endpoint, and
   this is also the missing "recover my trips after refresh" path.
3. Messages are `/trips/:id/messages`; we built `/messages?bookingId=`.
4. `markNotificationRead` = PATCH `/notifications/:id/read`; we only have read-all.
5. Rating summary is `/ratings/users/:id/summary`; we built `/ratings/users/:id`.
6. `GET /trips/:id/cancellation-policy` and `POST /trips/:id/cancel {reason}` — we have
   neither; cancellation reasons and the free-cancellation window are unimplemented.
7. `GET /trips/:id/location` (last-known location REST fallback) — missing.
8. `/routes/directions` Google-Directions proxy — missing entirely, needed for the map.
9. Driver registration is missing `email`, `confirmPassword`, `accountHolderName`,
   `bankAccountNumber`, `ifscCode`, both accept-terms flags, and all three document images.
10. User registration `email` is sent by the real app; ours treats it as optional-unused.
11. Booking UI never exposes `weightTons`, `goodsType`, `notes` (backend has the columns).
12. Geocoding should pass `countrycodes=in`.

---

## Additions beyond the recovered contract

Everything above was recovered from the decompiled bundles. The endpoints below were **not**
in the original app — they are new work, recorded here so later readers don't mistake them
for recovered behaviour.

### Phase B — authentication (rebuilt)
- `POST /auth/verify-otp` now returns `{verified, verificationToken}`. The original returned
  only `{verified:true}`, which registration could not check.
- `POST /auth/register/user` and `/register/driver` now **require** `verificationToken`.
- `POST /auth/refresh` returns a rotated `refreshToken` as well as an `accessToken`.
  Replaying a rotated token revokes the whole session family.
- `POST /auth/admin` — staff login (new `ADMIN` role).

### Phase C — driver KYC (new)
- `GET /drivers/documents`, `POST /drivers/documents/:type` (multipart),
  `POST /drivers/documents/verify`, `GET /drivers/documents/:id/file`
- `GET /admin/drivers`, `GET /admin/drivers/:id`, `GET /admin/documents/:id/file`,
  `POST /admin/drivers/:id/{approve,reject,suspend,reinstate,recheck}`
- `PUT /drivers/location`, `GET /bookings/available` and `POST /bookings/:id/accept` now sit
  behind `requireApprovedDriver` and return `403 DRIVER_NOT_APPROVED`.

### Phase E — staged custody (new)
The original had a single `pickupOtp`. There are now three custody gates:

```
ACCEPTED → EN_ROUTE_TO_PICKUP → ARRIVED_AT_PICKUP
  → [pickup PIN] → LOADING → [start PIN] → IN_TRANSIT
  → ARRIVED_AT_DROP → [drop PIN] → UNLOADING → DELIVERED
```

- `POST /trips/:id/verify-otp {otp, stage?}` replaces `verify-pickup-otp`. Stage is derived
  from the booking's own status; an explicit `stage` is honoured only when it agrees, so a
  caller cannot nominate a later gate to skip ahead.
- `POST /trips/:id/resend-otp` replaces `resend-pickup-otp`; rider-only, resends whichever
  gate is currently open.
- `trip:otp` socket payload gains `stage` so the rider's screen knows which PIN arrived.
- `BookingStatus` gains `LOADING` and `UNLOADING`; `Booking` gains `startOtp`, `dropOtp`,
  `loadingAt`, `unloadingAt`.
- `POST /trips/:id/status` refuses a transition across an open gate with
  `409 AWAITING_OTP`.

### Phase F — multi-driver bidding (new)
The original had a single "first driver to accept wins" flow. Bookings now open to the
market instead:

```
REQUESTED (unused at creation) → AWAITING_BIDS → [rider accepts a bid] → ACCEPTED → …
```

- `POST /bookings` now creates directly into `AWAITING_BIDS`, not `REQUESTED`.
- **`POST /bookings/:id/accept` (direct claim) is REMOVED.** It would let any approved
  driver bypass both the price floor and the rider's choice. The only way a driver is
  assigned is `POST /bookings/:id/bids/:bidId/accept`, called by the rider.
- `POST /bookings/:id/bids {amount, note?}` — approved drivers only. Server refuses any
  amount below `booking.estimatedFare` (`400 BELOW_FLOOR`) and any bid once the booking has
  left `AWAITING_BIDS` (`409 NOT_OPEN`). One bid per driver per booking — a second call
  updates the existing row rather than creating a duplicate, so withdraw-then-rebid doesn't
  fight the unique constraint.
- `GET /bookings/:id/bids` — the rider sees every pending bid with the bidding driver's
  identity (name, rating, vehicle); a driver sees only their own bid, never a competitor's.
- `POST /bookings/:id/bids/:bidId/accept` — rider only, wrapped in a Prisma transaction so
  two near-simultaneous accepts can't both win. Sets `actualFare` to the accepted bid's
  amount (which may exceed or undercut `estimatedFare` — that's the point), assigns
  `driverId`, marks every other pending bid `REJECTED`.
- `DELETE /bookings/:id/bids/:bidId` — driver withdraws their own pending bid.
- `bid:new` (→ rider), `bid:accepted` / `bid:rejected` (→ drivers) — pushed over each
  party's existing private `user:<id>` socket room; no new room plumbing.
- **`actualFare` now drives every fare display once set** — `estimatedFare` is only ever the
  pre-bid asking price shown while `AWAITING_BIDS`.
- `PATCH /bookings/:id/status` (kept for parity with the recovered client SDK) previously
  accepted *any* status from *any* driver with no ownership or transition check — a latent
  hole that would have let a driver self-assign or skip every custody PIN. It now requires
  `driverId === caller` and only permits the same moves `POST /trips/:id/status` allows.
