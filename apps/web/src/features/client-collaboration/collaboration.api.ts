import { fetchWithAuth, requestJson, uploadWithAuth, type AuthenticatedRequestInit } from '../../api/client';
import { ChatError, createChatApi, type Page } from '../chat/chat.api';
import { createPhase4Api, messageLink, isMeetingNotice } from '../chat/chat.phase4.api';
import type { ChatServices } from '../chat/ChatServices';
import type { NativeConversation } from '@ks-os/contracts';
import type { GuestCredential, GuestSession, MeetingBrand, PublicMeeting } from '../meetings/meetings.api';
import type { JoinTicket } from '../calls/calls.api';

export type ClientConversation = NativeConversation & { type: 'CLIENT'; externalClientChannel: true };
export const isClientChannel = (value: NativeConversation): value is ClientConversation => value.type === 'CLIENT' && (value as ClientConversation).externalClientChannel === true;
export type ClientRelationship = { id: string; tenantId: string; clientId: string; businessName: string; clientName: string; logoUrl: string | null; primaryColor: string; secondaryColor?: string | null };
export type CollaborationSession = { actorId: string; displayName: string; relationships: ClientRelationship[] };
export type ClientMeeting = PublicMeeting & { id: string; conversationId: string };
export type ClientContact = { relationshipId: string; customerAccountId: string; name: string; email: string; status: string };
export type ClientAccess = { contacts: ClientContact[]; invitations: Array<{ id: string; email: string; expiresAt: string; status: string }>; staff: Array<{ id: string; name: string; role: string }>; canManage: boolean };
export type ClientChannelSummary = { id: string; name: string; clientId: string; clientName: string; archivedAt: string | null };
const customerBase = '/api/v1/customer/collaboration';
const staffBase = '/api/v1/client-collaboration';
const data = async <T>(request: Promise<{ data: T }>) => (await request).data;
const post = <T>(path: string, body: unknown = {}, customer = false) => requestJson<T>(path, { method: 'POST', body: JSON.stringify(body), ...(customer ? { authContext: 'CUSTOMER' as const, credentials: 'include' as const, cache: 'no-store' as const, referrerPolicy: 'no-referrer' as const } : {}) });
export const relationshipPath = (id: string) => customerBase + '/' + encodeURIComponent(id);
export const portalPath = (id: string) => '/customer/collaboration/' + encodeURIComponent(id);
export const relationshipBrand = (value: ClientRelationship): MeetingBrand => ({ name: value.businessName, logoUrl: value.logoUrl, primaryColor: value.primaryColor, secondaryColor: value.secondaryColor });

