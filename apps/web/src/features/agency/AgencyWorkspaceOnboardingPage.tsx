import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  FileText,
  Flag,
  Rocket,
  Save,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useParams } from 'react-router';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';

type StageStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'READY' | 'COMPLETE' | 'SKIPPED';

type OnboardingStage = {
  id: string;
  stageKey: string;
  sequence: number;
  status: StageStatus;
  blockerCode?: string | null;
  blockerNote?: string | null;
  dueAt?: string | null;
  notes?: string | null;
  completedAt?: string | null;
};

type LaunchCheck = {
  checkKey: string;
  status: 'PASS' | 'FAIL' | string;
  blocking: boolean;
  detail: string;
  checkedAt?: string | null;
};

type OnboardingRecord = {
  id: string;
  status: string;
  currentStage: string;
  completionPercentage: number;
  targetLaunchAt?: string | null;
  nextAction?: string | null;
  internalNotes?: string | null;
  clientVisibleNotes?: string | null;
  missingInformation?: string[] | null;
  stages: OnboardingStage[];
  checks: LaunchCheck[];
};

type TenantDetail = {
  tenant: {
    id: string;
    name: string;
    lifecycleStatus: string;
    subdomain: string;
  };
};

type StageDefinition = {
  title: string;
  description: string;
  completionHint: string;
};

const stageDefinitions: Record<string, StageDefinition> = {
  SALE_HANDOVER: {
    title: 'Sales handover',
    description: 'Confirm the client, package, primary contact, agreed scope and commercial promises before delivery begins.',
    completionHint: 'Complete when the agreed scope and ownership are clear to the delivery team.',
  },
  CONTRACT: {
    title: 'Contract',
    description: 'Record that the client agreement has been issued, signed and stored in the correct place.',
    completionHint: 'Complete when the signed agreement is confirmed.',
  },
  SETUP_FEE: {
    title: 'Setup fee',
    description: 'Confirm that the setup payment has been received or formally waived with a reason.',
    completionHint: 'The final launch check reads the billing record, not this status alone.',
  },
  DIRECT_DEBIT: {
    title: 'Direct debit',
    description: 'Set up the client subscription mandate and confirm it is active.',
    completionHint: 'The final launch check requires an active GoCardless mandate.',
  },
  BUSINESS_PROFILE: {
    title: 'Business profile',
    description: 'Capture the business description, address, audience, service area and key selling points.',
    completionHint: 'Complete when the operating profile is accurate enough to configure the workspace.',
  },
  BRAND_ASSETS: {
    title: 'Brand assets',
    description: 'Collect the logo, colours, imagery, fonts and tone of voice needed for the client experience.',
    completionHint: 'Complete when approved assets are available to the delivery team.',
  },
  CATALOGUE: {
    title: 'Services and catalogue',
    description: 'Create the services, durations, prices, deposits and booking rules the client sells.',
    completionHint: 'The final launch check requires at least one active service.',
  },
  TEAM_AND_LOCATIONS: {
    title: 'Team and locations',
    description: 'Add operating locations, team members, roles, working hours and booking availability.',
    completionHint: 'The final launch check requires at least one active location.',
  },
  PAYMENTS: {
    title: 'Appointment payments',
    description: 'Connect and verify Stripe so deposits and appointment payments can be collected safely.',
    completionHint: 'The final launch check requires Stripe Connect to be ready.',
  },
  COMMUNICATIONS: {
    title: 'Communications',
    description: 'Review confirmations, reminders, sender details and client-facing communication settings.',
    completionHint: 'Complete after email and SMS behaviour has been checked with the client.',
  },
  TRAINING: {
    title: 'Training and handover',
    description: 'Walk the client through their workspace, daily tasks, support route and account security.',
    completionHint: 'Complete after the owner can perform the core operational tasks unaided.',
  },
  LAUNCH: {
    title: 'Final launch',
    description: 'Run the launch checks, resolve every blocker and activate the workspace for the client.',
    completionHint: 'This stage is completed automatically when the workspace is launched.',
  },
};

const statusOptions: Array<{ value: StageStatus; label: string }> = [
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'READY', label: 'Ready to complete' },
  { value: 'COMPLETE', label: 'Complete' },
  { value: 'SKIPPED', label: 'Skipped' },
];

const surface = 'rounded-3xl border border-slate-800/90 bg-slate-900/80 shadow-[0_24px_80px_rgba(2,6,23,0.28)]';

