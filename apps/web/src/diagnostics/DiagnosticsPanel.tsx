import { useState, useSyncExternalStore } from 'react';
import { clearDiagnostics, exportDiagnostics, getDiagnostics, subscribeDiagnostics } from './store';
export function DiagnosticsPanel() {
  const events = useSyncExternalStore(subscribeDiagnostics, getDiagnostics, getDiagnostics);
  const [copyState, setCopyState] = useState('');
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(exportDiagnostics()); setCopyState('Diagnostic report copied.');
    } catch { setCopyState('Copy is unavailable. Select and copy the report text below.'); }
  };
  return <details className="fixed bottom-24 right-3 z-[90] max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-300 bg-white p-3 text-slate-900 shadow-lg lg:bottom-3">
    <summary className="cursor-pointer text-xs font-bold">Diagnose this screen</summary>
    <div className="mt-3 max-h-[65vh] w-[min(32rem,85vw)] overflow-auto text-sm">
      <p>This tab keeps the latest 100 request and browser events. Use request references to find matching API evidence in Operations.</p>
      <p className="mt-2">Reports contain timing, status and references. They exclude form values, page addresses, credentials and customer details. Browser events stay in this tab unless you copy the report.</p>
      <div className="my-3 flex gap-3">
        <button type="button" onClick={() => void copy()} className="rounded-lg bg-indigo-600 px-3 py-2 font-bold text-white">Copy diagnostic report</button>
        <button type="button" onClick={clearDiagnostics} className="rounded-lg border px-3 py-2">Clear history</button>
      </div>
      <p role="status">{copyState}</p>
      <ol className="space-y-2">{[...events].reverse().map(event => <li key={event.id} className="rounded-lg border p-2">
        <p className="font-bold">{event.kind} · {event.operation} · {event.outcome}{event.status ? ' · HTTP ' + event.status : ''}</p>
        <p>{new Date(event.at).toLocaleTimeString()}{event.durationMs !== undefined ? ' · ' + event.durationMs + ' ms' : ''}</p>
        <p className="break-all">Reference: {event.requestId || event.correlationId || event.id}</p>
        {event.failureClass && <p>Failure category: {event.failureClass}</p>}
        {event.sourceFrames?.length ? <pre className="whitespace-pre-wrap break-all text-xs">{event.sourceFrames.join('\n')}</pre> : null}
      </li>)}</ol>
      {!events.length && <p>No diagnostic events have been recorded in this tab.</p>}
      <details className="mt-3"><summary>Report text</summary><pre className="whitespace-pre-wrap break-all text-xs">{exportDiagnostics()}</pre></details>
    </div>
  </details>;
}
