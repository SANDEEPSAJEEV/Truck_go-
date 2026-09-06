/**
 * The trip screen — the custody chain as the driver experiences it.
 *
 * The rule these cases exist to protect: the driver moves the trip between gates, and only
 * the customer's PIN opens one. A screen that offered the wrong control at the wrong moment
 * would either strand a driver or let them skip a hand-off.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Trip from '@/app/(app)/trip/[id]';
import { ApiError } from '@/lib/api';
import { booking } from '../fixtures';
import { setRouteParams, testRouter, testSocket } from '../setup';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, apiFetch: jest.fn() };
});

jest.mock('@/components/live-map', () => ({ LiveMap: () => null }));

const { apiFetch } = jest.requireMock('@/lib/api') as { apiFetch: jest.Mock };

beforeEach(() => setRouteParams({ id: 'bkg_1' }));

/** Serves the booking, and anything else the screen asks for, without failing. */
function withBooking(over: Record<string, unknown> = {}) {
  apiFetch.mockImplementation((path: string) => {
    if (path === '/bookings/bkg_1') return Promise.resolve({ booking: booking(over) });
    if (path.endsWith('/cancellation-policy')) return Promise.resolve({ secondsRemaining: 480 });
    if (path.endsWith('/eta')) return Promise.resolve({ target: 'pickup', etaMinutes: 12, distanceKm: 6.2, polyline: null });
    return Promise.resolve({});
  });
}

describe('the action offered at each stage', () => {
  it.each([
    ['ACCEPTED', 'Start driving to pickup'],
    ['EN_ROUTE_TO_PICKUP', "I've arrived at pickup"],
    ['IN_TRANSIT', 'Arrived at drop-off'],
    ['UNLOADING', 'Finish & complete delivery'],
  ])('offers the right move at %s', async (status, label) => {
    withBooking({ status });
    await render(<Trip />);

    expect(await screen.findByText(label)).toBeTruthy();
  });

  it.each([
    ['ARRIVED_AT_PICKUP', 'Pickup PIN from customer'],
    ['LOADING', 'Start PIN from customer'],
    ['ARRIVED_AT_DROP', 'Unload PIN from customer'],
  ])('asks for the customer PIN at %s, not a button the driver can press alone', async (status, label) => {
    withBooking({ status });
    await render(<Trip />);

    expect(await screen.findByText(label)).toBeTruthy();
    // No self-service advance exists at a custody gate.
    expect(screen.queryByText('Start driving to pickup')).toBeNull();
    expect(screen.queryByText("I've arrived at pickup")).toBeNull();
  });

  it('offers nothing further once delivered', async () => {
    withBooking({ status: 'DELIVERED' });
    await render(<Trip />);

    await waitFor(() => expect(screen.queryByText('Finish & complete delivery')).toBeNull());
    expect(screen.queryByText(/PIN from customer/)).toBeNull();
  });

  it('advances the status when the driver taps the action', async () => {
    withBooking({ status: 'ACCEPTED' });
    await render(<Trip />);

    fireEvent.press(await screen.findByText('Start driving to pickup'));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/trips/bkg_1/status',
        expect.objectContaining({ method: 'POST', body: expect.objectContaining({ status: 'EN_ROUTE_TO_PICKUP' }) }),
      ),
    );
  });
});

describe('the PIN gate', () => {
  it('refuses to submit fewer than four digits', async () => {
    withBooking({ status: 'ARRIVED_AT_PICKUP' });
    await render(<Trip />);
    await screen.findByText('Pickup PIN from customer');

    const field = screen.getByDisplayValue('');
    fireEvent.changeText(field, '12');
    await waitFor(() => expect(field.props.value).toBe('12'));
    fireEvent.press(screen.getByText('Verify & start loading'));

    // The gate is four digits; a short code must not even reach the server.
    await waitFor(() => expect(apiFetch).not.toHaveBeenCalledWith('/trips/bkg_1/verify-otp', expect.anything()));
  });

  it('sends the code and the stage it belongs to', async () => {
    withBooking({ status: 'LOADING' });
    await render(<Trip />);
    await screen.findByText('Start PIN from customer');

    const field = screen.getByDisplayValue('');
    fireEvent.changeText(field, '4242');
    await waitFor(() => expect(field.props.value).toBe('4242'));
    fireEvent.press(screen.getByText('Verify & start trip'));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/trips/bkg_1/verify-otp', {
        method: 'POST',
        body: { otp: '4242', stage: 'start' },
      }),
    );
  });

  it('shows the server’s reason when the PIN is wrong', async () => {
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === '/bookings/bkg_1') return Promise.resolve({ booking: booking({ status: 'ARRIVED_AT_PICKUP' }) });
      if (path.endsWith('/verify-otp')) return Promise.reject(new ApiError(400, 'INVALID_OTP', 'pickup code is wrong'));
      return Promise.resolve({});
    });
    await render(<Trip />);
    await screen.findByText('Pickup PIN from customer');

    const field = screen.getByDisplayValue('');
    fireEvent.changeText(field, '9999');
    await waitFor(() => expect(field.props.value).toBe('9999'));
    fireEvent.press(screen.getByText('Verify & start loading'));

    expect(await screen.findByText('pickup code is wrong')).toBeTruthy();
  });
});

