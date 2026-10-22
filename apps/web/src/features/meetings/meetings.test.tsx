import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GuestMeetingPage, { guestStorageKey, readGuestCredential } from './GuestMeetingPage';
import { MeetingForm } from './MeetingForm';
import { MeetingWaitingRoom } from './MeetingWaitingRoom';
import { MeetingInvitations } from './MeetingInvitations';
import { MeetingDetail } from './MeetingDetail';
import { MeetingsList } from './MeetingsList';
import { CustomerMeetings } from './CustomerMeetings';
import { brandStyle } from './MeetingBrand';
import { guestMeetingsApi, meetingsApi, type GuestSession, type MeetingsConfig, type PublicMeeting, type ScheduledMeeting } from './meetings.api';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), window: vi.fn(), role: 'owner', permissions: [] as string[] }));
vi.mock('./meetings.api', () => ({
  meetingsApi: { config: vi.fn(), list: vi.fn(), meeting: vi.fn(), create: vi.fn(), edit: vi.fn(), start: vi.fn(), cancel: vi.fn(), end: vi.fn(), join: vi.fn(), leave: vi.fn(), remove: vi.fn(), waiting: vi.fn(), admit: vi.fn(), invite: vi.fn(), revoke: vi.fn() },
  guestMeetingsApi: { resolve: vi.fn(), request: vi.fn(), session: vi.fn(), join: vi.fn(), leave: vi.fn() },
  mediaMeeting: (value: unknown) => value,
}));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ role: mocks.role, permissions: mocks.permissions, businessReference: 'business-a' }) }));
vi.mock('livekit-client', () => ({ Room: { getLocalDevices: async () => [] }, Track: { Kind: { Audio: 'audio', Video: 'video' } }, createLocalTracks: mocks.preview }));
vi.mock('../calls/MeetingWindow', () => ({ default: (props: any) => { mocks.window(props); return <section aria-label="Native meeting"><p>{props.brandName}</p><button onClick={() => void props.api.join(props.id, 'join-request')}>Join native meeting</button><button onClick={props.close}>Leave native meeting</button></section>; } }));

const brand = { name: 'Harbour Accounting', logoUrl: null, primaryColor: '#164e63', welcomeMessage: 'Welcome to your consultation.' };
const config: MeetingsConfig = { enabled: true, canCreate: true, currentUserId: 'host-a', timezone: 'Europe/London', branding: brand, limits: { concurrentMeetings: 3, participants: 12, externalGuests: 8 }, hosts: [{ id: 'host-a', name: 'Ada Patel' }, { id: 'staff-b', name: 'Morgan Lee' }], customers: [{ id: 'customer-a', reference: 'customer-reference-a', name: 'Alex Taylor' }], appointments: [{ id: 'appointment-a', customerId: 'customer-a', startAt: '2027-07-20T09:00:00Z', endAt: '2027-07-20T09:45:00Z', label: 'Alex consultation' }] };
const meeting: ScheduledMeeting = { id: 'meeting-a', conversationId: null, conversationName: 'Tax review', title: 'Tax review', description: 'Review this year’s accounts.', audience: 'EXTERNAL_CLIENT', type: 'VIDEO', status: 'SCHEDULED', createdBy: 'host-a', hostUserId: 'host-a', organizerName: 'Ada Patel', createdAt: '2027-01-01T09:00:00Z', startedAt: null, endedAt: null, endReason: null, expiresAt: '2027-07-20T11:00:00Z', scheduledStartAt: '2027-07-20T09:00:00Z', scheduledEndAt: '2027-07-20T09:30:00Z', timezone: 'Europe/London', customerId: 'customer-a', customerName: 'Alex Taylor', customerReference: 'customer-reference-a', appointmentId: null, version: 3, canManage: true, canJoin: true, canInvite: true, branding: brand, waiting: [], attendeeIds: [], cohostIds: [], guestScreenShare: false, invitations: [], participants: [] };
const publicMeeting: PublicMeeting = { title: meeting.title, type: 'VIDEO', status: 'SCHEDULED', scheduledStartAt: meeting.scheduledStartAt, scheduledEndAt: meeting.scheduledEndAt, timezone: meeting.timezone, hostName: 'Ada Patel', branding: brand, guestScreenShare: false, waitingRoomEnabled: true, participantLimit: 12 };
const guest: GuestSession = { sessionId: '11111111-1111-4111-8111-111111111111', csrfToken: 'csrf-token-for-isolated-test-123456789', state: 'WAITING', name: 'Alex Taylor', expiresAt: '2099-07-20T11:00:00Z', meeting: publicMeeting };
function mount(element: React.ReactNode) { return render(<MemoryRouter>{element}</MemoryRouter>); }
async function requestGuest() { render(<GuestMeetingPage/>); await userEvent.type(await screen.findByLabelText('Your name'), 'Alex Taylor'); await userEvent.click(screen.getByRole('button', { name: 'Request to join' })); await screen.findByRole('heading', { name: 'You are in the waiting room' }); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.role = 'owner'; mocks.permissions = []; sessionStorage.clear(); window.history.replaceState(null, '', '/meet#invite=isolated-invitation-secret');
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() } });
  mocks.preview.mockResolvedValue([]);
  vi.mocked(guestMeetingsApi.resolve).mockResolvedValue(publicMeeting); vi.mocked(guestMeetingsApi.request).mockResolvedValue(guest); vi.mocked(guestMeetingsApi.session).mockResolvedValue(guest); vi.mocked(guestMeetingsApi.join).mockResolvedValue({ token: 'test-token', url: 'wss://isolated.test', identity: 'guest', sessionId: 'media-session', expiresIn: 60, meeting: { ...meeting, status: 'ACTIVE', conversationId: '', canManage: false } }); vi.mocked(guestMeetingsApi.leave).mockResolvedValue({});
  vi.mocked(meetingsApi.list).mockResolvedValue({ data: [meeting], nextCursor: null }); vi.mocked(meetingsApi.meeting).mockResolvedValue(meeting); vi.mocked(meetingsApi.create).mockResolvedValue(meeting); vi.mocked(meetingsApi.edit).mockResolvedValue(meeting); vi.mocked(meetingsApi.waiting).mockResolvedValue([]); vi.mocked(meetingsApi.admit).mockResolvedValue({}); vi.mocked(meetingsApi.remove).mockResolvedValue({}); vi.mocked(meetingsApi.cancel).mockResolvedValue({ ...meeting, status: 'CANCELLED' }); vi.mocked(meetingsApi.invite).mockResolvedValue({ id: 'invite-a', url: 'https://meetings.test/meet#invite=secret', text: 'Please join your tax review.', expiresAt: '2099-07-20T11:00:00Z', emailQueued: false }); vi.mocked(meetingsApi.revoke).mockResolvedValue({});
});
afterEach(() => { cleanup(); sessionStorage.clear(); });

