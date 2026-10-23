import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientPortal from './ClientPortal';
import ClientInvitation from './ClientInvitation';
import { CreateClientChannel } from './CreateClientChannel';
import { CustomerClientChannels } from './CustomerClientChannels';
import { chatApi } from '../chat/chat.api';
import { collaborationApi, staffCollaborationApi, clientMeetingApi } from './collaboration.api';
import type { NativeConversation } from '@ks-os/contracts';

const mocks = vi.hoisted(() => ({ channels: vi.fn(), channel: vi.fn(), messages: vi.fn(), people: vi.fn(), read: vi.fn(), notifications: vi.fn(), preferences: vi.fn(), conversationPreference: vi.fn(), files: vi.fn(), stop: vi.fn(), signal: vi.fn(), callbacks: [] as any[], getSession: vi.fn(), signOut: vi.fn(), authCallback: null as ((event: string) => void) | null, meetingSession: vi.fn(), meetingJoin: vi.fn(), meetingLeave: vi.fn(), gateway: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: mocks.getSession, signOut: mocks.signOut, onAuthStateChange: (callback: (event: string) => void) => { mocks.authCallback = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } } }));
vi.mock('../../api/client', () => ({ fetchWithAuth: vi.fn().mockResolvedValue(new Response('{}')), requestJson: vi.fn(), uploadWithAuth: vi.fn() }));
vi.mock('../chat/chat.realtime', async original => ({ ...await original<typeof import('../chat/chat.realtime')>(), connectChat: (callbacks: unknown) => { mocks.callbacks.push(callbacks); return Object.assign(mocks.stop, { signal: mocks.signal }); } }));
vi.mock('./collaboration.api', async original => ({ ...await original<typeof import('./collaboration.api')>(), collaborationApi: { session: vi.fn(), meetings: vi.fn(), requestMeeting: vi.fn(), handoff: vi.fn(), pending: vi.fn(), accept: vi.fn() }, staffCollaborationApi: { customerReference: vi.fn(), channels: vi.fn(), customers: vi.fn(), config: vi.fn(), create: vi.fn(), addContact: vi.fn(), invite: vi.fn() }, clientMeetingApi: vi.fn(() => ({ session: mocks.meetingSession, join: mocks.meetingJoin, leave: mocks.meetingLeave })), createCustomerChatServices: (relationship: any) => ({ api: { channels: mocks.channels, channel: mocks.channel, messages: mocks.messages, people: mocks.people, read: mocks.read, ticket: vi.fn() }, files: { notifications: mocks.notifications, preferences: mocks.preferences, conversationPreference: mocks.conversationPreference, files: mocks.files }, external: true, notificationName: relationship.businessName, messageLink: () => '/customer/collaboration/' + relationship.id + '/messages/channel-a' }) }));
vi.mock('../meetings/GuestMeetingPage', () => ({ GuestCall: (props: any) => { mocks.gateway(props); return <section aria-label="Native customer call"><button onClick={() => void props.gateway.join('join-intent')}>Join customer call</button></section>; } }));
const first = { id: 'relationship-a', tenantId: 'tenant-a', clientId: 'client-a', businessName: 'Harbour Accounting', clientName: 'Taylor Studio', logoUrl: null, primaryColor: '#164e63' };
const second = { ...first, id: 'relationship-b', tenantId: 'tenant-b', businessName: 'Cedar Consulting' };
const session = { actorId: 'account-a', displayName: 'Alex Taylor', relationships: [first, second] };
const channel: NativeConversation = { id: 'channel-a', type: 'CLIENT', externalClientChannel: true, clientId: 'client-a', clientName: 'Taylor Studio', name: 'Your accounts', slug: 'your-accounts', description: 'Plans and shared documents', createdBy: 'staff-a', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z', archivedAt: null, memberRole: 'MEMBER', lastReadPosition: '0', lastReadAt: null, unreadCount: 0, memberCount: 2 };
const meeting = { id: 'meeting-a', conversationId: channel.id, title: 'Accounts review', type: 'VIDEO' as const, status: 'SCHEDULED' as const, scheduledStartAt: '2099-10-23T10:00:00Z', scheduledEndAt: '2099-10-23T11:00:00Z', timezone: 'Europe/London', hostName: 'Ada Patel', branding: { name: first.businessName, logoUrl: null, primaryColor: '#164e63' }, guestScreenShare: false, waitingRoomEnabled: true as const };
const guest = { sessionId: 'session-a', csrfToken: 'csrf-a', state: 'WAITING' as const, name: 'Alex Taylor', expiresAt: '2099-10-23T12:00:00Z', meeting };
function mount(path: string, element = <ClientPortal/>) { return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/customer/collaboration/*" element={element}/><Route path="/customer/invite" element={<ClientInvitation/>}/><Route path="/customer/login" element={<p>Secure customer login</p>}/></Routes></MemoryRouter>); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.callbacks = []; mocks.authCallback = null; window.history.replaceState(null, '', '/customer/collaboration'); sessionStorage.clear();
  vi.mocked(collaborationApi.session).mockResolvedValue(session); vi.mocked(collaborationApi.meetings).mockResolvedValue({ data: [meeting], nextCursor: null }); vi.mocked(collaborationApi.requestMeeting).mockResolvedValue(guest);
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'verified-test-session' } } }); mocks.signOut.mockResolvedValue({ error: null });
  mocks.channels.mockResolvedValue({ data: [channel], nextCursor: null }); mocks.channel.mockResolvedValue(channel); mocks.messages.mockResolvedValue({ data: [], nextCursor: null }); mocks.people.mockResolvedValue({ data: [], nextCursor: null }); mocks.read.mockResolvedValue({});
  mocks.notifications.mockResolvedValue({ data: [], nextCursor: null }); mocks.preferences.mockResolvedValue({ inApp: true, sound: false, dnd: false, directMessages: true, browser: false }); mocks.conversationPreference.mockResolvedValue({ mode: 'ALL' }); mocks.files.mockResolvedValue({ data: [], nextCursor: null }); mocks.meetingSession.mockResolvedValue(guest); mocks.meetingLeave.mockResolvedValue({}); mocks.meetingJoin.mockResolvedValue({});
  vi.mocked(collaborationApi.handoff).mockResolvedValue({ expiresAt: guest.expiresAt }); vi.mocked(collaborationApi.pending).mockResolvedValue({ available: true }); vi.mocked(collaborationApi.accept).mockResolvedValue({ relationshipId: first.id, conversationId: channel.id });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('restricted client portal', () => {
  it('shows only permitted client conversations, branded navigation and no staff controls', async () => {
    mocks.channels.mockResolvedValue({ data: [channel, { ...channel, id: 'internal', type: 'CHANNEL', name: 'Internal payroll' }, { ...channel, id: 'legacy', externalClientChannel: false, name: 'Legacy client record' }], nextCursor: null });
    mount('/customer/collaboration/relationship-a/messages'); await screen.findByRole('link', { name: /Your accounts/ }); expect(screen.getByText('Harbour Accounting')).toBeInTheDocument();
    for (const name of ['Messages', 'Files', 'Meetings', 'Account']) expect(screen.getByRole('link', { name })).toBeInTheDocument();
    expect(screen.queryByText('Internal payroll')).not.toBeInTheDocument(); expect(screen.queryByText('Legacy client record')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: /Create channel|Discover|New message/ })).not.toBeInTheDocument(); expect(mocks.people).not.toHaveBeenCalled();
  });
  it('clears conversation draft and closes the old connection when switching businesses', async () => {
    mount('/customer/collaboration/relationship-a/messages/channel-a'); const field = await screen.findByRole('combobox', { name: 'Message Your accounts' }); await userEvent.type(field, 'Private unsent draft');
    await userEvent.selectOptions(screen.getByLabelText('Business'), second.id); await waitFor(() => expect(screen.getByText('Cedar Consulting')).toBeInTheDocument()); expect(mocks.stop).toHaveBeenCalled(); expect(screen.queryByDisplayValue('Private unsent draft')).not.toBeInTheDocument(); expect(screen.queryByRole('combobox', { name: 'Message Your accounts' })).not.toBeInTheDocument();
  });
  it('purges message content immediately on socket revocation and refreshes session access', async () => {
    mount('/customer/collaboration/relationship-a/messages/channel-a'); await screen.findByRole('combobox', { name: 'Message Your accounts' }); act(() => mocks.callbacks.at(-1).revoked());
    await screen.findByRole('heading', { name: 'Access is no longer available' }); expect(screen.queryByRole('combobox', { name: 'Message Your accounts' })).not.toBeInTheDocument(); await waitFor(() => expect(collaborationApi.session).toHaveBeenCalledTimes(2));
  });
  it('preserves composer focus and draft through read events and reconnection refreshes', async () => {
    mount('/customer/collaboration/relationship-a/messages/channel-a'); const field = await screen.findByRole('combobox', { name: 'Message Your accounts' }); await userEvent.type(field, 'An unfinished reply'); expect(field).toHaveFocus();
    act(() => mocks.callbacks.at(-1).event({ type: 'conversation.read', conversationId: channel.id })); await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(2)); await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))); expect(field).toHaveFocus(); expect(field).toHaveValue('An unfinished reply');
    await act(async () => mocks.callbacks.at(-1).ready()); await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(3)); expect(screen.getByRole('combobox', { name: 'Message Your accounts' })).toBe(field); expect(field).toHaveFocus();
  });
  it('toggles conversation options without remounting the composer or losing its draft', async () => {
    mount('/customer/collaboration/relationship-a/messages/channel-a'); const field = await screen.findByRole('combobox', { name: 'Message Your accounts' }); await userEvent.type(field, 'A mobile reply');
    const toggle = screen.getByRole('button', { name: 'Conversation options' }); expect(toggle).toHaveAttribute('aria-expanded', 'false'); await userEvent.click(toggle); expect(toggle).toHaveAttribute('aria-expanded', 'true'); expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toHaveClass('client-options-open');
    await userEvent.click(toggle); expect(toggle).toHaveAttribute('aria-expanded', 'false'); expect(screen.getByRole('combobox', { name: 'Message Your accounts' })).toBe(field); expect(field).toHaveValue('A mobile reply');
    await userEvent.click(toggle); await userEvent.click(screen.getByRole('button', { name: 'Files' })); expect(toggle).toHaveAttribute('aria-expanded', 'false'); expect(screen.getByRole('heading', { name: 'Your accounts' })).toHaveFocus();
  });
  it('does not mount another relationship supplied in the URL', async () => { mount('/customer/collaboration/unknown/messages/channel-a'); await screen.findByRole('heading', { name: 'Choose a business' }); expect(mocks.channel).not.toHaveBeenCalled(); expect(mocks.callbacks).toHaveLength(0); });
  it('does not restore protected content from a late session refresh after sign out', async () => {
    mount('/customer/collaboration/relationship-a/messages/channel-a'); await screen.findByRole('combobox', { name: 'Message Your accounts' }); let finishSession!: (value: typeof session) => void, finishSignOut!: () => void;
    vi.mocked(collaborationApi.session).mockImplementation(() => new Promise(resolve => { finishSession = resolve; })); mocks.signOut.mockImplementation(() => new Promise<void>(resolve => { finishSignOut = resolve; }));
    act(() => window.dispatchEvent(new Event('focus'))); await waitFor(() => expect(collaborationApi.session).toHaveBeenCalledTimes(2)); await userEvent.click(screen.getByRole('button', { name: 'Sign out' })); await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());
    await act(async () => finishSession(session)); expect(screen.queryByRole('combobox', { name: 'Message Your accounts' })).not.toBeInTheDocument(); expect(screen.queryByText('Harbour Accounting')).not.toBeInTheDocument(); await act(async () => finishSignOut()); await screen.findByText('Secure customer login');
  });
  it('cancels an admission response that arrives after switching businesses', async () => {
    let finish!: (value: typeof guest) => void; vi.mocked(collaborationApi.requestMeeting).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount('/customer/collaboration/relationship-a/meetings'); await userEvent.click(await screen.findByRole('button', { name: 'Open meeting' })); await userEvent.click(screen.getByRole('button', { name: 'Request to join' })); await userEvent.selectOptions(screen.getByLabelText('Business'), second.id); await act(async () => finish(guest)); await waitFor(() => expect(mocks.meetingLeave).toHaveBeenCalled()); expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('keeps CUSTOMER meeting credentials in memory and waits for independent host admission', async () => {
    mount('/customer/collaboration/relationship-a/meetings'); await userEvent.click(await screen.findByRole('button', { name: 'Open meeting' })); await userEvent.click(screen.getByRole('button', { name: 'Request to join' })); await screen.findByText('You are in the waiting room. The host has been notified.'); expect(mocks.meetingJoin).not.toHaveBeenCalled(); expect(mocks.gateway).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
    mocks.meetingSession.mockResolvedValue({ ...guest, state: 'APPROVED', meeting: { ...meeting, status: 'ACTIVE' } }); act(() => mocks.callbacks.at(-1).event({ type: 'meeting.updated', meetingId: meeting.id, conversationId: channel.id })); await userEvent.click(await screen.findByRole('button', { name: 'Join customer call' })); expect(clientMeetingApi).toHaveBeenCalledWith(first.id, meeting.id, expect.objectContaining({ sessionId: guest.sessionId, csrfToken: guest.csrfToken })); expect(mocks.meetingJoin).toHaveBeenCalledWith('join-intent');
    await userEvent.selectOptions(screen.getByLabelText('Business'), second.id); await waitFor(() => expect(mocks.meetingLeave).toHaveBeenCalled()); expect(screen.queryByRole('region', { name: 'Native customer call' })).not.toBeInTheDocument();
  });
  it('opens only the authorized meeting from a deep link without requesting admission or media', async () => {
    mount('/customer/collaboration/relationship-a/meetings?meetingId=meeting-a');
    await screen.findByRole('region', { name: 'Meeting admission' });
    expect(collaborationApi.meetings).toHaveBeenCalledWith(first.id, 'meetingId=meeting-a', expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: 'Request to join' })).toBeInTheDocument();
    expect(collaborationApi.requestMeeting).not.toHaveBeenCalled(); expect(mocks.meetingJoin).not.toHaveBeenCalled(); expect(mocks.gateway).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Back to meetings' }));
    act(() => mocks.callbacks.at(-1).event({ type: 'meeting.updated', meetingId: meeting.id, conversationId: channel.id }));
    await waitFor(() => expect(collaborationApi.meetings).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region', { name: 'Meeting admission' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all my meetings' }));
    await waitFor(() => expect(collaborationApi.meetings).toHaveBeenLastCalledWith(first.id, '', expect.any(AbortSignal)));
    expect(collaborationApi.requestMeeting).not.toHaveBeenCalled();
  });
  it('does not substitute another meeting or open admission for an inaccessible deep-link target', async () => {
    vi.mocked(collaborationApi.meetings).mockResolvedValue({ data: [], nextCursor: null });
    mount('/customer/collaboration/relationship-a/meetings?meetingId=missing-meeting');
    await screen.findByText('This meeting is no longer available or has not been shared with you.');
    expect(collaborationApi.meetings).toHaveBeenCalledWith(first.id, 'meetingId=missing-meeting', expect.any(AbortSignal));
    expect(screen.queryByRole('region', { name: 'Meeting admission' })).not.toBeInTheDocument(); expect(collaborationApi.requestMeeting).not.toHaveBeenCalled();
  });
  it('shows ended meeting history from a deep link without offering admission', async () => {
    vi.mocked(collaborationApi.meetings).mockResolvedValue({ data: [{ ...meeting, status: 'ENDED' }], nextCursor: null });
    mount('/customer/collaboration/relationship-a/meetings?meetingId=meeting-a');
    await screen.findByRole('heading', { name: meeting.title });
    expect(screen.queryByRole('region', { name: 'Meeting admission' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Request to join' })).not.toBeInTheDocument(); expect(collaborationApi.requestMeeting).not.toHaveBeenCalled();
  });
  it('closes pre-join when the selected meeting is cancelled and preserves dismissal', async () => {
    mount('/customer/collaboration/relationship-a/meetings?meetingId=meeting-a');
    await screen.findByRole('button', { name: 'Request to join' });
    vi.mocked(collaborationApi.meetings).mockResolvedValue({ data: [{ ...meeting, status: 'CANCELLED' }], nextCursor: null });
    act(() => mocks.callbacks.at(-1).event({ type: 'meeting.cancelled', meetingId: meeting.id, conversationId: channel.id }));
    await screen.findByRole('heading', { name: 'Meeting access closed' });
    expect(screen.queryByRole('button', { name: 'Request to join' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open meeting' })).not.toBeInTheDocument();
    expect(collaborationApi.requestMeeting).not.toHaveBeenCalled(); expect(mocks.meetingJoin).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Back to meetings' }));
    act(() => mocks.callbacks.at(-1).event({ type: 'meeting.updated', meetingId: meeting.id, conversationId: channel.id }));
    await waitFor(() => expect(collaborationApi.meetings).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('region', { name: 'Meeting admission' })).not.toBeInTheDocument();
  });
});
describe('verified invitations', () => {
  it('removes the invitation fragment before handoff and never puts the secret in login links or storage', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } }); window.history.replaceState(null, '', '/customer/invite#invite=private-secret'); mount('/customer/invite'); await screen.findByRole('link', { name: 'Verify my email and continue' }); expect(window.location.hash).toBe(''); expect(collaborationApi.handoff).toHaveBeenCalledWith('private-secret'); expect(screen.getByRole('link', { name: 'Verify my email and continue' })).toHaveAttribute('href', '/customer/login?collaboration=1'); expect(sessionStorage.length).toBe(0); expect(collaborationApi.accept).not.toHaveBeenCalled();
  });
  it('keeps failed acceptance generic without exposing an invited business or recipient', async () => { vi.mocked(collaborationApi.accept).mockRejectedValue(new Error('private server detail')); mount('/customer/invite'); await userEvent.click(await screen.findByRole('button', { name: 'Accept invitation' })); expect(await screen.findByRole('alert')).toHaveTextContent('Use the email address that received it'); expect(screen.queryByText('private server detail')).not.toBeInTheDocument(); });
});
it('creates an explicitly external channel and grants only selected staff and verified contacts', async () => {
  vi.mocked(staffCollaborationApi.customers).mockResolvedValue([{ id: 'client-a', name: 'Taylor Studio' }]); vi.mocked(staffCollaborationApi.config).mockResolvedValue({ canManage: true, staff: [{ id: 'staff-a', name: 'Ada Patel' }], contacts: [{ relationshipId: 'relationship-a', customerAccountId: 'account-a', name: 'Alex', email: 'alex@example.test', status: 'ACTIVE' }] }); vi.mocked(staffCollaborationApi.create).mockResolvedValue({ id: 'channel-a' }); vi.mocked(staffCollaborationApi.addContact).mockResolvedValue({}); const created = vi.fn(); render(<CreateClientChannel close={vi.fn()} created={created}/>);
  await screen.findByRole('option', { name: 'Taylor Studio' }); await userEvent.selectOptions(screen.getByLabelText('Customer'), 'client-a'); await userEvent.type(screen.getByLabelText('Channel name'), 'Shared plan'); await userEvent.click(await screen.findByLabelText('Ada Patel')); await userEvent.click(screen.getByLabelText('Alex · alex@example.test')); await userEvent.click(screen.getByRole('button', { name: 'Create external channel' })); await waitFor(() => expect(created).toHaveBeenCalledWith('channel-a')); expect(staffCollaborationApi.create).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'client-a', staffUserIds: ['staff-a'] })); expect(staffCollaborationApi.addContact).toHaveBeenCalledWith('channel-a', 'relationship-a'); expect(staffCollaborationApi.invite).not.toHaveBeenCalled();
});

it('resolves the CRM reference before offering a channel for that exact customer', async () => {
  vi.spyOn(chatApi, 'capabilities').mockResolvedValue({ userId: 'staff-a', canCreateChannels: false, canCreateClientChannels: true });
  vi.mocked(staffCollaborationApi.customerReference).mockResolvedValue([{ id: 'client-a', name: 'Taylor Studio' }]); vi.mocked(staffCollaborationApi.channels).mockResolvedValue({ data: [], nextCursor: null }); vi.mocked(staffCollaborationApi.customers).mockResolvedValue([]); vi.mocked(staffCollaborationApi.config).mockResolvedValue({ staff: [], contacts: [], canManage: true });
  render(<MemoryRouter><CustomerClientChannels reference="customer-public-reference"/></MemoryRouter>); await userEvent.click(await screen.findByRole('button', { name: 'Create client channel' }));
  await screen.findByRole('option', { name: 'Taylor Studio' }); expect(screen.getByLabelText('Customer')).toHaveValue('client-a'); expect(staffCollaborationApi.customerReference).toHaveBeenCalledWith('customer-public-reference', expect.any(AbortSignal)); expect(staffCollaborationApi.config).toHaveBeenCalledWith('client-a');
});
