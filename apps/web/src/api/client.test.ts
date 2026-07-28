import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithAuth } from './client';

const { getSession, refreshSession, signOut } = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession, refreshSession, signOut } },
}));

const session = (accessToken: string) => ({
  data: { session: { access_token: accessToken } },
  error: null,
});

describe('fetchWithAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    refreshSession.mockResolvedValue({ data: { session: null }, error: null });
    signOut.mockResolvedValue({ error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    sessionStorage.clear();
  });

  it('marks string request bodies as JSON by default', async () => {
    await fetchWithAuth('/api/v1/bookings', {
      method: 'POST',
      body: JSON.stringify({ serviceId: 'service-id' }),
    });

    const [, request] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(request?.headers).get('Content-Type')).toBe('application/json');
  });

  it('preserves an explicitly supplied content type', async () => {
    await fetchWithAuth('/api/v1/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'content',
    });

    const [, request] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(request?.headers).get('Content-Type')).toBe('text/plain');
  });

  it('retries with a token already rotated by another auth listener', async () => {
    getSession
      .mockResolvedValueOnce(session('old-token'))
      .mockResolvedValueOnce(session('new-token'));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 })));

    const response = await fetchWithAuth('/api/v1/workspace/session');

    expect(response.status).toBe(200);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    const [, retryRequest] = vi.mocked(fetch).mock.calls[1];
    expect(new Headers(retryRequest?.headers).get('Authorization')).toBe('Bearer new-token');
  });

  it('recovers a session rotated elsewhere when manual refresh loses the race', async () => {
    getSession
      .mockResolvedValueOnce(session('old-token'))
      .mockResolvedValueOnce(session('old-token'))
      .mockResolvedValueOnce(session('new-token'));
    refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('Invalid Refresh Token: Refresh Token Not Found'),
    });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 })));

    const response = await fetchWithAuth('/api/v1/workspace/session');

    expect(response.status).toBe(200);
    expect(signOut).not.toHaveBeenCalled();
    const [, retryRequest] = vi.mocked(fetch).mock.calls[1];
    expect(new Headers(retryRequest?.headers).get('Authorization')).toBe('Bearer new-token');
  });

  it('returns the API failure without revoking the browser session when refresh cannot recover', async () => {
    getSession
      .mockResolvedValueOnce(session('old-token'))
      .mockResolvedValueOnce(session('old-token'))
      .mockResolvedValueOnce({ data: { session: null }, error: null });
    refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('Invalid Refresh Token: Refresh Token Not Found'),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    const response = await fetchWithAuth('/api/v1/workspace/session');

    expect(response.status).toBe(401);
    expect(signOut).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
