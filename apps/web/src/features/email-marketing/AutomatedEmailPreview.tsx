import { useEffect, useState } from 'react';
import type {
  AutomatedEmailPreviewKey,
  AutomatedEmailTemplate,
  EmailDesignSettings,
  EmailPreviewResponse,
} from '@ks-os/contracts';
import { Monitor, Smartphone } from 'lucide-react';
import { getDataProvider } from '../../data/data-provider.js';

export function AutomatedEmailPreview({
  templateKey,
  template,
  design,
}: {
  templateKey: AutomatedEmailPreviewKey;
  template: AutomatedEmailTemplate;
  design: EmailDesignSettings;
}) {
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [preview, setPreview] = useState<EmailPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      getDataProvider().renderAutomatedEmailPreview({ templateKey, template, design })
        .then(value => { if (active) setPreview(value); })
        .catch(cause => {
          if (active) setError(cause instanceof Error ? cause.message : 'The email preview could not be rendered.');
        })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [design, template, templateKey]);

  return (
    <aside aria-label="Email preview" className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 p-3 shadow-inner sm:p-5">
      <div className="mb-3 flex flex-col gap-3 rounded-2xl bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-xs text-slate-500">
          <span className="font-black text-slate-700">Subject:</span>{' '}
          <span className="break-words">{preview?.subject || template.subject}</span>
        </div>
        <div role="group" aria-label="Preview size" className="inline-flex self-start rounded-xl border border-slate-200 bg-slate-50 p-1">
          <button type="button" aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')} className={viewport === 'desktop' ? 'inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-black text-violet-700 shadow-sm' : 'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-slate-600'}>
            <Monitor className="h-3.5 w-3.5" />Desktop
          </button>
          <button type="button" aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')} className={viewport === 'mobile' ? 'inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-black text-violet-700 shadow-sm' : 'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-slate-600'}>
            <Smartphone className="h-3.5 w-3.5" />Mobile
          </button>
        </div>
      </div>
      {error ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">{error}</div> : null}
      <div className={viewport === 'mobile' ? 'relative mx-auto w-full max-w-[390px] overflow-hidden rounded-[28px] border-[6px] border-slate-900 bg-white shadow-2xl' : 'relative mx-auto w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl'}>
        {loading ? <div role="status" className="absolute inset-x-0 top-0 z-10 bg-slate-950/85 px-4 py-2 text-center text-xs font-bold text-white">Rendering the real email…</div> : null}
        {preview ? (
          <iframe
            title="Rendered transactional email"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={preview.html}
            className="block h-[760px] w-full border-0 bg-white"
          />
        ) : !error ? <div className="h-96 animate-pulse bg-white" /> : null}
      </div>
      <p className="mt-3 text-center text-[11px] font-bold text-slate-500">Rendered by the same React Email templates used for production delivery.</p>
    </aside>
  );
}
