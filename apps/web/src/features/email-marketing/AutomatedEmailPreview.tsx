import { useEffect, useState } from 'react';
import type {
  AutomatedEmailPreviewKey,
  AutomatedEmailTemplate,
  EmailDesignSettings,
  EmailPreviewResponse,
} from '@ks-os/contracts';
import { Monitor, Smartphone, TriangleAlert } from 'lucide-react';
import { getDataProvider } from '../../data/data-provider.js';

export function AutomatedEmailPreview({
  emailName,
  templateKey,
  template,
  design,
}: {
  emailName: string;
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
        .then(value => {
          if (active) {
            setPreview(value);
            setError(null);
          }
        })
        .catch(() => {
          if (active) setError("Preview couldn't update. Try again.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [design, template, templateKey]);

  return (
    <section
      aria-label="Email preview"
      data-testid="preview-stage"
      className="flex min-h-[680px] flex-col overflow-hidden border border-slate-200 bg-slate-200 lg:h-[calc(100vh-11.5rem)] lg:min-h-[620px]"
    >
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-black text-slate-950">{emailName}</h2>
          <p className="truncate text-xs text-slate-500">
            <span className="font-bold">Subject:</span> {preview?.subject || template.subject}
          </p>
        </div>
        <div role="group" aria-label="Preview size" className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            aria-pressed={viewport === 'desktop'}
            onClick={() => setViewport('desktop')}
            className={
              'inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ' +
              (viewport === 'desktop'
                ? 'bg-white font-black text-violet-700 shadow-sm'
                : 'font-bold text-slate-600 hover:text-slate-950')
            }
          >
            <Monitor className="h-3.5 w-3.5" />
            Desktop
          </button>
          <button
            type="button"
            aria-pressed={viewport === 'mobile'}
            onClick={() => setViewport('mobile')}
            className={
              'inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ' +
              (viewport === 'mobile'
                ? 'bg-white font-black text-violet-700 shadow-sm'
                : 'font-bold text-slate-600 hover:text-slate-950')
            }
          >
            <Smartphone className="h-3.5 w-3.5" />
            Mobile
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto bg-slate-200 p-3 sm:p-6">
        <div
          className={
            'relative mx-auto overflow-hidden bg-white transition-[max-width,border-radius] duration-200 ' +
            (viewport === 'mobile'
              ? 'w-full max-w-[390px] rounded-[28px] border-[6px] border-slate-900 shadow-xl'
              : 'w-full max-w-[680px] border border-slate-300 shadow-lg')
          }
        >
          {loading && preview ? (
            <div
              role="status"
              aria-live="polite"
              className="absolute right-3 top-3 z-20 rounded-full bg-slate-950/90 px-3 py-1.5 text-[11px] font-bold text-white shadow"
            >
              Updating preview…
            </div>
          ) : null}

          {error && preview ? (
            <div role="alert" className="absolute inset-x-3 top-3 z-20 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 shadow">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}

          {preview ? (
            <iframe
              title="Rendered transactional email"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={preview.html}
              className="block h-[860px] w-full border-0 bg-white"
            />
          ) : error ? (
            <div role="alert" className="flex h-[560px] items-center justify-center p-6 text-center text-sm font-bold text-rose-800">
              <span className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">{error}</span>
            </div>
          ) : (
            <div className="h-[560px] animate-pulse bg-white">
              <div className="mx-auto mt-12 h-4 w-40 rounded bg-slate-200" />
              <div className="mx-auto mt-8 h-56 w-4/5 rounded bg-slate-100" />
            </div>
          )}
        </div>
      </div>

      <p className="border-t border-slate-200 bg-white px-4 py-2 text-center text-[10px] font-bold text-slate-500">
        Production React Email render · Fictional preview data
      </p>
    </section>
  );
}
