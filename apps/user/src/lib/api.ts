import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEMO_MODE, demoFetch } from '@/lib/demo';

// Same call shape the original app used: apiFetch(path, { method, body }).
// Point EXPO_PUBLIC_API_URL at your backend (see backend/.env.example for the matching server).
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

const TOKEN_KEY = 'truckgo.accessToken';
const REFRESH_KEY = 'truckgo.refreshToken';
const REQUEST_TIMEOUT_MS = 20_000;

export async function getAccessToken() {
  // Demo mode has no backend to authenticate against, so a placeholder keeps the auth
  // context past its "is there a token?" gate and into the app.
  if (DEMO_MODE) return 'demo-token';
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setTokens(accessToken: string, refreshToken?: string) {
  await AsyncStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) await AsyncStorage.setItem(REFRESH_KEY, refreshToken);
}

export async function clearTokens() {
  await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_KEY]);
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }

  // status 0 means the request never reached the server, so the caller's own
  // state is still valid — retrying is meaningful, signing out is not.
  get isNetwork() {
    return this.status === 0;
  }

  get isAuth() {
    return this.status === 401 || this.status === 403;
  }
}

type FetchOpts = { method?: string; body?: unknown; auth?: boolean; query?: Record<string, string> };

async function rawFetch(path: string, opts: FetchOpts = {}) {
  const url = new URL(path, API_URL);
  if (opts.query) Object.entries(opts.query).forEach(([k, v]) => url.searchParams.set(k, v));

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== false) {
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url.toString(), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', 'The server took too long to respond. Please try again.');
    }
    throw new ApiError(0, 'NETWORK', "Can't reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

// Several screens can hit a 401 at the same moment; without this they would each
// fire their own refresh, and the losers would retry with an already-rotated token.
let refreshInFlight: Promise<boolean> | null = null;

function tryRefresh() {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = await AsyncStorage.getItem(REFRESH_KEY);
      if (!refreshToken) return false;
      const res = await rawFetch('/auth/refresh', { method: 'POST', body: { refreshToken }, auth: false });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) await clearTokens();
        return false;
      }
      const data = await res.json().catch(() => null);
      if (!data?.accessToken) return false;
      await setTokens(data.accessToken, data.refreshToken);
      return true;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function apiFetch<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  // Served entirely from in-memory fixtures — no network, no database. See lib/demo.ts.
  if (DEMO_MODE) return demoFetch<T>(path, opts);

  let res = await rawFetch(path, opts);

  if (res.status === 401 && opts.auth !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await rawFetch(path, opts);
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'UNKNOWN',
      data?.error?.message ?? res.statusText ?? 'Something went wrong. Please try again.',
    );
  }
  return data as T;
}

export { API_URL };
