import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgePoundSterling,
  Building2,
  CalendarCheck2,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  FileCheck2,
  Globe2,
  Layers3,
  Loader2,
  Palette,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Users,
  WandSparkles,
  Wrench,
} from 'lucide-react';
import { Link, useParams } from 'react-router';
import {
  SITE_DESIGN_PRESETS,
  type SiteDesignPreset,
  type SiteDesignPresetKey,
} from '@ks-os/contracts';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';

const PAGE_TYPES = [
  'HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'LOCATION_DETAIL', 'ABOUT', 'TEAM_HUB',
  'TEAM_DETAIL', 'CONTACT', 'FAQ', 'POLICIES', 'BOOKING',
] as const;
const DEFAULT_PAGE_TYPES = ['HOME', 'SERVICE_HUB', 'ABOUT', 'CONTACT', 'POLICIES', 'BOOKING'];
const TERMINAL_RUNS = new Set(['READY', 'FAILED', 'PARTIALLY_FAILED', 'ACTION_REQUIRED', 'CANCELLED']);
const EDITABLE_DRAFTS = new Set(['DRAFT', 'VALIDATING', 'READY_TO_PROVISION']);
const COMPLETE_STAGE_STATUSES = new Set(['COMPLETE', 'SKIPPED']);
const COMMERCIAL_STAGE_KEYS = ['SALE_HANDOVER', 'CONTRACT', 'SETUP_FEE', 'DIRECT_DEBIT'] as const;

type DesignSource = 'KS_NATIVE' | 'GOOGLE_STITCH' | 'LICENSED_TEMPLATE';
type SectionVariant = 'editorial' | 'grid' | 'split' | 'compact' | 'standard' | 'featured' | 'quiet';

type PaymentPreference = {
  allowPayLater: boolean;
  onlinePaymentsRequested: boolean;
  depositCollectionRequested: boolean;
};

type OnboardingStage = {
  id: string;
  stageKey: string;
  sequence: number;
  status: string;
  dueAt?: string | null;
  notes?: string | null;
  blockerNote?: string | null;
};

type Onboarding = {
  status: string;
  completionPercentage: number;
  targetLaunchAt?: string | null;
  nextAction?: string | null;
  missingInformation?: string[] | null;
  stages: OnboardingStage[];
};

const commercialDefinitions: Record<string, { title: string; description: string; owner: string }> = {
  SALE_HANDOVER: { title: 'Sales handover', description: 'Confirm the package, scope, primary contact and promises made before automation starts.', owner: 'Agency' },
  CONTRACT: { title: 'Contract', description: 'Confirm the agreement is signed and the approved scope is safe to use for delivery.', owner: 'Client and agency' },
  SETUP_FEE: { title: 'Setup fee', description: 'Confirm the setup fee has been received or formally waived.', owner: 'Agency' },
  DIRECT_DEBIT: { title: 'Direct Debit', description: 'Confirm the recurring subscription mandate is active or record the client action still required.', owner: 'Client' },
};

const tone: Record<string, string> = {
  READY: 'border-emerald-700 bg-emerald-950/35 text-emerald-200',
  COMPLETE: 'border-emerald-700 bg-emerald-950/35 text-emerald-200',
  ACTIVE: 'border-emerald-700 bg-emerald-950/35 text-emerald-200',
  PASS: 'border-emerald-700 bg-emerald-950/35 text-emerald-200',
  ACTION_REQUIRED: 'border-amber-700 bg-amber-950/35 text-amber-200',
  WARNING: 'border-amber-700 bg-amber-950/35 text-amber-200',
  BLOCKED: 'border-rose-800 bg-rose-950/35 text-rose-200',
  BLOCKING: 'border-rose-800 bg-rose-950/35 text-rose-200',
  FAILED: 'border-rose-800 bg-rose-950/35 text-rose-200',
  FAIL: 'border-rose-800 bg-rose-950/35 text-rose-200',
  PARTIALLY_FAILED: 'border-rose-800 bg-rose-950/35 text-rose-200',
  IN_PROGRESS: 'border-violet-700 bg-violet-950/35 text-violet-200',
  QUEUED: 'border-violet-700 bg-violet-950/35 text-violet-200',
  READY_TO_PROVISION: 'border-violet-700 bg-violet-950/35 text-violet-200',
  NOT_STARTED: 'border-slate-800 bg-slate-950 text-slate-400',
  PENDING: 'border-slate-800 bg-slate-950 text-slate-400',
  SKIPPED: 'border-slate-700 bg-slate-900 text-slate-300',
};

