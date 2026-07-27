import React, { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';

export type AuthHighlight = {
  eyebrow: string;
  title: string;
  description: string;
  metric: string;
  metricLabel: string;
  previewRows: Array<{ label: string; value: string }>;
};

type AuthSplitLayoutProps = {
  portalLabel: string;
  formTitle: string;
  formDescription: string;
  highlights: AuthHighlight[];
  accent?: 'indigo' | 'violet';
  trustLine: string;
  children: React.ReactNode;
};

const tones = {
  indigo: {
    mark: 'bg-indigo-600',
    glow: 'bg-indigo-500/25',
    eyebrow: 'text-indigo-200',
    metric: 'text-indigo-100',
    dot: 'bg-indigo-400',
    activeDot: 'bg-indigo-300',
    previewAccent: 'bg-indigo-500/15 text-indigo-200',
  },
  violet: {
    mark: 'bg-violet-600',
    glow: 'bg-violet-500/25',
    eyebrow: 'text-violet-200',
    metric: 'text-violet-100',
    dot: 'bg-violet-400',
    activeDot: 'bg-violet-300',
    previewAccent: 'bg-violet-500/15 text-violet-200',
  },
} as const;

export const AuthSplitLayout: React.FC<AuthSplitLayoutProps> = ({
  portalLabel,
  formTitle,
  formDescription,
  highlights,
  accent = 'indigo',
  trustLine,
  children,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const tone = tones[accent];
  const active = highlights[activeIndex] ?? highlights[0];

  useEffect(() => {
    if (highlights.length < 2 || typeof window === 'undefined') return;
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;
    const timer = window.setInterval(() => {
      setActiveIndex(current => (current + 1) % highlights.length);
    }, 9_000);
    return () => window.clearInterval(timer);
  }, [highlights.length]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,0.95fr)_minmax(520px,1.05fr)]">
        <aside className="relative hidden min-h-screen overflow-hidden border-r border-white/10 bg-slate-950 p-10 lg:flex lg:flex-col xl:p-14">
          <div className={`pointer-events-none absolute -left-20 top-20 h-80 w-80 rounded-full ${tone.glow} blur-3xl`} />
          <div className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <div className={`grid h-11 w-11 place-items-center rounded-2xl ${tone.mark} text-sm font-black shadow-lg`}>KS</div>
            <div>
              <p className="font-black tracking-tight">KS OS</p>
              <p className="text-xs text-slate-500">{portalLabel}</p>
            </div>
          </div>

          <div className="relative my-auto max-w-2xl py-12">
            <p className={`flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] ${tone.eyebrow}`}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {active.eyebrow}
            </p>
            <h2 className="mt-5 max-w-xl text-4xl font-black leading-tight tracking-tight xl:text-5xl">{active.title}</h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">{active.description}</p>

            <div className="mt-8 grid gap-4 xl:grid-cols-[180px_minmax(0,1fr)]">
              <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur-sm">
                <p className={`text-3xl font-black ${tone.metric}`}>{active.metric}</p>
                <p className="mt-2 text-xs leading-5 text-slate-400">{active.metricLabel}</p>
              </div>
              <div aria-label="Product preview" className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 shadow-2xl backdrop-blur-sm">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <span className="text-xs font-black text-slate-200">Workspace overview</span>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${tone.previewAccent}`}>Live context</span>
                </div>
                <dl className="mt-2 space-y-1">
                  {active.previewRows.map(row => (
                    <div key={row.label} className="flex items-center justify-between rounded-xl px-3 py-2.5 hover:bg-white/[0.04]">
                      <dt className="text-xs text-slate-400">{row.label}</dt>
                      <dd className="text-xs font-black text-slate-100">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            {highlights.length > 1 && (
              <div className="mt-7 flex items-center gap-2" role="tablist" aria-label="Product highlights">
                {highlights.map((highlight, index) => (
                  <button
                    key={highlight.title}
                    type="button"
                    role="tab"
                    aria-selected={activeIndex === index}
                    aria-label={`Show highlight ${index + 1}: ${highlight.title}`}
                    onClick={() => setActiveIndex(index)}
                    className={`h-2.5 rounded-full transition-all ${activeIndex === index ? `w-8 ${tone.activeDot}` : 'w-2.5 bg-slate-600 hover:bg-slate-500'}`}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="relative flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            {trustLine}
          </div>
        </aside>

        <section className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-950 sm:px-6 lg:px-12">
          <div className="w-full max-w-md">
            <div className="mb-7 flex items-center gap-3 lg:hidden">
              <div className={`grid h-10 w-10 place-items-center rounded-xl ${tone.mark} text-sm font-black text-white`}>KS</div>
              <div>
                <p className="font-black">KS OS</p>
                <p className="text-xs text-slate-500">{portalLabel}</p>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] sm:p-8">
              <header>
                <h1 className="text-2xl font-black tracking-tight text-slate-950">{formTitle}</h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">{formDescription}</p>
              </header>
              {children}
            </div>

            <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-slate-500">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Secure authentication with centrally revocable sessions
            </p>
          </div>
        </section>
      </div>
    </main>
  );
};

export default AuthSplitLayout;
