import { useEffect, useRef } from 'react';
import { MicOff, Monitor, Signal, UserRound } from 'lucide-react';
import { Track, type Participant, type Room } from 'livekit-client';
import type { Meeting } from './calls.api';

function TrackElement({ track, video, local = false, name }: { track: Track; video: boolean; local?: boolean; name: string }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => { track.detach(element); };
  }, [track]);
  return video ? <video ref={ref} autoPlay playsInline muted={local} aria-label={name}/> : <audio ref={ref} autoPlay aria-label={name}/>;
}
export function RoomAudio({ room }: { room: Room }) {
  return <div className="call-audio" aria-hidden="true">{[...room.remoteParticipants.values()].flatMap(participant => [...participant.audioTrackPublications.values()].filter(publication => publication.track).map(publication => <TrackElement key={publication.trackSid} track={publication.track!} video={false} name={'Audio from ' + (participant.name || 'Participant')}/>))}</div>;
}
export function ParticipantTile({ participant, share = false }: { participant: Participant; share?: boolean }) {
  const publication = participant.getTrackPublication(share ? Track.Source.ScreenShare : Track.Source.Camera);
  const track = publication?.track, name = participant.name || 'Participant';
  return <article className={'call-tile' + (participant.isSpeaking ? ' call-speaking' : '') + (share ? ' call-share-tile' : '')} aria-label={name + (share ? ' screen share' : '')}>
    {track && !publication?.isMuted ? <TrackElement track={track} video local={participant.isLocal} name={name + (share ? ' shared screen' : ' camera')}/> : <div className="call-camera-placeholder"><span aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span><p>{share ? 'Waiting for shared screen…' : 'Camera off'}</p></div>}
    <footer><strong>{share && <Monitor size={15} aria-hidden="true"/>}{name}{participant.isLocal ? ' (you)' : ''}</strong><span>{!participant.isMicrophoneEnabled && <MicOff size={14} aria-label="Microphone muted"/>}<Signal size={14} aria-hidden="true"/><span className="sr-only">Connection quality: </span>{participant.connectionQuality}</span></footer>
  </article>;
}
export function ParticipantsPanel({ meeting, participants, remove, busy }: { meeting: Meeting; participants: Participant[]; remove: (userId: string, name: string) => void; busy: boolean }) {
  return <section className="call-participants" aria-label="Call participants"><h3><UserRound size={18} aria-hidden="true"/>Participants</h3>
    <p className="call-muted">{participants.length} connected device{participants.length === 1 ? '' : 's'}. One person may join from more than one device.</p>
    <ul>{(meeting.participants || []).map(person => <li key={person.userId}><div><strong>{person.name}{person.userId === meeting.createdBy ? ' · Organiser' : ''}</strong><span>{person.sessionCount > 0 ? person.sessionCount + ' connected' : person.invitationState === 'INVITED' ? 'Invited' : person.invitationState === 'DECLINED' ? 'Declined' : person.invitationState === 'REMOVED' ? 'Removed' : person.leftAt ? 'Left' : 'Not connected'}</span></div>{meeting.canManage && person.userId !== meeting.createdBy && person.invitationState !== 'REMOVED' && <button type="button" disabled={busy} onClick={() => remove(person.userId, person.name)} aria-label={'Remove ' + person.name}>Remove</button>}</li>)}</ul>
  </section>;
}

