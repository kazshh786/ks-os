import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { agencyFetch } from './AgencyAuth';

const status = (value: string) => String(value || 'NOT_STARTED').replaceAll('_', ' ');

interface GenerationRunSummary {
  reference: string;
  versionReference: string | null;
  status: string;
  pageCountPlanned: number | null;
  pageCountCompleted: number | null;
  sectionCountPlanned: number | null;
  sectionCountCompleted: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

const ACTIVE_BUILD_STATUSES = new Set([
  'PENDING',
  'PREPARING_CONTEXT',
  'GENERATING',
  'REPAIRING',
  'VALIDATING',
  'CANCEL_REQUESTED',
]);
const COMPLETE_BUILD_STATUSES = new Set(['DESIGN_COMPLETE', 'READY_FOR_REVIEW']);
const BUILD_STAGES = ['Queued', 'Preparing', 'Generating', 'Validating', 'Complete'] as const;

function ratio(completed: number | null, planned: number | null) {
  const total = Number(planned ?? 0);
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, Number(completed ?? 0) / total));
}

function generationProgress(run: GenerationRunSummary) {
  const pages = ratio(run.pageCountCompleted, run.pageCountPlanned);
  const sections = ratio(run.sectionCountCompleted, run.sectionCountPlanned);
  const hasSections = Number(run.sectionCountPlanned ?? 0) > 0;
  const contentProgress = 20 + (pages * 35) + (hasSections ? sections * 35 : pages * 20);

  switch (run.status) {
    case 'PENDING': return 5;
    case 'PREPARING_CONTEXT': return 15;
    case 'GENERATING': return Math.min(82, Math.round(contentProgress));
    case 'REPAIRING': return Math.max(78, Math.min(88, Math.round(contentProgress)));
    case 'VALIDATING': return 92;
    case 'DESIGN_COMPLETE':
    case 'READY_FOR_REVIEW': return 100;
    case 'FAILED': return Math.max(8, Math.min(95, Math.round(contentProgress)));
    case 'CANCEL_REQUESTED': return Math.max(8, Math.min(95, Math.round(contentProgress)));
    case 'CANCELLED': return Math.max(8, Math.min(95, Math.round(contentProgress)));
    default: return Math.max(5, Math.min(95, Math.round(contentProgress)));
  }
}

function generationStageIndex(run: GenerationRunSummary) {
  switch (run.status) {
    case 'PENDING': return 0;
    case 'PREPARING_CONTEXT': return 1;
    case 'GENERATING':
    case 'REPAIRING': return 2;
    case 'VALIDATING': return 3;
    case 'DESIGN_COMPLETE':
    case 'READY_FOR_REVIEW': return 4;
    default: {
      if (Number(run.sectionCountCompleted ?? 0) > 0 || Number(run.pageCountCompleted ?? 0) > 0) return 2;
      return 0;
    }
  }
}

function generationMessage(run: GenerationRunSummary) {
  switch (run.status) {
    case 'PENDING': return 'Queued for the website generation worker.';
    case 'PREPARING_CONTEXT': return 'Loading the approved blueprint, Search Intelligence and verified business facts.';
    case 'GENERATING': return 'Generating governed pages, sections and website content.';
    case 'REPAIRING': return 'Repairing generated content that did not pass validation.';
    case 'VALIDATING': return 'Validating structure, metadata, links and renderability.';
    case 'DESIGN_COMPLETE': return 'The website build is complete and ready to preview.';
    case 'READY_FOR_REVIEW': return 'The website build is complete and ready for review.';
    case 'FAILED': return run.failureMessage || 'The website build stopped before completion.';
    case 'CANCEL_REQUESTED': return 'Cancellation has been requested. The worker is stopping safely.';
    case 'CANCELLED': return 'The website build was cancelled.';
    default: return `Website generation status: ${status(run.status)}.`;
  }
}

