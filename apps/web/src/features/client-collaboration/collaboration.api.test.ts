import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithAuth, requestJson, uploadWithAuth } from '../../api/client';
import { clientMeetingApi, collaborationApi, createCustomerChatServices, isClientChannel, type ClientRelationship } from './collaboration.api';
import type { NativeConversation } from '@ks-os/contracts';
vi.mock('../../api/client', () => ({ fetchWithAuth: vi.fn(), requestJson: vi.fn(), uploadWithAuth: vi.fn() }));
const relationship: ClientRelationship = { id: 'relationship-a', tenantId: 'tenant-a', clientId: 'client-a', businessName: 'Harbour Accounting', clientName: 'Taylor Studio', logoUrl: null, primaryColor: '#164e63' };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(fetchWithAuth).mockImplementation(async () => new Response(JSON.stringify({ data: [], nextCursor: null }))); vi.mocked(requestJson).mockResolvedValue({ data: {} }); });
describe('customer collaboration service scope', () => {
  it('binds history, thread posting, reactions and files to the relationship with CUSTOMER context', async () => {
    const scope = new AbortController(), services = createCustomerChatServices(relationship, () => scope.signal);
    await services.api.messages('channel-a', 'thread-a'); await services.api.send('channel-a', { body: 'A reply', parentMessageId: 'thread-a', clientMessageId: crypto.randomUUID(), mentions: [] }); await services.api.react('channel-a', 'message-a', '👍', true); await services.files.files('channel-a');
    for (const [url, options] of vi.mocked(fetchWithAuth).mock.calls) { expect(url).toMatch(/^\/api\/v1\/customer\/collaboration\/relationship-a\/chat\/channel-a\//); expect(options).toMatchObject({ authContext: 'CUSTOMER', cache: 'no-store' }); }
    expect(vi.mocked(fetchWithAuth).mock.calls[1][1]?.body).toContain('thread-a');
    expect(services.messageLink({ conversationId: 'channel-a', messageId: 'message-a', parentMessageId: 'thread-a' })).toBe('/customer/collaboration/relationship-a/messages/channel-a?message=message-a&thread=thread-a');
  });
  it('refuses a global directory lookup and permits only a selected conversation roster', async () => {
    const services = createCustomerChatServices(relationship, () => new AbortController().signal);
    await expect(services.api.people(null)).rejects.toMatchObject({ status: 403 }); expect(fetchWithAuth).not.toHaveBeenCalled(); await services.api.people('channel-a', false, 'Ada'); expect(fetchWithAuth).toHaveBeenCalledWith(expect.stringContaining('/channel-a/members?'), expect.anything());
  });
  it('keeps meeting and fallback notification links inside the selected customer portal', () => {
    const services = createCustomerChatServices(relationship, () => new AbortController().signal);
    expect(services.messageLink({ conversationId: 'channel-a', meetingId: 'meeting-a', type: 'MEETING_UPDATED', id: 'notification-a' })).toBe('/customer/collaboration/relationship-a/meetings?conversationId=channel-a');
    expect(services.messageLink({ conversationId: null, meetingId: 'meeting-a', type: 'MEETING_INVITATION' })).toBe('/customer/collaboration/relationship-a/meetings');
    expect(services.messageLink({ conversationId: null, type: 'CHAT_INVITATION', id: 'notification-a' })).toBe('/customer/collaboration/relationship-a/messages');
    expect(services.messageLink({ conversationId: 'channel-a', meetingId: 'meeting-a', type: 'CALL_INCOMING', id: 'notification-a' })).toBe('/customer/collaboration/relationship-a/messages/channel-a');
  });
  it('aborts in-flight work when its relationship workspace is replaced', async () => {
    const scope = new AbortController(); const signals: AbortSignal[] = [];
    vi.mocked(fetchWithAuth).mockImplementation((_url, options) => { const captured = options?.signal as AbortSignal; signals.push(captured); return new Promise((_resolve, reject) => captured.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))); });
    const pending = createCustomerChatServices(relationship, () => scope.signal).api.channels(); scope.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(signals[0]?.aborted).toBe(true);
  });
  it('uses CUSTOMER upload context and rejects unmarked legacy CLIENT conversations', async () => {
    vi.mocked(uploadWithAuth).mockResolvedValue(new Response(JSON.stringify({ data: { status: 'AVAILABLE' } })));
    const services = createCustomerChatServices(relationship, () => new AbortController().signal), abort = new AbortController(); await services.files.upload('channel-a', 'file-a', new File(['hello'], 'note.txt'), abort.signal, vi.fn());
    expect(uploadWithAuth).toHaveBeenCalledWith(expect.stringContaining('/relationship-a/chat/channel-a/files/file-a'), expect.any(File), abort.signal, expect.any(Function), 'CUSTOMER');
    expect(isClientChannel({ type: 'CLIENT' } as NativeConversation)).toBe(false); expect(isClientChannel({ type: 'CHANNEL', externalClientChannel: true } as NativeConversation)).toBe(false); expect(isClientChannel({ type: 'CLIENT', externalClientChannel: true } as NativeConversation)).toBe(true);
  });
  it('uses authenticated meeting session routes and never the public guest gateway', async () => {
    const gateway = clientMeetingApi('relationship-a', 'meeting-a', { sessionId: 'session-a', csrfToken: 'csrf-secret', requestId: 'request-a' }); await gateway.session(); await gateway.join('join-a'); await gateway.leave();
    for (const [url, options] of vi.mocked(requestJson).mock.calls) { expect(url).toMatch(/^\/api\/v1\/customer\/collaboration\/relationship-a\/meetings\/meeting-a\/sessions\/session-a/); expect(options).toMatchObject({ authContext: 'CUSTOMER', credentials: 'include' }); }
    expect(vi.mocked(requestJson).mock.calls[1][1]).toMatchObject({ method: 'POST', headers: { 'X-KSOS-CSRF': 'csrf-secret' } });
  });
  it('hands off invitation secrets in a credentialed POST body and accepts through the verified session', async () => {
    await collaborationApi.handoff('private-invite'); await collaborationApi.accept();
    expect(requestJson).toHaveBeenNthCalledWith(1, '/api/v1/customer/collaboration/invitations/handoff', expect.objectContaining({ method: 'POST', body: JSON.stringify({ invitationToken: 'private-invite' }), authContext: 'CUSTOMER', credentials: 'include', referrerPolicy: 'no-referrer' }));
    expect(requestJson).toHaveBeenNthCalledWith(2, '/api/v1/customer/collaboration/invitations/accept', expect.objectContaining({ body: '{}' }));
  });
});
