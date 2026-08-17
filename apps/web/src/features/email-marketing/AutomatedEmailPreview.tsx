import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type {
  AutomatedEmailPreviewKey,
  AutomatedEmailTemplate,
  EmailDesignSettings,
  EmailPreviewResponse,
} from '@ks-os/contracts';
import { TriangleAlert } from 'lucide-react';
import { getDataProvider } from '../../data/data-provider.js';
import type { EmailPreviewViewport } from './EmailMarketingTabs.js';

export function AutomatedEmailPreview({
  templateKey,
  template,
  design,
  viewport,
}: {
  templateKey: AutomatedEmailPreviewKey;
  template: AutomatedEmailTemplate;
  design: EmailDesignSettings;
  viewport: EmailPreviewViewport;
}) {
  const [preview, setPreview] = useState<EmailPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [frameHeight, setFrameHeight] = useState(860);
  const resizeObserver = useRef<ResizeObserver | null>(null);

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

  useEffect(() => () => {
    resizeObserver.current?.disconnect();
  }, []);

  const fitFrameToEmail = (event: SyntheticEvent<HTMLIFrameElement>) => {
    const frame = event.currentTarget;
    const frameDocument = frame.contentDocument;
    if (!frameDocument) return;

    resizeObserver.current?.disconnect();

    const measure = () => {
      const nextHeight = Math.max(
        frameDocument.documentElement.scrollHeight,
        frameDocument.body?.scrollHeight || 0,
        560,
      );
      setFrameHeight(Math.ceil(nextHeight));
    };

    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(frameDocument.documentElement);
      if (frameDocument.body) observer.observe(frameDocument.body);
      resizeObserver.current = observer;
    }
  };

  return (
    <section aria-label="Email preview" data-testid="preview-stage" className="bg-slate-200">
      <div data-testid="preview-canvas" className="relative bg-slate-200">
        <div
          className={
            'relative mx-auto overflow-hidden bg-white transition-[max-width,border-radius] duration-200 ' +
            (viewport === 'mobile'
              ? 'w-full max-w-[390px] rounded-[28px] border-[6px] border-slate-900 shadow-xl'
              : 'w-full max-w-[680px] shadow-lg')
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
              sandbox="allow-same-origin"
              referrerPolicy="no-referrer"
              srcDoc={preview.html}
              onLoad={fitFrameToEmail}
              style={{ height: frameHeight }}
              className="block min-h-[560px] w-full border-0 bg-white"
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
    </section>
  );
}