const statusTone = (value: string) => {
  const normalised = value.toUpperCase();
  if (['ACTIVE', 'COMPLETE', 'COMPLETED', 'PASS'].includes(normalised)) return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
  if (['IN_PROGRESS', 'READY', 'ONBOARDING'].includes(normalised)) return 'border-violet-400/30 bg-violet-400/10 text-violet-200';
  if (['BLOCKED', 'FAIL', 'FAILED'].includes(normalised)) return 'border-rose-400/30 bg-rose-400/10 text-rose-200';
  if (normalised === 'SKIPPED') return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
  return 'border-slate-700 bg-slate-800/70 text-slate-300';
};

const StatusBadge = ({ value }: { value: string }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusTone(value)}`}>
    {value.replaceAll('_', ' ')}
  </span>
);

const formatDate = (value?: string | null) => value
  ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : 'Not set';

const dateInputValue = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : '';

function useOnboardingWorkspace(tenantId?: string) {
  const [tenant, setTenant] = useState<TenantDetail['tenant'] | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const [detail, record] = await Promise.all([
        agencyFetch(`/tenants/${tenantId}`) as Promise<TenantDetail>,
        agencyFetch(`/tenants/${tenantId}/onboarding`) as Promise<OnboardingRecord>,
      ]);
      setTenant(detail.tenant);
      setOnboarding(record);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The onboarding workspace could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return { tenant, onboarding, loading, error, reload };
}

export const AgencyWorkspaceOnboardingPage: React.FC = () => {
  const { tenantId } = useParams();
  const { session } = useAgencyAuth();
  const live = useOnboardingWorkspace(tenantId);
  const canManage = session?.capabilities.includes('tenants.manage') ?? false;

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [stageStatus, setStageStatus] = useState<StageStatus>('NOT_STARTED');
  const [stageDueAt, setStageDueAt] = useState('');
  const [stageNotes, setStageNotes] = useState('');
  const [blockerNote, setBlockerNote] = useState('');
  const [targetLaunchAt, setTargetLaunchAt] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [missingInformation, setMissingInformation] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [clientVisibleNotes, setClientVisibleNotes] = useState('');
  const [planInitialised, setPlanInitialised] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [launchChecks, setLaunchChecks] = useState<LaunchCheck[]>([]);

  const stages = useMemo(() => live.onboarding?.stages ?? [], [live.onboarding?.stages]);
  const selectedStage = useMemo(() => {
    if (!stages.length) return null;
    return stages.find(stage => stage.stageKey === selectedKey)
      ?? stages.find(stage => !['COMPLETE', 'SKIPPED'].includes(stage.status))
      ?? stages[stages.length - 1];
  }, [selectedKey, stages]);

  React.useEffect(() => {
    if (!selectedStage) return;
    setSelectedKey(selectedStage.stageKey);
    setStageStatus(selectedStage.status);
    setStageDueAt(dateInputValue(selectedStage.dueAt));
    setStageNotes(selectedStage.notes ?? '');
    setBlockerNote(selectedStage.blockerNote ?? '');
  }, [selectedStage?.id]);

  React.useEffect(() => {
    if (!live.onboarding || planInitialised) return;
    setTargetLaunchAt(dateInputValue(live.onboarding.targetLaunchAt));
    setNextAction(live.onboarding.nextAction ?? '');
    setMissingInformation((live.onboarding.missingInformation ?? []).join('\n'));
    setInternalNotes(live.onboarding.internalNotes ?? '');
    setClientVisibleNotes(live.onboarding.clientVisibleNotes ?? '');
    setLaunchChecks(live.onboarding.checks ?? []);
    setPlanInitialised(true);
  }, [live.onboarding, planInitialised]);

  const completionPercentage = live.onboarding?.completionPercentage ?? 0;
  const completedCount = stages.filter(stage => ['COMPLETE', 'SKIPPED'].includes(stage.status)).length;
  const blockerCount = stages.filter(stage => stage.status === 'BLOCKED').length;
  const failedChecks = launchChecks.filter(check => check.status !== 'PASS');

  const selectStage = (stage: OnboardingStage) => {
    setSelectedKey(stage.stageKey);
    setStageStatus(stage.status);
    setStageDueAt(dateInputValue(stage.dueAt));
    setStageNotes(stage.notes ?? '');
    setBlockerNote(stage.blockerNote ?? '');
    setNotice('');
    setActionError('');
  };

  const saveStage = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!tenantId || !selectedStage || busy) return;
    if (stageStatus === 'BLOCKED' && blockerNote.trim().length === 0) {
      setActionError('Explain what is blocking this stage before saving it as blocked.');
      return;
    }
    setBusy('stage');
    setNotice('');
    setActionError('');
    try {
      await agencyFetch(`/tenants/${tenantId}/onboarding/${selectedStage.stageKey}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: stageStatus,
          dueAt: stageDueAt ? `${stageDueAt}T12:00:00.000Z` : null,
          notes: stageNotes.trim() || null,
          blockerCode: stageStatus === 'BLOCKED' ? 'MANUAL_BLOCKER' : null,
          blockerNote: stageStatus === 'BLOCKED' ? blockerNote.trim() : null,
        }),
      });
      setNotice(`${stageDefinitions[selectedStage.stageKey]?.title ?? selectedStage.stageKey} updated.`);
      await live.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The onboarding stage could not be updated.');
    } finally {
      setBusy(null);
    }
  };

  const completeAndContinue = async () => {
    if (!selectedStage || selectedStage.stageKey === 'LAUNCH') return;
    setStageStatus('COMPLETE');
    setBusy('stage');
    setNotice('');
    setActionError('');
    try {
      await agencyFetch(`/tenants/${tenantId}/onboarding/${selectedStage.stageKey}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'COMPLETE',
          dueAt: stageDueAt ? `${stageDueAt}T12:00:00.000Z` : null,
          notes: stageNotes.trim() || null,
          blockerCode: null,
          blockerNote: null,
        }),
      });
      await live.reload();
      setSelectedKey(null);
      setNotice(`${stageDefinitions[selectedStage.stageKey]?.title ?? selectedStage.stageKey} completed. The next incomplete stage is now selected.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The onboarding stage could not be completed.');
    } finally {
      setBusy(null);
    }
  };

  const savePlan = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tenantId || busy) return;
    setBusy('plan');
    setNotice('');
    setActionError('');
    try {
      await agencyFetch(`/tenants/${tenantId}/onboarding`, {
        method: 'PATCH',
        body: JSON.stringify({
          targetLaunchAt: targetLaunchAt ? `${targetLaunchAt}T12:00:00.000Z` : null,
          nextAction: nextAction.trim() || null,
          missingInformation: missingInformation.split('\n').map(item => item.trim()).filter(Boolean),
          internalNotes: internalNotes.trim() || null,
          clientVisibleNotes: clientVisibleNotes.trim() || null,
        }),
      });
      setNotice('The onboarding plan has been saved.');
      await live.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The onboarding plan could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const runChecks = async () => {
    if (!tenantId || busy) return;
    setBusy('checks');
    setNotice('');
    setActionError('');
    try {
      const result = await agencyFetch(`/tenants/${tenantId}/launch-checks`, { method: 'POST' });
      setLaunchChecks(result.checks ?? []);
      setNotice(result.ready
        ? 'All launch checks passed. The workspace is ready to activate.'
        : `${(result.checks ?? []).filter((check: LaunchCheck & { ok?: boolean }) => check.ok === false).length} launch checks still need attention.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Launch checks could not be completed.');
    } finally {
      setBusy(null);
    }
  };

  const launchWorkspace = async () => {
    if (!tenantId || busy) return;
    setBusy('launch');
    setNotice('');
    setActionError('');
    try {
      const result = await agencyFetch(`/tenants/${tenantId}/launch-checks`, { method: 'POST' });
      setLaunchChecks(result.checks ?? []);
      if (!result.ready) {
        setNotice(`${(result.checks ?? []).filter((check: LaunchCheck & { ok?: boolean }) => check.ok === false).length} launch checks still need attention.`);
        return;
      }
      if (!window.confirm(`Launch ${live.tenant?.name ?? 'this workspace'} now? The client workspace will become active.`)) return;
      await agencyFetch(`/tenants/${tenantId}/launch`, { method: 'POST' });
      setNotice('The client workspace is now active.');
      await live.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The workspace could not be launched.');
    } finally {
      setBusy(null);
    }
  };

  if (live.loading) {
    return <section className={`${surface} p-8`}><div className="flex items-center gap-3 text-slate-400"><div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-violet-400" /><span className="text-sm font-bold">Loading setup and launch…</span></div></section>;
  }

  if (live.error || !live.tenant || !live.onboarding || !selectedStage) {
    return <section className={`${surface} p-8`}><div role="alert" className="flex items-start gap-3 text-rose-200"><CircleAlert className="mt-0.5 h-5 w-5" /><div><p className="font-black">Setup and launch could not be loaded</p><p className="mt-1 text-sm text-rose-200/70">{live.error || 'No onboarding record was found.'}</p></div></div></section>;
  }

  const selectedDefinition = stageDefinitions[selectedStage.stageKey] ?? {
    title: selectedStage.stageKey.replaceAll('_', ' '),
    description: 'Complete the operational work required for this stage.',
    completionHint: 'Record enough evidence for another agency operator to understand the decision.',
  };
  const editableStatusOptions = selectedStage.stageKey === 'LAUNCH'
    ? statusOptions.filter(option => !['COMPLETE', 'SKIPPED'].includes(option.value))
    : statusOptions;

  return <div className="space-y-7">
    <section className="rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-500/15 via-slate-900 to-slate-950 p-6 shadow-2xl sm:p-8">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge value={live.tenant.lifecycleStatus} /><StatusBadge value={live.onboarding.status} /></div>
          <p className="mt-4 text-xs font-black uppercase tracking-[0.22em] text-violet-300">{live.tenant.name}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Setup and launch</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Manage the complete client onboarding journey, keep evidence beside each stage and use the launch checks as the final source of truth.</p>
        </div>
        {canManage ? <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void runChecks()} disabled={busy !== null} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-black text-slate-200 hover:bg-slate-800 disabled:opacity-50"><ShieldCheck className="h-4 w-4" />{busy === 'checks' ? 'Checking…' : 'Run launch checks'}</button><button type="button" onClick={() => void launchWorkspace()} disabled={busy !== null || live.tenant.lifecycleStatus === 'ACTIVE'} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50"><Rocket className="h-4 w-4" />{live.tenant.lifecycleStatus === 'ACTIVE' ? 'Workspace active' : busy === 'launch' ? 'Launching…' : 'Check and launch'}</button></div> : null}
      </div>
      <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_auto]"><div><div className="flex items-center justify-between gap-4 text-xs font-black"><span className="text-slate-400">{completedCount} of {stages.length} stages complete</span><span className="text-violet-200">{completionPercentage}%</span></div><div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label={`${completionPercentage}% complete`} aria-valuenow={completionPercentage} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400 transition-all" style={{ width: `${Math.max(completionPercentage, 2)}%` }} /></div></div><div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 font-bold text-slate-300">Target: {formatDate(live.onboarding.targetLaunchAt)}</span><span className={`rounded-full border px-3 py-2 font-bold ${blockerCount ? 'border-rose-400/30 bg-rose-400/10 text-rose-200' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'}`}>{blockerCount ? `${blockerCount} blocked` : 'No blocked stages'}</span></div></div>
    </section>

    {notice ? <p role="status" className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm font-bold text-emerald-100">{notice}</p> : null}
    {actionError ? <p role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">{actionError}</p> : null}

    <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <section className={`${surface} overflow-hidden`}>
        <div className="border-b border-slate-800 px-5 py-5 sm:px-6"><p className="text-xs font-black uppercase tracking-widest text-slate-500">Onboarding journey</p><h2 className="mt-1 text-xl font-black text-white">Choose a stage to manage</h2></div>
        <div className="divide-y divide-slate-800">{stages.map(stage => {
          const definition = stageDefinitions[stage.stageKey];
          const selected = selectedStage.stageKey === stage.stageKey;
          const complete = ['COMPLETE', 'SKIPPED'].includes(stage.status);
          return <button key={stage.id} type="button" onClick={() => selectStage(stage)} className={`flex w-full items-start gap-4 px-5 py-4 text-left transition sm:px-6 ${selected ? 'bg-violet-500/10' : 'hover:bg-slate-800/45'}`} aria-current={selected ? 'step' : undefined}><span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${complete ? 'bg-emerald-500/15 text-emerald-300' : stage.status === 'BLOCKED' ? 'bg-rose-500/15 text-rose-200' : selected ? 'bg-violet-500 text-white' : 'bg-slate-800 text-slate-400'}`}>{complete ? <CheckCircle2 className="h-4 w-4" /> : <span className="text-xs font-black">{stage.sequence}</span>}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-white">{definition?.title ?? stage.stageKey.replaceAll('_', ' ')}</strong><StatusBadge value={stage.status} /></span><span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-500">{stage.blockerNote || definition?.description}</span></span><ArrowRight className={`mt-2 h-4 w-4 shrink-0 ${selected ? 'text-violet-300' : 'text-slate-700'}`} /></button>;
        })}</div>
      </section>

      <form onSubmit={saveStage} className={`${surface} p-5 sm:p-6`}>
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-violet-300">Stage {selectedStage.sequence} of {stages.length}</p><h2 className="mt-2 text-2xl font-black text-white">{selectedDefinition.title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{selectedDefinition.description}</p></div><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-500/15 text-violet-200"><ClipboardCheck className="h-5 w-5" /></div></div>

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-4"><p className="text-xs font-black uppercase tracking-wider text-slate-500">Completion guidance</p><p className="mt-2 text-sm leading-6 text-slate-300">{selectedDefinition.completionHint}</p></div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <label className="block text-sm font-bold text-slate-300">Stage status<select disabled={!canManage || busy !== null} value={stageStatus} onChange={event => setStageStatus(event.target.value as StageStatus)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-violet-400 disabled:opacity-60">{editableStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="block text-sm font-bold text-slate-300">Due date<input disabled={!canManage || busy !== null} type="date" value={stageDueAt} onChange={event => setStageDueAt(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-violet-400 disabled:opacity-60" /></label>
        </div>

        {stageStatus === 'BLOCKED' ? <label className="mt-5 block text-sm font-bold text-rose-100">What is blocking this stage?<textarea required rows={3} disabled={!canManage || busy !== null} value={blockerNote} onChange={event => setBlockerNote(event.target.value)} placeholder="Describe the missing decision, access, payment or client information." className="mt-2 w-full rounded-xl border border-rose-500/40 bg-rose-950/20 p-3 text-white outline-none placeholder:text-rose-200/40 focus:border-rose-300 disabled:opacity-60" /></label> : null}

        <label className="mt-5 block text-sm font-bold text-slate-300">Stage notes<textarea rows={5} disabled={!canManage || busy !== null} value={stageNotes} onChange={event => setStageNotes(event.target.value)} placeholder="Record decisions, evidence, links or anything the next operator needs to know." className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none placeholder:text-slate-600 focus:border-violet-400 disabled:opacity-60" /></label>

        {selectedStage.stageKey === 'LAUNCH' ? <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4"><div className="flex items-start gap-3"><Flag className="mt-0.5 h-5 w-5 text-amber-200" /><div><p className="font-black text-amber-100">Launch is completed by the activation control</p><p className="mt-1 text-sm leading-6 text-amber-100/70">Run the launch checks and use <strong>Check and launch</strong>. This final stage cannot be manually marked complete.</p></div></div></div> : null}

        {canManage ? <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="submit" disabled={busy !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 text-sm font-black text-slate-200 hover:bg-slate-800 disabled:opacity-50"><Save className="h-4 w-4" />{busy === 'stage' ? 'Saving…' : 'Save stage'}</button>{selectedStage.stageKey !== 'LAUNCH' && !['COMPLETE', 'SKIPPED'].includes(selectedStage.status) ? <button type="button" disabled={busy !== null} onClick={() => void completeAndContinue()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />Complete and continue</button> : null}</div> : <p className="mt-6 text-sm text-slate-500">You have read-only access to this onboarding record.</p>}
      </form>
    </div>

    <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
      <form onSubmit={savePlan} className={`${surface} p-5 sm:p-6`}>
        <div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-500/15 text-violet-200"><CalendarDays className="h-5 w-5" /></div><div><p className="text-xs font-black uppercase tracking-widest text-slate-500">Overall plan</p><h2 className="mt-1 text-xl font-black text-white">Ownership and next action</h2><p className="mt-1 text-sm text-slate-500">Keep the whole onboarding understandable without opening every stage.</p></div></div>
        <div className="mt-6 grid gap-5 md:grid-cols-2"><label className="block text-sm font-bold text-slate-300">Target launch date<input disabled={!canManage || busy !== null} type="date" value={targetLaunchAt} onChange={event => setTargetLaunchAt(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-violet-400 disabled:opacity-60" /></label><label className="block text-sm font-bold text-slate-300">Next action<input disabled={!canManage || busy !== null} value={nextAction} onChange={event => setNextAction(event.target.value)} placeholder="e.g. Confirm the signed agreement" className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none placeholder:text-slate-600 focus:border-violet-400 disabled:opacity-60" /></label></div>
        <label className="mt-5 block text-sm font-bold text-slate-300">Missing information <span className="font-normal text-slate-500">— one item per line</span><textarea rows={4} disabled={!canManage || busy !== null} value={missingInformation} onChange={event => setMissingInformation(event.target.value)} placeholder={'Trading address\nLogo files\nService price list'} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none placeholder:text-slate-600 focus:border-violet-400 disabled:opacity-60" /></label>
        <div className="mt-5 grid gap-5 md:grid-cols-2"><label className="block text-sm font-bold text-slate-300">Internal agency notes<textarea rows={5} disabled={!canManage || busy !== null} value={internalNotes} onChange={event => setInternalNotes(event.target.value)} placeholder="Private delivery context, risks and decisions." className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none placeholder:text-slate-600 focus:border-violet-400 disabled:opacity-60" /></label><label className="block text-sm font-bold text-slate-300">Client-visible notes<textarea rows={5} disabled={!canManage || busy !== null} value={clientVisibleNotes} onChange={event => setClientVisibleNotes(event.target.value)} placeholder="A clear update suitable for the client." className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none placeholder:text-slate-600 focus:border-violet-400 disabled:opacity-60" /></label></div>
        {canManage ? <div className="mt-6 flex justify-end"><button disabled={busy !== null} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-black text-white hover:bg-violet-500 disabled:opacity-50"><Save className="h-4 w-4" />{busy === 'plan' ? 'Saving plan…' : 'Save onboarding plan'}</button></div> : null}
      </form>

      <section className={`${surface} overflow-hidden`}>
        <div className="border-b border-slate-800 px-5 py-5 sm:px-6"><div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-200"><ShieldCheck className="h-5 w-5" /></div><div><p className="text-xs font-black uppercase tracking-widest text-slate-500">Launch readiness</p><h2 className="mt-1 text-xl font-black text-white">Technical and commercial checks</h2><p className="mt-1 text-sm text-slate-500">These checks use live workspace records rather than manually ticked stages.</p></div></div></div>
        {launchChecks.length ? <div className="divide-y divide-slate-800">{launchChecks.map(check => <div key={check.checkKey} className="flex items-start gap-3 px-5 py-4 sm:px-6"><span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${check.status === 'PASS' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-200'}`}>{check.status === 'PASS' ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-black text-white">{check.checkKey.replaceAll('_', ' ')}</p><StatusBadge value={check.status} /></div><p className="mt-1 text-xs leading-5 text-slate-500">{check.detail}</p></div></div>)}</div> : <div className="px-6 py-12 text-center"><ShieldCheck className="mx-auto h-8 w-8 text-slate-600" /><p className="mt-3 font-black text-white">Launch checks have not been run</p><p className="mt-1 text-sm text-slate-500">Run them after the core setup records are in place.</p></div>}
        <div className="border-t border-slate-800 p-5 sm:p-6"><div className={`rounded-2xl border p-4 ${launchChecks.length && failedChecks.length === 0 ? 'border-emerald-400/20 bg-emerald-400/10' : 'border-slate-800 bg-slate-950/70'}`}><div className="flex items-start gap-3">{launchChecks.length && failedChecks.length === 0 ? <Sparkles className="mt-0.5 h-5 w-5 text-emerald-200" /> : <Clock3 className="mt-0.5 h-5 w-5 text-slate-500" />}<div><p className={`font-black ${launchChecks.length && failedChecks.length === 0 ? 'text-emerald-100' : 'text-white'}`}>{launchChecks.length ? failedChecks.length === 0 ? 'Ready to launch' : `${failedChecks.length} checks need attention` : 'Readiness not yet confirmed'}</p><p className="mt-1 text-sm leading-6 text-slate-500">The launch action will always run these checks again before activation.</p></div></div></div></div>
      </section>
    </div>

    <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5 sm:p-6"><div className="flex items-start gap-3"><FileText className="mt-0.5 h-5 w-5 text-slate-500" /><div><h2 className="font-black text-white">How stage completion works</h2><p className="mt-1 text-sm leading-6 text-slate-500">Stage statuses communicate operational progress. Launch checks independently verify the owner, location, service, setup fee, direct debit, subscription, Stripe connection and all pre-launch stages. Marking a stage complete never bypasses those live checks.</p></div></div></section>
  </div>;
};

export default AgencyWorkspaceOnboardingPage;
