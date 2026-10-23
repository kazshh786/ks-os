import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { chatApi } from '../chat/chat.api';
import { staffCollaborationApi, type ClientChannelSummary } from './collaboration.api';
import { CreateClientChannel } from './CreateClientChannel';
import './collaboration.css';

export function CustomerClientChannels({ reference }: { reference: string }) {
  const [rows, setRows] = useState<ClientChannelSummary[]>([]), [error, setError] = useState(''), [revision, setRevision] = useState(0), [create, setCreate] = useState(false), [canCreate, setCanCreate] = useState(false), [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => { const abort = new AbortController(); void staffCollaborationApi.customerReference(reference, abort.signal).then(values => { if (!abort.signal.aborted) setCustomer(values[0] || null); }).catch(() => {}); return () => abort.abort(); }, [reference]);
  useEffect(() => { let active = true; void chatApi.capabilities().then(value => { if (active) setCanCreate(Boolean(value.canCreateClientChannels)); }).catch(() => {}); return () => { active = false; }; }, []);
  useEffect(() => { const abort = new AbortController(); void staffCollaborationApi.channels(new URLSearchParams({ clientReference: reference }).toString(), abort.signal).then(page => { if (!abort.signal.aborted) { setRows(page.data); setError(''); } }).catch(() => { if (!abort.signal.aborted) setError('Client conversations are unavailable with your current access.'); }); return () => abort.abort(); }, [reference, revision]);
  return <section className="c360-section" aria-labelledby="customer-conversations"><div className="c360-section-title"><h2 id="customer-conversations">Client conversations</h2>{canCreate && customer && <button type="button" className="c360-button" onClick={() => setCreate(true)}>Create client channel</button>}</div><p className="c360-muted">Customer-visible conversations are separate from internal notes. Contacts only gain access through an explicit invitation.</p>{error ? <p role="status">{error}</p> : rows.length ? <ul className="c360-now">{rows.map(value => <li key={value.id}><div className="c360-now-copy"><Link to={'/app/chat/' + value.id}>{value.name}</Link><span>Customer-visible{value.archivedAt ? ' · Archived' : ''}</span></div></li>)}</ul> : <p className="c360-muted">No client conversations are linked to this customer.</p>}{create && <CreateClientChannel initialClientId={customer?.id} initialCustomer={customer || undefined} close={() => setCreate(false)} created={() => { setCreate(false); setRevision(value => value + 1); }}/>}</section>;
}
