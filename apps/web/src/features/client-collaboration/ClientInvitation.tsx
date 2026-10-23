import { signOutCustomer } from './customer-session';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { supabase } from '../../lib/supabase';
import { collaborationApi, portalPath } from './collaboration.api';
import './collaboration.css';

export default function ClientInvitation() {
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('invite') || '');
  const [ready, setReady] = useState(false), [signedIn, setSignedIn] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const handoff = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    let active = true;
    // Never forward the invitation capability to authentication redirects or asset requests.
    if (token) window.history.replaceState(window.history.state, '', '/customer/invite');
    if (token && token.length <= 1024) handoff.current ??= collaborationApi.handoff(token);
    const prepare = async () => {
      if (token) { if (token.length > 1024) throw new Error('Invalid invitation'); await handoff.current; }
      const [pending, auth] = await Promise.all([collaborationApi.pending(), supabase.auth.getSession()]);
      if (!pending.available) throw new Error('Invalid invitation');
      if (active) { setSignedIn(Boolean(auth.data.session)); setReady(true); }
    };
    void prepare().catch(() => { if (active) setError('This invitation is unavailable. Ask the business to send a new invitation.'); });
    return () => { active = false; };
  }, [token]);
  async function accept() {
    if (busy) return; setBusy(true); setError('');
    try { const result = await collaborationApi.accept(); navigate(portalPath(result.relationshipId) + '/messages/' + result.conversationId, { replace: true }); }
    catch { setError('This invitation could not be accepted. Use the email address that received it, or ask the business for a new invitation.'); } finally { setBusy(false); }
  }
  return <main className="client-entry"><section className="client-card"><p className="client-eyebrow">Secure client invitation</p><h1>Connect with your business</h1><p>Verify the email address that received this invitation. Access is limited to explicitly shared conversations.</p>{error && <p role="alert">{error}</p>}{!ready && !error && <p role="status">Checking your invitation…</p>}{ready && (signedIn ? <><button type="button" disabled={busy} onClick={() => void accept()}>{busy ? 'Accepting invitation…' : 'Accept invitation'}</button><p>If you are using a different email address, sign out before continuing.</p><button type="button" disabled={busy} onClick={() => { void signOutCustomer().then(() => setSignedIn(false)); }}>Use another account</button></> : <Link className="client-primary" to="/customer/login?collaboration=1">Verify my email and continue</Link>)}</section></main>;
}