describe('cancelling', () => {
  it('is offered before the goods are aboard', async () => {
    withBooking({ status: 'EN_ROUTE_TO_PICKUP' });
    await render(<Trip />);

    expect(await screen.findByText('Cancel trip')).toBeTruthy();
  });

  it('is not offered once loading has started — that is a support conversation', async () => {
    withBooking({ status: 'IN_TRANSIT' });
    await render(<Trip />);

    await screen.findByText('Arrived at drop-off');
    expect(screen.queryByText('Cancel trip')).toBeNull();
  });

  it('asks for confirmation and shows how long is left to cancel freely', async () => {
    withBooking({ status: 'ACCEPTED' });
    await render(<Trip />);

    fireEvent.press(await screen.findByText('Cancel trip'));

    expect(await screen.findByText(/Free to cancel for another 8 minutes/)).toBeTruthy();
    expect(screen.getByText('Keep trip')).toBeTruthy();
  });

  it('warns instead when the free window has closed', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/bookings/bkg_1') return Promise.resolve({ booking: booking({ status: 'ACCEPTED' }) });
      if (path.endsWith('/cancellation-policy')) return Promise.resolve({ secondsRemaining: 0 });
      return Promise.resolve({});
    });
    await render(<Trip />);

    fireEvent.press(await screen.findByText('Cancel trip'));

    expect(await screen.findByText(/free-cancellation window has closed/)).toBeTruthy();
  });

  it('backs out cleanly when the driver changes their mind', async () => {
    withBooking({ status: 'ACCEPTED' });
    await render(<Trip />);

    fireEvent.press(await screen.findByText('Cancel trip'));
    fireEvent.press(await screen.findByText('Keep trip'));

    await waitFor(() => expect(screen.queryByText('Keep trip')).toBeNull());
    expect(apiFetch).not.toHaveBeenCalledWith('/trips/bkg_1/cancel', expect.anything());
  });

  it('cancels and returns to the dashboard', async () => {
    withBooking({ status: 'ACCEPTED' });
    await render(<Trip />);

    fireEvent.press(await screen.findByText('Cancel trip'));
    const confirm = await screen.findByText('Keep trip');
    expect(confirm).toBeTruthy();
    fireEvent.press(screen.getAllByText('Cancel trip')[0]);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/trips/bkg_1/cancel', { method: 'POST', body: {} }),
    );
    await waitFor(() => expect(testRouter.replace).toHaveBeenCalledWith('/(app)/(tabs)/dashboard'));
  });

  it('still lets the driver cancel when the policy cannot be read', async () => {
    // Not knowing the window must not remove the ability to get out of a trip.
    apiFetch.mockImplementation((path: string) => {
      if (path === '/bookings/bkg_1') return Promise.resolve({ booking: booking({ status: 'ACCEPTED' }) });
      if (path.endsWith('/cancellation-policy')) return Promise.reject(new ApiError(500, 'INTERNAL', 'nope'));
      return Promise.resolve({});
    });
    await render(<Trip />);

    fireEvent.press(await screen.findByText('Cancel trip'));
    expect(await screen.findByText('Keep trip')).toBeTruthy();
  });
});

describe('reacting to the other side', () => {
  it('re-reads the trip when the rider changes its status', async () => {
    // A rider can cancel while the driver is driving to the pickup. Before this listener the
    // screen kept offering "Arrived at pickup" for a job that no longer existed.
    withBooking({ status: 'ACCEPTED' });
    await render(<Trip />);
    await screen.findByText('Start driving to pickup');

    const before = apiFetch.mock.calls.filter(([p]) => p === '/bookings/bkg_1').length;
    testSocket.emitServer('trip:status', { status: 'CANCELLED' });

    await waitFor(() =>
      expect(apiFetch.mock.calls.filter(([p]) => p === '/bookings/bkg_1').length).toBeGreaterThan(before),
    );
  });

  it('offers a way back when the trip cannot be loaded', async () => {
    apiFetch.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Booking not found'));
    await render(<Trip />);

    expect(await screen.findByText('Booking not found')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});
