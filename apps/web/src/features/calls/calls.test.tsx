import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunicationsEvent } from '@ks-os/contracts';
import { callsApi, callingError, type Meeting } from './calls.api';
import { ConversationCalls } from './ConversationCalls';
import { CallWorkspace } from './CallWorkspace';
import MeetingWindow from './MeetingWindow';
import { phase4Api } from '../chat/chat.phase4.api';
import type { SubscribeChat } from '../chat/MessageTimeline';

const sdk = vi.hoisted(() => ({
  connect: vi.fn(), disconnect: vi.fn(), microphone: vi.fn(), camera: vi.fn(), share: vi.fn(),
  preview: vi.fn(), getDevices: vi.fn(), switchDevice: vi.fn(), startAudio: vi.fn(), rooms: [] as any[],
}));
vi.mock('livekit-client', () => {
  const roomEvents = Object.fromEntries(['ConnectionStateChanged', 'Disconnected', 'MediaDevicesError', 'ParticipantConnected', 'ParticipantDisconnected', 'TrackSubscribed', 'TrackUnsubscribed', 'TrackMuted', 'TrackUnmuted', 'LocalTrackPublished', 'LocalTrackUnpublished', 'ActiveSpeakersChanged', 'ConnectionQualityChanged', 'AudioPlaybackStatusChanged', 'ParticipantNameChanged'].map(name => [name, name]));
  class Participant {
    identity: string; name: string; isLocal: boolean; isMicrophoneEnabled = false; isCameraEnabled = false; isScreenShareEnabled = false;
    isSpeaking = false; connectionQuality = 'excellent'; audioTrackPublications = new Map(); publications = new Map();
    constructor(identity: string, name: string, local: boolean) { this.identity = identity; this.name = name; this.isLocal = local; }
    getTrackPublication(source: string) { return this.publications.get(source); }
    async setMicrophoneEnabled(enabled: boolean) { await sdk.microphone(enabled); this.isMicrophoneEnabled = enabled; }
    async setCameraEnabled(enabled: boolean) { await sdk.camera(enabled); this.isCameraEnabled = enabled; }
    async setScreenShareEnabled(enabled: boolean, options: unknown) { await sdk.share(enabled, options); this.isScreenShareEnabled = enabled; }
  }
  class Room {
    state = 'disconnected'; canPlaybackAudio = true; localParticipant = new Participant('trusted-user:session', 'Ada', true);
    remoteParticipants = new Map([['other:session', new Participant('other:session', 'Grace', false)]]);
    listeners = new Map<string, Set<(...args: any[]) => void>>();
    constructor(public options: unknown) { sdk.rooms.push(this); }
    on(event: string, fn: (...args: any[]) => void) { const set = this.listeners.get(event) || new Set(); set.add(fn); this.listeners.set(event, set); return this; }
    emit(event: string, ...args: any[]) { for (const fn of this.listeners.get(event) || []) fn(...args); }
    removeAllListeners() { this.listeners.clear(); }
    async connect(url: string, token: string) { await sdk.connect(url, token); this.state = 'connected'; this.emit('ConnectionStateChanged', this.state); }
    async disconnect(stop?: boolean) { await sdk.disconnect(stop); this.state = 'disconnected'; }
    switchActiveDevice(kind: string, id: string) { return sdk.switchDevice(kind, id); }
    startAudio() { return sdk.startAudio(); }
    static getLocalDevices(...args: unknown[]) { return sdk.getDevices(...args); }
  }
  return { Room, RoomEvent: roomEvents, ConnectionState: { Disconnected: 'disconnected', Connecting: 'connecting', Connected: 'connected', Reconnecting: 'reconnecting' }, Track: { Kind: { Audio: 'audio', Video: 'video' }, Source: { Camera: 'camera', ScreenShare: 'screen_share' } }, createLocalTracks: sdk.preview };
});
vi.mock('./calls.api', async original => ({ ...await original<typeof import('./calls.api')>(), callsApi: {
  config: vi.fn(), history: vi.fn(), create: vi.fn(), incoming: vi.fn(), meeting: vi.fn(), invitation: vi.fn(), join: vi.fn(), leave: vi.fn(), end: vi.fn(), remove: vi.fn(),
} }));
vi.mock('../chat/chat.phase4.api', () => ({ phase4Api: { preferences: vi.fn() } }));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ email: 'ada@example.test', businessReference: 'tenant-a' }) }));
const meeting: Meeting = {
  id: '11111111-1111-4111-8111-111111111111', conversationId: '22222222-2222-4222-8222-222222222222', conversationName: 'Design team',
  type: 'VIDEO', status: 'RINGING', createdBy: 'ada', organizerName: 'Ada', title: 'Team call', createdAt: '2026-10-22T09:00:00Z', startedAt: null, endedAt: null, endReason: null,
  expiresAt: '2099-10-22T10:00:00Z', canManage: true, invitationState: 'INVITED',
  participants: [{ userId: 'ada', name: 'Ada', role: 'ORGANIZER', invitationState: 'ACCEPTED', joinedAt: null, leftAt: null, sessionCount: 1 }, { userId: 'grace', name: 'Grace', role: 'PARTICIPANT', invitationState: 'ACCEPTED', joinedAt: null, leftAt: null, sessionCount: 1 }],
};
const listeners = new Set<(event: CommunicationsEvent) => void>();
const subscribe: SubscribeChat = fn => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function mountMeeting() {
  return render(<MemoryRouter><MeetingWindow id={meeting.id} subscribe={subscribe} revision={0} close={vi.fn()} displayName="Ada" userId="ada" participantLimit={6}/></MemoryRouter>);
}
async function join() { mountMeeting(); await userEvent.click(await screen.findByRole('button', { name: 'Join call' })); await screen.findByRole('button', { name: 'Unmute' }); return sdk.rooms[0]; }
beforeEach(() => {
  vi.clearAllMocks(); sdk.rooms.length = 0; listeners.clear();
  sdk.connect.mockResolvedValue(undefined); sdk.disconnect.mockResolvedValue(undefined); sdk.preview.mockResolvedValue([]);
  sdk.microphone.mockResolvedValue(undefined); sdk.camera.mockResolvedValue(undefined); sdk.share.mockResolvedValue(undefined); sdk.switchDevice.mockResolvedValue(true); sdk.startAudio.mockResolvedValue(undefined);
  sdk.getDevices.mockResolvedValue([{ kind: 'audioinput', deviceId: 'mic-one', label: 'Desk microphone' }, { kind: 'videoinput', deviceId: 'cam-one', label: 'Desk camera' }]);
  vi.mocked(callsApi.config).mockResolvedValue({ enabled: true, participantLimit: 6, tokenTtlSeconds: 120 });
  vi.mocked(callsApi.history).mockResolvedValue({ data: [], nextCursor: null });
  vi.mocked(callsApi.create).mockResolvedValue(meeting); vi.mocked(callsApi.incoming).mockResolvedValue([]);
  vi.mocked(callsApi.meeting).mockResolvedValue(meeting); vi.mocked(callsApi.invitation).mockResolvedValue({ ...meeting, invitationState: 'ACCEPTED' });
  vi.mocked(callsApi.join).mockResolvedValue({ token: 'isolated-test-token', url: 'ws://127.0.0.1:7880', identity: 'trusted-user:session', sessionId: 'session-one', expiresIn: 120, meeting });
  vi.mocked(callsApi.leave).mockResolvedValue({}); vi.mocked(callsApi.remove).mockResolvedValue({});
  vi.mocked(callsApi.end).mockResolvedValue({ ...meeting, status: 'ENDED', endReason: 'ORGANIZER_ENDED', endedAt: '2026-10-22T09:30:00Z' });
  vi.mocked(phase4Api.preferences).mockResolvedValue({ inApp: true, browser: false, sound: false, dnd: false, directMessages: true });
  vi.stubGlobal('Notification', undefined); vi.stubGlobal('BroadcastChannel', undefined);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: vi.fn().mockResolvedValue([]), getDisplayMedia: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('conversation calling', () => {
  it.each([['voice', 'AUDIO'], ['video', 'VIDEO']] as const)('starts a %s call with a retry-safe request identity', async (label, type) => {
    render(<MemoryRouter><ConversationCalls conversationId={meeting.conversationId} archived={false} subscribe={subscribe} revision={0}/></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Start ' + label + ' call' }));
    expect(callsApi.create).toHaveBeenCalledWith(meeting.conversationId, type, expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(sdk.connect).not.toHaveBeenCalled(); expect(sdk.preview).not.toHaveBeenCalled();
  });
  it('retains the same creation id after an ambiguous network failure', async () => {
    vi.mocked(callsApi.create).mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValue(meeting);
    render(<MemoryRouter><ConversationCalls conversationId={meeting.conversationId} archived={false} subscribe={subscribe} revision={0}/></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Start voice call' }));
    await screen.findByRole('alert'); await userEvent.click(screen.getByRole('button', { name: 'Start voice call' }));
    expect(vi.mocked(callsApi.create).mock.calls[0][2]).toBe(vi.mocked(callsApi.create).mock.calls[1][2]);
  });
  it('shows active calls and persisted outcomes without offering a duplicate start', async () => {
    vi.mocked(callsApi.history).mockResolvedValue({ data: [{ ...meeting, status: 'ACTIVE' }, { ...meeting, id: 'old', status: 'CANCELLED', endReason: 'UNANSWERED' }], nextCursor: null });
    render(<MemoryRouter><ConversationCalls conversationId={meeting.conversationId} archived={false} subscribe={subscribe} revision={0}/></MemoryRouter>);
    await screen.findByRole('button', { name: 'Join call' }); expect(screen.queryByRole('button', { name: 'Start voice call' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Call history' })); expect(await screen.findByText('Video call · Unanswered')).toBeInTheDocument();
  });
});
describe('incoming calls', () => {
  it('accepts an invitation and opens pre-join without activating devices', async () => {
    vi.mocked(callsApi.incoming).mockResolvedValue([meeting]);
    render(<MemoryRouter><CallWorkspace subscribe={subscribe} revision={0} userId="ada"/></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(callsApi.invitation).toHaveBeenCalledWith(meeting.id, true);
    await screen.findByRole('button', { name: 'Join call' });
    expect(sdk.connect).not.toHaveBeenCalled(); expect(sdk.preview).not.toHaveBeenCalled();
  });
  it('declines and synchronises removal through the existing call journal', async () => {
    vi.mocked(callsApi.incoming).mockResolvedValue([meeting]);
    render(<MemoryRouter><CallWorkspace subscribe={subscribe} revision={0}/></MemoryRouter>);
    await screen.findByRole('button', { name: 'Decline' }); vi.mocked(callsApi.incoming).mockResolvedValue([]);
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(callsApi.invitation).toHaveBeenCalledWith(meeting.id, false);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument());
    expect(sdk.connect).not.toHaveBeenCalled();
  });
  it('respects Do Not Disturb and removes cancelled invitations', async () => {
    vi.mocked(callsApi.incoming).mockResolvedValue([meeting]);
    vi.mocked(phase4Api.preferences).mockResolvedValue({ inApp: true, browser: false, sound: true, dnd: true, directMessages: true });
    render(<MemoryRouter><CallWorkspace subscribe={subscribe} revision={0}/></MemoryRouter>);
    await waitFor(() => expect(callsApi.incoming).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    vi.mocked(phase4Api.preferences).mockResolvedValue({ inApp: true, browser: false, sound: false, dnd: false, directMessages: true });
    await act(async () => { for (const listener of listeners) listener({ type: 'call.invited', resourceId: meeting.id, conversationId: meeting.conversationId } as unknown as CommunicationsEvent); });
    await screen.findByRole('button', { name: 'Accept' });
    vi.mocked(callsApi.incoming).mockResolvedValue([]);
    await act(async () => { for (const listener of listeners) listener({ type: 'call.ended', resourceId: meeting.id, conversationId: meeting.conversationId } as unknown as CommunicationsEvent); });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument());
  });
  it('deduplicates browser alerts and closes them when the caller cancels', async () => {
    const close = vi.fn(), alerts = vi.fn();
    class BrowserAlert {
      static permission = 'granted'; onclick: (() => void) | null = null;
      constructor(title: string, options: unknown) { alerts(title, options); }
      close = close;
    }
    vi.stubGlobal('Notification', BrowserAlert);
    vi.mocked(callsApi.incoming).mockResolvedValue([meeting]);
    vi.mocked(phase4Api.preferences).mockResolvedValue({ inApp: true, browser: true, sound: false, dnd: false, directMessages: true });
    render(<MemoryRouter><CallWorkspace subscribe={subscribe} revision={0}/></MemoryRouter>);
    await waitFor(() => expect(alerts).toHaveBeenCalledTimes(1));
    expect(alerts).toHaveBeenCalledWith('Incoming KSOS call', expect.objectContaining({ tag: 'ksos-call-' + meeting.id, silent: true }));
    await act(async () => { for (const listener of listeners) listener({ type: 'call.invited', resourceId: meeting.id, conversationId: meeting.conversationId } as unknown as CommunicationsEvent); });
    expect(alerts).toHaveBeenCalledTimes(1);
    vi.mocked(callsApi.incoming).mockResolvedValue([]);
    await act(async () => { for (const listener of listeners) listener({ type: 'call.ended', resourceId: meeting.id, conversationId: meeting.conversationId } as unknown as CommunicationsEvent); });
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
});
describe('native meeting media', () => {
  it('recognises cross-realm device errors without exposing arbitrary object messages', () => {
    expect(callingError({ name: 'NotAllowedError', message: 'private provider details' })).toContain('permission was denied');
    expect(callingError({ name: 'UnknownProviderError', message: 'private provider details' })).toBe('The call could not complete this request. Please try again.');
  });
  it('joins with both devices disabled, shows participants, and leaves only this session', async () => {
    const mounted = mountMeeting();
    expect(await screen.findByLabelText('Enable microphone')).not.toBeChecked(); expect(screen.getByLabelText('Enable camera preview')).not.toBeChecked();
    expect(sdk.preview).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Join call' }));
    await screen.findByRole('button', { name: 'Unmute' });
    expect(sdk.connect).toHaveBeenCalledWith('ws://127.0.0.1:7880', 'isolated-test-token');
    expect(sdk.microphone).not.toHaveBeenCalled(); expect(sdk.camera).not.toHaveBeenCalled();
    expect(screen.getByRole('article', { name: 'Grace' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    await waitFor(() => expect(callsApi.leave).toHaveBeenCalledWith(meeting.id, 'session-one')); expect(callsApi.end).not.toHaveBeenCalled();
    mounted.unmount();
  });
  it('requests preview only after user intent and stops capture on close', async () => {
    const track = { kind: 'video', attach: vi.fn(), detach: vi.fn(), stop: vi.fn() };
    sdk.preview.mockResolvedValue([track]); const mounted = mountMeeting();
    await userEvent.click(await screen.findByLabelText('Enable camera preview'));
    await screen.findByLabelText('Your camera preview');
    expect(sdk.preview).toHaveBeenCalledWith(expect.objectContaining({ audio: false, video: expect.any(Object) }));
    mounted.unmount(); expect(track.stop).toHaveBeenCalled();
  });
  it('explains denied device permissions and still permits joining with devices off', async () => {
    sdk.preview.mockRejectedValue(new DOMException('Blocked', 'NotAllowedError')); mountMeeting();
    await userEvent.click(await screen.findByLabelText('Enable camera preview'));
    expect(await screen.findByRole('alert')).toHaveTextContent('permission was denied');
    await userEvent.click(screen.getByLabelText('Enable camera preview')); await userEvent.click(screen.getByRole('button', { name: 'Join call' }));
    await screen.findByRole('button', { name: 'Unmute' }); expect(sdk.camera).not.toHaveBeenCalled();
  });
  it('toggles microphone, camera, and screen sharing and reflects browser stop-sharing', async () => {
    const room = await join();
    await userEvent.click(screen.getByRole('button', { name: 'Unmute' })); expect(sdk.microphone).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Mute' })); expect(sdk.microphone).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Camera on' })); expect(sdk.camera).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Share screen' })); expect(sdk.share).toHaveBeenCalledWith(true, { audio: true });
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toHaveAttribute('aria-pressed', 'true');
    act(() => { room.localParticipant.isScreenShareEnabled = false; room.emit('LocalTrackUnpublished'); });
    expect(screen.getByRole('button', { name: 'Share screen' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('disables unsupported screen capture and makes reconnecting state explicit', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() } });
    const room = await join(); expect(screen.getByRole('button', { name: 'Share screen' })).toBeDisabled();
    act(() => { room.emit('ConnectionStateChanged', 'reconnecting'); });
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeDisabled(); expect(screen.getAllByText(/Reconnecting/).length).toBeGreaterThan(0);
    act(() => { room.emit('ConnectionStateChanged', 'connected'); }); expect(screen.getByRole('button', { name: 'Unmute' })).toBeEnabled();
  });
  it('handles connection failure without leaving an active browser session or device capture', async () => {
    sdk.connect.mockRejectedValue(new Error('Network unreachable')); mountMeeting();
    await userEvent.click(await screen.findByRole('button', { name: 'Join call' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect');
    expect(sdk.disconnect).toHaveBeenCalledWith(true); expect(callsApi.leave).toHaveBeenCalledWith(meeting.id, 'session-one');
    expect(sdk.microphone).not.toHaveBeenCalled();
  });
  it('allows organisers to remove a participant and end the room separately from leaving', async () => {
    await join(); await userEvent.click(screen.getByRole('button', { name: 'Participants' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Grace' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove participant' }));
    await waitFor(() => expect(callsApi.remove).toHaveBeenCalledWith(meeting.id, 'grace'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove participant' })).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'End for everyone' }));
    await userEvent.click(screen.getByRole('button', { name: 'End meeting for everyone' }));
    await waitFor(() => expect(callsApi.end).toHaveBeenCalledWith(meeting.id));
    await screen.findByRole('heading', { name: 'Ended by organiser' }); expect(sdk.disconnect).toHaveBeenCalled();
  });
  it('keeps the connection while minimized and switches devices through the official client', async () => {
    await join(); await userEvent.click(screen.getByRole('button', { name: 'Devices' }));
    await userEvent.selectOptions(screen.getByLabelText('Microphone'), 'mic-one');
    expect(sdk.switchDevice).toHaveBeenCalledWith('audioinput', 'mic-one');
    await userEvent.click(screen.getByRole('button', { name: 'Minimize call' }));
    expect(screen.getByRole('button', { name: 'Expand call' })).toBeVisible(); expect(sdk.disconnect).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Expand call' })); expect(screen.getByRole('button', { name: 'Unmute' })).toBeVisible();
  });
  it('does not offer organiser controls to regular participants', async () => {
    vi.mocked(callsApi.meeting).mockResolvedValue({ ...meeting, canManage: false });
    vi.mocked(callsApi.join).mockResolvedValue({ token: 'isolated-test-token', url: 'ws://127.0.0.1:7880', identity: 'trusted-user:session', sessionId: 'session-one', expiresIn: 120, meeting: { ...meeting, canManage: false } });
    await join(); expect(screen.queryByRole('button', { name: 'End for everyone' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Participants' })); expect(screen.queryByRole('button', { name: 'Remove Grace' })).not.toBeInTheDocument();
  });
  it('reuses native media with a scoped guest adapter and hides internal navigation and sharing policy controls', async () => {
    const safeMeeting = { ...meeting, title: 'Client review', conversationId: '', canManage: false };
    const adapter = { meeting: vi.fn().mockResolvedValue(safeMeeting), join: vi.fn().mockResolvedValue({ token: 'guest-test-token', url: 'ws://127.0.0.1:7880', identity: 'guest:session', sessionId: 'guest-media', expiresIn: 60, meeting: safeMeeting }), leave: vi.fn().mockResolvedValue({}), end: vi.fn(), remove: vi.fn() };
    render(<MemoryRouter><MeetingWindow id="guest-session" api={adapter} mode="guest" brandName="Harbour Accounting" allowScreenShare={false} subscribe={subscribe} revision={0} close={vi.fn()} displayName="Alex" participantLimit={8}/></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Join call' })); await screen.findByRole('button', { name: 'Unmute' });
    expect(adapter.join).toHaveBeenCalledWith('guest-session', expect.any(String)); expect(callsApi.join).not.toHaveBeenCalled(); expect(sdk.connect).toHaveBeenCalledWith('ws://127.0.0.1:7880', 'guest-test-token');
    expect(screen.queryByRole('button', { name: 'Share screen' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'End for everyone' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Information' })); expect(screen.queryByRole('link', { name: /conversation chat/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Leave call' })); await waitFor(() => expect(adapter.leave).toHaveBeenCalledWith('guest-session', 'guest-media')); expect(callsApi.leave).not.toHaveBeenCalled();
  });
});