export function SitePublishingPanel(props: {
  siteReference: string;
  publication: any;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [latestGeneration, setLatestGeneration] = useState<GenerationRunSummary | null>(null);
  const [showBuildMonitor, setShowBuildMonitor] = useState(false);

  const refreshGeneration = useCallback(async () => {
    try {
      const generations = await agencyFetch(`/sites/${props.siteReference}/generation-runs`) as GenerationRunSummary[];
      const next = generations[0] ?? null;
      setLatestGeneration(next);
      if (!next) return;
      const createdAt = new Date(next.createdAt).getTime();
      const recentlyChanged = Number.isFinite(createdAt) && Date.now() - createdAt < 60_000;
      if (ACTIVE_BUILD_STATUSES.has(next.status) || (recentlyChanged && (COMPLETE_BUILD_STATUSES.has(next.status) || next.status === 'FAILED'))) {
        setShowBuildMonitor(true);
      }
    } catch {
      // Publishing remains usable if generation polling is temporarily unavailable.
    }
  }, [props.siteReference]);

  useEffect(() => {
    void refreshGeneration();
    const interval = window.setInterval(() => void refreshGeneration(), 2_000);
    return () => window.clearInterval(interval);
  }, [refreshGeneration]);

  const run = async (key: string, operation: () => Promise<unknown>, success: string) => {
    setBusy(key); setError(''); setMessage('');
    try {
      await operation();
      setMessage(success);
      await props.onChanged();
    } catch (caught: any) {
      setError(caught.message);
    } finally {
      setBusy('');
    }
  };
  const previewGeneratedSite = async () => {
    const previewWindow = window.open('about:blank', '_blank');
    if (previewWindow) previewWindow.opener = null;
    setBusy('preview'); setError(''); setMessage('');
    try {
      const preview = await agencyFetch(`/sites/${props.siteReference}/preview-link`, {
        method: 'POST',
        body: '{}',
      }) as {
        previewUrl: string;
        versionNumber: number;
        generationStatus: string | null;
      };
      if (previewWindow) previewWindow.location.href = preview.previewUrl;
      else window.location.assign(preview.previewUrl);
      setMessage(`Opened generated website version ${preview.versionNumber}. Previewing does not publish the site.`);
    } catch (caught: any) {
      previewWindow?.close();
      setError(caught.message || 'The generated website preview could not be opened.');
    } finally {
      setBusy('');
    }
  };
  const publish = () => {
    const quality = props.publication?.quality;
    if (!quality) return;
    void run('publish', () => agencyFetch(`/sites/${props.siteReference}/publications`, {
      method: 'POST',
      body: JSON.stringify({
        siteVersionReference: quality.versionReference,
        qualityRunReference: quality.reference,
        reason: 'CONTENT_UPDATE',
        acknowledgeWarnings: quality.gateStatus === 'READY_WITH_WARNINGS',
      }),
    }), 'Digest-pinned publication was queued.');
  };
  const addCustom = () => {
    const hostname = prompt('Custom hostname (for example www.example.com)');
    if (!hostname) return;
    void run('domain', () => agencyFetch(`/sites/${props.siteReference}/domains/custom`, {
      method: 'POST',
      body: JSON.stringify({ hostname }),
    }), 'Custom domain DNS discovery was queued.');
  };
  const reserveFallback = () => void run(
    'domain',
    () => agencyFetch(`/sites/${props.siteReference}/domains/fallback`, {
      method: 'POST',
      body: JSON.stringify({ fallbackDomain: 'sites.kasimshah.com' }),
    }),
    'Managed fallback hostname reserved.',
  );
  const quality = props.publication?.quality;
  const canPublish = quality?.status === 'READY'
    && ['READY', 'READY_WITH_WARNINGS'].includes(quality?.gateStatus);

  const buildProgress = latestGeneration ? generationProgress(latestGeneration) : 0;
  const buildStage = latestGeneration ? generationStageIndex(latestGeneration) : 0;
  const buildActive = Boolean(latestGeneration && ACTIVE_BUILD_STATUSES.has(latestGeneration.status));
  const buildComplete = Boolean(latestGeneration && COMPLETE_BUILD_STATUSES.has(latestGeneration.status));
  const buildFailed = latestGeneration?.status === 'FAILED';

  return <>
    {showBuildMonitor && latestGeneration ? <aside aria-live="polite" aria-label="Website build progress" className="fixed inset-x-3 bottom-3 z-50 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur sm:left-auto sm:right-4 sm:w-[430px]">
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">
              {buildActive ? <Loader2 className="h-4 w-4 animate-spin" /> : buildComplete ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : null}
              Website build
            </p>
            <h3 className={`mt-2 text-lg font-black ${buildFailed ? 'text-rose-200' : buildComplete ? 'text-emerald-200' : 'text-white'}`}>
              {buildFailed ? 'Build failed' : buildComplete ? 'Build complete' : 'Building your website'}
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-400">{generationMessage(latestGeneration)}</p>
          </div>
          <span className="shrink-0 rounded-full border border-slate-700 px-2.5 py-1 text-[10px] font-black text-slate-300">{status(latestGeneration.status)}</span>
        </div>

        <div className="mt-4 flex items-center justify-between text-[11px] font-bold text-slate-300"><span>Build progress</span><span>{buildProgress}%</span></div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={buildProgress}>
          <div className={`h-full rounded-full transition-[width] duration-700 ${buildFailed ? 'bg-rose-500' : buildComplete ? 'bg-emerald-500' : 'bg-violet-500'}`} style={{ width: `${buildProgress}%` }} />
        </div>

        <div className="mt-4 grid grid-cols-5 gap-1" aria-label="Build stages">
          {BUILD_STAGES.map((stage, index) => {
            const complete = buildComplete || index < buildStage;
            const current = !buildFailed && index === buildStage && !buildComplete;
            return <div key={stage} className="min-w-0 text-center">
              <span className={`mx-auto grid h-6 w-6 place-items-center rounded-full border text-[10px] font-black ${complete ? 'border-emerald-600 bg-emerald-950 text-emerald-300' : current ? 'border-violet-500 bg-violet-950 text-violet-200' : 'border-slate-700 bg-slate-900 text-slate-600'}`}>{complete ? '✓' : index + 1}</span>
              <span className={`mt-1 block truncate text-[9px] font-bold ${current ? 'text-violet-200' : complete ? 'text-emerald-300' : 'text-slate-600'}`}>{stage}</span>
            </div>;
          })}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-slate-900 p-3"><span className="text-[9px] font-black uppercase tracking-wide text-slate-500">Pages</span><p className="mt-1 text-sm font-black text-white">{Number(latestGeneration.pageCountCompleted ?? 0)} / {Number(latestGeneration.pageCountPlanned ?? 0)}</p></div>
          <div className="rounded-xl bg-slate-900 p-3"><span className="text-[9px] font-black uppercase tracking-wide text-slate-500">Sections</span><p className="mt-1 text-sm font-black text-white">{Number(latestGeneration.sectionCountCompleted ?? 0)} / {Number(latestGeneration.sectionCountPlanned ?? 0)}</p></div>
        </div>

        {buildFailed ? <div className="mt-3 rounded-xl border border-rose-900 bg-rose-950/30 p-3"><p className="text-xs font-bold text-rose-200">{latestGeneration.failureCode || 'GENERATION_FAILED'}</p><p className="mt-1 text-[11px] leading-5 text-rose-100/70">Use <strong>Retry build</strong> in Search Intelligence to restart this governed build.</p></div> : null}
        {buildComplete ? <button type="button" disabled={Boolean(busy)} onClick={() => void previewGeneratedSite()} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white transition hover:bg-emerald-500 disabled:opacity-40">{busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}{busy === 'preview' ? 'Opening preview…' : 'Preview generated site'}</button> : null}
      </div>
    </aside> : null}

    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xs font-black uppercase tracking-widest text-cyan-300">Preview, publishing and domains</h2><p className="mt-2 text-sm text-slate-400">Preview generated output immediately. Quality, review, payments and publication remain separate gates for going live.</p></div>
        <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-black">{status(props.publication?.status)}</span>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-rose-900 p-3 text-xs text-rose-200">{error}</p>}
      {message && <p role="status" className="mt-3 rounded-lg border border-emerald-900 p-3 text-xs text-emerald-200">{message}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-800 bg-cyan-950/25 p-4">
        <div><strong className="text-sm text-cyan-100">See the generated website now</strong><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">Opens the latest available secure rendered preview. This does not publish the site or require launch readiness.</p></div>
        <button type="button" disabled={Boolean(busy)} onClick={() => void previewGeneratedSite()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-600 px-4 text-xs font-black text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}{busy === 'preview' ? 'Opening preview…' : 'Preview generated site'}</button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-slate-950 p-4 text-xs"><strong>Quality gate</strong><p className="mt-2 text-slate-400">{status(quality?.gateStatus)}</p></div>
        <div className="rounded-xl bg-slate-950 p-4 text-xs"><strong>Live snapshot</strong><p className="mt-2 break-all text-slate-400">{props.publication?.pointer?.snapshotReference || 'None'}</p></div>
        <div className="rounded-xl bg-slate-950 p-4 text-xs"><strong>Pointer version</strong><p className="mt-2 text-slate-400">{props.publication?.pointer?.pointerVersion || '—'}</p></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button disabled={Boolean(busy) || !canPublish} onClick={publish} className="rounded-xl border border-emerald-700 px-4 py-2 text-xs font-black text-emerald-300 disabled:opacity-40">{busy === 'publish' ? 'Publishing…' : 'Publish approved version'}</button>
        <button disabled={Boolean(busy)} onClick={reserveFallback} className="rounded-xl border border-cyan-700 px-4 py-2 text-xs font-black">Reserve fallback hostname</button>
        <button disabled={Boolean(busy)} onClick={addCustom} className="rounded-xl border border-cyan-700 px-4 py-2 text-xs font-black">Add custom domain</button>
      </div>
      <div className="mt-4 space-y-2">{props.publication?.domains?.map((domain: any) => <div key={domain.reference} className="flex flex-wrap justify-between gap-2 rounded-xl bg-slate-950 p-3 text-xs"><span className="font-bold">{domain.hostname}</span><span className="text-slate-400">{domain.type} · {status(domain.status)} · ownership {status(domain.ownershipStatus)} · SSL {status(domain.sslStatus)}</span></div>)}</div>
    </section>
  </>;
}
