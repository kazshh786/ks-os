import { diagnoseResource } from '@ks-os/contracts';
export function ReaderDiagnostics(props: {
  enabled: boolean | null; loading: boolean; error: string; checkedAt: string | null; total: number; usable: number;
  onRefresh?: () => void;
}) {
  const diagnosis = diagnoseResource({ ...props, error: Boolean(props.error) });
  return <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
    <summary className="cursor-pointer font-bold">Why is the reader option available or unavailable?</summary>
    <dl className="mt-3 grid gap-2">
      <div><dt className="font-bold">Expected</dt><dd>Connected, supported readers appear as payment options.</dd></div>
      <div><dt className="font-bold">Current state</dt><dd>{diagnosis.actual}</dd></div>
      <div><dt className="font-bold">Reason</dt><dd>{diagnosis.reason}</dd></div>
      <div><dt className="font-bold">Next step</dt><dd>{diagnosis.nextStep}</dd></div>
      {props.checkedAt && <div><dt className="font-bold">Last successful check</dt><dd>{new Date(props.checkedAt).toLocaleString()}</dd></div>}
    </dl>
    {props.error && <p role="alert" className="mt-3 text-rose-700">{props.error}</p>}
    {props.onRefresh && <button type="button" disabled={props.loading || props.enabled !== true} onClick={props.onRefresh}
      className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold disabled:opacity-50">Refresh reader availability</button>}
  </details>;
}
