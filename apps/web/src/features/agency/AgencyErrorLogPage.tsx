import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, Info, RefreshCw, Search, Wrench } from 'lucide-react';
import { agencyFetch } from './AgencyAuth';

interface ErrorLogRow {
  id: string;
  fingerprint: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  statusCode: number;
  errorCode: string;
  errorType: string;
  message: string;
  originFile: string | null;
  originFunction: string | null;
  originLine: number | null;
  requestId: string;
  correlationId: string | null;
  method: string;
  route: string;
  sourceComponent: string;
  environment: string;
  tenantId: string | null;
  tenantName: string | null;
  affectedUser: { type: string; displayName: string };
  retryable: boolean;
  occurredAt: string;
}

interface ErrorLogDetail extends ErrorLogRow {
  stack: string | null;
  applicationContext: string | null;
  supportSessionId: string | null;
  sessionId: string | null;
  context: { parameterKeys?: string[]; queryKeys?: string[]; bodyKeys?: string[]; supportMode?: boolean };
}

type IssueExplanation = {
  title: string;
  summary: string;
  nextStep: string;
  kind: 'prerequisite' | 'problem' | 'information';
};

export function explainAgencyIssue(issue: Pick<ErrorLogRow, 'errorCode' | 'message' | 'statusCode' | 'retryable'>): IssueExplanation {
  if (issue.errorCode === 'SEARCH_INTELLIGENCE_BLUEPRINT_NOT_APPROVED') return {
    title: 'Approve the website structure first',
    summary: 'Search planning is tied to the exact website pages that have been reviewed and approved.',
    nextStep: 'Review and approve the current website structure, then return to Search.',
    kind: 'prerequisite',
  };
  if (issue.errorCode === 'PUBLISHED_SNAPSHOT_REQUIRED') return {
    title: 'Available after the website goes live',
    summary: 'Website change monitoring compares business changes with the published website. There is nothing to compare before the first publication.',
    nextStep: 'No action is needed here until the website has been published.',
    kind: 'prerequisite',
  };
  if (issue.errorCode === 'SEARCH_INTELLIGENCE_RESEARCH_REQUIRED') return {
    title: 'Add search research before approval',
    summary: 'The current search plan only has planning context and does not yet have the required governed research evidence.',
    nextStep: 'Open Website → Search and import the governed research bundle before approving the strategy.',
    kind: 'prerequisite',
  };
  if (issue.statusCode === 409) return {
    title: 'A required step has not been completed yet',
    summary: issue.message,
    nextStep: 'Review the current workflow step and complete the stated prerequisite before trying again.',
    kind: 'prerequisite',
  };
  if (issue.statusCode >= 500) return {
    title: 'KS OS could not complete this action',
    summary: issue.retryable ? 'The action failed unexpectedly, but it may succeed when retried.' : 'The action failed unexpectedly and needs investigation.',
    nextStep: issue.retryable ? 'Retry the action once. If it fails again, use the technical details below for support.' : 'Review the technical details below and investigate the affected service before retrying.',
    kind: 'problem',
  };
  return {
    title: issue.message || 'System information recorded',
    summary: 'KS OS recorded this event for operational visibility.',
    nextStep: issue.retryable ? 'Retry the affected action if it is still needed.' : 'No action is required unless the issue affects current work.',
    kind: issue.statusCode >= 400 ? 'problem' : 'information',
  };
}

const dateTime = (value: string) => new Date(value).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

const severityTone: Record<ErrorLogRow['severity'], string> = {
  INFO: 'border-sky-700/60 bg-sky-950/25 text-sky-200',
  WARNING: 'border-amber-700/60 bg-amber-950/25 text-amber-100',
  ERROR: 'border-rose-700/60 bg-rose-950/25 text-rose-200',
  CRITICAL: 'border-fuchsia-700/60 bg-fuchsia-950/25 text-fuchsia-200',
};

function IssueIcon({ kind }: { kind: IssueExplanation['kind'] }) {
  if (kind === 'prerequisite') return <AlertTriangle className="h-5 w-5 text-amber-300" />;
  if (kind === 'problem') return <CircleAlert className="h-5 w-5 text-rose-300" />;
  return <Info className="h-5 w-5 text-sky-300" />;
}

function Metric({ label, value, help }: { label: string; value: React.ReactNode; help: string }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-white">{value}</p><p className="mt-1 text-xs text-slate-600">{help}</p></div>;
}

