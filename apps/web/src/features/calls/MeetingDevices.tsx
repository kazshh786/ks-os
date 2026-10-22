import { useCallback, useEffect, useRef, useState } from 'react';
import { createLocalTracks, Room, Track, type LocalTrack } from 'livekit-client';
import { callingError } from './calls.api';

export type DeviceSelection = { audioinput: string; videoinput: string; audiooutput: string };
export const defaultDevices: DeviceSelection = { audioinput: '', videoinput: '', audiooutput: '' };
export function useDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) { setError('Device selection is not supported in this browser.'); return; }
    try { setDevices(await Room.getLocalDevices(undefined, false)); setError(''); } catch (cause) { setError(callingError(cause)); }
  }, []);
  useEffect(() => {
    void refresh(); const changed = () => void refresh();
    navigator.mediaDevices?.addEventListener('devicechange', changed);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', changed);
  }, [refresh]);
  return { devices, error, refresh };
}
export function DeviceSettings({ devices, selected, change, disabled = false }: { devices: MediaDeviceInfo[]; selected: DeviceSelection; change: (kind: MediaDeviceKind, id: string) => void; disabled?: boolean }) {
  const outputSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  return <div className="call-devices">
    {(['audioinput', 'videoinput', 'audiooutput'] as const).map(kind => <label key={kind}>
      {{ audioinput: 'Microphone', videoinput: 'Camera', audiooutput: 'Speaker' }[kind]}
      <select value={selected[kind]} disabled={disabled || kind === 'audiooutput' && !outputSupported} onChange={event => change(kind, event.target.value)}>
        <option value="">System default</option>{devices.filter(device => device.kind === kind).map((device, index) => <option key={device.deviceId || index} value={device.deviceId}> {device.label || 'Device ' + (index + 1)}</option>)}
      </select>
    </label>)}
    {!outputSupported && <p className="call-muted">Choose speakers in your system settings; this browser cannot switch audio output.</p>}
    <p className="call-muted">Device names may appear after you allow microphone or camera access.</p>
  </div>;
}
export function DevicePreview({ microphone, camera, selected, changed, initials = 'KS' }: { microphone: boolean; camera: boolean; selected: DeviceSelection; changed: () => Promise<void>; initials?: string }) {
  const [tracks, setTracks] = useState<LocalTrack[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let current = true, acquired: LocalTrack[] = [];
    setTracks([]); setError('');
    if (!microphone && !camera) { setLoading(false); return; }
    setLoading(true);
    // Capture only follows the user's explicit pre-join device toggle.
    void createLocalTracks({
      audio: microphone ? { deviceId: selected.audioinput || undefined, echoCancellation: true, noiseSuppression: true } : false,
      video: camera ? { deviceId: selected.videoinput || undefined, resolution: { width: 640, height: 360, frameRate: 24 } } : false,
    }).then(result => {
      acquired = result;
      if (!current) { result.forEach(track => track.stop()); return; }
      setTracks(result); void changed();
    }).catch(cause => { if (current) setError(callingError(cause)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; acquired.forEach(track => { track.detach(); track.stop(); }); };
  }, [microphone, camera, selected.audioinput, selected.videoinput, changed]);
  const cameraTrack = tracks.find(track => track.kind === Track.Kind.Video);
  useEffect(() => {
    const element = video.current;
    if (!cameraTrack || !element) return;
    cameraTrack.attach(element);
    return () => { cameraTrack.detach(element); };
  }, [cameraTrack]);
  return <div className="call-preview">
    {cameraTrack ? <video ref={video} autoPlay muted playsInline aria-label="Your camera preview"/> : <div className="call-camera-placeholder"><span aria-hidden="true">{initials}</span><p>{loading ? 'Checking devices…' : 'Your camera is off'}</p></div>}
    {microphone && tracks.some(track => track.kind === Track.Kind.Audio) && <p className="call-preview-caption">Microphone ready · preview is not sent to the meeting</p>}
    {error && <p role="alert" className="call-error">{error}</p>}
  </div>;
}

