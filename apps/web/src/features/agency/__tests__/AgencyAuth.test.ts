import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));

vi.mock('../../../api/client', () => ({
  fetchWithAuth,
  setDefaultAuthContextOverride: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      refreshSession: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: vi.fn(),
      mfa: {
        listFactors: vi.fn(),
        unenroll: vi.fn(),
        enroll: vi.fn(),
        challengeAndVerify: vi.fn(),
      },
    },
  },
}));

import { agencyFetch } from '../AgencyAuth';

afterEach(() => {
  fetchWithAuth.mockReset();
});

describe('agencyFetch', () => {
  it('returns data from a valid JSON response', async () => {
    fetchWithAuth.mockResolvedValue(new Response(JSON.stringify({ data: { ready: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': 'request-1' },
    }));

    await expect(agencyFetch('/tenants')).resolves.toEqual({ ready: true });
  });

  it('preserves structured Fastify errors', async () => {
    fetchWithAuth.mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'LAUNCH_BLOCKED', message: 'Launch requirements are incomplete.', details: [{ key: 'OWNER_ACTIVE' }] },
    }), {
      status: 409,
      headers: { 'content-type': 'application/json', 'x-request-id': 'request-2' },
    }));

    await expect(agencyFetch('/tenants/tenant/launch')).rejects.toMatchObject({
      message: 'Launch requirements are incomplete.',
      code: 'LAUNCH_BLOCKED',
      details: [{ key: 'OWNER_ACTIVE' }],
      status: 409,
      path: '/tenants/tenant/launch',
      requestId: 'request-2',
    });
  });

  it('converts HTML gateway responses into a safe transport error', async () => {
    fetchWithAuth.mockResolvedValue(new Response('<!DOCTYPE html><html><body>Bad gateway</body></html>', {
      status: 502,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));

    await expect(agencyFetch('/tenants/tenant/users')).rejects.toMatchObject({
      code: 'AGENCY_API_UNAVAILABLE',
      status: 502,
      path: '/tenants/tenant/users',
    });
  });

  it('does not expose returned HTML in the operator error', async () => {
    fetchWithAuth.mockResolvedValue(new Response('<!DOCTYPE html><title>Private proxy page</title>', {
      status: 404,
      headers: { 'content-type': 'text/html' },
    }));

    try {
      await agencyFetch('/missing');
      throw new Error('Expected agencyFetch to fail');
    } catch (error) {
      expect(error).toMatchObject({ code: 'AGENCY_API_UNAVAILABLE' });
      expect((error as Error).message).not.toContain('<!DOCTYPE');
      expect((error as Error).message).not.toContain('Private proxy page');
    }
  });
});
