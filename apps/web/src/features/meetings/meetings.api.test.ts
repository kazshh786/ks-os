import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guestMeetingsApi, meetingsApi, mediaMeeting, type ScheduledMeeting } from './meetings.api';
const mocks = vi.hoisted(() => ({ authenticated: vi.fn(), publicFetch: vi.fn(), body: {} as unknown }));
vi.mock('../../api/client', () => ({ requestJson: mocks.authenticated }));
vi.mock('../../diagnostics/http', () => ({ fetchPublicApi: mocks.publicFetch, readJsonResponse: async () => mocks.body, responseError: (_response: unknown, message: string) => new Error(message) }));
const credential = { sessionId: 'session-a', csrfToken: 'csrf-for-session-a', requestId: 'original-request' };
beforeEach(() => { vi.clearAllMocks(); mocks.publicFetch.mockResolvedValue({ ok: true }); mocks.body = { data: { state: 'WAITING' } }; mocks.authenticated.mockResolvedValue({ data: {} }); });
describe('guest and staff request separation', () => {
  it('sends invitation capability only in a public POST body with no staff credentials', async () => {
    await guestMeetingsApi.resolve('private-invitation'); const [url, init] = mocks.publicFetch.mock.calls[0];
    expect(url).toBe('/api/v1/public/meetings/resolve'); expect(url).not.toContain('private-invitation'); expect(JSON.parse(init.body)).toEqual({ invitationToken: 'private-invitation' });
    expect(init).toMatchObject({ credentials: 'include', cache: 'no-store', referrerPolicy: 'no-referrer', method: 'POST' }); expect(init.headers.has('Authorization')).toBe(false); expect(init.headers.has('X-KS-Support-Session')).toBe(false); expect(mocks.authenticated).not.toHaveBeenCalled();
  });
  it('uses only the scoped session route and CSRF header when requesting media', async () => {
    await guestMeetingsApi.join(credential, 'join-request'); const [url, init] = mocks.publicFetch.mock.calls[0]; expect(url).toBe('/api/v1/public/meetings/sessions/session-a/join'); expect(init.headers.get('X-KSOS-CSRF')).toBe('csrf-for-session-a'); expect(JSON.parse(init.body)).toEqual({ requestId: 'join-request' });
    await guestMeetingsApi.session(credential); const [, read] = mocks.publicFetch.mock.calls[1]; expect(read.method).toBe('GET'); expect(read.body).toBeUndefined(); expect(read.headers.has('X-KSOS-CSRF')).toBe(false);
  });
  it('keeps staff calls authenticated and does not add client-controlled tenant identifiers', async () => {
    await meetingsApi.join('meeting-a', 'join-a'); expect(mocks.authenticated).toHaveBeenCalledWith('/api/v1/meetings/meeting-a/join', { method: 'POST', body: JSON.stringify({ requestId: 'join-a' }) }); expect(mocks.publicFetch).not.toHaveBeenCalled();
  });
  it('preserves the server permission boundary and maps participant ids for the reused media panel', () => {
    const value = mediaMeeting({ id: 'meeting-a', title: 'Review', hostUserId: 'host-user', createdBy: 'creator', status: 'ACTIVE', canManage: false, conversationId: null, participants: [{ id: 'host-participant', userId: 'host-user', name: 'Host' }, { id: 'guest-participant', userId: null, name: 'Guest' }] } as ScheduledMeeting);
    expect(value.createdBy).toBe('host-participant'); expect(value.conversationId).toBe(''); expect(value.participants?.map(person => person.userId)).toEqual(['host-participant', 'guest-participant']); expect(value.canManage).toBe(false);
  });
});
