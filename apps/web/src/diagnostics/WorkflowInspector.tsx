import { useEffect, useRef, useState } from 'react';
import { agencyFetch } from '../features/agency/AgencyAuth';
interface JobDiagnosis {
  reference: string;
  diagnosis: { checkedAt: string; actualState: string; expected: string; reason: string; nextStep: string; allowedTransitions: string[]; overdue: boolean | null; leaseExpired: boolean | null; heartbeatAt?: string | null; evidenceLimit?: string };
  events: Array<{ eventType: string; statusFrom: string | null; statusTo: string | null; occurredAt: string; attemptNumber: number | null }>;
}
export function WorkflowInspector() {
  const [reference, setReference] = useState('');
  const [result, setResult] = useState<JobDiagnosis | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const inspect = async () => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError(''); setResult(null);
    try {
      const data = await agencyFetch('/site-jobs/' + encodeURIComponent(reference.trim()) + '/diagnostics', { signal: abort.signal });
      if (!abort.signal.aborted) setResult(data);
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Workflow state could not be loaded.');
    } finally { if (!abort.signal.aborted) setLoading(false); }
  };
  return <details className="my-4 rounded-xl border border-slate-700 p-4 text-slate-200">
    <summary className="cursor-pointer font-bold">Inspect a website job's expected flow</summary>
    <form className="mt-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void inspect(); }}>
      <label htmlFor="diagnostic-job-reference">Job reference</label>
      <input id="diagnostic-job-reference" required value={reference} disabled={loading} onChange={event => { setReference(event.target.value); setResult(null); }}
        pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
        className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-3 py-2" />
      <button type="submit" disabled={loading} className="rounded bg-indigo-600 px-3 py-2 text-white">{loading ? 'Checking…' : 'Explain state'}</button>
    </form>
    {error && <p role="alert" className="mt-3 text-rose-300">{error}</p>}
    {result && <dl className="mt-3 space-y-2">
      <div><dt className="font-bold">Current state</dt><dd>{result.diagnosis.actualState}</dd></div>
      <div><dt className="font-bold">Expected</dt><dd>{result.diagnosis.expected}</dd></div>
      <div><dt className="font-bold">Reason</dt><dd>{result.diagnosis.reason}</dd></div>
      <div><dt className="font-bold">Next step</dt><dd>{result.diagnosis.nextStep}</dd></div>
      <div><dt className="font-bold">Allowed transitions</dt><dd>{result.diagnosis.allowedTransitions.join(', ') || 'None'}</dd></div>
      <div><dt className="font-bold">Lease</dt><dd>{result.diagnosis.leaseExpired === true ? 'Expired. Inspect worker recovery.' : result.diagnosis.leaseExpired === false ? 'Not expired at the time of this check.' : 'No active lease evidence.'}</dd></div>
      <div><dt className="font-bold">Last heartbeat</dt><dd>{result.diagnosis.heartbeatAt ? new Date(result.diagnosis.heartbeatAt).toLocaleString() : 'Not recorded'}</dd></div>
      <div><dt className="font-bold">Eligibility delay</dt><dd>{result.diagnosis.overdue === true ? 'Eligible for more than a minute; check worker availability.' : result.diagnosis.overdue === false ? 'Not overdue.' : 'Not determined for this state.'}</dd></div>
      <div><dt className="font-bold">Checked</dt><dd>{new Date(result.diagnosis.checkedAt).toLocaleString()}</dd></div>
      <div><dt className="font-bold">Evidence limits</dt><dd>{result.diagnosis.evidenceLimit}</dd></div>
      <div><dt className="font-bold">Recent events (newest first)</dt><dd><ol>{result.events.map((event, index) => <li key={index}>{new Date(event.occurredAt).toLocaleString()} · {event.eventType} · {event.statusFrom || '—'} → {event.statusTo || '—'}</li>)}</ol></dd></div>
    </dl>}
  </details>;
}
