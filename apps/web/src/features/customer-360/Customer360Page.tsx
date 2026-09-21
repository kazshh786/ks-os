import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ArrowUpRight, BriefcaseBusiness, CalendarDays, CheckCheck, CircleUserRound, CreditCard, FileCheck2, Mail, MessageCircle, Sparkles, Wrench } from 'lucide-react';
import { CustomerOverviewSchema, CustomerTimelinePageSchema, type CustomerAction, type CustomerOverview, type CustomerSource, type CustomerTimelineEntry, type CustomerTimelinePage } from '@ks-os/contracts';
import { fetchWithAuth, responseError } from '../../api/client';
import './customer-360.css';

const labels: Record<CustomerSource, string> = { crm: 'Relationship', sales: 'Sales', work: 'Work', tasks: 'Tasks', bookings: 'Appointments', communications: 'Messages', payments: 'Payments', forms: 'Forms', reputation: 'Reviews', operations: 'Operations' };
const icons = { crm: CircleUserRound, sales: BriefcaseBusiness, work: Wrench, tasks: CheckCheck, bookings: CalendarDays, communications: Mail, payments: CreditCard, forms: FileCheck2, reputation: Sparkles, operations: MessageCircle };
const day = (value: string) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const time = (value: string) => new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const money = (amount: number, currency: string) => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount / 100);
async function request(path: string, init?: RequestInit) {
  const response = await fetchWithAuth(path, init);
  if (!response.ok) throw await responseError(response, 'Could not load this customer.');
  return (await response.json()).data;
}
function Timeline({ entries }: { entries: CustomerTimelineEntry[] }) {
  const groups = new Map<string, CustomerTimelineEntry[]>();
  for (const entry of entries) { const key = day(entry.occurredAt); groups.set(key, [...(groups.get(key) ?? []), entry]); }
  return <div className="c360-history">{[...groups].map(([date, rows]) => <section key={date} aria-label={date}>
    <h3>{date}</h3><ol>{rows.map(entry => { const Icon = icons[entry.source]; return <li key={entry.key}>
      <span className="c360-event-icon" aria-hidden="true"><Icon size={17} /></span>
      <div><p>{entry.route ? <Link to={entry.route}>{entry.title}</Link> : entry.title}</p><span>{labels[entry.source]} · <time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time>{entry.important ? ' · Key event' : ''}</span></div>
    </li>; })}</ol></section>)}</div>;
}
export function Customer360Page() {
  const { reference = '' } = useParams();
  return <Customer360View key={reference} reference={reference} />;
}
export function Customer360View({ reference }: { reference: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<CustomerOverview | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [timeline, setTimeline] = useState<CustomerTimelinePage | null>(null);
  const [source, setSource] = useState<CustomerSource | ''>('');
  const [important, setImportant] = useState(false);
  const [timelineBusy, setTimelineBusy] = useState(false);
  const [timelineError, setTimelineError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [action, setAction] = useState<CustomerAction | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const actionInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const timelineSequence = useRef(0);
  const mounted = useRef(true);
  const base = `/api/v1/clients/${encodeURIComponent(reference)}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; timelineSequence.current++; }; }, []);
  useEffect(() => {
    const abort = new AbortController(); setError('');
    timelineSequence.current++; setTimelineBusy(false);
    void request(`${base}/overview`, { signal: abort.signal }).then(value => {
      if (abort.signal.aborted) return;
      const next = CustomerOverviewSchema.parse(value); setData(next); setTimeline(next.timeline); setSource(''); setImportant(false); setTimelineError('');
    }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load this customer.'); });
    return () => abort.abort();
  }, [base, refresh]);
  useEffect(() => { if (action) actionInput.current?.focus(); }, [action]);
  async function loadTimeline(nextSource: CustomerSource | '', nextImportant: boolean, cursor?: string) {
    const sequence = ++timelineSequence.current; setTimelineBusy(true); setTimelineError('');
    const query = new URLSearchParams({ limit: '20', importantOnly: String(nextImportant) });
    if (nextSource) query.set('source', nextSource); if (cursor) query.set('cursor', cursor);
    try {
      const next = CustomerTimelinePageSchema.parse(await request(`${base}/timeline?${query}`));
      if (!mounted.current || sequence !== timelineSequence.current) return;
      // Keep the previous page/cursor on a partial continuation so retry cannot omit history.
      if (cursor && next.diagnostics.length) { setTimelineError('Some history is unavailable. Retry loading more.'); return; }
      setTimeline(previous => ({ ...next, entries: cursor && previous ? [...new Map([...previous.entries, ...next.entries].map(e => [e.key,e])).values()] : next.entries }));
    } catch (e) { if (mounted.current && sequence === timelineSequence.current) setTimelineError(e instanceof Error ? e.message : 'Could not load the timeline.'); }
    finally { if (mounted.current && sequence === timelineSequence.current) setTimelineBusy(false); }
  }
  function openAction(next: CustomerAction) { trigger.current = document.activeElement as HTMLElement; setAction(next); setTitle(next.kind === 'CONVERT_WORK' ? `${data?.customer.name} — ${data?.customer.workLabel}` : ''); setActionError(''); setNotice(''); }
  function closeAction() { setAction(null); trigger.current?.focus(); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!action || saving) return; setSaving(true); setActionError('');
    try {
      const result = await request(`${base}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: action.kind, title, ...(action.kind === 'CONVERT_WORK' ? { sourceReference: action.reference } : {}) }) });
      if (!mounted.current) return;
      closeAction(); setNotice('Created and linked to this customer.');
      if (result.route) navigate(result.route); else setRefresh(x => x + 1);
    } catch (e) { if (mounted.current) setActionError(e instanceof Error ? e.message : 'The action could not be completed.'); }
    finally { if (mounted.current) setSaving(false); }
  }
  const renderAction = (item: CustomerAction, primary = false) => item.kind === 'LINK' && item.route
    ? <Link className={`c360-button ${primary ? 'c360-primary' : ''}`} to={item.route}>{item.label}<ArrowUpRight size={16} aria-hidden="true" /></Link>
    : <button type="button" className={`c360-button ${primary ? 'c360-primary' : ''}`} onClick={() => openAction(item)}>{item.label}</button>;
  if (!data) return <main className="c360"><Link className="c360-back" to="/app/clients"><ArrowLeft size={16} /> Customers</Link>{error ? <div role="alert"><h1>Customer unavailable</h1><p>{error}</p><button className="c360-button" onClick={() => setRefresh(x => x + 1)}>Try again</button></div> : <div role="status" aria-label="Loading customer" className="c360-loading"><div /><div /><div /><span>Loading the relationship…</span></div>}</main>;
  const customer = data.customer;
  const signals = data.attention.filter(i => i.severity !== 'INFO');
  const now = expanded ? data.now : data.now.slice(0, 5);
  return <main className="c360">
    <Link className="c360-back" to="/app/clients"><ArrowLeft size={16} aria-hidden="true" /> All customers</Link>
    <header className="c360-header"><div className="c360-identity"><span className="c360-avatar" aria-hidden="true">{customer.name.slice(0,1).toUpperCase()}</span><div><p className="c360-eyebrow">{customer.terminology} · Since {day(customer.since)}</p><h1>{customer.name}</h1><p className="c360-contact">{customer.email && <span>{customer.email}</span>}{customer.phone && <span>{customer.phone}</span>}</p></div></div>
      <div className="c360-health">{signals.length ? `${signals.length} ${signals.length === 1 ? 'item needs' : 'items need'} attention` : data.diagnostics.length || data.timeline.diagnostics.length ? 'Some information unavailable' : 'No current attention signals'}</div>
      <div className="c360-actions">{data.actions.slice(0,2).map((item,index) => <span key={item.key}>{renderAction(item,index === 0)}</span>)}{data.actions.length > 2 && <details><summary className="c360-button">More actions</summary><div>{data.actions.slice(2).map(item => <span key={item.key}>{renderAction(item)}</span>)}</div></details>}</div>
    </header>
    {notice && <p role="status" className="c360-notice">{notice}</p>}
    {error && <p role="alert">{error} <button className="c360-button" onClick={() => setRefresh(x => x + 1)}>Retry</button></p>}
    {action && <section className="c360-compose" aria-labelledby="customer-action-heading"><h2 id="customer-action-heading">{action.label}</h2><p>{action.reason}</p><form onSubmit={submit}><label htmlFor="customer-action-title">Title</label><input ref={actionInput} id="customer-action-title" required minLength={2} maxLength={180} value={title} onChange={e => setTitle(e.target.value)} disabled={saving} /><div><button className="c360-button c360-primary" disabled={saving}>{saving ? 'Creating…' : action.label}</button><button className="c360-button" type="button" disabled={saving} onClick={closeAction}>Cancel</button></div>{actionError && <p role="alert">{actionError}</p>}</form></section>}
    {data.diagnostics.length > 0 && <aside className="c360-diagnostic" role="status"><p>Some information is temporarily unavailable: {data.diagnostics.map(d => labels[d.source]).join(', ')}.</p><button className="c360-button" onClick={() => setRefresh(x => x + 1)}>Retry</button><details><summary>Support details</summary><p>Request: {data.diagnostics[0].requestId}</p></details></aside>}
    <section className="c360-section" aria-labelledby="customer-now"><div className="c360-section-title"><div><p className="c360-eyebrow">The living relationship</p><h2 id="customer-now">Now</h2></div><span>What is happening today</span></div>
      {now.length ? <ul className="c360-now">{now.map(item => { const Icon = icons[item.source]; return <li key={item.key}><span className={`c360-now-icon c360-${item.attentionLevel.toLowerCase()}`} aria-hidden="true"><Icon size={21} /></span><div className="c360-now-copy"><p>{item.title}</p>{item.relatedSale && <span>For <Link to={'/app/sales/' + item.relatedSale.reference}>{item.relatedSale.title}</Link> · {item.relatedSale.stage}</span>}<span>{labels[item.source]} · {item.subtitle}{item.amount !== null && item.currency ? ` · ${money(item.amount,item.currency)}` : ''}</span>{(item.dueAt || item.owner) && <span>{item.dueAt ? `Due ${time(item.dueAt)}` : ''}{item.dueAt && item.owner ? ' · ' : ''}{item.owner}</span>}</div>{item.action?.route && <Link className="c360-source-link" to={item.action.route} aria-label={`Open ${item.title}`}><ArrowUpRight size={20} aria-hidden="true" /></Link>}</li>; })}</ul> : <div className="c360-empty"><CircleUserRound size={30} aria-hidden="true" /><h3>{data.diagnostics.length ? 'No active items in the available information.' : 'Nothing is active for this customer yet.'}</h3><p>{data.actions.length ? 'Start with an action above. Everything stays connected here.' : 'Their relationship history will appear here as it develops.'}</p></div>}
      {data.now.length > 5 && <button className="c360-button c360-text" onClick={() => setExpanded(x => !x)}>{expanded ? 'Show less' : `Show ${data.now.length - 5} more active items`}</button>}{data.nowHasMore && <p className="c360-muted">Showing the most relevant active items. Open a source for the full list.</p>}
    </section>
    {signals.length > 0 && <section className="c360-attention" aria-labelledby="customer-attention"><h2 id="customer-attention">Needs attention</h2><ul>{signals.slice(0,expanded ? 100 : 3).map(item => <li key={item.key}><div><span className="c360-eyebrow">{item.severity === 'IMPORTANT' ? 'Important' : 'Follow up'}</span><h3>{item.title}</h3><p>{item.reason}</p></div>{item.action && renderAction(item.action)}</li>)}</ul>{signals.length > 3 && !expanded && <button className="c360-button" onClick={() => setExpanded(true)}>Show all attention items</button>}</section>}
    <details className="c360-summary" open><summary>Relationship at a glance</summary><dl><div><dt>Customer since</dt><dd>{day(customer.since)}</dd></div>{customer.lifecycle && <div><dt>Relationship</dt><dd>{customer.lifecycle.toLowerCase()}</dd></div>}{customer.owner && <div><dt>Responsible team member</dt><dd>{customer.owner}</dd></div>}{data.summary.map(metric => <div key={metric.key}><dt>{metric.label}</dt><dd>{metric.currency ? money(metric.value,metric.currency) : metric.value}</dd></div>)}</dl></details>
    <section className="c360-section" aria-labelledby="customer-history"><div className="c360-section-title"><h2 id="customer-history">The story so far</h2><span>Customer timeline</span></div><div className="c360-filters"><label>Show<select value={source} disabled={timelineBusy} onChange={e => { const next = e.target.value as CustomerSource | ''; setSource(next); setTimeline(null); void loadTimeline(next,important); }}><option value="">All activity</option>{data.sources.map(s => <option key={s} value={s}>{labels[s]}</option>)}</select></label><label className="c360-checkbox"><input type="checkbox" checked={important} disabled={timelineBusy} onChange={e => { setImportant(e.target.checked); setTimeline(null); void loadTimeline(source,e.target.checked); }} /> Important only</label></div>
      {timelineError && <p role="alert">{timelineError} <button className="c360-button" onClick={() => void loadTimeline(source,important,timeline?.nextCursor ?? undefined)}>Retry</button></p>}
      {!!timeline?.diagnostics.length && <p role="status">Some history could not be loaded. <button className="c360-button" onClick={() => void loadTimeline(source,important)}>Retry history</button></p>}
      {timeline && <Timeline entries={timeline.entries} />}{timeline && !timeline.entries.length && !timeline.diagnostics.length && <p className="c360-muted">No activity matches these filters.</p>}
      {timelineBusy && <p role="status">Loading history…</p>}{timeline?.nextCursor && <button className="c360-button" disabled={timelineBusy} onClick={() => void loadTimeline(source,important,timeline.nextCursor!)}>Load earlier activity</button>}
    </section>
  </main>;
}