export const collaborationApi = {
  session: (signal?: AbortSignal) => data(requestJson<{ data: CollaborationSession }>(customerBase + '/session', { authContext: 'CUSTOMER', signal, cache: 'no-store' })),
  handoff: (invitationToken: string) => data(post<{ data: { expiresAt: string } }>(customerBase + '/invitations/handoff', { invitationToken }, true)),
  pending: () => data(requestJson<{ data: { available: boolean } }>(customerBase + '/invitations/pending', { authContext: 'CUSTOMER', credentials: 'include', cache: 'no-store' })),
  accept: () => data(post<{ data: { relationshipId: string; conversationId: string } }>(customerBase + '/invitations/accept', {}, true)),
  meetings: (relationshipId: string, query = '', signal?: AbortSignal) => requestJson<Page<ClientMeeting>>(relationshipPath(relationshipId) + '/meetings' + (query ? '?' + query : ''), { authContext: 'CUSTOMER', signal, cache: 'no-store' }),
  requestMeeting: (relationshipId: string, meetingId: string, conversationId: string, requestId: string) => data(post<{ data: GuestSession }>(relationshipPath(relationshipId) + '/meetings/' + encodeURIComponent(meetingId) + '/request', { conversationId, requestId }, true)),
};
export function clientMeetingApi(relationshipId: string, meetingId: string, credential: GuestCredential) {
  const base = relationshipPath(relationshipId) + '/meetings/' + encodeURIComponent(meetingId) + '/sessions/' + encodeURIComponent(credential.sessionId);
  const action = <T>(suffix: string, body: unknown) => data(requestJson<{ data: T }>(base + suffix, { authContext: 'CUSTOMER', method: 'POST', body: JSON.stringify(body), credentials: 'include', cache: 'no-store', headers: { 'X-KSOS-CSRF': credential.csrfToken } }));
  return {
    session: () => data(requestJson<{ data: GuestSession }>(base, { authContext: 'CUSTOMER', credentials: 'include', cache: 'no-store' })),
    join: (requestId: string) => action<JoinTicket>('/join', { requestId }),
    leave: () => action<unknown>('/leave', {}),
  };
}
export const staffCollaborationApi = {
  customers: (q = '', signal?: AbortSignal) => data(requestJson<{ data: Array<{ id: string; name: string }> }>(staffBase + '/customers?' + new URLSearchParams({ q }), { signal })),
  customerReference: (reference: string, signal?: AbortSignal) => data(requestJson<{ data: Array<{ id: string; name: string }> }>(staffBase + '/customers?' + new URLSearchParams({ clientReference: reference }), { signal })),
  config: (clientId: string) => data(requestJson<{ data: { staff: Array<{ id: string; name: string }>; contacts: ClientContact[]; canManage: boolean } }>(staffBase + '/config?' + new URLSearchParams({ clientId }))),
  channels: (query: string, signal?: AbortSignal) => requestJson<Page<ClientChannelSummary>>(staffBase + '/channels?' + query, { signal }),
  create: (input: { clientId: string; name: string; description: string; staffUserIds: string[]; requestId: string }) => data(post<{ data: { id: string } }>(staffBase + '/channels', input)),
  access: (id: string) => data(requestJson<{ data: ClientAccess }>(staffBase + '/channels/' + id + '/access')),
  invite: (id: string, email: string, requestId: string) => data(post<{ data: { id: string; url: string; expiresAt: string } }>(staffBase + '/channels/' + id + '/invitations', { email, requestId })),
  revokeInvitation: (id: string, invitationId: string) => post(staffBase + '/channels/' + id + '/invitations/' + invitationId + '/revoke'),
  addContact: (id: string, relationshipId: string) => post(staffBase + '/channels/' + id + '/contacts', { relationshipId }),
  removeContact: (id: string, relationshipId: string) => requestJson(staffBase + '/channels/' + id + '/contacts/' + relationshipId, { method: 'DELETE' }),
  revokeRelationship: (id: string) => post(staffBase + '/relationships/' + id + '/revoke'),
  meetings: (id: string) => requestJson<Page<ClientMeeting>>(staffBase + '/channels/' + id + '/meetings'),
  shareMeeting: (id: string, meetingId: string) => post(staffBase + '/channels/' + id + '/meetings', { meetingId }),
  unshareMeeting: (id: string, meetingId: string) => requestJson(staffBase + '/channels/' + id + '/meetings/' + meetingId, { method: 'DELETE' }),
};

/** No mutable global context: every request remains bound to this authorised relationship. */
export function createCustomerChatServices(relationship: ClientRelationship, scopeSignal: () => AbortSignal): ChatServices {
  const base = relationshipPath(relationship.id) + '/chat';
  const authenticatedFetch = async (url: string, options: AuthenticatedRequestInit = {}) => {
    const scope = scopeSignal();
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (scope.aborted || options.signal?.aborted) abort();
    scope.addEventListener('abort', abort, { once: true }); options.signal?.addEventListener('abort', abort, { once: true });
    try { return await fetchWithAuth(url, { ...options, authContext: 'CUSTOMER', signal: controller.signal, cache: 'no-store' }); }
    finally { scope.removeEventListener('abort', abort); options.signal?.removeEventListener('abort', abort); }
  };
  const request = async <T,>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> => {
    const response = await authenticatedFetch(base + path, { method, signal, timeoutMs: 15000, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ChatError(payload.error?.message || 'This conversation is no longer available.', response.status);
    return payload;
  };
  const api = createChatApi(request);
  const scopedPeople = api.people;
  api.people = (id, ...args) => id ? scopedPeople(id, ...args) : Promise.reject(new ChatError('Choose a conversation to find its participants.', 403));
  const files = createPhase4Api(base, request, authenticatedFetch, (url, body, signal, progress) => uploadWithAuth(url, body, signal, progress, 'CUSTOMER'));
  return { api, files, external: true, notificationName: relationship.businessName, messageLink: value => {
    const root = portalPath(relationship.id);
    if (isMeetingNotice(value)) return root + '/meetings?' + new URLSearchParams({ ...(value.conversationId ? { conversationId: value.conversationId } : {}), ...(value.meetingId ? { meetingId: value.meetingId } : {}) });
    if (!value.conversationId) return root + '/messages';
    // Customer media always uses the explicit waiting-room admission flow, never a staff call route.
    return messageLink({ ...value, meetingId: null }).replace('/app/chat/', root + '/messages/');
  } };
}
