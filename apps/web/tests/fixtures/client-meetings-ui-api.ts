// Isolated browser fixture only. Production resolves the real authenticated/public API module.
import type { GuestSession, MeetingInput, MeetingsConfig, PublicMeeting, ScheduledMeeting } from '../../src/features/meetings/meetings.api';
import type { Meeting } from '../../src/features/calls/calls.api';
const brand = { name: 'Harbour Accounting', logoUrl: null, primaryColor: '#164e63', secondaryColor: '#0f766e', welcomeMessage: 'Welcome. Take a moment to get comfortable before your consultation.' };
const customer = { id: 'customer-one', reference: 'customer-reference', name: 'Alex Taylor' };
export const config: MeetingsConfig = { enabled: true, guestEnabled: true, canCreate: true, currentUserId: 'ada', timezone: 'Europe/London', branding: brand, limits: { concurrentMeetings: 3, participants: 12, externalGuests: 8 }, hosts: [{ id: 'ada', name: 'Ada Patel' }, { id: 'grace', name: 'Grace Morgan' }], customers: [customer], appointments: [{ id: 'appointment-one', customerId: customer.id, startAt: '2027-07-20T09:00:00Z', endAt: '2027-07-20T09:45:00Z', label: 'Alex Taylor · Consultation' }] };
const initial: ScheduledMeeting = { id: 'meeting-one', conversationId: null, conversationName: 'Your quarterly accounts review', title: 'Your quarterly accounts review', type: 'VIDEO', audience: 'EXTERNAL_CLIENT', description: 'Review the last quarter, answer your questions and agree the next steps for your business.', status: 'SCHEDULED', createdBy: 'ada', hostUserId: 'ada', organizerName: 'Ada Patel', createdAt: '2027-07-01T09:00:00Z', startedAt: null, endedAt: null, endReason: null, expiresAt: '2099-07-20T11:00:00Z', scheduledStartAt: '2027-07-20T09:00:00Z', scheduledEndAt: '2027-07-20T09:45:00Z', timezone: 'Europe/London', customerId: customer.id, customerName: customer.name, customerReference: customer.reference, appointmentId: 'appointment-one', version: 1, canManage: true, canJoin: true, canInvite: true, branding: brand, waiting: [], attendeeIds: ['grace'], cohostIds: [], guestScreenShare: false, invitations: [], participants: [{ id: 'ada-participant', userId: 'ada', name: 'Ada Patel', role: 'HOST', invitationState: 'ACCEPTED', joinedAt: null, leftAt: null, sessionCount: 0 }, { id: 'grace-participant', userId: 'grace', name: 'Grace Morgan', role: 'PARTICIPANT', invitationState: 'INVITED', joinedAt: null, leftAt: null, sessionCount: 0 }] };
let meeting = { ...initial }; let guests = [{ id: 'guest-one', name: 'Alex Taylor', state: 'WAITING' as const, createdAt: '2027-07-20T08:58:00Z', expiresAt: initial.expiresAt }];
const publicMeeting = (): PublicMeeting => ({ title: meeting.title, type: meeting.type, status: meeting.status, scheduledStartAt: meeting.scheduledStartAt, scheduledEndAt: meeting.scheduledEndAt, timezone: meeting.timezone, hostName: meeting.organizerName, branding: brand, guestScreenShare: meeting.guestScreenShare, waitingRoomEnabled: true, participantLimit: 12 });
let guestState: GuestSession['state'] = 'WAITING', guestJoins = 0, staffJoins = 0;
const guestSession = (): GuestSession => ({ sessionId: '11111111-1111-4111-8111-111111111111', csrfToken: 'fixture-csrf-credential-123456789012345', name: 'Alex Taylor', expiresAt: initial.expiresAt, state: guestState, meeting: ['WAITING', 'APPROVED'].includes(guestState) ? publicMeeting() : null });
export function mediaMeeting(value: ScheduledMeeting): Meeting { return { ...value, conversationId: '', createdBy: 'ada-participant', status: value.status === 'SCHEDULED' ? 'CREATED' : value.status === 'EXPIRED' ? 'CANCELLED' : value.status, participants: value.participants.map(person => ({ ...person, userId: person.id })) }; }
export const meetingsApi = {
  config: async () => config,
  list: async (query = '') => { const params = new URLSearchParams(query), status = params.get('status'); const records = [meeting, { ...initial, id: 'completed-one', title: 'Business planning consultation', status: 'ENDED' as const, scheduledStartAt: '2027-07-12T13:00:00Z', scheduledEndAt: '2027-07-12T13:30:00Z', endedAt: '2027-07-12T13:30:00Z' }]; return { data: records.filter(value => !status || value.status === status), nextCursor: null }; },
  meeting: async () => ({ ...meeting }),
  create: async (input: MeetingInput) => { meeting = { ...initial, ...input, id: 'meeting-new', scheduledStartAt: new Date(input.localStart).toISOString(), scheduledEndAt: new Date(Date.parse(input.localStart) + input.durationMinutes * 60000).toISOString() }; return meeting; },
  edit: async (_id: string, input: MeetingInput) => { meeting = { ...meeting, ...input, version: meeting.version + 1, scheduledStartAt: new Date(input.localStart).toISOString(), scheduledEndAt: new Date(Date.parse(input.localStart) + input.durationMinutes * 60000).toISOString(), invitations: [] }; return meeting; },
  start: async () => { meeting = { ...meeting, status: 'RINGING' }; return meeting; },
  cancel: async () => { meeting = { ...meeting, status: 'CANCELLED' }; guestState = 'CANCELLED'; return meeting; },
  end: async () => { meeting = { ...meeting, status: 'ENDED' }; return meeting; },
  join: async () => { staffJoins++; meeting = { ...meeting, status: 'ACTIVE' }; return { token: 'isolated-ui-media', url: 'wss://unused.invalid', identity: 'ada:session', sessionId: 'media-session', expiresIn: 60, meeting }; },
  leave: async () => ({}), remove: async () => ({}),
  waiting: async () => guests,
  admit: async (_id: string, guestId: string, approve: boolean) => { guests = guests.filter(value => value.id !== guestId); guestState = approve ? 'APPROVED' : 'DENIED'; return {}; },
  invite: async () => { const invitation = { id: 'invitation-one', email: null, expiresAt: initial.expiresAt, revokedAt: null, claimedAt: null }; meeting = { ...meeting, invitations: [invitation] }; return { ...invitation, url: window.location.origin + '/meet#invite=isolated-guest-invitation', text: 'You are invited to your quarterly accounts review with Harbour Accounting. Open the meeting link and wait for your host to admit you.', emailQueued: false }; },
  revoke: async () => { meeting = { ...meeting, invitations: [] }; return {}; },
};
export const guestMeetingsApi = {
  resolve: async () => publicMeeting(), request: async () => guestSession(), session: async () => guestSession(),
  join: async () => { if (guestState !== 'APPROVED') throw new Error('Admission is required'); guestJoins++; return { token: 'isolated-ui-guest-media', url: 'wss://unused.invalid', identity: 'guest:session', sessionId: 'guest-media-session', expiresIn: 60, meeting: { ...mediaMeeting(meeting), canManage: false, participants: [] } }; },
  leave: async () => ({}),
};
export const clientMeetingsFixture = {
  guest(state: GuestSession['state'], status: ScheduledMeeting['status'] = 'ACTIVE') { guestState = state; meeting = { ...meeting, status }; window.dispatchEvent(new Event('focus')); },
  reset() { meeting = { ...initial }; guestState = 'WAITING'; guestJoins = 0; staffJoins = 0; guests = [{ id: 'guest-one', name: 'Alex Taylor', state: 'WAITING', createdAt: '2027-07-20T08:58:00Z', expiresAt: initial.expiresAt }]; },
  counts() { return { guestJoins, staffJoins }; },
};
