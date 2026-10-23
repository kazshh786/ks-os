import { useCallback, useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import { callingError } from '../calls/calls.api';
import { meetingsApi, type WaitingGuest } from './meetings.api';
import { onMeetingsInvalidated } from './meetings.live';

export function MeetingWaitingRoom({ id, changed }: { id: string; changed: () => void }) {
  const [guests, setGuests] = useState<WaitingGuest[]>([]), [error, setError] = useState(''), [busyId, setBusyId] = useState('');
  const [revision, setRevision] = useState(0), [notice, setNotice] = useState('');
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => onMeetingsInvalidated(refresh), [refresh]);
  useEffect(() => {
    let active = true, pending = false;
    const update = async () => {
      if (pending) return; pending = true;
      try { const value = await meetingsApi.waiting(id); if (active) { setGuests(value); setError(''); } }
      catch (cause) { if (active) setError(callingError(cause)); } finally { pending = false; }
    };
    void update(); const timer = setInterval(() => void update(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [id, revision]);
  async function admission(guest: WaitingGuest, approve: boolean) {
    if (busyId) return; setBusyId(guest.id); setError('');
    try { await meetingsApi.admit(id, guest.id, approve); setNotice(`${guest.name} ${approve ? 'has been admitted' : 'was not admitted'}.`); refresh(); changed(); }
    catch (cause) { setError(callingError(cause)); } finally { setBusyId(''); }
  }
  const waiting = guests.filter(guest => guest.state === 'WAITING');
  return <section className="meeting-waiting-room" aria-labelledby={'waiting-' + id}><div><h2 id={'waiting-' + id}><UserRound size={19} aria-hidden="true"/>Waiting room <span className="meetings-count">{waiting.length}</span></h2><p className="meetings-muted">Only admitted guests can connect. Check names with your customer before admitting; guest names do not verify identity.</p></div>
    {error && <p role="alert" className="meetings-error">{error} <button type="button" onClick={refresh}>Retry</button></p>}{notice && <p role="status" className="meetings-notice">{notice}</p>}
    <p className="sr-only" role="status" aria-live="polite">{waiting.length} guest{waiting.length === 1 ? '' : 's'} waiting</p>
    {waiting.length ? <ul>{waiting.map(guest => <li key={guest.id}><div><strong>{guest.name}</strong><span>Arrived <time dateTime={guest.createdAt}>{new Date(guest.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time></span></div><div className="meetings-actions"><button type="button" disabled={Boolean(busyId)} onClick={() => void admission(guest, false)}>Deny</button><button type="button" className="meetings-primary" disabled={Boolean(busyId)} onClick={() => void admission(guest, true)}>{busyId === guest.id ? 'Saving…' : 'Admit'}</button></div></li>)}</ul> : <p className="meetings-muted">No guests are waiting.</p>}
  </section>;
}
