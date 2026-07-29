import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'lucide-react';
import { useParams } from 'react-router';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';

type StageStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'READY' | 'COMPLETE' | 'SKIPPED';

type Stage = {
  id: string;
  stageKey: string;
  sequence: number;
  status: StageStatus;
  blockerNote?: string | null;
  dueAt?: string | null;
  notes?: string | null;
};

type LaunchCheck = {
  checkKey: string;
  status: 'PASS' | 'FAIL';
  detail: string;
};

type Onboarding = {
  id: string;
  status: string;
  currentStage: string;
  completionPercentage: number;
  targetLaunchAt?: string | null;
  nextAction?: string | null;
  internalNotes?: string | null;
  clientVisibleNotes?: string | null;
  missingInformation?: string[] | null;
  stages: Stage[];
  checks?: unknown[];
};

type Tenant = {
  id: string;
  name: string;
  lifecycleStatus: string;
  subdomain: string;
};

type StageDefinition = {
  title: string;
  description: string;
  evidence: string;
};

const stageDefinitions: Record<string, StageDefinition> = {
  SALE_HANDOVER: {
    title: 'Sales handover',
    description: 'Confirm the package, primary contact, scope, promises and ownership before delivery begins.',
    evidence: 'The agreed scope and commercial context are clear to the delivery team.',
  },
  CONTRACT: {
    title: 'Contract',
    description: 'Confirm that the client agreement has been issued, signed and stored.',
    evidence: 'The signed agreement has been verified.',
  },
  SETUP_FEE: {
    title: 'Setup fee',
    description: 'Confirm that the setup payment has been received or formally waived.',
    evidence: 'The launch check verifies the live billing record independently.',
  },
  DIRECT_DEBIT: {
    title: 'Direct debit',
    description: 'Set up the recurring subscription mandate and confirm it is active.',
    evidence: 'The launch check requires an active GoCardless mandate.',
  },
  BUSINESS_PROFILE: {
    title: 'Business profile',
    description: 'Capture the business description, address, audience, service area and selling points.',
    evidence: 'The operating profile is accurate enough to configure the workspace.',
  },
  BRAND_ASSETS: {
    title: 'Brand assets',
    description: 'Collect and approve the logo, colours, imagery, fonts and tone of voice.',
    evidence: 'Approved assets are available to the delivery team.',
  },
  CATALOGUE: {
    title: 'Services and catalogue',
    description: 'Create services, durations, prices, deposits and booking rules.',
    evidence: 'The launch check requires at least one active service.',
  },
  TEAM_AND_LOCATIONS: {
    title: 'Team and locations',
    description: 'Add locations, staff, roles, working hours and availability.',
    evidence: 'The launch check requires at least one active location.',
  },
  PAYMENTS: {
    title: 'Appointment payments',
    description: 'Connect and verify Stripe for deposits and appointment payments.',
    evidence: 'The launch check requires Stripe Connect to be ready.',
  },
  COMMUNICATIONS: {
    title: 'Communications',
    description: 'Review confirmations, reminders, sender details and client-facing messages.',
    evidence: 'Email and SMS behaviour has been checked with the client.',
  },
  TRAINING: {
    title: 'Training and handover',
    description: 'Train the client on daily tasks, support, security and account ownership.',
    evidence: 'The owner can complete core operational tasks unaided.',
  },
  LAUNCH: {
    title: 'Final launch',
    description: 'Resolve every live launch check and activate the workspace.',
    evidence: 'This stage completes automatically when the workspace is launched.',
  },
};

const allStatuses: Array<{ value: StageStatus; label: string }> = [
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'READY', label: 'Ready to complete' },
  { value: 'COMPLETE', label: 'Complete' },
  { value: 'SKIPPED', label: 'Skipped' },
];

const surface = 'rounded-3xl border border-slate-800/90 bg-slate-900/80 shadow-[0_24px_80px_rgba(2,6,23,0.28)]';