const label = (value?: string) => (value || 'NOT_STARTED').replaceAll('_', ' ');
const statusClass = (value?: string) => tone[value || 'NOT_STARTED'] || tone.IN_PROGRESS;

function Status({ value }: { value?: string }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusClass(value)}`}>{label(value)}</span>;
}

function Panel({ title, description, action, children }: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return <section className="rounded-3xl border border-slate-800 bg-slate-900/85 p-5 shadow-xl shadow-slate-950/20 sm:p-6">
    <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div><h2 className="text-base font-black text-white">{title}</h2>{description ? <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">{description}</p> : null}</div>
      {action}
    </div>
    <div className="pt-5">{children}</div>
  </section>;
}

function Metric({ label: metricLabel, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{metricLabel}</p><p className="mt-2 text-lg font-black text-white">{value}</p>{detail ? <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p> : null}</div>;
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-slate-700 bg-slate-950 p-4 text-xs leading-5 text-slate-500">{children}</p>;
}

function StageCard({ index, title, detail, ready, icon: Icon }: { index: number; title: string; detail: string; ready: boolean; icon: React.ElementType }) {
  return <li className={`rounded-2xl border p-4 ${ready ? tone.READY : tone.NOT_STARTED}`}><div className="flex items-center justify-between"><Icon className="h-5 w-5" /><span className="text-[10px] font-black">{index}/6</span></div><strong className="mt-4 block text-xs">{title}</strong><p className="mt-1 text-[11px] leading-4 opacity-70">{detail}</p></li>;
}

function DesignSourceCard({ source, selected, disabled, title, description, badge, icon: Icon, onSelect }: {
  source: DesignSource;
  selected: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  badge: string;
  icon: React.ElementType;
  onSelect: (source: DesignSource) => void;
}) {
  return <button
    type="button"
    disabled={disabled}
    aria-pressed={selected}
    onClick={() => onSelect(source)}
    className={`min-h-40 rounded-2xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 disabled:cursor-not-allowed disabled:opacity-45 ${selected ? 'border-violet-500 bg-violet-950/35' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}
  >
    <span className="flex items-start justify-between gap-3"><Icon className="h-5 w-5 text-violet-300" /><span className="rounded-full border border-slate-700 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-400">{badge}</span></span>
    <strong className="mt-5 block text-sm text-white">{title}</strong>
    <span className="mt-2 block text-[11px] leading-5 text-slate-500">{description}</span>
  </button>;
}

