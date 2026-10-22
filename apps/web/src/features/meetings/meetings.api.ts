import { requestJson } from '../../api/client';
import { fetchPublicApi, readJsonResponse, responseError } from '../../diagnostics/http';
import type { JoinTicket, Meeting as MediaMeeting, MeetingType } from '../calls/calls.api';

export type MeetingBrand = { name: string; logoUrl: string | null; primaryColor: string; secondaryColor?: string | null; welcomeMessage?: string | null };
export type GuestState = 'WAITING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CANCELLED' | 'REMOVED';
export type WaitingGuest = { id: string; name: string; state: GuestState; createdAt: string; expiresAt: string };
export type InvitationSummary = { id: string; email?: string | null; expiresAt: string; revokedAt: string | null; claimedAt: string | null };
export type ScheduledMeeting = Omit<MediaMeeting, 'conversationId' | 'status' | 'participants'> & {
  conversationId: string | null; status: MediaMeeting['status'] | 'SCHEDULED' | 'EXPIRED';
  hostUserId: string; scheduledStartAt: string; scheduledEndAt: string; timezone: string; audience: 'INTERNAL' | 'EXTERNAL_CLIENT';
  description: string | null; customerId: string | null; customerName: string | null; customerReference: string | null; appointmentId: string | null;
  version: number; canJoin: boolean; canInvite: boolean; branding: MeetingBrand; waiting: WaitingGuest[];
  attendeeIds: string[]; cohostIds: string[]; guestScreenShare: boolean; invitations: InvitationSummary[];
  participants: Array<Omit<NonNullable<MediaMeeting['participants']>[number], 'userId'> & { id: string; userId: string | null }>;
};
export type MeetingsConfig = {
  enabled: boolean; guestEnabled?: boolean; canCreate: boolean; currentUserId: string; timezone: string; branding: MeetingBrand;
  limits: { concurrentMeetings: number; participants: number; externalGuests: number };
  hosts: Array<{ id: string; name: string }>;
  customers: Array<{ id: string; name: string; reference: string }>;
  appointments: Array<{ id: string; customerId: string; startAt: string; endAt: string; label: string }>;
};
export type MeetingInput = {
  title: string; description: string; audience: ScheduledMeeting['audience']; type: MeetingType; localStart: string; timezone: string; durationMinutes: number;
  hostUserId: string; customerId?: string | null; appointmentId?: string | null; attendeeIds: string[]; cohostIds: string[]; guestScreenShare: boolean;
};
export type MeetingPage = { data: ScheduledMeeting[]; nextCursor: string | null };
export type InvitationResult = { id: string; url: string; text: string; expiresAt: string; emailQueued: boolean };
export type PublicMeeting = {
  title: string; type: MeetingType; status: ScheduledMeeting['status']; scheduledStartAt: string; scheduledEndAt: string;
  timezone: string; hostName: string; branding: MeetingBrand; guestScreenShare: boolean; waitingRoomEnabled: true; participantLimit?: number;
};
export type GuestSession = { sessionId: string; csrfToken?: string; state: GuestState; name?: string; expiresAt: string; meeting: PublicMeeting | null };
export type GuestCredential = { sessionId: string; csrfToken: string; requestId: string };
const base = '/api/v1/meetings';
const idPath = (id: string) => `${base}/${encodeURIComponent(id)}`;
const data = async <T>(value: Promise<{ data: T }>) => (await value).data;
const post = <T>(path: string, body: unknown = {}) => requestJson<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const meetingsApi = {
  config: (customerReference = '') => data(requestJson<{ data: MeetingsConfig }>(base + '/config' + (customerReference ? '?customerReference=' + encodeURIComponent(customerReference) : ''))),
  list: (query = '', signal?: AbortSignal) => requestJson<MeetingPage>(`${base}${query ? '?' + query : ''}`, { signal }),
  meeting: (id: string) => data(requestJson<{ data: ScheduledMeeting }>(idPath(id))),
  create: (input: MeetingInput, requestId: string) => data(post<{ data: ScheduledMeeting }>(base, { ...input, requestId })),
  edit: (id: string, input: MeetingInput, version: number) => data(requestJson<{ data: ScheduledMeeting }>(idPath(id), { method: 'PATCH', body: JSON.stringify({ ...input, version }) })),
  start: (id: string) => data(post<{ data: ScheduledMeeting }>(idPath(id) + '/start')),
  cancel: (id: string) => data(post<{ data: ScheduledMeeting }>(idPath(id) + '/cancel')),
  end: (id: string) => data(post<{ data: ScheduledMeeting }>(idPath(id) + '/end')),
  join: (id: string, requestId: string) => data(post<{ data: Omit<JoinTicket, 'meeting'> & { meeting: ScheduledMeeting } }>(idPath(id) + '/join', { requestId })),
  leave: (id: string, sessionId: string) => post(idPath(id) + '/leave', { sessionId }),
  remove: (id: string, participantId: string) => post(idPath(id) + '/participants/' + encodeURIComponent(participantId) + '/remove'),
  waiting: (id: string) => data(requestJson<{ data: WaitingGuest[] }>(idPath(id) + '/waiting')),
  admit: (id: string, guestId: string, approve: boolean) => post(idPath(id) + '/guests/' + encodeURIComponent(guestId) + '/admission', { approve }),
  invite: (id: string, requestId: string, email?: string, expiresAt?: string) => data(post<{ data: InvitationResult }>(idPath(id) + '/invitations', { requestId, ...(email ? { email } : {}), ...(expiresAt ? { expiresAt } : {}) })),
  revoke: (id: string, invitationId: string) => post(idPath(id) + '/invitations/' + encodeURIComponent(invitationId) + '/revoke'),
};