const normaliseChecks = (items: unknown[] = []): LaunchCheck[] => items.map(item => {
  const check = item as Record<string, unknown>;
  const ok = check.ok === true || check.status === 'PASS';
  return {
    checkKey: String(check.checkKey ?? check.key ?? 'UNKNOWN_CHECK'),
    status: ok ? 'PASS' : 'FAIL',
    detail: String(check.detail ?? 'No check detail was returned.'),
  };
});

const dateValue = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : '';
const displayDate = (value?: string | null) => value
  ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : 'Not set';

const statusTone = (value: string) => {
  if (['ACTIVE', 'COMPLETE', 'PASS'].includes(value)) return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
  if (['IN_PROGRESS', 'READY', 'ONBOARDING'].includes(value)) return 'border-violet-400/30 bg-violet-400/10 text-violet-200';
  if (['BLOCKED', 'FAIL'].includes(value)) return 'border-rose-400/30 bg-rose-400/10 text-rose-200';
  if (value === 'SKIPPED') return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
  return 'border-slate-700 bg-slate-800/70 text-slate-300';
};

const StatusBadge = ({ value }: { value: string }) => (
  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusTone(value)}`}>
    {value.replaceAll('_', ' ')}
  </span>
);

export const AgencyWorkspaceOnboardingManager: React.FC = () => {
  const { tenantId } = useParams();
  const { session } = useAgencyAuth();
  const canManage = session?.capabilities.includes('tenants.manage') ?? false;

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
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
  const [checks, setChecks] = useState<LaunchCheck[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const planHydrated = useRef(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setLoadError('');
    try {
      const [tenantResult, onboardingResult] = await Promise.all([
        agencyFetch(`/tenants/${tenantId}`) as Promise<{ tenant: Tenant }>,
        agencyFetch(`/tenants/${tenantId}/onboarding`) as Promise<Onboarding>,
      ]);
      setTenant(tenantResult.tenant);
      setOnboarding(onboardingResult);
      setChecks(normaliseChecks(onboardingResult.checks ?? []));
      if (!planHydrated.current) {
        setTargetLaunchAt(dateValue(onboardingResult.targetLaunchAt));
        setNextAction(onboardingResult.nextAction ?? '');
        setMissingInformation((onboardingResult.missingInformation ?? []).join('\n'));
        setInternalNotes(onboardingResult.internalNotes ?? '');
        setClientVisibleNotes(onboardingResult.clientVisibleNotes ?? '');
        planHydrated.current = true;
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'The onboarding workspace could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const stages = useMemo(() => onboarding?.stages ?? [], [onboarding]);
  const selectedStage = useMemo(() => {
    if (!stages.length) return null;
    return stages.find(stage => stage.stageKey === selectedKey)
      ?? stages.find(stage => !['COMPLETE', 'SKIPPED'].includes(stage.status))
      ?? stages[stages.length - 1];
  }, [selectedKey, stages]);

  useEffect(() => {
    if (!selectedStage) return;
    setSelectedKey(selectedStage.stageKey);
    setStageStatus(selectedStage.status);
    setStageDueAt(dateValue(selectedStage.dueAt));
    setStageNotes(selectedStage.notes ?? '');
    setBlockerNote(selectedStage.blockerNote ?? '');
  }, [selectedStage]);

  const chooseStage = (stage: Stage) => {
    setSelectedKey(stage.stageKey);
    setStageStatus(stage.status);
    setStageDueAt(dateValue(stage.dueAt));
    setStageNotes(stage.notes ?? '');
    setBlockerNote(stage.blockerNote ?? '');
    setNotice('');
    setActionError('');
  };

  const saveStageWithStatus = async (status: StageStatus) => {
    if (!tenantId || !selectedStage || busy) return;
    if (status === 'BLOCKED' && blockerNote.trim().length === 0) {
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
          status,
          dueAt: stageDueAt ? `${stageDueAt}T12:00:00.000Z` : null,
          notes: stageNotes.trim() || null,
          blockerCode: status === 'BLOCKED' ? 'MANUAL_BLOCKER' : null,
          blockerNote: status === 'BLOCKED' ? blockerNote.trim() : null,
        }),
      });
      setNotice(status === 'COMPLETE'
        ? `${stageDefinitions[selectedStage.stageKey]?.title ?? selectedStage.stageKey} completed.`
        : `${stageDefinitions[selectedStage.stageKey]?.title ?? selectedStage.stageKey} updated.`);
      if (status === 'COMPLETE') setSelectedKey(null);
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The onboarding stage could not be updated.');
    } finally {
      setBusy(null);
    }
  };

  const saveStage = async (event: React.FormEvent) => {
    event.preventDefault();
    await saveStageWithStatus(stageStatus);
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
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The onboarding plan could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const runLaunchChecks = async () => {
    if (!tenantId || busy) return false;
    setBusy('checks');
    setNotice('');
    setActionError('');
    try {
      const result = await agencyFetch(`/tenants/${tenantId}/launch-checks`, { method: 'POST' });
      const normalised = normaliseChecks(result.checks ?? []);
      setChecks(normalised);
      const failed = normalised.filter(check => check.status === 'FAIL');
      setNotice(failed.length ? `${failed.length} launch checks still need attention.` : 'All launch checks passed. The workspace is ready to activate.');
      return failed.length === 0;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Launch checks could not be completed.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const launchWorkspace = async () => {
    if (!tenantId || busy || !tenant) return;
    setBusy('launch');
    setNotice('');
    setActionError('');
    try {
      const result = await agencyFetch(`/tenants/${tenantId}/launch-checks`, { method: 'POST' });
      const normalised = normaliseChecks(result.checks ?? []);
      setChecks(normalised);
      const failed = normalised.filter(check => check.status === 'FAIL');
      if (failed.length) {
        setNotice(`${failed.length} launch checks still need attention.`);
        return;
      }
      if (!window.confirm(`Launch ${tenant.name} now? The client workspace will become active.`)) return;
      await agencyFetch(`/tenants/${tenantId}/launch`, { method: 'POST' });
      setNotice('The client workspace is now active.');
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The workspace could not be launched.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <section className={`${surface} p-8`}><div className="flex items-center gap-3 text-slate-400"><div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-violet-400" /><span className="text-sm font-bold">Loading setup and launch…</span></div></section>;

  if (loadError || !tenant || !onboarding || !selectedStage) {
    return <section className={`${surface} p-8`}><div role="alert" className="flex items-start gap-3 text-rose-200"><CircleAlert className="mt-0.5 h-5 w-5" /><div><p className="font-black">Setup and launch could not be loaded</p><p className="mt-1 text-sm text-rose-200/70">{loadError || 'No onboarding record was found.'}</p></div></div></section>;
  }

  const definition = stageDefinitions[selectedStage.stageKey] ?? {
    title: selectedStage.stageKey.replaceAll('_', ' '),
    description: 'Complete the operational work required for this stage.',
    evidence: 'Record enough evidence for another operator to understand the decision.',
  };
  const completeCount = stages.filter(stage => ['COMPLETE', 'SKIPPED'].includes(stage.status)).length;
  const blockerCount = stages.filter(stage => stage.status === 'BLOCKED').length;
  const failedChecks = checks.filter(check => check.status === 'FAIL');
  const statusOptions = selectedStage.stageKey === 'LAUNCH'
    ? allStatuses.filter(option => !['COMPLETE', 'SKIPPED'].includes(option.value))
    : allStatuses;

  return <div className="space-y-7">
    <section className="rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-500/15 via-slate-900 to-slate-950 p-6 shadow-2xl sm:p-8">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl"><div className="flex flex-wrap gap-2"><StatusBadge value={tenant.lifecycleStatus} /><StatusBadge value={onboarding.status} /></div><p className="mt-4 text-xs font-black uppercase tracking-[0.22em] text-violet-300">{tenant.name}</p><h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Setup and launch</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Manage every onboarding stage, preserve the evidence behind decisions and use live launch checks before activation.</p></div>
        {canManage ? <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void runLaunchChecks()} disabled={busy !== null} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-black text-slate-200 hover:bg-slate-800 disabled:opacity-50"><ShieldCheck className="h-4 w-4" />{busy === 'checks' ? 'Checking…' : 'Run launch checks'}</button><button type="button" onClick={() => void launchWorkspace()} disabled={busy !== null || tenant.lifecycleStatus === 'ACTIVE'} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50"><Rocket className="h-4 w-4" />{tenant.lifecycleStatus === 'ACTIVE' ? 'Workspace active' : busy === 'launch' ? 'Launching…' : 'Check and launch'}</button></div> : null}
      </div>
      <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_auto]"><div><div className="flex justify-between text-xs font-black"><span className="text-slate-400">{completeCount} of {stages.length} stages complete</span><span className="text-violet-200">{onboarding.completionPercentage}%</span></div><div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label={`${onboarding.completionPercentage}% complete`} aria-valuenow={onboarding.completionPercentage} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400" style={{ width: `${Math.max(onboarding.completionPercentage, 2)}%` }} /></div></div><div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 font-bold text-slate-300">Target: {displayDate(onboarding.targetLaunchAt)}</span><span className={`rounded-full border px-3 py-2 font-bold ${blockerCount ? 'border-rose-400/30 bg-rose-400/10 text-rose-200' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'}`}>{blockerCount ? `${blockerCount} blocked` : 'No blocked stages'}</span></div></div>
    </section>

    {notice ? <p role="status" className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm font-bold text-emerald-100">{notice}</p> : null}
    {actionError ? <p role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">{actionError}</p> : null}

    <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <section className={`${surface} overflow-hidden`}><div className="border-b border-slate-800 px-5 py-5 sm:px-6"><p className="text-xs font-black uppercase tracking-widest text-slate-500">Onboarding journey</p><h2 className="mt-1 text-xl font-black text-white">Choose a stage to manage</h2></div><div className="divide-y divide-slate-800">{stages.map(stage => {
        const item = stageDefinitions[stage.stageKey];
        const selected = stage.stageKey === selectedStage.stageKey;
        const complete = ['COMPLETE', 'SKIPPED'].includes(stage.status);
        return <button key={stage.id} type="button" onClick={() => chooseStage(stage)} aria-current={selected ? 'step' : undefined} className={`flex w-full items-start gap-4 px-5 py-4 text-left transition sm:px-6 ${selected ? 'bg-violet-500/10' : 'hover:bg-slate-800/45'}`}><span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${complete ? 'bg-emerald-500/15 text-emerald-300' : stage.status === 'BLOCKED' ? 'bg-rose-500/15 text-rose-200' : selected ? 'bg-violet-500 text-white' : 'bg-slate-800 text-slate-400'}`}>{complete ? <CheckCircle2 className="h-4 w-4" /> : <span className="text-xs font-black">{stage.sequence}</span>}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-white">{item?.title ?? stage.stageKey.replaceAll('_', ' ')}</strong><StatusBadge value={stage.status} /></span><span className="mt-1 block text-xs leading-5 text-slate-500">{stage.blockerNote || item?.description}</span></span><ArrowRight className={`mt-2 h-4 w-4 shrink-0 ${selected ? 'text-violet-300' : 'text-slate-700'}`} /></button>;
      })}</div></section>

      <form onSubmit={saveStage} className={`${surface} p-5 sm:p-6`}><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-violet-300">Stage {selectedStage.sequence} of {stages.length}</p><h2 className="mt-2 text-2xl font-black text-white">{definition.title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{definition.description}</p></div><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-500/15 text-violet-200"><ClipboardCheck className="h-5 w-5" /></div></div>
        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-4"><p className="text-xs font-black uppercase tracking-wider text-slate-500">Completion evidence</p><p className="mt-2 text-sm leading-6 text-slate-300">{definition.evidence}</p></div>
        <div className="mt-6 grid gap-5 md:grid-cols-2"><label className="block text-sm font-bold text-slate-300">Stage status<select disabled={!canManage || busy !== null} value={stageStatus} onChange={event => setStageStatus(event.target.value as StageStatus)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-violet-400 disabled:opacity-60">{statusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="block text-sm font-bold text-slate-300">Due date<input disabled={!canManage || busy !== null} type="date" value={stageDueAt} onChange={event => setStageDueAt(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-violet-400 disabled:opacity-60" /></label></div>
        {stageStatus === 'BLOCKED' ? <label className="mt-5 block text-sm font-bold text-rose-100">What is blocking this stage?<textarea required rows={3} disabled={!canManage || busy !== null} value={blockerNote} onChange={event => setBlockerNote(event.target.value)} placeholder="Describe the missing decision, access, payment or information." className="mt-2 w-full rounded-xl border border-rose-500/40 bg-rose-950/20 p-3 text-white outline-none placeholder:text-rose-200/40 focus:border-rose-300 disabled:opacity-60" /></label> : null}
        <label className="mt-5 block text-sm font-bold text-slate-300">Stage notes<textarea rows={5} disabled={!canManage || busy !== null} value={stageNotes} onChange={event => setStageNotes(event.target.value)} placeholder="Record decisions, evidence, links or anything the next operator needs." className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none placeholder:text-slate-600 focus:border-violet-400 disabled:opacity-60" /></label>
        {selectedStage.stageKey === 'LAUNCH' ? <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4"><div className="flex items-start gap-3"><Flag className="mt-0.5 h-5 w-5 text-amber-200" /><div><p className="font-black text-amber-100">Launch completes automatically</p><p className="mt-1 text-sm leading-6 text-amber-100/70">Run the live checks and use <strong>Check and launch</strong>. The final stage cannot be manually marked complete.</p></div></div></div> : null}
        {canManage ? <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="submit" disabled={busy !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 text-sm font-black text-slate-200 hover:bg-slate-800 disabled:opacity-50"><Save className="h-4 w-4" />{busy === 'stage' ? 'Saving…' : 'Save stage'}</button>{selectedStage.stageKey !== 'LAUNCH' && !['COMPLETE', 'SKIPPED'].includes(selectedStage.status) ? <button type="button" disabled={busy !== null} onClick={() => void saveStageWithStatus('COMPLETE')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />Complete and continue</button> : null}</div> : <p className="mt-6 text-sm text-slate-500">You have read-only access to this onboarding record.</p>}
      </form>
    </div>

    <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
      <form onSubmit={savePlan} className={`${surface} p-5 sm:p-6`}><div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-500/15 text-violet-200"><CalendarDays className="h-5 w-5" /></div><div><p className="text-xs font-black uppercase tracking-widest text-slate-500">Overall plan</p><h2 className="mt-1 text-xl font-black text-white">Ownership and next action</h2><p className="mt-1 text-sm text-slate-500">Keep the onboarding understandable without opening every stage.</p></div></div>
        <div className="mt-6 grid gap-5 md:grid-cols-2"><label className="block text-sm font-bold text-slate-300">Target launch date<input disabled={!canManage || busy !== null} type="date" value={targetLaunchAt} onChange={event => setTargetLaunchAt(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-violet-400 disabled:opacity-60" /></label><label className="block text-sm font-bold text-slate-300">Next action<input disabled={!canManage || busy !== null} value={nextAction} onChange={event => setNextAction(event.target.value)} placeholder="e.g. Confirm the signed agreement" className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none placeholder:text-slate-600 focus:border-violet-400 disabled:opacity-60" /></label></div>
        <label className="mt-5 block text-sm font-bold text-slate-300">Missing information <span className="font-normal text-slate-500">— one item per line</span><textarea rows={4} disabled={!canManage || busy !== null} value={missingInformation} onChange={event => setMissingInformation(event.target.value)} placeholder={'Trading address\nLogo files\nService price list'} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none placeholder:text-slate-600 focus:border-violet-400 disabled:opacity-60" /></label>
        <div className="mt-5 grid gap-5 md:grid-cols-2"><label className="block text-sm font-bold text-slate-300">Internal agency notes<textarea rows={5} disabled={!canManage || busy !== null} value={internalNotes} onChange={event => setInternalNotes(event.target.value)} placeholder="Private delivery context, risks and decisions." className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none placeholder:text-slate-600 focus:border-violet-400 disabled:opacity-60" /></label><label className="block text-sm font-bold text-slate-300">Client-visible notes<textarea rows={5} disabled={!canManage || busy !== null} value={clientVisibleNotes} onChange={event => setClientVisibleNotes(event.target.value)} placeholder="A clear update suitable for the client." className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none placeholder:text-slate-600 focus:border-violet-400 disabled:opacity-60" /></label></div>
        {canManage ? <div className="mt-6 flex justify-end"><button disabled={busy !== null} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-black text-white hover:bg-violet-500 disabled:opacity-50"><Save className="h-4 w-4" />{busy === 'plan' ? 'Saving plan…' : 'Save onboarding plan'}</button></div> : null}
      </form>

      <section className={`${surface} overflow-hidden`}><div className="border-b border-slate-800 px-5 py-5 sm:px-6"><div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-200"><ShieldCheck className="h-5 w-5" /></div><div><p className="text-xs font-black uppercase tracking-widest text-slate-500">Launch readiness</p><h2 className="mt-1 text-xl font-black text-white">Live technical and commercial checks</h2><p className="mt-1 text-sm text-slate-500">These read actual workspace records rather than relying on manual ticks.</p></div></div></div>
        {checks.length ? <div className="divide-y divide-slate-800">{checks.map(check => <div key={check.checkKey} className="flex items-start gap-3 px-5 py-4 sm:px-6"><span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${check.status === 'PASS' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-200'}`}>{check.status === 'PASS' ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-black text-white">{check.checkKey.replaceAll('_', ' ')}</p><StatusBadge value={check.status} /></div><p className="mt-1 text-xs leading-5 text-slate-500">{check.detail}</p></div></div>)}</div> : <div className="px-6 py-12 text-center"><ShieldCheck className="mx-auto h-8 w-8 text-slate-600" /><p className="mt-3 font-black text-white">Launch checks have not been run</p><p className="mt-1 text-sm text-slate-500">Run them after the core setup records are in place.</p></div>}
        <div className="border-t border-slate-800 p-5 sm:p-6"><div className={`rounded-2xl border p-4 ${checks.length && failedChecks.length === 0 ? 'border-emerald-400/20 bg-emerald-400/10' : 'border-slate-800 bg-slate-950/70'}`}><div className="flex items-start gap-3">{checks.length && failedChecks.length === 0 ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-200" /> : <Clock3 className="mt-0.5 h-5 w-5 text-slate-500" />}<div><p className={`font-black ${checks.length && failedChecks.length === 0 ? 'text-emerald-100' : 'text-white'}`}>{checks.length ? failedChecks.length === 0 ? 'Ready to launch' : `${failedChecks.length} checks need attention` : 'Readiness not yet confirmed'}</p><p className="mt-1 text-sm leading-6 text-slate-500">The launch action always runs every check again before activation.</p></div></div></div></div>
      </section>
    </div>

    <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5 sm:p-6"><div className="flex items-start gap-3"><FileText className="mt-0.5 h-5 w-5 text-slate-500" /><div><h2 className="font-black text-white">Manual progress never bypasses launch safety</h2><p className="mt-1 text-sm leading-6 text-slate-500">The final checks independently verify the active owner, location, service, setup fee, direct debit, subscription, Stripe connection and every pre-launch stage.</p></div></div></section>
  </div>;
};

export default AgencyWorkspaceOnboardingManager;
