import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Grid2X2, Info, Maximize2, Mic, MicOff, Minimize2, MonitorUp, PhoneOff, Settings, Users, Video, VideoOff, X } from 'lucide-react';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import { useModalDialog } from '../../components/overlays/useModalDialog';
import { ConfirmChatAction } from '../chat/ChatDialog';
import { ChatError } from '../chat/chat.api';
import type { SubscribeChat } from '../chat/MessageTimeline';
import { callsApi, callingError, isJoinable, meetingOutcome, type Meeting } from './calls.api';
import { defaultDevices, DevicePreview, DeviceSettings, useDevices, type DeviceSelection } from './MeetingDevices';
import { ParticipantTile, ParticipantsPanel, RoomAudio } from './MeetingParticipants';

type Session = { room: Room; sessionId: string };
export type MeetingMediaApi = Pick<typeof callsApi, 'meeting' | 'join' | 'leave' | 'end' | 'remove'>;
export type MeetingWindowProps = {
  id: string; subscribe: SubscribeChat; revision: number; close: () => void; displayName: string; userId?: string; participantLimit: number;
  api?: MeetingMediaApi; mode?: 'conversation' | 'scheduled' | 'guest'; brandName?: string; brandHeader?: ReactNode;
  allowScreenShare?: boolean; hostPanel?: ReactNode;
};
export default function MeetingWindow({ id, subscribe, revision, close, displayName, userId, participantLimit, api = callsApi, mode = 'conversation', brandName = 'KSOS', brandHeader, allowScreenShare = true, hostPanel }: MeetingWindowProps) {
  const [meeting, setMeeting] = useState<Meeting | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [room, setRoom] = useState<Room | null>(null), [connection, setConnection] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [microphone, setMicrophone] = useState(false), [camera, setCamera] = useState(false), [selected, setSelected] = useState<DeviceSelection>(defaultDevices);
  const [joining, setJoining] = useState(false), [busy, setBusy] = useState(false), [minimized, setMinimized] = useState(false);
  const [settings, setSettings] = useState(false), [participantsOpen, setParticipantsOpen] = useState(false), [info, setInfo] = useState(false), [focusShare, setFocusShare] = useState(true);
  const [confirmation, setConfirmation] = useState<{ userId?: string; name?: string } | null>(null);
  const [, render] = useState(0);
  const alive = useRef(true), generation = useRef(0), connecting = useRef(false), session = useRef<Session | null>(null);
  const { devices, error: deviceError, refresh: refreshDevices } = useDevices();
  const dialog = useModalDialog<HTMLDivElement>(!minimized && !confirmation, () => setMinimized(true));
  const stop = useCallback(async () => {
    generation.current++;
    const current = session.current; session.current = null;
    if (alive.current) { setRoom(null); setConnection(ConnectionState.Disconnected); }
    if (!current) return;
    current.room.removeAllListeners();
    await current.room.disconnect(true).catch(() => undefined);
    await api.leave(id, current.sessionId).catch(() => undefined);
  }, [api, id]);
  const refreshMeeting = useCallback(async () => {
    try {
      const value = await api.meeting(id);
      if (!alive.current) return;
      setMeeting(value);
      if (!isJoinable(value)) { await stop(); setNotice(meetingOutcome(value)); }
    } catch (cause) {
      if (!alive.current) return;
      setError(callingError(cause));
      if (cause instanceof ChatError && [401, 403, 404].includes(cause.status) || cause instanceof Error && 'status' in cause && [401, 403, 404, 410].includes(Number(cause.status))) await stop();
    }
  }, [api, id, stop]);
  useEffect(() => {
    alive.current = true;
    void refreshMeeting();
    const timer = setInterval(() => void refreshMeeting(), 15000);
    const unsubscribe = subscribe(event => { if ((event.type.startsWith('call.') || event.type.startsWith('meeting.') || event.type.startsWith('guest.')) && event.resourceId === id || event.type === 'conversation.member_left') void refreshMeeting(); });
    return () => { alive.current = false; connecting.current = false; clearInterval(timer); unsubscribe(); void stop(); };
  }, [refreshMeeting, stop, subscribe, id]);
  useEffect(() => { if (revision) void refreshMeeting(); }, [revision, refreshMeeting]);
  const join = async () => {
    if (!meeting || !isJoinable(meeting) || connecting.current || session.current) return;
    connecting.current = true; setJoining(true); setError(''); setNotice('');
    const attempt = ++generation.current;
    let newSession: Session | null = null;
    try {
      const ticket = await api.join(id, crypto.randomUUID());
      if (!alive.current || attempt !== generation.current) { await api.leave(id, ticket.sessionId).catch(() => undefined); return; }
      const connectedRoom = new Room({
        adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true,
        audioCaptureDefaults: { deviceId: selected.audioinput || undefined, echoCancellation: true, noiseSuppression: true },
        videoCaptureDefaults: { deviceId: selected.videoinput || undefined, resolution: { width: 640, height: 360, frameRate: 24 } },
        audioOutput: { deviceId: selected.audiooutput || 'default' },
        publishDefaults: { simulcast: true },
      });
      newSession = { room: connectedRoom, sessionId: ticket.sessionId };
      session.current = newSession;
      const update = () => { if (alive.current && session.current?.room === connectedRoom) render(value => value + 1); };
      connectedRoom.on(RoomEvent.ConnectionStateChanged, state => {
        if (alive.current && session.current?.room === connectedRoom) {
          setConnection(state);
          if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) setNotice('Reconnecting… Your devices keep their current settings.');
          if (state === ConnectionState.Connected) setNotice('');
        }
      });
      connectedRoom.on(RoomEvent.Disconnected, () => {
        if (alive.current && session.current?.room === connectedRoom) {
          setNotice('The media connection ended. Check the call status, then join again if it is still open.');
          void stop(); void refreshMeeting();
        }
      });
      connectedRoom.on(RoomEvent.MediaDevicesError, cause => { if (alive.current) setError(callingError(cause)); });
      const updatedEvents = [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.ConnectionQualityChanged, RoomEvent.AudioPlaybackStatusChanged, RoomEvent.ParticipantNameChanged] as const;
      for (const event of updatedEvents) connectedRoom.on(event, update);
      setConnection(ConnectionState.Connecting);
      await connectedRoom.connect(ticket.url, ticket.token);
      if (!alive.current || attempt !== generation.current) { await connectedRoom.disconnect(true); return; }
      setRoom(connectedRoom); setMeeting(ticket.meeting); setConnection(connectedRoom.state);
      // No device is activated until the participant explicitly selects it in pre-join.
      if (microphone) { try { await connectedRoom.localParticipant.setMicrophoneEnabled(true); } catch (cause) { if (alive.current) setError(callingError(cause)); } }
      if (camera && alive.current && attempt === generation.current) { try { await connectedRoom.localParticipant.setCameraEnabled(true); } catch (cause) { if (alive.current) setError(callingError(cause)); } }
      if (!alive.current || attempt !== generation.current) { await connectedRoom.disconnect(true); return; }
      update(); void refreshDevices(); void refreshMeeting();
    } catch (cause) {
      if (newSession && session.current === newSession) await stop();
      if (alive.current) { setConnection(ConnectionState.Disconnected); setError('Unable to connect. ' + callingError(cause)); }
    } finally { connecting.current = false; if (alive.current) setJoining(false); }
  };
  const control = async (work: () => Promise<unknown>) => {
    if (busy) return; setBusy(true); setError('');
    try { await work(); await refreshDevices(); render(value => value + 1); } catch (cause) { setError(callingError(cause)); }
    finally { setBusy(false); }
  };
  const leave = async () => { setBusy(true); await stop(); setBusy(false); close(); };
  const manage = async () => {
    const action = confirmation; if (!action) return;
    setBusy(true); setError('');
    try {
      if (action.userId) { await api.remove(id, action.userId); setNotice(action.name + ' was removed.'); await refreshMeeting(); }
      else { const value = await api.end(id); setMeeting(value); await stop(); setNotice(meetingOutcome(value)); }
      setConfirmation(null);
    } catch (cause) { setError(callingError(cause)); } finally { setBusy(false); }
  };
  const participantList = room ? [room.localParticipant, ...room.remoteParticipants.values()] : [];
  const sharing = participantList.filter(person => person.getTrackPublication(Track.Source.ScreenShare)?.track && person.isScreenShareEnabled);
  const selfName = meeting?.participants?.find(person => person.userId === userId)?.name || displayName;
  const canScreenShare = allowScreenShare && Boolean(navigator.mediaDevices?.getDisplayMedia);
  const connected = room && connection === ConnectionState.Connected;
  return <>
    {room && <RoomAudio room={room}/>}
    {minimized && <div className="call-minimized"><span className="call-live-dot"/><span>{meeting?.conversationName || 'KSOS call'} · {room ? connection : 'Ready to join'}</span><button type="button" onClick={() => setMinimized(false)} aria-label="Expand call"><Maximize2 size={18}/></button><button type="button" onClick={() => void leave()} aria-label="Leave call"><PhoneOff size={18}/></button></div>}
    <div className="call-backdrop" hidden={minimized}>
      <section ref={dialog} className="call-window" role="dialog" aria-modal="true" aria-label={meeting ? meeting.type === 'VIDEO' ? 'Video call' : 'Voice call' : 'KSOS call'} tabIndex={-1}>
        <header className="call-header"><div>{brandHeader}<p className="chat-eyebrow">{brandName} · {meeting?.type === 'VIDEO' ? 'Video call' : 'Voice call'}</p><h2>{mode === 'conversation' ? meeting?.conversationName || 'Opening call…' : meeting?.title || 'Opening meeting…'}</h2><p role="status">{joining ? 'Connecting…' : room ? connection === ConnectionState.Connected ? 'Connected' : (connection === ConnectionState.Reconnecting || connection === ConnectionState.SignalReconnecting) ? 'Reconnecting…' : 'Disconnected' : notice || 'Ready when you are'}</p></div><button type="button" onClick={() => setMinimized(true)} aria-label="Minimize call"><Minimize2 size={19}/></button><button type="button" disabled={busy} onClick={() => void leave()} aria-label="Close and leave call"><X size={19}/></button></header>
        {hostPanel}
        {error && <p role="alert" className="call-error">{error}</p>}
        {notice && <p role="status" className="call-notice">{notice}</p>}
        {!meeting ? <p role="status" className="call-loading">Loading meeting details…</p> : !isJoinable(meeting) ? <div className="call-ended"><PhoneOff size={36} aria-hidden="true"/><h3>{meetingOutcome(meeting)}</h3><p>{mode === 'conversation' ? 'Call history is saved in ' + meeting.conversationName + '.' : mode === 'guest' ? 'Your connection to this meeting is closed.' : 'Meeting history remains available in Meetings.'}</p><button type="button" onClick={close}>{mode === 'guest' ? 'Close meeting' : 'Back to workspace'}</button></div> : room ? <>
          <div className="call-body"><div className="call-stage">
            <p className="sr-only" role="status" aria-live="polite">{participantList.length} connected device{participantList.length === 1 ? '' : 's'}: {participantList.map(person => person.name || 'Participant').join(', ')}</p>
            {sharing.length > 0 && <div className="call-stage-tools"><button type="button" onClick={() => setFocusShare(value => !value)}><Grid2X2 size={16}/>{focusShare ? 'Show grid' : 'Focus shared screen'}</button></div>}
            {focusShare && sharing.length > 0 && <div className="call-shared-focus">{sharing.map(person => <ParticipantTile key={person.identity} participant={person} share/>)}</div>}
            <div className={'call-grid' + (focusShare && sharing.length ? ' call-grid-small' : '')}>
              {participantList.map(person => <ParticipantTile key={person.identity} participant={person}/>)}
              {!focusShare && sharing.map(person => <ParticipantTile key={person.identity + '-share'} participant={person} share/>)}
            </div>
            {participantList.length === 1 && <p className="call-waiting">{mode === 'conversation' ? 'You are the first person here. Others can join from the conversation.' : 'You are the first person here. Other participants will appear when they join.'}</p>}
            {!room.canPlaybackAudio && <button type="button" className="call-primary" onClick={() => void control(() => room.startAudio())}>Enable call audio</button>}
          </div>
          {participantsOpen && <ParticipantsPanel meeting={meeting} participants={participantList} busy={busy} mediaOnly={mode === 'guest'} remove={(targetId, name) => setConfirmation({ userId: targetId, name })}/>}
          </div>
          {settings && <section className="call-settings" aria-label="Call device settings"><h3>Devices</h3><DeviceSettings devices={devices} selected={selected} disabled={busy} change={(kind, deviceId) => void control(async () => { const switched = await room.switchActiveDevice(kind, deviceId || 'default'); if (!switched) throw new Error('This device could not be selected. Check that it is connected and allowed by your browser.'); setSelected(value => ({ ...value, [kind]: deviceId })); })}/>{deviceError && <p role="alert">{deviceError}</p>}</section>}
          {info && <section className="call-info" aria-label="Meeting information"><p>Organised by {meeting.organizerName}. Up to {participantLimit} participants.</p><p>Media uses encrypted transport. Recording and transcription are off.</p><p>Keep this page open to stay connected.</p>{mode === 'conversation' && <a href={'/app/chat/' + meeting.conversationId} target="_blank" rel="noopener noreferrer">Open conversation chat in a new tab</a>}{mode === 'guest' && <p>Guest names are provided by participants and do not verify their identity. Meetings are provided securely through KSOS.</p>}</section>}
          <footer className="call-toolbar">
            <button type="button" disabled={busy || !connected} aria-pressed={room.localParticipant.isMicrophoneEnabled} onClick={() => void control(() => room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled))}>{room.localParticipant.isMicrophoneEnabled ? <Mic size={20}/> : <MicOff size={20}/>}<span>{room.localParticipant.isMicrophoneEnabled ? 'Mute' : 'Unmute'}</span></button>
            <button type="button" disabled={busy || !connected} aria-pressed={room.localParticipant.isCameraEnabled} onClick={() => void control(() => room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled))}>{room.localParticipant.isCameraEnabled ? <Video size={20}/> : <VideoOff size={20}/>}<span>{room.localParticipant.isCameraEnabled ? 'Camera off' : 'Camera on'}</span></button>
            {allowScreenShare && <button type="button" disabled={busy || !connected || !canScreenShare} title={canScreenShare ? 'Share your screen, window or tab' : 'Screen sharing is not supported in this browser'} aria-pressed={room.localParticipant.isScreenShareEnabled} onClick={() => void control(() => room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled, { audio: true }))}><MonitorUp size={20}/><span>{room.localParticipant.isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}</span></button>}
            <button type="button" aria-expanded={participantsOpen} onClick={() => setParticipantsOpen(value => !value)}><Users size={20}/><span>Participants</span></button>
            <button type="button" aria-expanded={settings} onClick={() => setSettings(value => !value)}><Settings size={20}/><span>Devices</span></button>
            <button type="button" aria-expanded={info} onClick={() => setInfo(value => !value)}><Info size={20}/><span>Information</span></button>
            <button type="button" className="call-danger" disabled={busy} onClick={() => void leave()}><PhoneOff size={20}/><span>Leave call</span></button>
            {meeting.canManage && <button type="button" className="call-end" disabled={busy} onClick={() => setConfirmation({})}>End for everyone</button>}
          </footer>
        </> : joining ? <div className="call-loading" role="status">Connecting securely to your meeting…</div> : <div className="call-prejoin">
          <div><DevicePreview microphone={microphone} camera={camera} selected={selected} changed={refreshDevices} initials={brandName.slice(0, 2).toUpperCase()}/><div className="call-prejoin-toggles"><label><input type="checkbox" checked={microphone} onChange={event => setMicrophone(event.target.checked)}/>Enable microphone</label><label><input type="checkbox" checked={camera} onChange={event => setCamera(event.target.checked)}/>Enable camera preview</label></div></div>
          <div><p className="chat-eyebrow">Before you join</p><h3>Hello, {selfName}</h3><p>Your microphone and camera start off. Enable only what you want to share.</p><DeviceSettings devices={devices} selected={selected} change={(kind, value) => setSelected(current => ({ ...current, [kind]: value }))}/>{deviceError && <p role="alert">{deviceError}</p>}<button type="button" className="call-primary call-join" disabled={busy} onClick={() => void join()}>Join call</button>{meeting.canManage && <button type="button" className="call-end" disabled={busy} onClick={() => setConfirmation({})}>Cancel call for everyone</button>}<p className="call-muted">Up to {participantLimit} participants.{mode === 'conversation' ? ' Your conversation stays in KSOS Chat.' : ' Recording and transcription are off.'}</p></div>
        </div>}
      </section>
    </div>
    {confirmation && <ConfirmChatAction title={confirmation.userId ? 'Remove participant' : 'End meeting for everyone'} description={confirmation.userId ? 'Remove ' + confirmation.name + ' from this meeting? Their active connections will end.' : 'Everyone will be disconnected. To disconnect only this device, choose Leave call instead.'} action={() => { if (!busy) void manage(); }} close={() => { if (!busy) setConfirmation(null); }}/>} 
  </>;
}

