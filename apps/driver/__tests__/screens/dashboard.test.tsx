/**
 * The dashboard — where a driver spends their day.
 *
 * Two of these cases exist because the bugs already happened: an online toggle that read
 * "Offline" while the server was still dispatching, and a preference that was written and
 * never read.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';

import Dashboard from '@/app/(app)/(tabs)/dashboard';
import { ApiError } from '@/lib/api';
import { setNotificationPrefs, DEFAULT_PREFS } from '@/lib/notification-prefs';
import { booking, driver } from '../fixtures';
import { testRouter, testSocket } from '../setup';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, apiFetch: jest.fn() };
});

jest.mock('@/components/live-map', () => ({ LiveMap: () => null }));

const { apiFetch } = jest.requireMock('@/lib/api') as { apiFetch: jest.Mock };

// `mock`-prefixed because jest hoists the factory above the imports and refuses to close
// over anything else.
let mockUser: ReturnType<typeof driver> | null = driver();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: mockUser, refreshUser: jest.fn() }),
}));

function serve(bookings: unknown[] = []) {
  apiFetch.mockImplementation((path: string) => {
    if (path === '/bookings/available') return Promise.resolve({ bookings });
    if (path === '/drivers/earnings') return Promise.resolve({ totalEarnings: 0, completedTrips: 0, trips: [] });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  mockUser = driver();
});

describe('the online toggle', () => {
  it('starts from what the server believes, not from false', async () => {
    // A driver who went online yesterday is still on the dispatch board this morning. The
    // toggle used to open at "Offline" while loads were still being sent to them.
    mockUser = driver({ driverProfile: { isOnline: true } });
    serve();
    await render(<Dashboard />);

    expect(await screen.findByText('Available loads')).toBeTruthy();
  });

  it('opens offline when the server says offline', async () => {
    mockUser = driver({ driverProfile: { isOnline: false } });
    serve();
    await render(<Dashboard />);

    expect(await screen.findByText('You are offline')).toBeTruthy();
  });

  it('publishes a position when going online', async () => {
    serve();
    await render(<Dashboard />);

    fireEvent(await screen.findByLabelText('Go online'), 'valueChange', true);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/drivers/location',
        expect.objectContaining({ method: 'PUT', body: expect.objectContaining({ isOnline: true }) }),
      ),
    );
  });

  it('goes offline without needing a GPS fix', async () => {
    // A driver parked underground, or who denied location, must still be able to stop
    // receiving work.
    mockUser = driver({ driverProfile: { isOnline: true } });
    serve();
    await render(<Dashboard />);

    fireEvent(await screen.findByLabelText('Go offline'), 'valueChange', false);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/drivers/location',
        expect.objectContaining({ method: 'PUT', body: { isOnline: false } }),
      ),
    );
  });

  it('explains a refused location permission and stays offline', async () => {
    // Not `Once`: the screen also asks for permission on focus to drive the map, so a
    // single-use mock is spent before the toggle ever runs.
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
      granted: false,
    });
    serve();
    await render(<Dashboard />);

    fireEvent(await screen.findByLabelText('Go online'), 'valueChange', true);

    expect(await screen.findByText(/Location permission is needed/)).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalledWith('/drivers/location', expect.anything());
  });
});

describe('verification gating', () => {
  it('replaces the load board with the reason when not approved', async () => {
    mockUser = driver({ driverProfile: { verificationStatus: 'PENDING', isOnline: false } });
    serve();
    await render(<Dashboard />);

    expect(await screen.findByText('Verification Pending')).toBeTruthy();
    expect(screen.queryByText('Available loads')).toBeNull();
  });

  it('names the action needed when documents were rejected', async () => {
    mockUser = driver({ driverProfile: { verificationStatus: 'REJECTED', isOnline: false } });
    serve();
    await render(<Dashboard />);

    expect(await screen.findByText('Action needed on your documents')).toBeTruthy();
  });

  it('stays quiet about the feed being refused, since the card already explains it', async () => {
    mockUser = driver({ driverProfile: { verificationStatus: 'PENDING', isOnline: false } });
    apiFetch.mockImplementation((path: string) => {
      if (path === '/bookings/available') {
        return Promise.reject(new ApiError(403, 'DRIVER_NOT_APPROVED', 'Your account is not approved yet.'));
      }
      return Promise.resolve({ totalEarnings: 0, completedTrips: 0, trips: [] });
    });
    await render(<Dashboard />);

    await screen.findByText('Verification Pending');
    // Repeating it as an error would be noise on top of the card that already says it.
    expect(screen.queryByText('Your account is not approved yet.')).toBeNull();
  });
});

describe('bidding from the board', () => {
  it('will not submit a custom bid below the auto-quoted fare', async () => {
    mockUser = driver({ driverProfile: { isOnline: true } });
    serve([booking({ id: 'bkg_9', status: 'AWAITING_BIDS', estimatedFare: 4200, myBid: null })]);
    await render(<Dashboard />);

    fireEvent.press(await screen.findByText('Place bid'));
    const field = await screen.findByDisplayValue('4200');
    fireEvent.changeText(field, '3000');
    await waitFor(() => expect(field.props.value).toBe('3000'));
    fireEvent.press(screen.getByText('Submit'));

    // The server refuses this too; the point is not to waste the trip.
    await waitFor(() => expect(apiFetch).not.toHaveBeenCalledWith('/bookings/bkg_9/bids', expect.anything()));
  });

  it('accepts a load at the asking fare', async () => {
    mockUser = driver({ driverProfile: { isOnline: true } });
    serve([booking({ id: 'bkg_9', status: 'AWAITING_BIDS', estimatedFare: 4200, myBid: null })]);
    await render(<Dashboard />);

    fireEvent.press(await screen.findByText('Accept Ride'));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/bookings/bkg_9/bids', {
        method: 'POST',
        body: { amount: 4200 },
      }),
    );
  });
});

describe('reacting to dispatch', () => {
  it('opens the trip when a bid is accepted, by default', async () => {
    mockUser = driver({ driverProfile: { isOnline: true } });
    serve();
    await render(<Dashboard />);
    await screen.findByText('Available loads');

    testSocket.emitServer('bid:accepted', { bookingId: 'bkg_7' });

    await waitFor(() => expect(testRouter.push).toHaveBeenCalledWith('/(app)/trip/bkg_7'));
  });

  it('respects the driver turning that off', async () => {
    // The setting was written and never read, so the toggle did nothing at all.
    await setNotificationPrefs({ ...DEFAULT_PREFS, autoOpenAcceptedTrip: false });
    mockUser = driver({ driverProfile: { isOnline: true } });
    serve();
    await render(<Dashboard />);
    await screen.findByText('Available loads');

    testSocket.emitServer('bid:accepted', { bookingId: 'bkg_7' });

    await waitFor(() => expect(testSocket.on).toHaveBeenCalledWith('bid:accepted', expect.any(Function)));
    expect(testRouter.push).not.toHaveBeenCalled();
  });

  it('drops a load from the board once someone else takes it', async () => {
    mockUser = driver({ driverProfile: { isOnline: true } });
    serve([booking({ id: 'bkg_9', status: 'AWAITING_BIDS' })]);
    await render(<Dashboard />);
    await screen.findByText('TRK-4F2A91');

    testSocket.emitServer('load:taken', { bookingId: 'bkg_9' });

    await waitFor(() => expect(screen.queryByText('TRK-4F2A91')).toBeNull());
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});