export function AgencyWorkspaceLaunchPipeline() {
  const { tenantId } = useParams();
  const { session } = useAgencyAuth();
  const [detail, setDetail] = useState<any>(null);
  const [context, setContext] = useState<any>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [designSource, setDesignSource] = useState<DesignSource>('KS_NATIVE');
  const [presetKey, setPresetKey] = useState<SiteDesignPresetKey>('NORTHLIGHT');
  const [defaultSectionVariant, setDefaultSectionVariant] = useState<SectionVariant>('standard');
  const [templateReference, setTemplateReference] = useState('');
  const [pageTypes, setPageTypes] = useState<string[]>(DEFAULT_PAGE_TYPES);
  const [paymentPreference, setPaymentPreference] = useState<PaymentPreference>({ allowPayLater: true, onlinePaymentsRequested: false, depositCollectionRequested: false });
  const [launchChecks, setLaunchChecks] = useState<any[]>([]);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canManageStages = Boolean(session?.capabilities.includes('tenants.manage'));
  const canProvision = Boolean(session?.capabilities.includes('provisioning.create') && session.capabilities.includes('provisioning.update') && session.capabilities.includes('provisioning.execute'));

  const load = useCallback(async (showLoading = true) => {
    if (!tenantId) return;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const [nextDetail, nextContext, nextOnboarding] = await Promise.all([
        agencyFetch(`/tenants/${tenantId}`),
        agencyFetch(`/tenants/${tenantId}/delivery-context`),
        agencyFetch(`/tenants/${tenantId}/onboarding`),
      ]);
      setDetail(nextDetail);
      setContext(nextContext);
      setOnboarding(nextOnboarding);
      const draft = nextContext.draft;
      const savedDesign = draft?.pagePlan?.design;
      const inferredSource: DesignSource = savedDesign?.source
        || (draft?.templateSourceType === 'ENVATO_HTML' ? 'LICENSED_TEMPLATE' : draft?.templateSourceType === 'GOOGLE_STITCH' ? 'GOOGLE_STITCH' : 'KS_NATIVE');
      setDesignSource(inferredSource);
      setPresetKey(savedDesign?.presetKey || nextContext.designLibrary?.defaultPresetKey || 'NORTHLIGHT');
      setDefaultSectionVariant(savedDesign?.defaultSectionVariant || 'standard');
      setTemplateReference(current => current || (inferredSource === 'KS_NATIVE' ? '' : draft?.templateVersionReference || ''));
      setPageTypes(draft?.pagePlan?.requestedPageTypes?.length ? draft.pagePlan.requestedPageTypes : DEFAULT_PAGE_TYPES);
      setPaymentPreference(draft?.paymentPreference || { allowPayLater: true, onlinePaymentsRequested: false, depositCollectionRequested: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The client launch pipeline could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reference = context?.run?.reference;
    if (!reference || TERMINAL_RUNS.has(context.run.status)) return;
    const timer = window.setInterval(() => {
      void agencyFetch(`/provisioning-runs/${reference}`).then(run => {
        setContext((current: any) => current ? { ...current, run } : current);
        if (TERMINAL_RUNS.has(run.status)) void load(false);
      }).catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [context?.run?.reference, context?.run?.status, load]);

  const commercialStages = useMemo(() => {
    const stages = onboarding?.stages || [];
    return COMMERCIAL_STAGE_KEYS.map(stageKey => stages.find(stage => stage.stageKey === stageKey)).filter(Boolean) as OnboardingStage[];
  }, [onboarding]);

  const nativeTemplateReference = context?.designLibrary?.nativeTemplateVersionReference || '';
  const advancedTemplates = context?.approvedTemplates || [];
  const stitchTemplates = advancedTemplates.filter((template: any) => template.sourceType === 'GOOGLE_STITCH');
  const licensedTemplates = advancedTemplates.filter((template: any) => template.sourceType === 'ENVATO_HTML');
  const technicalTemplateReference = designSource === 'KS_NATIVE' ? nativeTemplateReference : templateReference;
  const presets: SiteDesignPreset[] = context?.designLibrary?.presets || SITE_DESIGN_PRESETS;
  const activeRun = Boolean(context?.run && !TERMINAL_RUNS.has(context.run.status));
  const run = context?.run;
  const tenant = detail?.tenant || context?.tenant;
  const workspaceActive = tenant?.lifecycleStatus === 'ACTIVE';
  const planLocked = Boolean(run || (context?.draft && !EDITABLE_DRAFTS.has(context.draft.status)));

  const draftBody = useMemo(() => context ? ({
    productionBriefReference: context.productionBrief?.reference,
    planVersionReference: context.plan?.versionReference,
    workspace: { name: context.tenant.name, subdomain: context.tenant.subdomain, timezone: context.tenant.timezone, currency: context.tenant.currency },
    templateVersionReference: technicalTemplateReference,
    pagePlan: {
      requestedPageTypes: pageTypes,
      preferredLayoutReferences: {},
      design: { source: designSource, presetKey, defaultSectionVariant },
    },
    paymentPreference,
  }) : null, [context, defaultSectionVariant, designSource, pageTypes, paymentPreference, presetKey, technicalTemplateReference]);

  const prerequisites = useMemo(() => [
    { label: 'Active plan assigned', ready: Boolean(context?.plan), action: 'Assign an active plan.' },
    { label: 'Production brief locked', ready: context?.productionBrief?.status === 'LOCKED_FOR_PROVISIONING', action: 'Approve and lock the production brief.' },
    { label: 'Approved facts ready', ready: context?.productionBrief?.readyForProvisioning === true, action: 'Resolve the remaining fact-finding issues.' },
    {
      label: designSource === 'KS_NATIVE' ? 'KS Native Component System ready' : 'Approved design source selected',
      ready: Boolean(technicalTemplateReference) && (designSource !== 'KS_NATIVE' || context?.designLibrary?.nativeTemplateReady === true),
      action: designSource === 'KS_NATIVE' ? 'Deploy the KS Native Component System migration.' : 'Select an approved design source.',
    },
  ], [context, designSource, technicalTemplateReference]);
  const blockingPrerequisites = prerequisites.filter(item => !item.ready);
  const readiness = context?.readiness || {};
  const source = context?.sourcePreview || { services: [], locations: [], staff: [] };

  const markStageComplete = async (stage: OnboardingStage) => {
    if (!tenantId || !canManageStages || busy) return;
    setBusy(`stage:${stage.stageKey}`); setError(''); setNotice('');
    try {
      await agencyFetch(`/tenants/${tenantId}/onboarding/${stage.stageKey}`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETE', dueAt: stage.dueAt || null, notes: stage.notes || null, blockerCode: null, blockerNote: null }) });
      setNotice(`${commercialDefinitions[stage.stageKey]?.title || label(stage.stageKey)} completed.`);
      await load(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The readiness gate could not be updated.'); }
    finally { setBusy(''); }
  };

  const buildWorkspaceAndWebsite = async () => {
    if (!tenantId || !context || !draftBody || busy || !canProvision) return;
    setBusy('build'); setError(''); setNotice('');
    try {
      if (blockingPrerequisites.length) throw new Error(blockingPrerequisites.map(item => item.action).join(' '));
      const currentDraft = context.draft;
      const editable = currentDraft?.reference && EDITABLE_DRAFTS.has(currentDraft.status);
      const draft = await agencyFetch(editable ? `/provisioning-drafts/${currentDraft.reference}` : '/provisioning-drafts', { method: editable ? 'PATCH' : 'POST', body: JSON.stringify(draftBody) });
      const validation = await agencyFetch(`/provisioning-drafts/${draft.reference}/validate`, { method: 'POST' });
      if (validation.status !== 'READY_TO_PROVISION') {
        const issues = (validation.blockingIssues || []).map((issue: any) => issue.message).filter(Boolean);
        throw new Error(issues.join(' ') || 'The delivery plan still has blocking issues.');
      }
      const keyName = `ks-os-delivery-idempotency:${draft.reference}`;
      const idempotencyKey = sessionStorage.getItem(keyName) || `agency-delivery:${draft.reference}:${crypto.randomUUID()}`;
      sessionStorage.setItem(keyName, idempotencyKey);
      await agencyFetch('/provisioning-runs', { method: 'POST', body: JSON.stringify({ provisioningDraftReference: draft.reference, idempotencyKey }) });
      setNotice(`Build started. KS OS will create booking, generate the website and apply the ${presets.find(item => item.key === presetKey)?.name || presetKey} design before review.`);
      await load(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The automated build could not be started.'); await load(false); }
    finally { setBusy(''); }
  };

  const retryProvisioning = async () => {
    if (!run?.reference || busy) return;
    setBusy('retry'); setError(''); setNotice('');
    try {
      await agencyFetch(`/provisioning-runs/${run.reference}/retry`, { method: 'POST', body: JSON.stringify({ reason: 'Retry requested from the client launch pipeline.' }) });
      setNotice('The failed or action-required step has been queued again. Completed work will not be duplicated.');
      await load(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The provisioning run could not be retried.'); }
    finally { setBusy(''); }
  };

  const runLaunchChecks = async () => {
    if (!tenantId || busy) return null;
    setBusy('checks'); setError(''); setNotice('');
    try {
      const result = await agencyFetch(`/tenants/${tenantId}/launch-checks`, { method: 'POST' });
      setLaunchChecks(result.checks || []);
      setNotice(result.ready ? 'All workspace launch checks passed.' : 'Launch checks found items that still need attention.');
      return result;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Launch checks could not be completed.'); return null; }
    finally { setBusy(''); }
  };

  const activateWorkspace = async () => {
    if (!tenantId || busy || workspaceActive) return;
    const result = await runLaunchChecks();
    if (!result?.ready) return;
    setBusy('launch'); setError('');
    try { await agencyFetch(`/tenants/${tenantId}/launch`, { method: 'POST' }); setNotice('The client workspace is active. Website publication remains controlled in Site Studio.'); await load(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The workspace could not be activated.'); }
    finally { setBusy(''); }
  };

  if (loading) return <div className="grid min-h-80 place-items-center rounded-3xl border border-slate-800 bg-slate-900"><p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading launch pipeline…</p></div>;
  if (!tenantId || !tenant || !context || !onboarding) return <p role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error || 'The client launch pipeline is unavailable.'}</p>;

  const commercialReady = commercialStages.length > 0 && commercialStages.every(stage => COMPLETE_STAGE_STATUSES.has(stage.status));
  const briefReady = context.productionBrief?.status === 'LOCKED_FOR_PROVISIONING' && context.productionBrief?.readyForProvisioning;
  const bookingReady = readiness.booking === 'READY';
  const websiteReady = readiness.website === 'READY';
  const reviewReady = readiness.review === 'READY';
  const automatedCompletions = [
    context.canonical?.serviceCount > 0 ? `${context.canonical.serviceCount} active services created` : null,
    context.canonical?.locationCount > 0 ? `${context.canonical.locationCount} active locations created` : null,
    context.canonical?.activeUserCount > 0 ? `${context.canonical.activeUserCount} active workspace users` : null,
    bookingReady ? 'Native booking configuration ready' : null,
    websiteReady ? 'Structured website draft ready' : null,
    reviewReady ? 'Internal review opened' : null,
  ].filter(Boolean) as string[];
  const needsAttention = [
    ...(context.draft?.validation?.blockingIssues || []).map((issue: any) => issue.message),
    ...(readiness.blockingIssues || []).map((issue: any) => issue.message),
    ...blockingPrerequisites.map(item => item.action),
    ...(['FAILED', 'PARTIALLY_FAILED', 'ACTION_REQUIRED'].includes(run?.status) ? [run?.safeMessage || 'The build has a step requiring attention.'] : []),
  ].filter(Boolean) as string[];
  const clientActions = commercialStages.filter(stage => !COMPLETE_STAGE_STATUSES.has(stage.status) && ['CONTRACT', 'DIRECT_DEBIT'].includes(stage.stageKey)).map(stage => commercialDefinitions[stage.stageKey]?.description || label(stage.stageKey));
  if (readiness.payments && readiness.payments !== 'READY' && !paymentPreference.allowPayLater) clientActions.push('Complete the online payment connection before launch.');

  return <div className="space-y-6">
    <section className="rounded-3xl border border-violet-800/60 bg-gradient-to-br from-violet-950 via-slate-950 to-slate-900 p-6 shadow-2xl sm:p-8">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl"><div className="flex flex-wrap gap-2"><Status value={tenant.lifecycleStatus} /><Status value={run?.status || context.draft?.status || onboarding.status} /></div><p className="mt-4 text-xs font-black uppercase tracking-[0.22em] text-violet-300">Automation-first client delivery</p><h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Launch pipeline</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Use one approved source to configure the workspace, build native booking, generate a KS-owned website and surface only the decisions that still need you or the client.</p></div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row xl:flex-col xl:items-end"><button type="button" onClick={() => void buildWorkspaceAndWebsite()} disabled={!canProvision || Boolean(busy) || activeRun || workspaceActive} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-black text-slate-950 shadow-lg shadow-emerald-950/30 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"><Sparkles className="h-4 w-4" />{busy === 'build' ? 'Preparing build…' : activeRun ? 'Build in progress' : workspaceActive ? 'Workspace active' : 'Build workspace and website'}</button><p className="max-w-xs text-right text-[11px] leading-4 text-slate-500">Creates or reuses booking records, builds the native site and applies the selected design before internal review.</p></div>
      </div>
    </section>

    {error ? <p role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p> : null}
    {notice ? <p role="status" className="rounded-2xl border border-emerald-800 bg-emerald-950/35 p-4 text-sm text-emerald-200">{notice}</p> : null}

    <ol aria-label="Client launch progress" className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StageCard index={1} title="Commercial ready" detail="Scope, contract and billing gates" ready={commercialReady} icon={FileCheck2} />
      <StageCard index={2} title="Approved source" detail="Locked brief and verified assets" ready={Boolean(briefReady)} icon={ShieldCheck} />
      <StageCard index={3} title="Native design plan" detail="Design system, pages and payments" ready={context.draft?.status === 'READY_TO_PROVISION' || Boolean(run)} icon={Palette} />
      <StageCard index={4} title="Automated build" detail="Workspace, booking and website" ready={run?.status === 'READY'} icon={Wrench} />
      <StageCard index={5} title="Internal review" detail="Preview, comments and approval" ready={reviewReady} icon={Globe2} />
      <StageCard index={6} title="Client launch" detail="Final checks and activation" ready={workspaceActive} icon={Rocket} />
    </ol>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
      <div className="space-y-6">
        <Panel title="1. Commercial and client gates" description="These are the manual confirmations KS OS cannot safely infer. Everything else should flow from approved data.">
          <div className="grid gap-3 md:grid-cols-2">{commercialStages.map(stage => { const definition = commercialDefinitions[stage.stageKey]; const complete = COMPLETE_STAGE_STATUSES.has(stage.status); return <article key={stage.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{definition?.owner || 'Agency'}</p><h3 className="mt-1 text-sm font-black text-white">{definition?.title || label(stage.stageKey)}</h3></div><Status value={stage.status} /></div><p className="mt-3 text-xs leading-5 text-slate-400">{stage.blockerNote || definition?.description}</p>{stage.notes ? <p className="mt-3 rounded-xl bg-slate-900 p-3 text-xs leading-5 text-slate-300">{stage.notes}</p> : null}{!complete && canManageStages ? <button type="button" disabled={Boolean(busy)} onClick={() => void markStageComplete(stage)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-700 px-3 text-xs font-black text-emerald-200 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />{busy === `stage:${stage.stageKey}` ? 'Saving…' : 'Confirm complete'}</button> : null}</article>; })}</div>
        </Panel>

        <Panel title="2. Approved business source" description="The locked production brief is the single source for the workspace and website. Raw or unapproved intake answers are not used." action={<Link to="/agency/fact-finding" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-700 px-3 text-xs font-black text-violet-200">Review facts <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <div className="grid gap-3 sm:grid-cols-3"><Metric label="Services approved" value={source.services.length} detail={source.services.length ? source.services.slice(0, 3).join(', ') : 'Add approved service names.'} /><Metric label="Locations approved" value={source.locations.length} detail={source.locations.length ? source.locations.slice(0, 3).join(', ') : 'Add approved trading locations.'} /><Metric label="Staff approved" value={source.staff.length} detail={source.staff.length ? source.staff.slice(0, 3).join(', ') : 'Add approved staff records.'} /></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className={`rounded-2xl border p-4 ${source.hasAvailability ? tone.READY : tone.ACTION_REQUIRED}`}><div className="flex items-center gap-2"><CalendarCheck2 className="h-4 w-4" /><strong className="text-xs">Availability</strong></div><p className="mt-2 text-xs opacity-75">{source.hasAvailability ? 'Approved opening hours or staff availability found.' : 'Availability still needs approval before booking can be ready.'}</p></div><div className={`rounded-2xl border p-4 ${source.hasBookingRules ? tone.READY : tone.ACTION_REQUIRED}`}><div className="flex items-center gap-2"><CircleDot className="h-4 w-4" /><strong className="text-xs">Booking rules</strong></div><p className="mt-2 text-xs opacity-75">{source.hasBookingRules ? 'Approved booking rules found.' : 'Booking rules still need approval.'}</p></div></div>
        </Panel>

        <Panel title="3. Native design and workspace plan" description="Choose an owned KS design system, pages and payment behaviour. The technical renderer is pinned automatically and never needs a client licence.">
          <fieldset disabled={activeRun || planLocked}>
            <legend className="text-xs font-black uppercase tracking-wide text-slate-400">Website design source</legend>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <DesignSourceCard source="KS_NATIVE" selected={designSource === 'KS_NATIVE'} title="KS Native Design Library" description="Owned components, unlimited reuse, accessible colour controls and one-click delivery." badge="Default" icon={Layers3} onSelect={setDesignSource} />
              <DesignSourceCard source="GOOGLE_STITCH" selected={designSource === 'GOOGLE_STITCH'} disabled={!stitchTemplates.length} title="Google Stitch design" description={stitchTemplates.length ? 'Use an approved Stitch conversion that has already been mapped to controlled KS renderers.' : 'Stitch API import is the next integration. No approved converted designs are available yet.'} badge={stitchTemplates.length ? 'Available' : 'Coming next'} icon={WandSparkles} onSelect={sourceValue => { setDesignSource(sourceValue); setTemplateReference(stitchTemplates[0]?.reference || ''); }} />
              <DesignSourceCard source="LICENSED_TEMPLATE" selected={designSource === 'LICENSED_TEMPLATE'} disabled={!licensedTemplates.length} title="Licensed template" description={licensedTemplates.length ? 'Use an approved agency-only template with its project-specific licence.' : 'No approved licensed templates are currently available.'} badge="Advanced" icon={Globe2} onSelect={sourceValue => { setDesignSource(sourceValue); setTemplateReference(licensedTemplates[0]?.reference || ''); }} />
            </div>
          </fieldset>

          {designSource === 'KS_NATIVE' ? <fieldset className="mt-6" disabled={activeRun || planLocked}>
            <legend className="text-xs font-black uppercase tracking-wide text-slate-400">Design system</legend>
            <p className="mt-1 text-xs leading-5 text-slate-500">The selected system is applied before the first preview. Colours and component variants remain editable in Site Studio.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{presets.map(preset => <button key={preset.key} type="button" aria-pressed={presetKey === preset.key} onClick={() => setPresetKey(preset.key)} className={`rounded-2xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${presetKey === preset.key ? 'border-violet-500 bg-violet-950/40' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}><span className="flex gap-1" aria-hidden="true">{[preset.theme.primaryColour, preset.theme.secondaryColour, preset.theme.accentColour, preset.theme.backgroundColour].map(colour => <span key={colour} className="h-6 flex-1 first:rounded-l-lg last:rounded-r-lg" style={{ backgroundColor: colour }} />)}</span><strong className="mt-3 block text-xs text-white">{preset.name}</strong><span className="mt-1 block text-[10px] leading-4 text-slate-500">{preset.description}</span></button>)}</div>
            <label className="mt-5 block max-w-sm text-xs font-bold text-slate-300">Default section treatment<select value={defaultSectionVariant} onChange={event => setDefaultSectionVariant(event.target.value as SectionVariant)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="standard">Balanced</option><option value="editorial">Editorial</option><option value="grid">Grid-led</option><option value="split">Split layout</option><option value="compact">Compact</option><option value="featured">Featured</option><option value="quiet">Quiet</option></select><span className="mt-1 block font-normal leading-5 text-slate-500">KS OS still chooses a suitable variation for heroes, services, trust, FAQs and calls to action.</span></label>
          </fieldset> : <label className="mt-6 block text-xs font-bold text-slate-300">Approved design<select value={templateReference} onChange={event => setTemplateReference(event.target.value)} disabled={activeRun || planLocked} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white disabled:opacity-50"><option value="">Select an approved design</option>{(designSource === 'GOOGLE_STITCH' ? stitchTemplates : licensedTemplates).map((template: any) => <option key={template.reference} value={template.reference}>{template.label}</option>)}</select></label>}

          <fieldset className="mt-6" disabled={activeRun || planLocked}><legend className="text-xs font-black uppercase tracking-wide text-slate-400">Website pages</legend><div className="mt-3 flex flex-wrap gap-2">{PAGE_TYPES.map(type => <label key={type} className={`rounded-xl border px-3 py-2 text-xs ${pageTypes.includes(type) ? 'border-violet-600 bg-violet-950/40 text-violet-200' : 'border-slate-800 bg-slate-950 text-slate-500'}`}><input type="checkbox" className="mr-2" checked={pageTypes.includes(type)} onChange={event => setPageTypes(current => event.target.checked ? [...current, type] : current.filter(item => item !== type))} />{label(type)}</label>)}</div></fieldset>
          <fieldset className="mt-5 grid gap-3 sm:grid-cols-3" disabled={activeRun || planLocked}><legend className="sr-only">Payment options</legend>{[['allowPayLater', 'Allow pay later'], ['onlinePaymentsRequested', 'Use online payments'], ['depositCollectionRequested', 'Collect deposits']].map(([key, text]) => <label key={key} className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300"><input type="checkbox" className="mr-2" checked={Boolean(paymentPreference[key as keyof PaymentPreference])} onChange={event => setPaymentPreference(current => ({ ...current, [key]: event.target.checked }))} />{text}</label>)}</fieldset>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">{prerequisites.map(item => <div key={item.label} className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${item.ready ? tone.READY : tone.ACTION_REQUIRED}`}>{item.ready ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}<span><strong>{item.label}</strong>{!item.ready ? <small className="mt-1 block opacity-75">{item.action}</small> : null}</span></div>)}</div>
        </Panel>

        <Panel title="4. Automated build" description="The durable worker creates booking before the website, applies the selected native design, resumes completed work on retry and surfaces only safe failure information." action={run ? <Status value={run.status} /> : null}>
          {!run ? <EmptyMessage>When the approved source and design plan are ready, use <strong className="text-white">Build workspace and website</strong>. KS OS will create the operational records, booking setup, native website and private review preview.</EmptyMessage> : <><div className="flex items-center justify-between text-xs text-slate-400"><span>{run.currentStep ? label(run.currentStep) : 'Waiting to start'}</span><strong className="text-white">{run.completionPercentage}%</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-950"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${run.completionPercentage}%` }} /></div><div className="mt-5 grid gap-2 md:grid-cols-2">{run.steps?.map((step: any) => <div key={step.key} className={`rounded-xl border p-3 text-xs ${statusClass(step.status)}`}><div className="flex items-start justify-between gap-3"><strong>{label(step.key)}</strong><span className="text-[10px] font-black">{label(step.status)}</span></div>{step.safeMessage ? <p className="mt-1 opacity-70">{step.safeMessage}</p> : null}</div>)}</div>{['FAILED', 'PARTIALLY_FAILED', 'ACTION_REQUIRED'].includes(run.status) ? <button type="button" disabled={Boolean(busy)} onClick={() => void retryProvisioning()} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-black text-white disabled:opacity-40"><RefreshCw className="h-4 w-4" />{busy === 'retry' ? 'Retrying…' : 'Retry required step'}</button> : null}</>}
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel title="Automation summary" description="What KS OS completed, what needs you and what needs the client."><div className="space-y-4"><div><div className="flex items-center gap-2 text-xs font-black text-emerald-300"><CheckCircle2 className="h-4 w-4" />Completed automatically</div><div className="mt-2 space-y-2">{automatedCompletions.length ? automatedCompletions.map(item => <p key={item} className="rounded-xl border border-emerald-900 bg-emerald-950/25 p-3 text-xs text-emerald-200">{item}</p>) : <EmptyMessage>Automated results will appear after provisioning starts.</EmptyMessage>}</div></div><div><div className="flex items-center gap-2 text-xs font-black text-amber-300"><Wrench className="h-4 w-4" />Needs your attention</div><div className="mt-2 space-y-2">{needsAttention.length ? [...new Set(needsAttention)].map(item => <p key={item} className="rounded-xl border border-amber-900 bg-amber-950/25 p-3 text-xs text-amber-200">{item}</p>) : <p className="rounded-xl border border-emerald-900 bg-emerald-950/25 p-3 text-xs text-emerald-200">No agency blockers detected.</p>}</div></div><div><div className="flex items-center gap-2 text-xs font-black text-violet-300"><Users className="h-4 w-4" />Client action required</div><div className="mt-2 space-y-2">{clientActions.length ? clientActions.map(item => <p key={item} className="rounded-xl border border-violet-900 bg-violet-950/25 p-3 text-xs text-violet-200">{item}</p>) : <p className="rounded-xl border border-emerald-900 bg-emerald-950/25 p-3 text-xs text-emerald-200">No client actions currently detected.</p>}</div></div></div></Panel>
        <Panel title="Live readiness" description="Workspace, booking, website, review and payments stay separate so a warning never looks like a pass."><div className="space-y-2">{[['Workspace', readiness.workspace, Building2], ['Booking', readiness.booking, CalendarCheck2], ['Website', readiness.website, Globe2], ['Internal review', readiness.review, ShieldCheck], ['Payments', readiness.payments, BadgePoundSterling]].map(([area, value, Icon]: any) => <div key={area} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs"><span className="flex items-center gap-2 font-bold text-slate-300"><Icon className="h-4 w-4" />{area}</span><Status value={String(value || 'NOT_STARTED')} /></div>)}</div></Panel>
        <Panel title="5. Review website and booking" description="Open the generated preview, check native booking actions and adjust colours or section variations before approval."><div className="flex flex-col gap-2 sm:flex-row xl:flex-col">{run?.siteReference || context.site?.reference ? <Link to={`/agency/sites/${run?.siteReference || context.site.reference}/studio`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-black text-white"><Globe2 className="h-4 w-4" />Open Site Studio</Link> : <button type="button" disabled className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-800 px-4 text-xs font-black text-slate-600"><Globe2 className="h-4 w-4" />Site Studio after build</button>}<a href={`/book/${context.tenant.subdomain}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-200"><ExternalLink className="h-4 w-4" />Test booking</a></div><p className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs leading-5 text-slate-400">Every Site Studio design change creates a new preview digest and requires fresh accessibility and quality checks before publication.</p></Panel>
        <Panel title="6. Final checks and activation" description="Run live workspace checks, resolve failures and activate client access. Website publication remains separately controlled."><div className="flex flex-col gap-2 sm:flex-row xl:flex-col"><button type="button" disabled={Boolean(busy)} onClick={() => void runLaunchChecks()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-200 disabled:opacity-40"><Play className="h-4 w-4" />{busy === 'checks' ? 'Checking…' : 'Run final checks'}</button><button type="button" disabled={Boolean(busy) || workspaceActive} onClick={() => void activateWorkspace()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white disabled:opacity-40"><Rocket className="h-4 w-4" />{workspaceActive ? 'Workspace active' : busy === 'launch' ? 'Activating…' : 'Activate workspace'}</button></div>{launchChecks.length ? <div className="mt-4 space-y-2">{launchChecks.map(check => <div key={check.key || check.checkKey} className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${check.ok || check.status === 'PASS' ? tone.READY : tone.BLOCKING}`}>{check.ok || check.status === 'PASS' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}<span><strong>{label(check.key || check.checkKey)}</strong><small className="mt-1 block opacity-75">{check.detail}</small></span></div>)}</div> : null}</Panel>
      </div>
    </div>
  </div>;
}

export default AgencyWorkspaceLaunchPipeline;