/** Public requests deliberately never obtain staff authentication or support-session headers. */
async function publicRequest<T>(path: string, body?: unknown, credential?: GuestCredential): Promise<T> {
  const origin = String(import.meta.env.VITE_API_ORIGIN || '').trim().replace(/\/$/, '');
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (credential && body !== undefined) headers.set('X-KSOS-CSRF', credential.csrfToken);
  const response = await fetchPublicApi(origin + '/api/v1/public/meetings' + path, {
    method: body === undefined ? 'GET' : 'POST', headers, credentials: 'include', cache: 'no-store', referrerPolicy: 'no-referrer',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const error = payload as { error?: { message?: unknown } };
    throw responseError(response, typeof error?.error?.message === 'string' ? error.error.message : 'This meeting is not available. Please contact the organiser.', payload);
  }
  return (payload as { data: T }).data;
}
const sessionPath = (credential: GuestCredential) => '/sessions/' + encodeURIComponent(credential.sessionId);
export const guestMeetingsApi = {
  resolve: (invitationToken: string) => publicRequest<PublicMeeting>('/resolve', { invitationToken }),
  request: (invitationToken: string, name: string, requestId: string) => publicRequest<GuestSession>('/request', { invitationToken, name, requestId }),
  session: (credential: GuestCredential) => publicRequest<GuestSession>(sessionPath(credential), undefined, credential),
  join: (credential: GuestCredential, requestId: string) => publicRequest<JoinTicket>(sessionPath(credential) + '/join', { requestId }, credential),
  leave: (credential: GuestCredential) => publicRequest<unknown>(sessionPath(credential) + '/leave', {}, credential),
};

export function mediaMeeting(value: ScheduledMeeting): MediaMeeting {
  return {
    ...value, conversationId: value.conversationId || '', conversationName: value.title, createdBy: value.participants.find(person => person.userId === value.hostUserId)?.id || value.hostUserId,
    status: value.status === 'SCHEDULED' ? 'CREATED' : value.status === 'EXPIRED' ? 'CANCELLED' : value.status,
    participants: value.participants.map(person => ({ ...person, userId: person.id })),
  };
}
