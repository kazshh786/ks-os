import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CommunicationLinkTargetSchema } from '@ks-os/contracts';
import { requestJson } from '../../api/client';
import { useAuth } from '../../auth/useAuth';

/** HTTPS app-link fallback. The API validates the target again before navigation. */
export default function CommunicationLinkPage() {
  const [params] = useSearchParams(), navigate = useNavigate(), auth = useAuth();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const target = CommunicationLinkTargetSchema.safeParse(Object.fromEntries(params));
  const serialized = params.toString();
  useEffect(() => {
    if (auth.isLoading) return;
    const result = CommunicationLinkTargetSchema.safeParse(Object.fromEntries(new URLSearchParams(serialized)));
    if (!result.success) { setError('This communication link is invalid.'); return; }
    const value = result.data, controller = new AbortController();
    const prefix = value.relationshipId ? `/api/v1/customer/collaboration/${value.relationshipId}/chat` : '/api/v1/communications/conversations';
    setBusy(true); setError('');
    void requestJson<{ data: { webPath: string } }>(prefix + '/links/resolve', {
      method: 'POST', body: JSON.stringify({ url: window.location.origin + '/open?' + serialized }),
      authContext: value.relationshipId ? 'CUSTOMER' : 'TENANT', signal: controller.signal, cache: 'no-store',
    }).then(({ data }) => {
      if (controller.signal.aborted) return;
      // Defence in depth: never navigate to arbitrary URLs, even on a malformed response.
      if (!/^\/(app\/(chat|meetings)|customer\/collaboration)\//.test(data.webPath)) throw new Error('Invalid destination');
      navigate(data.webPath, { replace: true });
    }).catch(() => { if (!controller.signal.aborted) setError('This item is unavailable in your current account or business. Sign in or choose an authorised business, then try again.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [serialized, auth.isLoading, auth.businessReference, navigate, revision]);
  return <main className="client-businesses"><h1>Open communication</h1>{busy && <p role="status">Checking your access…</p>}{error && <p role="alert">{error}</p>}
    {target.success && <>{!target.data.relationshipId && auth.memberships.length > 1 && <label>Business<select value={auth.businessReference} disabled={busy} onChange={event => { void auth.selectWorkspace(event.target.value).catch(() => setError('This business could not be selected.')); }}><option value="">Choose a business</option>{auth.memberships.map(item => <option key={item.businessReference} value={item.businessReference}>{item.businessName}</option>)}</select></label>}
      <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>Try again</button>
      <p><Link to={target.data.relationshipId ? '/customer/login' : '/login'}>Sign in</Link> and return to this link to continue.</p></>}
  </main>;
}
