/**
 * Trip chat. Written for the driver-app completion and never executed until now.
 *
 * The case that matters most is the failing send: a message the app loses is worse than a
 * message that visibly failed, because the driver has no way to know it never arrived.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Chat from '@/app/(app)/chat/[id]';
import { ApiError } from '@/lib/api';
import { message } from '../fixtures';
import { setRouteParams, testSocket } from '../setup';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, apiFetch: jest.fn() };
});

jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'drv_1' }, refreshUser: jest.fn() }),
}));

const { apiFetch } = jest.requireMock('@/lib/api') as { apiFetch: jest.Mock };

beforeEach(() => setRouteParams({ id: 'bkg_1' }));

describe('reading the conversation', () => {
  it('shows an invitation rather than a blank screen when there are no messages', async () => {
    apiFetch.mockResolvedValue({ messages: [] });
    await render(<Chat />);

    expect(await screen.findByText(/No messages yet/)).toBeTruthy();
  });

  it('renders both sides of the conversation', async () => {
    apiFetch.mockResolvedValue({
      messages: [
        message({ id: 'm1', senderId: 'drv_1', text: 'Which gate should I use?' }),
        message({ id: 'm2', senderId: 'usr_9', text: 'Gate 3, past the weighbridge.' }),
      ],
    });
    await render(<Chat />);

    expect(await screen.findByText('Which gate should I use?')).toBeTruthy();
    expect(screen.getByText('Gate 3, past the weighbridge.')).toBeTruthy();
  });

  it('reports a load failure instead of looking empty', async () => {
    apiFetch.mockRejectedValue(new ApiError(500, 'INTERNAL', 'Could not load messages.'));
    await render(<Chat />);

    expect(await screen.findByText('Could not load messages.')).toBeTruthy();
  });
});

describe('sending', () => {
  it('will not send an empty or whitespace-only message', async () => {
    apiFetch.mockResolvedValue({ messages: [] });
    await render(<Chat />);
    await screen.findByText(/No messages yet/);

    const send = screen.getByText('Send');
    fireEvent.press(send);
    // Nothing beyond the initial load.
    expect(apiFetch.mock.calls.filter(([, opts]) => opts?.method === 'POST')).toHaveLength(0);

    fireEvent.changeText(screen.getByPlaceholderText('Message the customer'), '   ');
    fireEvent.press(send);
    expect(apiFetch.mock.calls.filter(([, opts]) => opts?.method === 'POST')).toHaveLength(0);
  });

  it('posts the message and clears the draft', async () => {
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST') return Promise.resolve({ message: message({ id: 'm9', text: 'On my way.' }) });
      return Promise.resolve({ messages: [] });
    });

    await render(<Chat />);
    await screen.findByText(/No messages yet/);

    const field = screen.getByPlaceholderText('Message the customer');
    fireEvent.changeText(field, 'On my way.');
    // Send is disabled until the draft is non-empty, and that state change is scheduled
    // rather than immediate — pressing straight away presses a disabled button.
    await waitFor(() => expect(field.props.value).toBe('On my way.'));
    fireEvent.press(screen.getByText('Send'));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/trips/bkg_1/messages', {
        method: 'POST',
        body: { text: 'On my way.' },
      }),
    );
    expect(await screen.findByText('On my way.')).toBeTruthy();
    expect(field.props.value).toBe('');
  });

  it('keeps the draft when the send fails', async () => {
    // Retyping a message the app threw away is worse than the failure itself — the driver
    // is usually holding a phone in one hand at a loading bay.
    apiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST') return Promise.reject(new ApiError(0, 'NETWORK', 'Could not send that message.'));
      return Promise.resolve({ messages: [] });
    });

    await render(<Chat />);
    await screen.findByText(/No messages yet/);

    const field = screen.getByPlaceholderText('Message the customer');
    fireEvent.changeText(field, 'Running twenty minutes late.');
    await waitFor(() => expect(field.props.value).toBe('Running twenty minutes late.'));
    fireEvent.press(screen.getByText('Send'));

    expect(await screen.findByText('Could not send that message.')).toBeTruthy();
    expect(field.props.value).toBe('Running twenty minutes late.');
  });
});

describe('live delivery', () => {
  it('appends a message that arrives over the socket', async () => {
    apiFetch.mockResolvedValue({ messages: [] });
    await render(<Chat />);
    await screen.findByText(/No messages yet/);

    testSocket.emitServer('chat:message', message({ id: 'm5', senderId: 'usr_9', text: 'Gate 3, past the weighbridge.' }));

    expect(await screen.findByText('Gate 3, past the weighbridge.')).toBeTruthy();
  });

  it('ignores a message belonging to a different trip', async () => {
    apiFetch.mockResolvedValue({ messages: [] });
    await render(<Chat />);
    await screen.findByText(/No messages yet/);

    testSocket.emitServer('chat:message', message({ id: 'm6', bookingId: 'other_trip', text: 'Not for this trip.' }));

    await waitFor(() => expect(screen.queryByText('Not for this trip.')).toBeNull());
  });

  it('shows a message once when it arrives twice', async () => {
    // The sender gets its own message back from the room as well as from the POST response.
    apiFetch.mockResolvedValue({ messages: [] });
    await render(<Chat />);
    await screen.findByText(/No messages yet/);

    const dup = message({ id: 'm7', text: 'Arrived at the gate.' });
    testSocket.emitServer('chat:message', dup);
    testSocket.emitServer('chat:message', dup);

    await screen.findByText('Arrived at the gate.');
    expect(screen.getAllByText('Arrived at the gate.')).toHaveLength(1);
  });
});
