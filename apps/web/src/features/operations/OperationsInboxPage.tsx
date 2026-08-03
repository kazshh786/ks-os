import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { OperationsIssue } from '@ks-os/contracts';
import { ConversationsInboxPage } from '../conversations/ConversationsInboxPage.js';
import { listOperationsIssues } from './operations.api.js';

const severityClass = {
  CRITICAL: 'bg-red-100 text-red-800',
  WARNING: 'bg-amber-100 text-amber-800',
  INFO: 'bg-blue-100 text-blue-800',
} as const;

function SystemIssuesInbox() {
  const [issues, setIssues] = useState<OperationsIssue[]>([]);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    listOperationsIssues({ status: status as any, category: category as any, severity: severity as any, cursor, limit: 30 })
      .then(result => { if (active) { setIssues(result.data); setNextCursor(result.nextCursor); } })
      .catch(cause => { if (active) setError(cause.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [status, category, severity, cursor]);

  const resetFilters = () => { setStatus(''); setCategory(''); setSeverity(''); setCursor(undefined); };

  return <main className="space-y-5">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="text-xs font-black uppercase tracking-wider text-indigo-600">Inbox monitoring</p><h1 className="mt-1 text-2xl font-black text-slate-900">System issues</h1><p className="text-sm text-slate-500">Delivery, automation, payment, compliance and platform issues that need attention.</p></div>
      <Link to="/app/operations" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-xs font-black text-white">Customer inbox</Link>
    </header>
    <section aria-label="Issue filters" className="flex flex-wrap gap-2 rounded-xl border bg-white p-3">
      <select aria-label="Status" value={status} onChange={event => { setStatus(event.target.value); setCursor(undefined); }} className="rounded-lg border px-3 py-2 text-sm"><option value="">All statuses</option>{['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'].map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="Category" value={category} onChange={event => { setCategory(event.target.value); setCursor(undefined); }} className="rounded-lg border px-3 py-2 text-sm"><option value="">All categories</option>{['EMAIL', 'SMS', 'AUTOMATION', 'PAYMENT', 'REFUND', 'STRIPE', 'PAYOUT', 'DISPUTE', 'FORM', 'APPOINTMENT', 'TEAM', 'SYSTEM'].map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="Severity" value={severity} onChange={event => { setSeverity(event.target.value); setCursor(undefined); }} className="rounded-lg border px-3 py-2 text-sm"><option value="">All severities</option>{['CRITICAL', 'WARNING', 'INFO'].map(value => <option key={value}>{value}</option>)}</select>
      <button type="button" onClick={resetFilters} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">Clear</button>
    </section>
    {loading ? <p className="rounded-xl border bg-white p-8 text-center text-slate-500">Loading operational issues…</p>
      : error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>
        : issues.length === 0 ? <p className="rounded-xl border border-dashed bg-white p-10 text-center text-slate-500">No issues match these filters.</p>
          : <ul className="space-y-2">{issues.map(issue => <li key={issue.id}><Link to={`/app/operations/${issue.id}`} className="block rounded-xl border bg-white p-4 transition hover:border-slate-400"><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${severityClass[issue.severity]}`}>{issue.severity}</span><span className="text-xs font-bold text-slate-500">{issue.category}</span>{issue.occurrenceCount > 1 && <span className="text-xs text-slate-500">Occurred {issue.occurrenceCount} times</span>}</div><h2 className="mt-2 font-extrabold text-slate-900">{issue.title}</h2><p className="mt-1 text-sm text-slate-600">{issue.message}</p></div><div className="shrink-0 text-right"><span className="text-xs font-bold text-slate-600">{issue.status}</span><time className="mt-1 block text-xs text-slate-400" dateTime={issue.lastOccurredAt}>{new Date(issue.lastOccurredAt).toLocaleString()}</time></div></div></Link></li>)}</ul>}
    {nextCursor && <button type="button" onClick={() => setCursor(nextCursor)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">Next page</button>}
  </main>;
}

export function OperationsInboxPage() {
  const [params] = useSearchParams();
  return params.get('view') === 'system' ? <SystemIssuesInbox /> : <ConversationsInboxPage />;
}
