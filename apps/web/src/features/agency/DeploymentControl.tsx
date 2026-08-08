import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  LoaderCircle,
  Rocket,
  Server,
  TriangleAlert,
  X,
} from 'lucide-react';
import { agencyFetch, type AgencyRequestError } from './AgencyAuth';
import { createPortal } from 'react-dom';

type DeploymentTarget = 'both' | 'vps' | 'cloudflare';

interface DeploymentRun {
  runId: number;
  requestId?: string;
  status: string;
  conclusion: string | null;
  url: string;
  displayTitle: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  failedSteps: Array<{
    job: string;
    step: string;
    jobUrl: string;
  }>;
}

const targetOptions: Array<{
  value: DeploymentTarget;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: 'both',
    label: 'VPS + Cloudflare',
    description: 'Deploy VPS and trigger the existing Cloudflare production pipeline.',
    icon: Rocket,
  },
  {
    value: 'vps',
    label: 'VPS only',
    description: 'Deploy and verify VPS services.',
    icon: Server,
  },
  {
    value: 'cloudflare',
    label: 'Cloudflare only',
    description: 'Trigger and verify the existing Cloudflare production pipeline.',
    icon: Cloud,
  },
];

function describeStatus(run: DeploymentRun | null) {
  if (!run) return null;
  if (run.status !== 'completed') return 'Deployment is running. This panel only exposes errors if a stage fails.';
  if (run.conclusion === 'success') return 'Production deployment completed successfully.';
  return `Production deployment ${run.conclusion || 'failed'}.`;
}

