# TruckGo — what could NOT be extracted, and what we assume instead

Everything in the other reference docs is quoted from the decompiled bundles. This file
is the opposite: the things that are **not in the APK at all**, why, what indirect
evidence exists, and exactly what the rebuild assumes in their place.

Read this before trusting any pricing, dispatch, or policy behaviour in our build.

**The rule:** an APK contains only the client. Anything the *server* computes is
invisible — we can see the request that goes out and the field names that come back,
never the logic in between. No amount of static analysis changes that; only a live
capture against the running backend would, and that is still unverified (see the last
section).

---

## 1. Fare formula — NOT RECOVERABLE

**Evidence found**
- Client sends `{pickup, drop, vehicleType, weightTons?}` to `POST /bookings/estimate`.
- Client reads back exactly `{distanceKm, durationMin, fare: {total}}`.
- `fare` has **no breakdown** — no base, per-km, surge, tax or discount fields are read
  anywhere in the bundle. Searching the whole bundle for `baseFare`/`perKm`/`surge`/`gst`
  returns nothing.
- Currency is INR, rendered `₹`. `fareTotal` / `estimatedFare` exist only as *i18n label
  keys*, not data fields.
- Inputs that provably affect price: distance, vehicle type, and optionally weight.

**What we assume**
`backend/src/lib/fare.ts` uses `base 80 + distanceKm × perKm[vehicleType] + tons × 15`,
floor ₹150, `durationMin` from a 35 km/h average. Per-km rates 18–40 by vehicle.

**Confidence: LOW.** The *shape* is right and matches the real response exactly; the
*numbers* are invented. Do not ship these to real customers.

**How to resolve:** get the rate card from the business, or capture one live
`/bookings/estimate` response for a known distance.

---

## 2. Cancellation fee amounts — NOT RECOVERABLE

**Evidence found**
- `GET /trips/:id/cancellation-policy` returns `{secondsRemaining, windowEndsAt}` — the
  client parses `windowEndsAt` with `Date.parse` and counts down with
  `Math.max(0, Math.round(...))`.
- So the free-cancellation **window** is entirely server-computed and per-trip.
- Copy confirms the two states: inside the window, cancelling is free
  (`Your booking has been cancelled. You weren't charged.`); outside it, the UI refuses
  and routes to support (`The free-cancellation window has closed. Please contact support.`).
- Reasons are a fixed client-side list: `Driver taking too long`, `Booked by mistake`,
  `Plans changed`, `Other`.
- **No fee amount ever appears in the client.** The client never displays a charge — it
  only shows free-or-contact-support.

**What we assume**
Our `cancellation-policy.tsx` is placeholder prose with no real numbers, and our cancel
endpoint applies no fee.

**Confidence: MEDIUM on behaviour, NONE on amounts.** The two-state
free-window-then-support behaviour is well evidenced. The window *duration* and any fee
are unknown.

**How to resolve:** business rules, or one live `GET /trips/:id/cancellation-policy`.

---

## 3. Dispatch / driver matching — NOT RECOVERABLE

**Evidence found**
- Driver feed is `GET /bookings/available` returning unclaimed bookings.
- `SearchingForDriverScreen` watches booking `.status` and `.driver` and transitions when
  a driver attaches. It contains **no timeout constant**.
- `NO_DRIVER_FOUND` is a real status in the enum but is never *set* by the client.
- Nothing client-side filters by radius, rating, or vehicle match.

**What we assume**
Our `/bookings/available` returns the 25 oldest `REQUESTED` bookings to every online
driver, unfiltered. No proximity, no vehicle-type matching, no timeout to
`NO_DRIVER_FOUND`, no assignment fairness.

**Confidence: LOW.** Almost certainly not what the original does — a real dispatcher
would filter by distance and vehicle type at minimum. Our version is a functional
placeholder.

**How to resolve:** business rules. Not observable from the client even with a capture,
beyond noticing which bookings a given driver is shown.

---

## 4. Server-provided limits & validation — PARTIALLY RECOVERABLE

