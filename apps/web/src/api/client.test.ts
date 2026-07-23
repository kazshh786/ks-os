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

describe('fetchWithAuth', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
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
});
