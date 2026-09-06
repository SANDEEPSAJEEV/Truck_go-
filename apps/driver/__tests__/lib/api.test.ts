/**
 * `api.ts` — every request in the app goes through it, and nothing has ever tested it.
 *
 * Its refresh logic is the part that matters most: get it wrong in one direction and an
 * expired token signs the driver out mid-shift; wrong in the other and a network blip does
 * the same. Both have already happened once on the server side of this project.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiFetch, ApiError, clearTokens, getAccessToken, getRefreshToken, setTokens, warmUp } from '@/lib/api';

const ACCESS_KEY = 'truckgo.accessToken';

/** Builds a fetch Response without needing a real one. */
function reply(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

describe('token storage', () => {
  it('round-trips both tokens', async () => {
    await setTokens('access-1', 'refresh-1');
    expect(await getAccessToken()).toBe('access-1');
    expect(await getRefreshToken()).toBe('refresh-1');
  });

  it('keeps the existing refresh token when only an access token is given', async () => {
    // Rotation returns a new access token and sometimes no refresh token. Overwriting the
    // stored one with undefined would end the session at the next expiry.
    await setTokens('access-1', 'refresh-1');
    await setTokens('access-2');
    expect(await getAccessToken()).toBe('access-2');
    expect(await getRefreshToken()).toBe('refresh-1');
  });

  it('clears both on sign-out', async () => {
    await setTokens('a', 'r');
    await clearTokens();
    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
  });
});

describe('requests', () => {
  it('sends the bearer token and parses JSON', async () => {
    await setTokens('access-1', 'refresh-1');
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply(200, { ok: true }));

    const result = await apiFetch<{ ok: boolean }>('/drivers/me');

    expect(result).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
  });

  it('omits the Authorization header when auth is false', async () => {
    await setTokens('access-1', 'refresh-1');
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply(200, {}));

    await apiFetch('/auth/login', { method: 'POST', body: { phone: '9', password: 'p' }, auth: false });

    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('treats 204 as success with no body rather than failing to parse', async () => {
    await setTokens('access-1', 'refresh-1');
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply(204));

    await expect(apiFetch('/drivers/location', { method: 'PUT', body: {} })).resolves.toBeUndefined();
  });

  it('surfaces the server error envelope both apps rely on', async () => {
    await setTokens('access-1', 'refresh-1');
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply(400, { error: { code: 'BELOW_FLOOR', message: 'Your bid must be at least ₹900.' } }));

    await expect(apiFetch('/bookings/x/bids', { method: 'POST', body: { amount: 1 } })).rejects.toMatchObject({
      status: 400,
      code: 'BELOW_FLOOR',
      message: 'Your bid must be at least ₹900.',
    });
  });

  it('reports a network failure as status 0, distinct from any server reply', async () => {
    await setTokens('access-1', 'refresh-1');
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('Network request failed'));

    const error = (await apiFetch('/drivers/me').catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.isNetwork).toBe(true);
  });
});

describe('token refresh', () => {
  it('refreshes once on a 401 and retries the original request', async () => {
    await setTokens('stale', 'refresh-1');
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockResolvedValueOnce(reply(200, { accessToken: 'fresh', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(reply(200, { user: { id: 'd1' } }));

    const result = await apiFetch<{ user: { id: string } }>('/drivers/me');

    expect(result.user.id).toBe('d1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The retry must carry the new token, not the one that just failed.
    const [, retryInit] = fetchMock.mock.calls[2];
    expect((retryInit?.headers as Record<string, string>).Authorization).toBe('Bearer fresh');
    expect(await getAccessToken()).toBe('fresh');
  });

  it('shares one refresh between requests that 401 together', async () => {
    // Two screens polling at once both get a 401. Refreshing twice would rotate the token
    // out from under the first refresh and trigger the server's reuse detection, which
    // revokes the whole session — the driver is signed out for being busy.
    await setTokens('stale', 'refresh-1');
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockResolvedValueOnce(reply(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockResolvedValueOnce(reply(200, { accessToken: 'fresh', refreshToken: 'refresh-2' }))
      .mockResolvedValue(reply(200, { ok: true }));

    await Promise.all([apiFetch('/drivers/me'), apiFetch('/drivers/earnings')]);

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('signs the driver out when the refresh token is rejected', async () => {
    await setTokens('stale', 'dead-refresh');
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockResolvedValueOnce(reply(401, { error: { code: 'SESSION_REVOKED', message: 'revoked' } }));

    await expect(apiFetch('/drivers/me')).rejects.toBeInstanceOf(ApiError);
    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
  });

  it('keeps the session when the refresh itself fails on the network', async () => {
    // The distinction that matters: "your session is over" versus "we could not ask right
    // now". Clearing tokens on a tunnel or a lift signs out a driver who did nothing wrong.
    await setTokens('stale', 'refresh-1');
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(apiFetch('/drivers/me')).rejects.toBeInstanceOf(ApiError);
    expect(await getRefreshToken()).toBe('refresh-1');
  });

  it('does not attempt a refresh when there is no refresh token', async () => {
    await AsyncStorage.setItem(ACCESS_KEY, 'stale');
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply(401, { error: { code: 'UNAUTHORIZED', message: 'nope' } }));

    await expect(apiFetch('/drivers/me')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on a 403 — that is a permission answer, not an expiry', async () => {
    await setTokens('access-1', 'refresh-1');
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply(403, { error: { code: 'DRIVER_NOT_APPROVED', message: 'not approved' } }));

    await expect(apiFetch('/bookings/available')).rejects.toMatchObject({ code: 'DRIVER_NOT_APPROVED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getAccessToken()).toBe('access-1');
  });
});

describe('warmUp', () => {
  it('never surfaces a rejection, however badly the ping fails', async () => {
    // Deliberately fire-and-forget: it returns void, not a promise, so nothing awaits it at
    // launch. That makes an unhandled rejection the risk — on a cold server, which is
    // exactly when the ping is most likely to fail.
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('Network request failed'));

    expect(() => warmUp()).not.toThrow();
    // Let the swallowed rejection settle before checking nothing escaped.
    await new Promise((r) => setTimeout(r, 0));

    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