| Thing | Evidence | Assumption |
|---|---|---|
| Max weight | Copy is `Enter a weight between 0 and {{max}} tons.` — `{{max}}` is interpolated, so the server supplies it | we don't enforce a max |
| OTP length | Copy is `Enter the 4–8 digit code` | we generate 4 digits |
| Password min | Copy is `Choose a strong password of at least 8 characters.` | we enforce 6 — **wrong, should be 8** |
| Pagination | `listBookings` has a search box and All/Active filters; no page/cursor param found | we return everything |
| Rate limits | none visible | none |
| Token TTL | not in client | 15 min access / 30 day refresh (ours) |

`{{max}}` being interpolated is solid evidence the weight ceiling is a server value the
client renders — so our UI should read it from an API response rather than hardcode it.

---

## 5. Notification & SMS delivery — NOT RECOVERABLE

**Evidence found**
- Notifications are fetched over REST (`GET /notifications`) and marked read
  (`PATCH /notifications/:id/read`, `PATCH /notifications/read-all`).
- No push-token registration call, no Firebase/Expo push config in the bundle.
- Pickup OTP arrives at the rider over the socket (`trip:otp`) **and** the copy implies
  SMS delivery for auth OTPs.
- No SMS provider (Twilio/MSG91) appears anywhere in the client — as expected, that's
  server-side.

**What we assume**
`backend/src/lib/otp.ts` `console.log`s the code instead of sending SMS. Notifications
are in-app only; no push.

**Confidence: HIGH that this is server-side and invisible.** Our stub is honest, but no
real delivery happens.

---

## 6. Response shapes we inferred rather than read

These are cases where the endpoint is certain but the *response* body wasn't fully
traceable through the decompiled control flow:

| Endpoint | Confidence | Basis |
|---|---|---|
| `POST /bookings` | HIGH | sibling `getBooking` unwraps `{booking}`; same client module |
| `GET /bookings` (`listBookings`) | MEDIUM | endpoint certain; array shape assumed `{bookings: [...]}` |
| `GET /trips/:id/tracking` | MEDIUM | fields inferred from the socket equivalents |
| `GET /trips/:id/location` | MEDIUM | assumed `{lat, lng, ts}` mirroring `trip:location` |
| `GET /ratings/users/:id/summary` | MEDIUM | assumed `{average, count, recent}` |
| `POST /auth/*` responses | HIGH | token fields read directly at call sites |

---

## 7. Deliberate deviations (not unknowns — choices)

1. **One backend instead of three.** The original runs `API_BASE_URL`,
   `BOOKING_API_BASE_URL` and `LIVE_OPS_BASE_URL` as separate Railway services. We serve
   all three path groups from one Express app. Client-visible paths are identical.
2. **SQLite instead of the real database.** Schema is ours; the original's is unknown.
3. **Nominatim for geocoding, no Google Places.** The original uses Nominatim for
   `geocodeAddress` (matching), but also has a Google-key-backed Places autocomplete and
   a server-side `/routes/directions` Google Directions proxy we haven't built.
4. **IDs are cuids.** The original shows a human-readable `SHIPMENT ID` to users; its
   format is unknown.

---

## 8. Status of the live-capture attempt

A live capture would resolve §1, §2 and most of §4 and §6. It was attempted and **did not
succeed**:

- Android SDK, emulator, JDK and mitmproxy were installed successfully under
  `C:\Users\sreel\AndroidDev` (still present and reusable).
- A plain emulator boot works reliably (~45 s).
- The rooted / `-writable-system` path needed to install a CA into the system trust store
  hung non-deterministically at the same early boot stage, surviving a fresh AVD, freed
  RAM (2.4 GB → 6.2 GB), and single-instance discipline.
- **Untried next approach:** repackage the APK with a permissive
  `network_security_config.xml` (trust user CAs), re-sign, and install on a *plain*
  non-rooted boot — avoiding the root/remount/reboot cycle entirely.

Until that runs, everything in §1–§4 remains assumption, clearly marked as such in code
comments.
