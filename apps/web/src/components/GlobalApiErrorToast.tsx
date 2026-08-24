import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { ApiErrorNotice } from '../api/client.js';

const visibleForMs = 12_000;

export function GlobalApiErrorToast() {
  const [notice, setNotice] = useState<ApiErrorNotice | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const onApiError = (event: Event) => {
      const next = (event as CustomEvent<ApiErrorNotice>).detail;
      if (!next?.code || !next?.message) return;
      setNotice(next);
      clearTimer();
      timer.current = window.setTimeout(() => setNotice(null), visibleForMs);
    };
    window.addEventListener('ks-api-error', onApiError);
    return () => {
      window.removeEventListener('ks-api-error', onApiError);
      clearTimer();
    };
  }, []);

  if (!notice) return null;

  return <aside role="alert" aria-live="assertive" className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-[250] w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-rose-300 bg-white p-4 shadow-2xl">
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700"><AlertTriangle className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-slate-950">Action could not be completed</p>
        <p className="mt-1 text-sm leading-5 text-slate-700">{notice.message}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-rose-800">Error code: {notice.code}</span>
          {notice.requestId && <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-700">Reference: {notice.requestId}</span>}
        </div>
      </div>
      <button type="button" aria-label="Dismiss error" onClick={() => setNotice(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
    </div>
  </aside>;
}
