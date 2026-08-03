import React, { useEffect, useMemo, useState } from 'react';
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
  originColumn: number | null;
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
  context: {
    parameterKeys?: string[];
    queryKeys?: string[];
    bodyKeys?: string[];
    supportMode?: boolean;
  };
}

const dateTime = (value: string) => new Date(value).toLocaleString('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const severityClass: Record<ErrorLogRow['severity'], string> = {
  INFO: 'border-sky-800 bg-sky-950/50 text-sky-300',
  WARNING: 'border-amber-800 bg-amber-950/50 text-amber-300',
  ERROR: 'border-rose-800 bg-rose-950/50 text-rose-300',
  CRITICAL: 'border-fuchsia-800 bg-fuchsia-950/50 text-fuchsia-300',
};

const Chip: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black ${className}`}>{children}</span>
);

const Metric: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
    <p className="mt-2 text-2xl font-black text-white">{value}</p>
  </div>
);

const DetailFact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-xl bg-slate-950 p-3">
    <dt className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</dt>
    <dd className="mt-1 break-all text-xs font-semibold text-slate-200">{value || '—'}</dd>
  </div>
);

export const AgencyErrorLogPage: React.FC = () => {
  const [rows, setRows] = useState<ErrorLogRow[]>([]);
  const [selected, setSelected] = useState<ErrorLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setLoading(true);
    setError(null);
    try {
      setRows(await agencyFetch(`/errors?${query}`));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const inspect = async (id: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      setSelected(await agencyFetch(`/errors/${id}`));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const serverFailures = rows.filter(row => row.statusCode >= 500).length;
  const critical = rows.filter(row => row.severity === 'CRITICAL').length;
  const affectedWorkspaces = new Set(rows.map(row => row.tenantId).filter(Boolean)).size;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Recent errors" value={rows.length} />
        <Metric label="Server failures" value={serverFailures} />
        <Metric label="Critical" value={critical} />
        <Metric label="Affected workspaces" value={affectedWorkspaces} />
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-xl font-black text-white">Platform error log</h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
              Technical evidence from API failures. Search by error code, request ID, fingerprint, route, or message. Sensitive values and request-body contents are not stored.
            </p>
          </div>
          <button type="button" onClick={() => void load()} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black text-slate-200 hover:border-violet-500">
            Refresh
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_160px]">
          <label className="text-xs font-bold text-slate-400">
            Search evidence
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Error code, request ID, route, fingerprint…"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none"
            />
          </label>
          <label className="text-xs font-bold text-slate-400">
            Severity
            <select value={severity} onChange={event => setSeverity(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">
              <option value="">All severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="ERROR">Error</option>
              <option value="WARNING">Warning</option>
              <option value="INFO">Info</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-400">
            HTTP status
            <input
              value={statusCode}
              onChange={event => setStatusCode(event.target.value.replace(/\D/g, '').slice(0, 3))}
              placeholder="e.g. 500"
              inputMode="numeric"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder-slate-600"
            />
          </label>
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm font-semibold text-rose-300">{error}</p>}

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        {loading ? (
          <p className="p-6 text-sm text-slate-400">Loading error evidence…</p>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-bold text-slate-300">No errors match these filters</p>
            <p className="mt-1 text-xs text-slate-500">Change the filters or refresh after reproducing the issue.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-xs text-slate-300">
              <thead className="border-b border-slate-800 bg-slate-950/50 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="p-3">When</th>
                  <th>Failure</th>
                  <th>Where</th>
                  <th>Affected user</th>
                  <th>Workspace</th>
                  <th>Request</th>
                  <th className="p-3 text-right">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-800/80 align-top hover:bg-slate-950/50">
                    <td className="whitespace-nowrap p-3 text-slate-400">{dateTime(row.occurredAt)}</td>
                    <td className="max-w-[280px] py-3 pr-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip className={severityClass[row.severity]}>{row.severity}</Chip>
                        <Chip className="border-slate-700 bg-slate-950 text-slate-300">HTTP {row.statusCode}</Chip>
                        {row.retryable && <Chip className="border-emerald-800 bg-emerald-950/50 text-emerald-300">RETRYABLE</Chip>}
                      </div>
                      <strong className="mt-2 block text-slate-100">{row.errorCode}</strong>
                      <p className="mt-1 line-clamp-2 text-slate-400">{row.message}</p>
                    </td>
                    <td className="max-w-[270px] py-3 pr-4">
                      <code className="block break-all text-violet-300">{row.method} {row.route}</code>
                      <p className="mt-1 break-all text-slate-500">
                        {row.originFile ? `${row.originFile}:${row.originLine || '?'}` : row.sourceComponent}
                      </p>
                    </td>
                    <td className="py-3 pr-4">
                      <strong className="block text-slate-200">{row.affectedUser.displayName}</strong>
                      <span className="text-slate-500">{row.affectedUser.type}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-slate-200">{row.tenantName || 'Platform-wide'}</span>
                    </td>
                    <td className="max-w-[180px] py-3 pr-4">
                      <code className="break-all text-slate-400">{row.requestId}</code>
                    </td>
                    <td className="p-3 text-right">
                      <button type="button" disabled={detailLoading} onClick={() => void inspect(row.id)} className="rounded-lg bg-violet-600 px-3 py-2 text-[10px] font-black text-white hover:bg-violet-500 disabled:opacity-50">
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Error evidence">
          <section className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip className={severityClass[selected.severity]}>{selected.severity}</Chip>
                  <Chip className="border-slate-700 bg-slate-950 text-slate-300">HTTP {selected.statusCode}</Chip>
                </div>
                <h2 className="mt-3 text-xl font-black text-white">{selected.errorCode}</h2>
                <p className="mt-1 text-sm text-slate-300">{selected.message}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-black text-slate-300 hover:text-white">Close</button>
            </div>

            <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DetailFact label="Affected user" value={`${selected.affectedUser.displayName} · ${selected.affectedUser.type}`} />
              <DetailFact label="Workspace" value={selected.tenantName || 'Platform-wide'} />
              <DetailFact label="Request ID" value={selected.requestId} />
              <DetailFact label="Correlation ID" value={selected.correlationId} />
              <DetailFact label="Route" value={`${selected.method} ${selected.route}`} />
              <DetailFact label="Source location" value={selected.originFile ? `${selected.originFile}:${selected.originLine || '?'}:${selected.originColumn || '?'}` : selected.sourceComponent} />
              <DetailFact label="Function" value={selected.originFunction} />
              <DetailFact label="Fingerprint" value={selected.fingerprint} />
              <DetailFact label="Application context" value={selected.applicationContext} />
              <DetailFact label="Support session" value={selected.supportSessionId} />
              <DetailFact label="Session" value={selected.sessionId} />
              <DetailFact label="Occurred" value={dateTime(selected.occurredAt)} />
            </dl>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">Safe request shape</h3>
                <p className="mt-1 text-[11px] text-slate-600">Only field names are retained. Values are never stored here.</p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs text-emerald-300">{JSON.stringify(selected.context || {}, null, 2)}</pre>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">Sanitised stack</h3>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">{selected.stack || 'No stack was available for this error.'}</pre>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default AgencyErrorLogPage;
