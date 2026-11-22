import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../mocks/config', () => ({ USE_MOCK: false }));

import { ApiError, apiClient, setAccessTokenProvider, setSessionRefresher } from './apiClient';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setAccessTokenProvider(() => 'old-token');
  setSessionRefresher(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAccessTokenProvider(() => null);
  setSessionRefresher(null);
});

const authOf = (call: number) => (fetchMock.mock.calls[call][1]?.headers as Record<string, string>)['Authorization'];

describe('apiClient retries', () => {
  it('retries a GET after a temporary network failure and returns the data', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(json(200, [{ id: 'r1' }]));
    const promise = apiClient.get<Array<{ id: string }>>('/study-rooms/?group_id=g');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual([{ id: 'r1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a GET on 503 (temporary gateway failure) until it answers', async () => {
    fetchMock
      .mockResolvedValueOnce(json(503, { detail: 'waking up' }))
      .mockResolvedValueOnce(json(502, { detail: 'bad gateway' }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    const promise = apiClient.get('/groups/mine');
    await vi.advanceTimersByTimeAsync(1000 + 2000);
    await expect(promise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after the retry budget and surfaces the error', async () => {
    fetchMock.mockResolvedValue(json(503, { detail: 'down' }));
    const promise = apiClient.get('/groups/mine');
    const assertion = expect(promise).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(7_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('never re-sends a write after a failure (it may already have been applied)', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { detail: 'down' }));
    await expect(apiClient.post('/groups/', { name: 'x' })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a slow AI POST pending without duplicating the write', async () => {
    let complete: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const pending = apiClient.post('/groups/g/tasks/ai/generate', { goal: 'JLPT N2' });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    complete(json(200, { title: 'JLPT N2', nodes: [] }));
    await expect(pending).resolves.toMatchObject({ title: 'JLPT N2' });
  });

  it('does not retry client errors like 404', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { detail: 'Not found' }));
    await expect(apiClient.get('/groups/x')).rejects.toMatchObject({ status: 404, message: 'Not found' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('apiClient token refresh', () => {
  it('refreshes an expired token once on 401 and re-sends the request with the new one', async () => {
    const refresher = vi.fn(async () => 'new-token');
    setSessionRefresher(refresher);
    fetchMock.mockResolvedValueOnce(json(401, { detail: 'Token expired' })).mockResolvedValueOnce(json(200, { id: 'g' }));
    await expect(apiClient.get('/groups/g')).resolves.toEqual({ id: 'g' });
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(authOf(0)).toBe('Bearer old-token');
    expect(authOf(1)).toBe('Bearer new-token');
  });

  it('also re-sends writes after a 401, since the server rejected them before acting', async () => {
    setSessionRefresher(async () => 'new-token');
    fetchMock.mockResolvedValueOnce(json(401, { detail: 'Token expired' })).mockResolvedValueOnce(json(201, { id: 'n' }));
    await expect(apiClient.post('/groups/', { name: 'x' })).resolves.toEqual({ id: 'n' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one refresh between requests that hit 401 at the same time', async () => {
    let resolveRefresh: (token: string) => void = () => {};
    const refresher = vi.fn(() => new Promise<string>((r) => (resolveRefresh = r)));
    setSessionRefresher(refresher);
    fetchMock.mockImplementation(async (_url, init) => {
      const auth = (init?.headers as Record<string, string>)['Authorization'];
      return auth === 'Bearer new-token' ? json(200, { ok: true }) : json(401, { detail: 'Token expired' });
    });
    const a = apiClient.get('/a');
    const b = apiClient.get('/b');
    await vi.advanceTimersByTimeAsync(0);
    resolveRefresh('new-token');
    await expect(Promise.all([a, b])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it('surfaces the 401 when the session cannot be refreshed', async () => {
    setSessionRefresher(async () => null);
    fetchMock.mockResolvedValueOnce(json(401, { detail: 'Token expired' }));
    await expect(apiClient.get('/groups/mine')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
