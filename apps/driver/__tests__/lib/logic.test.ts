/**
 * The small pure modules. Individually simple, collectively responsible for most of what the
 * driver reads on screen — a fare, a distance, a date bucket, a status word.
 */

import { countCompletedToday, fareOf, type Trip } from '@/lib/earnings';
import { boundsOf, decodePolyline, distanceMeters, resolveHeading } from '@/lib/geo';
import { getLanguage, languageLabel, setLanguage } from '@/lib/language';
import { DEFAULT_PREFS, getNotificationPrefs, setNotificationPrefs } from '@/lib/notification-prefs';
import { normalizePhone } from '@/lib/phone';
import { timeAgo } from '@/lib/time-ago';
import { vehicleLabel } from '@/lib/vehicle';
import { VERIFICATION_BADGE } from '@/lib/verification-badge';

/* -------------------------------------------------------------------- phone */

describe('normalizePhone', () => {
  it('strips the spacing the field itself shows as a placeholder', () => {
    // "+91 98765 43210" is exactly what the placeholder displays and what arrives pasted
    // from Contacts. The server's phoneSchema rejects it outright — this is the bug that
    // made the last build unable to onboard anyone.
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
  });

  it('handles the other shapes a person actually types', () => {
    expect(normalizePhone('98765-43210')).toBe('9876543210');
    expect(normalizePhone('(0) 98765 43210')).toBe('09876543210');
    expect(normalizePhone('  9876543210  ')).toBe('9876543210');
  });

  it('keeps a leading + and only a leading +', () => {
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
    expect(normalizePhone('91+9876543210')).toBe('919876543210');
  });

  it('drops letters rather than passing them to the server', () => {
    expect(normalizePhone('+91 98765 abcde')).toBe('+9198765');
  });
});

/* ----------------------------------------------------------------- earnings */

describe('earnings', () => {
  const trip = (over: Partial<Trip> = {}): Trip => ({
    completedAt: new Date().toISOString(),
    actualFare: null,
    estimatedFare: 1000,
    ...over,
  });

  it('prefers the agreed fare over the original quote', () => {
    // actualFare is what the rider accepted; estimatedFare is only the opening ask.
    expect(fareOf(trip({ actualFare: 1350, estimatedFare: 1000 }))).toBe(1350);
    expect(fareOf(trip({ actualFare: null, estimatedFare: 1000 }))).toBe(1000);
  });

  it('treats a zero agreed fare as zero, not as missing', () => {
    expect(fareOf(trip({ actualFare: 0, estimatedFare: 1000 }))).toBe(0);
  });

  it('counts only trips completed today, in the driver’s own timezone', () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 3600_000);
    const trips = [
      trip({ completedAt: now.toISOString() }),
      trip({ completedAt: now.toISOString() }),
      trip({ completedAt: yesterday.toISOString() }),
      trip({ completedAt: null }),
    ];
    expect(countCompletedToday(trips)).toBe(2);
  });

  it('counts nothing from an empty history', () => {
    expect(countCompletedToday([])).toBe(0);
  });
});

/* ---------------------------------------------------------------------- geo */