export const AgencyErrorLogPage: React.FC = () => {
  const [rows, setRows] = useState<ErrorLogRow[]>([]);
  const [selected, setSelected] = useState<ErrorLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [statusCode, setStatusCode] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (search.trim()) params.set('search', search.trim());
    if (severity) params.set('severity', severity);
    if (statusCode) params.set('statusCode', statusCode);
    return params.toString();
  }, [search, severity, statusCode]);

  const load = async () => {
    setLoading(true); setError('');
    try { setRows(await agencyFetch(`/errors?${query}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'System issues could not be loaded.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const inspect = async (id: string) => {
    setDetailLoading(true); setError('');
    try { setSelected(await agencyFetch(`/errors/${id}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The issue details could not be loaded.'); }
    finally { setDetailLoading(false); }
  };

  const problems = rows.filter(row => row.statusCode >= 500 || row.severity === 'CRITICAL').length;
  const prerequisites = rows.filter(row => row.statusCode === 409).length;
  const workspaces = new Set(rows.map(row => row.tenantId).filter(Boolean)).size;

  return <div className="space-y-6">
    <header className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Platform</p>
      <h1 className="mt-2 text-3xl font-black text-white">System issues</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Start with what happened and what to do next. HTTP codes, request IDs, routes and stacks are available only when you need technical evidence.</p>
    </header>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Recorded" value={rows.length} help="Issues matching the current filters" />
      <Metric label="Problems" value={problems} help="Unexpected server or critical failures" />
      <Metric label="Prerequisites" value={prerequisites} help="Actions attempted before a required step" />
      <Metric label="Workspaces" value={workspaces} help="Client workspaces affected" />
    </div>

    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px_160px]">
          <label className="text-xs font-bold text-slate-400">Find an issue<div className="relative mt-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-600" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Message, code, request or route" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-3 text-sm text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none" /></div></label>
          <label className="text-xs font-bold text-slate-400">Severity<select value={severity} onChange={event => setSeverity(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="">All</option><option value="CRITICAL">Critical</option><option value="ERROR">Error</option><option value="WARNING">Warning</option><option value="INFO">Information</option></select></label>
          <label className="text-xs font-bold text-slate-400">HTTP status<input value={statusCode} onChange={event => setStatusCode(event.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="e.g. 500" inputMode="numeric" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder-slate-600" /></label>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-200 hover:border-violet-500"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>
    </section>

    {error ? <div role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/30 p-4 text-sm text-rose-200"><p className="font-black">System issues could not be refreshed</p><p className="mt-1 text-rose-200/75">{error}</p></div> : null}

    <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
      {loading ? <p className="p-6 text-sm text-slate-400">Loading system issues…</p> : rows.length === 0 ? <div className="p-10 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-emerald-300" /><p className="mt-3 font-black text-slate-200">No issues match these filters</p><p className="mt-1 text-xs text-slate-500">Change the filters or refresh after reproducing a problem.</p></div> : <div className="divide-y divide-slate-800">{rows.map(row => {
        const explanation = explainAgencyIssue(row);
        return <article key={row.id} className="p-5 transition hover:bg-slate-950/40">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3"><div className="mt-1"><IssueIcon kind={explanation.kind} /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${severityTone[row.severity]}`}>{explanation.kind === 'prerequisite' ? 'Prerequisite' : row.severity}</span><span className="text-xs text-slate-600">{dateTime(row.occurredAt)}</span>{row.tenantName ? <span className="text-xs font-bold text-slate-500">{row.tenantName}</span> : null}</div><h2 className="mt-2 text-base font-black text-white">{explanation.title}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{explanation.summary}</p><p className="mt-2 text-xs font-bold text-slate-300"><span className="text-violet-300">Next:</span> {explanation.nextStep}</p></div></div>
            <button type="button" disabled={detailLoading} onClick={() => void inspect(row.id)} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 text-xs font-black text-slate-200 hover:border-violet-500 disabled:opacity-40"><Wrench className="h-4 w-4" />View details</button>
          </div>
        </article>;
      })}</div>}
    </section>

    {selected ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="System issue details"><section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">{(() => {
      const explanation = explainAgencyIssue(selected);
      return <><div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><IssueIcon kind={explanation.kind} /><div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">What happened</p><h2 className="mt-2 text-2xl font-black text-white">{explanation.title}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{explanation.summary}</p></div></div><button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-black text-slate-300 hover:text-white">Close</button></div><div className="mt-5 rounded-2xl border border-violet-800/50 bg-violet-950/20 p-4"><p className="text-xs font-black uppercase tracking-wide text-violet-300">What to do next</p><p className="mt-2 text-sm text-slate-200">{explanation.nextStep}</p></div><details className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/70 p-4"><summary className="cursor-pointer text-sm font-black text-slate-300">Technical details</summary><p className="mt-3 text-[11px] text-slate-500">Only field names are retained. Values are never stored here.</p><dl className="mt-4 grid gap-3 sm:grid-cols-2"><Detail label="Error code" value={selected.errorCode} /><Detail label="HTTP status" value={selected.statusCode} /><Detail label="Request ID" value={selected.requestId} /><Detail label="Correlation ID" value={selected.correlationId} /><Detail label="Route" value={`${selected.method} ${selected.route}`} /><Detail label="Affected user" value={`${selected.affectedUser.displayName} · ${selected.affectedUser.type}`} /><Detail label="Workspace" value={selected.tenantName || 'Platform-wide'} /><Detail label="Source" value={selected.originFile ? `${selected.originFile}:${selected.originLine || '?'}` : selected.sourceComponent} /><Detail label="Fingerprint" value={selected.fingerprint} /><Detail label="Session" value={selected.sessionId} /></dl>{selected.stack ? <div className="mt-4"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Sanitised stack</p><pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-3 text-[11px] leading-5 text-slate-500">{selected.stack}</pre></div> : null}</details></>;
    })()}</section></div> : null}
  </div>;
};

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl bg-slate-900 p-3"><dt className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</dt><dd className="mt-1 break-all text-xs font-semibold text-slate-200">{value || '—'}</dd></div>;
}