export function DeploymentControl() {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<DeploymentTarget>('both');
  const [gitRef, setGitRef] = useState('main');
  const [applyMigrations, setApplyMigrations] = useState(false);
  const [run, setRun] = useState<DeploymentRun | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRunning = Boolean(run && run.status !== 'completed');
  const statusMessage = useMemo(() => describeStatus(run), [run]);

  useEffect(() => {
    if (!run?.runId || run.status === 'completed') return;

    let active = true;
    const poll = async () => {
      try {
        const next = await agencyFetch(`/deployments/${run.runId}`) as DeploymentRun;
        if (active) {
          setRun(next);
          setError(null);
        }
      } catch (cause) {
        if (!active) return;
        const requestError = cause as AgencyRequestError;
        setError(requestError.message || 'The deployment status could not be refreshed.');
      }
    };

    const timer = window.setInterval(() => void poll(), 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [run?.runId, run?.status]);

  useEffect(() => {
    if (target === 'cloudflare') setApplyMigrations(false);
  }, [target]);

  useEffect(() => {
    if (!open || isRunning) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reset();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isRunning]);

  const reset = () => {
    if (isRunning) return;
    setOpen(false);
    setError(null);
    setRun(null);
    setApplyMigrations(false);
  };

  const startDeployment = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setRun(null);

    try {
      const created = await agencyFetch('/deployments', {
        method: 'POST',
        body: JSON.stringify({
          target,
          ref: gitRef.trim(),
          applyMigrations: target === 'cloudflare' ? false : applyMigrations,
        }),
      }) as DeploymentRun;
      setRun(created);
    } catch (cause) {
      const requestError = cause as AgencyRequestError;
      setError(requestError.message || 'The production deployment could not be started.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-3 text-xs font-black text-violet-100 transition hover:border-violet-400 hover:bg-violet-500/20"
      >
        <Rocket aria-hidden="true" className="h-4 w-4" />
        Deploy
      </button>

      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex flex-col items-center justify-start overflow-y-auto bg-slate-950/85 p-4 sm:p-6 backdrop-blur-sm"
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget && !isRunning) reset();
              }}
            >
              <section
                aria-labelledby="production-deployment-title"
                aria-modal="true"
                role="dialog"
                className="my-auto max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-7"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-violet-300">Production release</p>
                    <h2 id="production-deployment-title" className="mt-2 text-2xl font-black text-white">Deploy KS OS</h2>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
                      The same guarded GitHub Actions workflow is used by automatic merges, the CLI and this control.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={reset}
                    disabled={isRunning}
                    aria-label="Close deployment control"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-700 text-slate-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>

                {!run ? (
                  <form onSubmit={startDeployment} className="mt-7 space-y-6">
                    <fieldset>
                      <legend className="text-sm font-black text-white">Deployment type</legend>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        {targetOptions.map(option => {
                          const Icon = option.icon;
                          const selected = target === option.value;
                          return (
                            <label
                              key={option.value}
                              className={`cursor-pointer rounded-2xl border p-4 transition focus-within:ring-2 focus-within:ring-violet-400 ${selected ? 'border-violet-400 bg-violet-500/15' : 'border-slate-700 bg-slate-950/50 hover:border-slate-600'}`}
                            >
                              <input
                                type="radio"
                                name="deployment-target"
                                value={option.value}
                                checked={selected}
                                onChange={() => setTarget(option.value)}
                                className="sr-only"
                              />
                              <Icon aria-hidden="true" className={`h-5 w-5 ${selected ? 'text-violet-300' : 'text-slate-400'}`} />
                              <span className="mt-3 block text-sm font-black text-white">{option.label}</span>
                              <span className="mt-1 block text-xs leading-5 text-slate-400">{option.description}</span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>

                    <label className="block text-sm font-black text-white">
                      Git ref
                      <input
                        value={gitRef}
                        onChange={event => setGitRef(event.target.value)}
                        required
                        pattern="[A-Za-z0-9._/-]+"
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
                      />
                      <span className="mt-2 block text-xs font-normal leading-5 text-slate-500">Use main for the current production branch or a reviewed commit SHA.</span>
                    </label>

                    {target !== 'cloudflare' ? (
                      <label className="flex cursor-pointer gap-3 rounded-2xl border border-amber-800/70 bg-amber-950/30 p-4">
                        <input
                          type="checkbox"
                          checked={applyMigrations}
                          onChange={event => setApplyMigrations(event.target.checked)}
                          className="mt-1 h-4 w-4 accent-amber-400"
                        />
                        <span>
                          <span className="flex items-center gap-2 text-sm font-black text-amber-100">
                            <Database aria-hidden="true" className="h-4 w-4" /> Apply reviewed database migrations
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-amber-200/70">
                            Leave this off unless the migration plan has been reviewed. Automatic merge deployments never apply migrations.
                          </span>
                        </span>
                      </label>
                    ) : null}

                    {error ? <p role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p> : null}

                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                      <button type="button" onClick={reset} className="min-h-11 rounded-xl border border-slate-700 px-5 text-sm font-bold text-slate-300 transition hover:text-white">Cancel</button>
                      <button
                        type="submit"
                        disabled={submitting || !gitRef.trim()}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-black text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {submitting ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Rocket aria-hidden="true" className="h-4 w-4" />}
                        {submitting ? 'Starting…' : `Deploy ${target === 'both' ? 'VPS + Cloudflare' : target === 'vps' ? 'VPS' : 'Cloudflare'}`}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="mt-7 space-y-5">
                    <div className={`rounded-2xl border p-5 ${run.status !== 'completed' ? 'border-violet-700 bg-violet-950/30' : run.conclusion === 'success' ? 'border-emerald-800 bg-emerald-950/30' : 'border-rose-800 bg-rose-950/30'}`}>
                      <div className="flex items-start gap-3">
                        {run.status !== 'completed' ? (
                          <LoaderCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-violet-300" />
                        ) : run.conclusion === 'success' ? (
                          <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                        ) : (
                          <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
                        )}
                        <div>
                          <p className="text-sm font-black text-white">{statusMessage}</p>
                          <p className="mt-1 text-xs text-slate-400">Run #{run.runId} · {run.headSha.slice(0, 12)}</p>
                        </div>
                      </div>
                    </div>

                    {error ? <p role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p> : null}

                    {run.status === 'completed' && run.conclusion !== 'success' ? (
                      <div className="rounded-2xl border border-rose-900/80 bg-slate-950/70 p-5">
                        <h3 className="text-sm font-black text-white">Errors</h3>
                        {run.failedSteps.length > 0 ? (
                          <ul className="mt-3 space-y-2">
                            {run.failedSteps.map((failure, index) => (
                              <li key={`${failure.job}-${failure.step}-${index}`} className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm">
                                <span className="font-bold text-rose-200">{failure.step}</span>
                                <span className="mt-1 block text-xs text-slate-500">{failure.job}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-sm text-slate-400">GitHub reported a failure without a failed step summary. Open the run for the error log.</p>
                        )}
                      </div>
                    ) : null}

                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                      {!isRunning ? <button type="button" onClick={reset} className="min-h-11 rounded-xl border border-slate-700 px-5 text-sm font-bold text-slate-300 transition hover:text-white">Close</button> : null}
                      <a
                        href={run.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-5 text-sm font-black text-white transition hover:border-slate-500"
                      >
                        Open GitHub run <ExternalLink aria-hidden="true" className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                )}
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export default DeploymentControl;