describe('geo', () => {
  it('decodes a known Google polyline', () => {
    // The reference string from Google's own encoded-polyline documentation.
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(points).toHaveLength(3);
    expect(points[0].lat).toBeCloseTo(38.5, 4);
    expect(points[0].lng).toBeCloseTo(-120.2, 4);
    expect(points[2].lat).toBeCloseTo(43.252, 3);
  });

  it('returns nothing for an empty polyline instead of throwing', () => {
    expect(decodePolyline('')).toEqual([]);
  });

  it('measures a known distance', () => {
    // Kochi to Thrissur, ~66.6km straight line.
    const metres = distanceMeters({ lat: 9.9312, lng: 76.2673 }, { lat: 10.5276, lng: 76.2144 });
    expect(metres / 1000).toBeGreaterThan(66);
    expect(metres / 1000).toBeLessThan(67);
    expect(distanceMeters({ lat: 9.9312, lng: 76.2673 }, { lat: 9.9312, lng: 76.2673 })).toBeCloseTo(0, 5);
  });

  it('trusts the GPS heading only when actually moving', () => {
    const from = { lat: 9.9312, lng: 76.2673 };
    // ~1.1km due north — well past the 8m floor for deriving a bearing from movement.
    const north = { lat: 9.9412, lng: 76.2673 };

    // Above the speed floor the device's own heading is the better answer.
    expect(resolveHeading(from, north, 90, 10, 0)).toBe(90);

    // Below it, GPS heading is noise, so the bearing is derived from actual movement.
    expect(resolveHeading(from, north, 250, 0, 42)).toBeCloseTo(0, 0);

    // Stationary and with no usable history, the previous heading beats jitter.
    expect(resolveHeading(from, from, undefined, 0, 42)).toBe(42);
    expect(resolveHeading(null, north, undefined, undefined, 17)).toBe(17);
  });

  it('bounds a single point and a spread of points', () => {
    const one = boundsOf([{ lat: 10, lng: 76 }]);
    expect(one.minLat).toBe(10);
    expect(one.maxLat).toBe(10);

    const many = boundsOf([
      { lat: 9, lng: 75 },
      { lat: 11, lng: 77 },
      { lat: 10, lng: 76 },
    ]);
    expect(many.minLat).toBe(9);
    expect(many.maxLat).toBe(11);
    expect(many.minLng).toBe(75);
    expect(many.maxLng).toBe(77);
  });
});

/* ------------------------------------------------------------------- labels */

describe('labels', () => {
  it('names every vehicle type, and survives one it does not know', () => {
    for (const t of ['miniTruck', 'pickup', 'tataAce', 'tempo', 'largeTruck', 'container']) {
      expect(vehicleLabel(t)).toBeTruthy();
      expect(vehicleLabel(t)).not.toBe('—');
    }
    expect(vehicleLabel(null)).toBe('—');
    // An enum added on the server before the app knows about it must not render blank.
    expect(vehicleLabel('hovercraft')).toBe('hovercraft');
  });

  it('gives every verification status a badge', () => {
    for (const s of ['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUSPENDED'] as const) {
      expect(VERIFICATION_BADGE[s].label).toBeTruthy();
      expect(VERIFICATION_BADGE[s].tone).toBeTruthy();
    }
  });

  it('describes recent times the way a person would', () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 5_000).toISOString())).toBe('just now');
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(timeAgo(new Date(now - 3 * 3600_000).toISOString())).toBe('3h ago');
    expect(timeAgo(new Date(now - 2 * 86400_000).toISOString())).toBe('2d ago');
  });
});

/* -------------------------------------------------------- stored preferences */

describe('stored preferences', () => {
  it('starts from defaults when nothing has been saved', async () => {
    await expect(getNotificationPrefs()).resolves.toEqual(DEFAULT_PREFS);
  });

  it('round-trips a change', async () => {
    await setNotificationPrefs({ ...DEFAULT_PREFS, newLoadAlerts: false });
    await expect(getNotificationPrefs()).resolves.toMatchObject({ newLoadAlerts: false });
  });

  it('merges a partial saved value over the defaults', async () => {
    // A build that adds a preference must not read undefined for it on an existing install.
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    await AsyncStorage.setItem('truckgo.notificationPrefs', JSON.stringify({ newLoadAlerts: false }));

    const prefs = await getNotificationPrefs();
    expect(prefs.newLoadAlerts).toBe(false);
    expect(prefs.autoOpenAcceptedTrip).toBe(DEFAULT_PREFS.autoOpenAcceptedTrip);
  });

  it('falls back to defaults when the stored value is corrupt', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    await AsyncStorage.setItem('truckgo.notificationPrefs', 'not json at all');
    await expect(getNotificationPrefs()).resolves.toEqual(DEFAULT_PREFS);
  });

  it('defaults the language and round-trips a change', async () => {
    await expect(getLanguage()).resolves.toBe('en');
    await setLanguage('en');
    await expect(getLanguage()).resolves.toBe('en');
    expect(languageLabel('en')).toBe('English');
  });
});
