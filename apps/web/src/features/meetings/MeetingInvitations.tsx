import { useRef, useState } from 'react';
import { Copy, Link2, Mail } from 'lucide-react';
import { callingError } from '../calls/calls.api';
import { meetingsApi, type InvitationResult, type ScheduledMeeting } from './meetings.api';
import { meetingDateTime } from './meeting-time';

export function MeetingInvitations({ meeting, changed }: { meeting: ScheduledMeeting; changed: () => void }) {
  const [email, setEmail] = useState(''), [expires, setExpires] = useState('');
  const [result, setResult] = useState<InvitationResult | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  async function generate(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice('');
    try {
      const invitation = await meetingsApi.invite(meeting.id, requestId.current, email.trim() || undefined, expires ? new Date(expires + ':00Z').toISOString() : undefined);
      setResult(invitation); requestId.current = crypto.randomUUID(); setNotice(invitation.emailQueued ? 'Invitation created and email queued.' : 'Invitation created. Copy the link or invitation text below.'); changed();
    } catch (cause) { setError(callingError(cause)); } finally { setBusy(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice('Copied to clipboard.'); } catch { setError('Clipboard access is unavailable. Select and copy the invitation below.'); }
  }
  async function revoke() {
    if (!confirmId || busy) return; setBusy(true); setError('');
    try { await meetingsApi.revoke(meeting.id, confirmId); if (result?.id === confirmId) setResult(null); setConfirmId(null); setNotice('Invitation revoked. Create a new invitation below if the guest still needs access.'); changed(); }
    catch (cause) { setError(callingError(cause)); } finally { setBusy(false); }
  }
  return <section className="meetings-card" aria-labelledby="meeting-invitations"><h2 id="meeting-invitations"><Link2 size={19} aria-hidden="true"/>Guest invitations</h2><p className="meetings-muted">Each link admits one guest to the waiting room. After it is claimed, that browser can return using its secure session. Create separate invitations for other guests.</p>
    {error && <p role="alert" className="meetings-error">{error}</p>}{notice && <p role="status" className="meetings-notice">{notice}</p>}
    <form onSubmit={event => void generate(event)} className="meetings-invite-form"><label>Email address (optional)<input type="email" autoComplete="off" maxLength={254} value={email} onChange={event => { setEmail(event.target.value); requestId.current = crypto.randomUUID(); }} /></label><label>Expires at (UTC, optional)<input type="datetime-local" value={expires} onChange={event => { setExpires(event.target.value); requestId.current = crypto.randomUUID(); }} /></label><button type="submit" className="meetings-primary" disabled={busy}><Mail size={17} aria-hidden="true"/>{busy ? 'Working…' : email ? 'Create and email invitation' : 'Create invitation'}</button></form>
    {result && <div className="meetings-invitation-result"><label>Invitation link<input readOnly value={result.url} onFocus={event => event.target.select()}/></label><label>Invitation text<textarea readOnly rows={5} value={result.text} onFocus={event => event.target.select()}/></label><div className="meetings-actions"><button type="button" onClick={() => void copy(result.url)}><Copy size={16} aria-hidden="true"/>Copy link</button><button type="button" onClick={() => void copy(result.text)}><Copy size={16} aria-hidden="true"/>Copy invitation</button></div><p className="meetings-muted">Expires {meetingDateTime(result.expiresAt, meeting.timezone)} ({meeting.timezone}). The link is shown only when it is created.</p></div>}
    {confirmId && <div className="meetings-confirm" role="group" aria-label="Revoke invitation confirmation"><p>Revoke this invitation and the guest access it grants? Create a replacement invitation after revoking.</p><button type="button" className="meetings-danger" disabled={busy} onClick={() => void revoke()}>Revoke invitation</button><button type="button" disabled={busy} onClick={() => setConfirmId(null)}>Keep invitation</button></div>}
    <ul className="meetings-invitations">{(meeting.invitations || []).map(invitation => <li key={invitation.id}><div><strong>{invitation.email || 'Copy-link invitation'}</strong><span>{invitation.revokedAt ? 'Revoked' : invitation.claimedAt ? 'Claimed' : Date.parse(invitation.expiresAt) <= Date.now() ? 'Expired' : 'Available'} · Expires {meetingDateTime(invitation.expiresAt, meeting.timezone)}</span></div>{!invitation.revokedAt && Date.parse(invitation.expiresAt) > Date.now() && <button type="button" disabled={busy} onClick={() => setConfirmId(invitation.id)}>Revoke</button>}</li>)}</ul>
  </section>;
}
