/**
 * apiClient — Tầng gọi HTTP dùng chung cho toàn bộ frontend, giao tiếp với FastAPI backend.
 */
import { USE_MOCK } from '../mocks/config';
import { mockApiRequest } from '../mocks/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type AccessTokenProvider = () => string | null | undefined;

// Không có token cho tới khi Supabase Auth được tích hợp; các request khi đó vẫn hoạt động bình thường (không có header Authorization).
let getAccessToken: AccessTokenProvider = () => null;

/** Cho phép lớp Auth (tác vụ sau) cung cấp access token hiện tại của Supabase. */
export function setAccessTokenProvider(provider: AccessTokenProvider): void {
  getAccessToken = provider;
}

/**
 * Render free tier "spin down" khiến request đầu tiên sau một thời gian rảnh có thể mất
 * hàng chục giây để backend khởi động lại. Theo dõi các request đang treo lâu hơn ngưỡng
 * này để UI có thể hiện thông báo "đang khởi động server" thay vì trông như bị treo.
 */
const COLD_START_THRESHOLD_MS = 2500;

type ColdStartListener = (isSlow: boolean) => void;

const coldStartListeners = new Set<ColdStartListener>();
let slowRequestCount = 0;

function notifyColdStart(isSlow: boolean): void {
  coldStartListeners.forEach((listener) => listener(isSlow));
}

export function subscribeColdStart(listener: ColdStartListener): () => void {
  coldStartListeners.add(listener);
  return () => coldStartListeners.delete(listener);
}

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Lets the request survive page unload (tab close/reload/navigation) -- see
   * `fetch`'s `keepalive` option. Used for best-effort cleanup calls fired from a
   * `pagehide` handler, where the page may finish unloading before a normal request
   * would otherwise complete. */
  keepalive?: boolean;
}

/**
 * Lets the auth layer refresh the session (Supabase `refreshSession`) when the backend says the
 * access token is no longer valid -- e.g. a tab left open for hours, or a laptop waking from
 * sleep, sends its first request with an expired token before Supabase's own timer refreshed it.
 * Resolves to the new access token, or null if the session cannot be refreshed.
 */
type SessionRefresher = () => Promise<string | null>;
let refreshSession: SessionRefresher | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function setSessionRefresher(refresher: SessionRefresher | null): void {
  refreshSession = refresher;
}

/** One refresh shared by every request that hit a 401 at the same moment. */
function refreshOnce(): Promise<string | null> {
  if (!refreshSession) return Promise.resolve(null);
  if (!refreshInFlight) {
    refreshInFlight = refreshSession()
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * Transient failures worth retrying for idempotent reads: the network request itself failed
 * (server unreachable, still booting, connection reset) or a gateway/availability status, which
 * is what a sleeping Render free-tier instance answers while it spins back up.
 */
const RETRYABLE_STATUS = new Set([502, 503, 504]);
/** Backoff between attempts: ~1 minute in total, the time a cold Render instance needs. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers, signal, keepalive } = options;
  if (USE_MOCK) {
    return mockApiRequest<T>(path, method, body);
  }

  // Only reads are retried after a failure: re-sending a POST/PATCH/DELETE whose response was
  // lost could apply it twice. A 401 is different -- the server rejected the request before
  // doing anything -- so any method may be re-sent once with a refreshed token.
  const canRetry = method === 'GET' && !keepalive;

  let firedColdStart = false;
  const coldStartTimer = setTimeout(() => {
    firedColdStart = true;
    slowRequestCount += 1;
    if (slowRequestCount === 1) notifyColdStart(true);
  }, COLD_START_THRESHOLD_MS);

  const send = async (token: string | null) => {
    const requestHeaders: Record<string, string> = { Accept: 'application/json', ...headers };
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    if (token) requestHeaders['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      keepalive,
    });
    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const data = isJson ? await response.json().catch(() => null) : await response.text();
    return { response, data, isJson };
  };

  try {
    let token = getAccessToken() ?? null;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      let result: Awaited<ReturnType<typeof send>>;
      try {
        result = await send(token);
      } catch (err) {
        // fetch() itself rejected: network down, server not listening yet, CORS-less gateway page.
        if (isAbort(err) || !canRetry || attempt >= RETRY_DELAYS_MS.length) throw err;
        await wait(RETRY_DELAYS_MS[attempt], signal);
        continue;
      }
      const { response, data, isJson } = result;

      if (response.status === 401 && token && !refreshed) {
        refreshed = true;
        const fresh = await refreshOnce();
        if (fresh && fresh !== token) {
          token = fresh;
          attempt -= 1; // a token refresh is not a failed attempt
          continue;
        }
      }
      if (RETRYABLE_STATUS.has(response.status) && canRetry && attempt < RETRY_DELAYS_MS.length) {
        await wait(RETRY_DELAYS_MS[attempt], signal);
        continue;
      }
      if (!response.ok) {
        const message =
          isJson && data && typeof data === 'object' && 'detail' in data
            ? String((data as { detail: unknown }).detail)
            : response.statusText;
        throw new ApiError(response.status, message, data);
      }
      return data as T;
    }
  } finally {
    clearTimeout(coldStartTimer);
    if (firedColdStart) {
      slowRequestCount -= 1;
      if (slowRequestCount === 0) notifyColdStart(false);
    }
  }
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
