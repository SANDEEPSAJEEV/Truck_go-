/**
 * HTTP client for the suite.
 *
 * Two deliberate differences from the apps' own `apiFetch`:
 *
 *  - It never throws on a non-2xx. Every case asserts its status explicitly, so a client that
 *    turns 403 into an exception would make "expect a 403" read like error handling instead of
 *    an assertion.
 *
 *  - It paces itself. `generalLimiter` allows 300 requests per 60s per IP and the server runs
 *    behind `trust proxy 1`, so the whole suite shares one bucket. Pacing under that ceiling
 *    keeps rate limiting something the suite tests on purpose (case 14.7) rather than
 *    something it trips over at case 60 and spends the rest of the run confused by.
 */

const BASE = (process.env.E2E_BASE_URL ?? "https://truckgo-api.onrender.com").replace(/\/+$/, "");

export const BASE_URL = BASE;

// Under the server's 300/60s so the suite never trips the limiter by accident. The limiter is
// still exercised deliberately, by a case that opts out of pacing.
const BUDGET = 240;
const WINDOW_MS = 60_000;
const stamps: number[] = [];

async function takeToken(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > WINDOW_MS) stamps.shift();
    if (stamps.length < BUDGET) {
      stamps.push(now);
      return;
    }
    const waitMs = WINDOW_MS - (now - stamps[0]) + 50;
    console.log(`      \x1b[2m(rate-limit pacing: ${(waitMs / 1000).toFixed(1)}s)\x1b[0m`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/**
 * Access tokens live 15 minutes and a full run takes longer than that, so fixture tokens go
 * stale mid-suite. Rather than sprinkle re-logins through the cases, the client does what both
 * apps do: on a 401, refresh the caller's session once and retry. Without this, every case
 * after the fifteen-minute mark fails with a 401 that says nothing about the code under test.
 *
 * Registered by actors.ts, which owns the credentials. Kept as an injected hook so this module
 * doesn't import back into the fixtures.
 */
type TokenRefresher = (staleToken: string) => Promise<string | null>;
let refreshToken: TokenRefresher | null = null;

export function setTokenRefresher(fn: TokenRefresher): void {
  refreshToken = fn;
}

export type ApiResponse<T = any> = {
  status: number;
  body: T;
  /** Raw text, kept for the webhook cases where the exact bytes matter. */
  text: string;
  headers: Headers;
  /** `error.code` from the standard envelope, when the response carries one. */
  code?: string;
  /** `error.message` from the standard envelope. */
  message?: string;
};

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Access token to send as `Authorization: Bearer …`. */
  token?: string;
  query?: Record<string, string | number | undefined>;
  /** Send these bytes verbatim instead of JSON-encoding `body`. For webhook signature cases. */
  rawBody?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Skip the token bucket. Only for the case that deliberately exhausts the limiter. */
  unpaced?: boolean;
  /** Skip the refresh-and-retry on 401. Set internally on the retry, and by cases that are
   *  deliberately asserting a 401 for a token they forged or revoked themselves. */
  noRefresh?: boolean;
};

/**
 * Transport-level failures get retried; HTTP statuses never do.
 *
 * A dropped connection or a DNS hiccup says nothing about the code under test, and a suite
 * that aborts on one is worse than useless — it reports a network blip as a product defect.
 * A 4xx or 5xx, by contrast, is exactly the signal we came for and is returned untouched.
 */
const NETWORK_RETRIES = 3;

export async function api<T = any>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const res = await withNetworkRetry<T>(path, opts);

  // A 401 on a call that carried a token is almost always the 15-minute expiry, not a real
  // authorization result. Refresh once and retry; if the token still fails, the 401 is real
  // and gets returned for the case to assert on.
  if (res.status === 401 && opts.token && refreshToken && !opts.noRefresh) {
    const fresh = await refreshToken(opts.token);
    if (fresh && fresh !== opts.token) {
      return withNetworkRetry<T>(path, { ...opts, token: fresh, noRefresh: true });
    }
  }
  return res;
}

async function withNetworkRetry<T>(path: string, opts: RequestOptions): Promise<ApiResponse<T>> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt++) {
    try {
      return await attemptRequest<T>(path, opts);
    } catch (e) {
      lastError = e as Error;
      if (attempt === NETWORK_RETRIES) break;
      const backoffMs = 1000 * 2 ** attempt;
      console.log(`      \x1b[2m(network retry ${attempt + 1}/${NETWORK_RETRIES} in ${backoffMs}ms: ${path})\x1b[0m`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError;
}

async function attemptRequest<T>(path: string, opts: RequestOptions): Promise<ApiResponse<T>> {
  if (!opts.unpaced) await takeToken();

  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let payload: string | undefined;
  if (opts.rawBody !== undefined) {
    payload = opts.rawBody;
    headers["Content-Type"] ??= "application/json";
  } else if (opts.body !== undefined) {
    payload = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: payload,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const why = e instanceof Error && e.name === "AbortError" ? "timed out" : String(e);
    throw new Error(`${opts.method ?? "GET"} ${path} — network failure (${why})`);
  }
  clearTimeout(timer);

  const text = await res.text();
  let body: any = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    status: res.status,
    body,
    text,
    headers: res.headers,
    code: body?.error?.code,
    message: body?.error?.message,
  };
}

/** For setup steps, where a non-2xx means the fixture is broken rather than a case failing. */
export async function apiOk<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await api<T>(path, opts);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `setup: ${opts.method ?? "GET"} ${path} expected 2xx, got ${res.status} ${res.text.slice(0, 300)}`,
    );
  }
  return res.body;
}

/**
 * Render's free tier sleeps after ~15 minutes idle and takes 30-60s to wake. Every run starts
 * here so a cold start is a reported wait rather than a wall of timeouts.
 */
export async function waitForServer(maxMs = 180_000): Promise<number> {
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const res = await api("/health", { timeoutMs: 90_000, unpaced: true });
      if (res.status === 200) return Date.now() - started;
      console.log(`  health check → ${res.status}, retrying…`);
    } catch (e) {
      console.log(`  health check attempt ${attempt} failed (${(e as Error).message.slice(0, 80)})`);
    }
    if (Date.now() - started > maxMs) {
      throw new Error(`Server at ${BASE} did not become healthy within ${maxMs / 1000}s`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