describe('guest admission boundary', () => {
  it('shows authoritative branding, clears the fragment, and does not capture or issue media credentials before admission', async () => {
    await requestGuest(); expect(screen.getByText('Harbour Accounting')).toBeInTheDocument(); expect(window.location.hash).toBe(''); expect(mocks.preview).not.toHaveBeenCalled(); expect(guestMeetingsApi.join).not.toHaveBeenCalled(); expect(mocks.window).not.toHaveBeenCalled();
    const stored = sessionStorage.getItem(guestStorageKey)!; expect(stored).not.toContain('isolated-invitation-secret'); expect(stored).not.toContain('test-token'); expect(readGuestCredential()?.sessionId).toBe(guest.sessionId);
  });
  it('captures preview only after explicit intent and stops preview when entering the waiting room', async () => {
    const track = { kind: 'video', attach: vi.fn(), detach: vi.fn(), stop: vi.fn() }; mocks.preview.mockResolvedValue([track]); render(<GuestMeetingPage/>);
    await userEvent.click(await screen.findByLabelText('Preview camera')); await screen.findByLabelText('Your camera preview');
    await userEvent.type(screen.getByLabelText('Your name'), 'Alex Taylor'); await userEvent.click(screen.getByRole('button', { name: 'Request to join' })); await screen.findByRole('heading', { name: 'You are in the waiting room' }); expect(track.stop).toHaveBeenCalled();
  });
  it('keeps an approved guest waiting until the room opens, then requests a token only on Join', async () => {
    await requestGuest(); vi.mocked(guestMeetingsApi.session).mockResolvedValue({ ...guest, state: 'APPROVED' }); act(() => window.dispatchEvent(new Event('focus'))); await screen.findByRole('heading', { name: 'You have been admitted' }); expect(mocks.window).not.toHaveBeenCalled();
    vi.mocked(guestMeetingsApi.session).mockResolvedValue({ ...guest, state: 'APPROVED', meeting: { ...publicMeeting, status: 'ACTIVE' } }); act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByRole('button', { name: 'Join native meeting' }); expect(guestMeetingsApi.join).not.toHaveBeenCalled();
    expect(mocks.window.mock.calls.at(-1)![0]).toMatchObject({ mode: 'guest', allowScreenShare: false, brandName: brand.name });
    await userEvent.click(screen.getByRole('button', { name: 'Join native meeting' })); await waitFor(() => expect(guestMeetingsApi.join).toHaveBeenCalledWith(expect.objectContaining({ sessionId: guest.sessionId, csrfToken: guest.csrfToken }), 'join-request')); expect(meetingsApi.join).not.toHaveBeenCalled();
  });
  it('recovers a scoped session without needing or re-resolving the invitation', async () => {
    sessionStorage.setItem(guestStorageKey, JSON.stringify({ sessionId: guest.sessionId, csrfToken: guest.csrfToken, requestId: 'original-request' })); window.history.replaceState(null, '', '/meet'); render(<GuestMeetingPage/>); await screen.findByRole('heading', { name: 'You are in the waiting room' }); expect(guestMeetingsApi.resolve).not.toHaveBeenCalled(); expect(guestMeetingsApi.request).not.toHaveBeenCalled();
  });
  it('purges meeting branding and media when admission is revoked', async () => {
    await requestGuest(); vi.mocked(guestMeetingsApi.session).mockResolvedValue({ ...guest, state: 'APPROVED', meeting: { ...publicMeeting, status: 'ACTIVE' } }); act(() => window.dispatchEvent(new Event('focus'))); await screen.findByRole('button', { name: 'Join native meeting' });
    vi.mocked(guestMeetingsApi.session).mockResolvedValue({ ...guest, state: 'CANCELLED', meeting: null }); act(() => window.dispatchEvent(new Event('focus'))); await screen.findByRole('heading', { name: 'This meeting is closed' }); expect(screen.queryByText('Tax review')).not.toBeInTheDocument(); expect(screen.queryByText(brand.name)).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Join native meeting' })).not.toBeInTheDocument();
  });
  it('rejects corrupt browser session metadata and uses no staff routes', async () => {
    sessionStorage.setItem(guestStorageKey, JSON.stringify({ sessionId: '../another', csrfToken: 'invalid' })); expect(readGuestCredential()).toBeNull(); await requestGuest(); expect(meetingsApi.meeting).not.toHaveBeenCalled(); expect(meetingsApi.config).not.toHaveBeenCalled(); expect(screen.queryByRole('link', { name: /workspace|customer/i })).not.toBeInTheDocument();
  });
});
describe('scheduled business meetings', () => {
  it('requires the repeated-hour choice and sends the chosen matching offset', async () => {
    mount(<MeetingForm config={config} saved={vi.fn()}/>); await userEvent.type(screen.getByLabelText('Title'), 'Autumn review'); fireEvent.change(screen.getByLabelText('Start date and time'), { target: { value: '2026-10-25T01:30' } });
    expect(screen.getByRole('button', { name: 'Create meeting' })).toBeDisabled(); await userEvent.selectOptions(screen.getByLabelText('This time occurs twice when the clocks change'), '2026-10-25T01:30:00.000Z'); await userEvent.click(screen.getByRole('button', { name: 'Create meeting' })); await waitFor(() => expect(meetingsApi.create).toHaveBeenCalledWith(expect.objectContaining({ localStart: '2026-10-25T01:30:00+00:00', timezone: 'Europe/London', audience: 'EXTERNAL_CLIENT', guestScreenShare: false }), expect.any(String)));
  });
  it('links the selected existing appointment and customer without creating either', async () => {
    mount(<MeetingForm config={config} saved={vi.fn()}/>); await userEvent.type(screen.getByLabelText('Title'), 'Appointment review'); await userEvent.selectOptions(screen.getByLabelText('Appointment (optional)'), 'appointment-a'); expect(screen.getByLabelText('Customer (optional)')).toHaveValue('customer-a'); expect(screen.getByLabelText('Duration (minutes)')).toHaveValue(45); expect(screen.getByLabelText('Duration (minutes)')).toBeDisabled(); expect(screen.getByLabelText('Start date and time')).toBeDisabled(); await userEvent.click(screen.getByRole('button', { name: 'Create meeting' })); await waitFor(() => expect(meetingsApi.create).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: 'appointment-a', customerId: 'customer-a', localStart: '2027-07-20T10:00:00+01:00' }), expect.any(String)));
  });
  it('sends the version when editing and makes co-hosts explicit attendees', async () => {
    mount(<MeetingForm config={config} meeting={meeting} saved={vi.fn()}/>); await userEvent.click(screen.getByLabelText('Co-host')); await userEvent.click(screen.getByRole('button', { name: 'Save changes' })); await waitFor(() => expect(meetingsApi.edit).toHaveBeenCalledWith('meeting-a', expect.objectContaining({ cohostIds: ['staff-b'], attendeeIds: ['staff-b'] }), 3));
  });
  it('admission uses the guest ID and does not obtain a media token for the host', async () => {
    vi.mocked(meetingsApi.waiting).mockResolvedValue([{ id: 'guest-a', name: 'Alex Taylor', state: 'WAITING', createdAt: '2027-07-20T08:59:00Z', expiresAt: guest.expiresAt }]); render(<MeetingWaitingRoom id="meeting-a" changed={vi.fn()}/>); await userEvent.click(await screen.findByRole('button', { name: 'Admit' })); await waitFor(() => expect(meetingsApi.admit).toHaveBeenCalledWith('meeting-a', 'guest-a', true)); expect(meetingsApi.join).not.toHaveBeenCalled();
  });
  it('shows history when media is disabled and filters by the active business API only', async () => {
    mount(<MeetingsList config={{ ...config, enabled: false }}/>); await screen.findByRole('link', { name: 'Tax review' }); expect(screen.queryByRole('link', { name: 'Create meeting' })).not.toBeInTheDocument(); expect(vi.mocked(meetingsApi.list).mock.calls[0][0]).not.toContain('tenant'); await userEvent.click(screen.getByRole('button', { name: 'Completed' })); await waitFor(() => expect(meetingsApi.list).toHaveBeenLastCalledWith(expect.stringContaining('status=ENDED'), expect.any(AbortSignal)));
  });
  it('does not offer attendance merely because an owner can administer a meeting', async () => {
    vi.mocked(meetingsApi.meeting).mockResolvedValue({ ...meeting, status: 'ACTIVE', canJoin: false }); mount(<MeetingDetail id="meeting-a" config={config}/>); await screen.findByRole('heading', { name: 'Tax review' }); expect(screen.queryByRole('button', { name: 'Join meeting' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'End for everyone' })).toBeInTheDocument();
  });
  it('requires confirmation before cancelling and closes guest access', async () => {
    mount(<MeetingDetail id="meeting-a" config={config}/>); await userEvent.click(await screen.findByRole('button', { name: 'Cancel meeting' })); expect(meetingsApi.cancel).not.toHaveBeenCalled(); await userEvent.click(screen.getByRole('button', { name: 'Confirm' })); await waitFor(() => expect(meetingsApi.cancel).toHaveBeenCalledWith('meeting-a')); expect(await screen.findByText('Meeting cancelled. Invitations and guest access are closed.')).toBeInTheDocument();
  });
  it('creates a one-guest copy invitation and confirms revocation', async () => {
    render(<MeetingInvitations meeting={{ ...meeting, invitations: [{ id: 'invite-a', email: null, claimedAt: null, revokedAt: null, expiresAt: guest.expiresAt }] }} changed={vi.fn()}/>); await userEvent.click(screen.getByRole('button', { name: 'Create invitation' })); expect(await screen.findByLabelText('Invitation link')).toHaveValue('https://meetings.test/meet#invite=secret'); await userEvent.click(screen.getByRole('button', { name: /^Revoke$/ })); expect(meetingsApi.revoke).not.toHaveBeenCalled(); await userEvent.click(within(screen.getByRole('group', { name: 'Revoke invitation confirmation' })).getByRole('button', { name: 'Revoke invitation' })); await waitFor(() => expect(meetingsApi.revoke).toHaveBeenCalledWith('meeting-a', 'invite-a'));
  });
  it('loads a customer-linked panel by authorized reference and hides it without meeting capability', async () => {
    const view = mount(<CustomerMeetings reference="customer-reference-a"/>); await screen.findByRole('link', { name: 'Tax review' }); expect(meetingsApi.list).toHaveBeenCalledWith('customerReference=customer-reference-a&limit=5', expect.any(AbortSignal)); view.unmount(); mocks.role = 'staff'; mocks.permissions = []; mount(<CustomerMeetings reference="customer-reference-a"/>); expect(screen.queryByRole('heading', { name: 'Meetings' })).not.toBeInTheDocument();
  });
  it('uses a safe fallback colour and contrasting text for bright business colours', () => {
    expect(brandStyle({ ...brand, primaryColor: 'url(javascript:bad)' })).toMatchObject({ '--meeting-accent': '#334155' }); expect(brandStyle({ ...brand, primaryColor: '#ffff00' })).toMatchObject({ '--meeting-on-accent': '#000000' });
  });
});
