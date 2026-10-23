import { Room, RoomEvent, Track } from 'livekit-client';

// Only served by the isolated CI harness; not imported by the application.
const room = new Room({ adaptiveStream: true, dynacast: true, videoCaptureDefaults: { resolution: { width: 640, height: 360, frameRate: 15 } }, publishDefaults: { simulcast: true } });
const events = [];
const status = document.getElementById('status');
const media = document.getElementById('media');
function attach(track, publication, participant) {
  const element = track.attach();
  element.dataset.identity = participant.identity;
  element.dataset.source = publication.source;
  element.autoplay = true;
  element.playsInline = true;
  if (track.kind === Track.Kind.Video) { element.style.width = '320px'; element.style.height = '180px'; }
  media.append(element);
}
room.on(RoomEvent.ConnectionStateChanged, state => { events.push(state); status.textContent = state; });
room.on(RoomEvent.TrackSubscribed, attach);
room.on(RoomEvent.TrackUnsubscribed, track => track.detach().forEach(element => element.remove()));
room.on(RoomEvent.Disconnected, reason => { events.push(`disconnected:${reason}`); });
room.on(RoomEvent.SignalReconnecting, () => events.push('signal-reconnecting'));
room.on(RoomEvent.SignalConnected, () => events.push('signal-connected'));
room.on(RoomEvent.Reconnected, () => events.push('reconnected'));
document.getElementById('share').addEventListener('click', async () => {
  try {
    await room.localParticipant.setScreenShareEnabled(true, { audio: false, preferCurrentTab: true });
    document.getElementById('share-result').textContent = 'Screen sharing';
  } catch (error) { document.getElementById('share-result').textContent = `Screen sharing failed: ${error.message}`; }
});
window.media = {
  events,
  async connect({ url, token }) { await room.connect(url, token); return room.localParticipant.identity; },
  async publish() { await room.localParticipant.setMicrophoneEnabled(true); await room.localParticipant.setCameraEnabled(true); },
  async microphone(enabled) { await room.localParticipant.setMicrophoneEnabled(enabled); return room.localParticipant.isMicrophoneEnabled; },
  async camera(enabled) { await room.localParticipant.setCameraEnabled(enabled); return room.localParticipant.isCameraEnabled; },
  async stopScreen() { await room.localParticipant.setScreenShareEnabled(false); },
  async disconnect() { await room.disconnect(); },
  state: () => room.state,
  participants: () => [...room.remoteParticipants.keys()],
  async received() {
    const result = [];
    for (const participant of room.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) {
      if (!publication.track) continue;
      const report = await publication.track.getRTCStatsReport();
      for (const stat of report?.values() ?? []) if (stat.type === 'inbound-rtp' && !stat.isRemote) result.push({
        identity: participant.identity, source: publication.source, kind: publication.kind,
        bytesReceived: stat.bytesReceived ?? 0, framesDecoded: stat.framesDecoded ?? 0, packetsReceived: stat.packetsReceived ?? 0,
      });
    }
    return result;
  },
};
