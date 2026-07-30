import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  FileCheck2,
  Globe2,
  Layers3,
  Loader2,
  Palette,
  Play,
  Rocket,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  Wrench,
} from 'lucide-react';
import { Link, useParams } from 'react-router';
import {
  SITE_DESIGN_PRESETS,
  siteThemeAccessibilityIssues,
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
type NativeThemeMode = 'PRESET' | 'LIBRARY';
type SectionVariant = 'editorial' | 'grid' | 'split' | 'compact' | 'standard' | 'featured' | 'quiet';
type ColourKey = keyof ThemeColours;

type ThemeColours = {
  primaryColour: string;
  secondaryColour: string;
  accentColour: string;
  backgroundColour: string;
  surfaceColour: string;
  textColour: string;
  mutedTextColour: string;
  borderColour: string;
};

type ThemeRecord = ThemeColours & Record<string, unknown>;

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
  stages: OnboardingStage[];
};

type LibraryTheme = {
  reference: string;
  name: string;
  description: string;
  theme: ThemeRecord;
  preview: Record<string, unknown>;
  previewImageUrl?: string | null;
  tags: string[];
  isSystem: boolean;
};

const DEFAULT_COLOURS: ThemeColours = {
  primaryColour: '#2A1F4F',
  secondaryColour: '#51407A',
  accentColour: '#B54B78',
  backgroundColour: '#FAF8FF',
  surfaceColour: '#FFFFFF',
  textColour: '#211A3B',
  mutedTextColour: '#5A536E',
  borderColour: '#DDD7EA',
};

const colourLabels: Record<ColourKey, string> = {
  primaryColour: 'Primary',
  secondaryColour: 'Secondary',
  accentColour: 'Accent',
  backgroundColour: 'Background',
  surfaceColour: 'Surface',
  textColour: 'Text',
  mutedTextColour: 'Muted text',
  borderColour: 'Border',
};

const commercialDefinitions: Record<string, { title: string; description: string; owner: string }> = {
  SALE_HANDOVER: { title: 'Sales handover', description: 'Confirm the package, scope, primary contact and promises made.', owner: 'Agency' },
  CONTRACT: { title: 'Contract', description: 'Confirm the agreement is signed and the approved scope is safe to use.', owner: 'Client and agency' },
  SETUP_FEE: { title: 'Setup fee', description: 'Confirm the setup fee has been received or formally waived.', owner: 'Agency' },
  DIRECT_DEBIT: { title: 'Direct Debit', description: 'Confirm the recurring subscription mandate is active.', owner: 'Client' },
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

function Panel({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-3xl border border-slate-800 bg-slate-900/85 p-5 shadow-xl shadow-slate-950/20 sm:p-6"><div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-base font-black text-white">{title}</h2>{description ? <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">{description}</p> : null}</div>{action}</div><div className="pt-5">{children}</div></section>;
}

function Stage({ index, title, detail, ready, icon: Icon }: { index: number; title: string; detail: string; ready: boolean; icon: React.ElementType }) {
  return <li className={`rounded-2xl border p-4 ${ready ? tone.READY : tone.NOT_STARTED}`}><div className="flex items-center justify-between"><Icon className="h-5 w-5" /><span className="text-[10px] font-black">{index}/6</span></div><strong className="mt-4 block text-xs">{title}</strong><p className="mt-1 text-[11px] leading-4 opacity-70">{detail}</p></li>;
}

function Metric({ title, value, detail }: { title: string; value: React.ReactNode; detail: string }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{title}</p><p className="mt-2 text-xl font-black text-white">{value}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></div>;
}

function ThemePreview({ name, theme, preview }: { name: string; theme: ThemeRecord; preview?: Record<string, unknown> }) {
  const merged = { ...DEFAULT_COLOURS, ...theme };
  const headline = typeof preview?.headline === 'string' ? preview.headline : name;
  const action = typeof preview?.primaryAction === 'string' ? preview.primaryAction : 'Book now';
  return <div className="overflow-hidden rounded-xl border shadow-xl" style={{ backgroundColor: merged.backgroundColour, borderColor: merged.borderColour, color: merged.textColour }}><div className="flex h-10 items-center justify-between border-b px-3 text-[8px]" style={{ backgroundColor: merged.surfaceColour, borderColor: merged.borderColour }}><strong>{name.split(' ').slice(0, 2).join(' ')}</strong><span style={{ color: merged.mutedTextColour }}>Home · Services · About</span><span className="rounded px-2 py-1 font-black text-white" style={{ backgroundColor: merged.primaryColour }}>{action}</span></div><div className="grid aspect-[16/7] grid-cols-2 items-center gap-4 p-4"><div><p className="text-[7px] font-black uppercase tracking-widest" style={{ color: merged.accentColour }}>Client website</p><p className="mt-2 text-base font-black leading-none">{headline}</p><span className="mt-3 inline-block rounded px-2 py-1 text-[7px] font-black text-white" style={{ backgroundColor: merged.primaryColour }}>{action}</span></div><div className="h-full rounded-lg" style={{ background: `linear-gradient(135deg, ${merged.secondaryColour}, ${merged.primaryColour})` }} /></div></div>;
}

function ColourEditor({ values, onChange }: { values: ThemeColours; onChange: (key: ColourKey, value: string) => void }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{(Object.keys(colourLabels) as ColourKey[]).map(key => <label key={key} className="text-xs font-bold text-slate-300">{colourLabels[key]}<span className="mt-2 flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-2"><input type="color" value={values[key]} onChange={event => onChange(key, event.target.value.toUpperCase())} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0" /><input value={values[key]} onChange={event => onChange(key, event.target.value.toUpperCase())} maxLength={7} pattern="#[0-9A-Fa-f]{6}" aria-label={`${colourLabels[key]} hex colour`} className="min-w-0 flex-1 bg-transparent font-mono text-xs text-white outline-none" /></span></label>)}</div>;
}

function coloursFromTheme(theme: Record<string, unknown> | undefined): ThemeColours {
  const output = { ...DEFAULT_COLOURS };
  for (const key of Object.keys(output) as ColourKey[]) {
    const value = theme?.[key];
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) output[key] = value.toUpperCase();
  }
  return output;
}

export function AgencyWorkspaceLaunchPipeline() {
  const { tenantId } = useParams();
  const { session } = useAgencyAuth();
  const [detail, setDetail] = useState<any>(null);
  const [context, setContext] = useState<any>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [designSource, setDesignSource] = useState<DesignSource>('KS_NATIVE');
  const [nativeThemeMode, setNativeThemeMode] = useState<NativeThemeMode>('PRESET');
  const [presetKey, setPresetKey] = useState<SiteDesignPresetKey>('NORTHLIGHT');
  const [libraryThemeReference, setLibraryThemeReference] = useState('');
  const [defaultSectionVariant, setDefaultSectionVariant] = useState<SectionVariant>('standard');
  const [templateReference, setTemplateReference] = useState('');
  const [customColours, setCustomColours] = useState(false);
  const [colourOverrides, setColourOverrides] = useState<ThemeColours>(DEFAULT_COLOURS);
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
      setDetail(nextDetail); setContext(nextContext); setOnboarding(nextOnboarding);
      const savedDesign = nextContext.draft?.pagePlan?.design || {};
      const inferredSource: DesignSource = savedDesign.source || (nextContext.draft?.templateSourceType === 'ENVATO_HTML' ? 'LICENSED_TEMPLATE' : nextContext.draft?.templateSourceType === 'GOOGLE_STITCH' ? 'GOOGLE_STITCH' : 'KS_NATIVE');
      const assignedReference = nextContext.designLibrary?.assignedTheme?.reference || '';
      const selectedLibrary = savedDesign.libraryItemReference || assignedReference;
      const selectedPreset = savedDesign.presetKey || nextContext.designLibrary?.defaultPresetKey || 'NORTHLIGHT';
      setDesignSource(inferredSource);
      setNativeThemeMode(selectedLibrary ? 'LIBRARY' : 'PRESET');
      setLibraryThemeReference(selectedLibrary);
      setPresetKey(selectedPreset);
      setDefaultSectionVariant(savedDesign.defaultSectionVariant || 'standard');
      setTemplateReference(inferredSource === 'KS_NATIVE' ? '' : nextContext.draft?.templateVersionReference || '');
      setPageTypes(nextContext.draft?.pagePlan?.requestedPageTypes?.length ? nextContext.draft.pagePlan.requestedPageTypes : DEFAULT_PAGE_TYPES);
      setPaymentPreference(nextContext.draft?.paymentPreference || { allowPayLater: true, onlinePaymentsRequested: false, depositCollectionRequested: false });
      const savedOverrides = savedDesign.themeOverrides && Object.keys(savedDesign.themeOverrides).length ? savedDesign.themeOverrides : null;
      const presets: SiteDesignPreset[] = nextContext.designLibrary?.presets || SITE_DESIGN_PRESETS;
      const themes: LibraryTheme[] = nextContext.designLibrary?.themes || [];
      const base = selectedLibrary ? themes.find(theme => theme.reference === selectedLibrary)?.theme : presets.find(item => item.key === selectedPreset)?.theme;
      setCustomColours(Boolean(savedOverrides));
      setColourOverrides({ ...coloursFromTheme(base), ...(savedOverrides || {}) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The client launch pipeline could not be loaded.');
    } finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reference = context?.run?.reference;
    if (!reference || TERMINAL_RUNS.has(context.run.status)) return;
    const timer = window.setInterval(() => void agencyFetch(`/provisioning-runs/${reference}`).then(run => {
      setContext((current: any) => current ? { ...current, run } : current);
      if (TERMINAL_RUNS.has(run.status)) void load(false);
    }).catch(() => undefined), 3_000);
    return () => window.clearInterval(timer);
  }, [context?.run?.reference, context?.run?.status, load]);

  const commercialStages = useMemo(() => COMMERCIAL_STAGE_KEYS.map(stageKey => onboarding?.stages.find(stage => stage.stageKey === stageKey)).filter(Boolean) as OnboardingStage[], [onboarding]);
  const commercialReady = commercialStages.length > 0 && commercialStages.every(stage => COMPLETE_STAGE_STATUSES.has(stage.status));
  const nativeTemplateReference = context?.designLibrary?.nativeTemplateVersionReference || '';
  const presets: SiteDesignPreset[] = context?.designLibrary?.presets || SITE_DESIGN_PRESETS;
  const libraryThemes: LibraryTheme[] = context?.designLibrary?.themes || [];
  const selectedPreset = presets.find(item => item.key === presetKey) || presets[0];
  const selectedLibraryTheme = libraryThemes.find(theme => theme.reference === libraryThemeReference) || null;
  const selectedBaseTheme = (nativeThemeMode === 'LIBRARY' ? selectedLibraryTheme?.theme : selectedPreset?.theme) || DEFAULT_COLOURS;
  const effectiveTheme = { ...selectedBaseTheme, ...(customColours ? colourOverrides : {}) } as ThemeRecord;
  const colourIssues = customColours ? siteThemeAccessibilityIssues(effectiveTheme as any) : [];
  const advancedTemplates = context?.approvedTemplates || [];
  const availableAdvancedTemplates = advancedTemplates.filter((template: any) => designSource === 'GOOGLE_STITCH' ? template.sourceType === 'GOOGLE_STITCH' : template.sourceType === 'ENVATO_HTML');
  const technicalTemplateReference = designSource === 'KS_NATIVE' ? nativeTemplateReference : templateReference;
  const run = context?.run;
  const activeRun = Boolean(run && !TERMINAL_RUNS.has(run.status));
  const tenant = detail?.tenant || context?.tenant;
  const workspaceActive = tenant?.lifecycleStatus === 'ACTIVE';
  const planLocked = Boolean(run || (context?.draft && !EDITABLE_DRAFTS.has(context.draft.status)));
  const knowledgeReady = context?.knowledge?.ready === true;

  const draftBody = useMemo(() => context ? ({
    productionBriefReference: context.productionBrief?.reference,
    planVersionReference: context.plan?.versionReference,
    workspace: { name: context.tenant.name, subdomain: context.tenant.subdomain, timezone: context.tenant.timezone, currency: context.tenant.currency },
    templateVersionReference: technicalTemplateReference,
    pagePlan: {
      requestedPageTypes: pageTypes,
      preferredLayoutReferences: {},
      design: {
        source: designSource,
        presetKey,
        defaultSectionVariant,
        ...(designSource === 'KS_NATIVE' && nativeThemeMode === 'LIBRARY' && libraryThemeReference ? { libraryItemReference: libraryThemeReference } : {}),
        ...(designSource === 'KS_NATIVE' && customColours ? { themeOverrides: colourOverrides } : {}),
      },
    },
    paymentPreference,
  }) : null, [colourOverrides, context, customColours, defaultSectionVariant, designSource, libraryThemeReference, nativeThemeMode, pageTypes, paymentPreference, presetKey, technicalTemplateReference]);

  const prerequisites = [
    { label: 'Commercial gates complete', ready: commercialReady, action: 'Complete the contract, fee and subscription gates.' },
    { label: 'Active plan assigned', ready: Boolean(context?.plan), action: 'Assign an active plan.' },
    { label: 'Production brief locked', ready: context?.productionBrief?.status === 'LOCKED_FOR_PROVISIONING' && context?.productionBrief?.readyForProvisioning === true, action: 'Approve and lock the production brief.' },
    { label: 'Approved knowledge pack active', ready: knowledgeReady, action: 'Activate exactly one approved PUBLIC_SITE knowledge pack.' },
    { label: designSource === 'KS_NATIVE' ? 'Native renderer ready' : 'Approved template selected', ready: Boolean(technicalTemplateReference) && (designSource !== 'KS_NATIVE' || context?.designLibrary?.nativeTemplateReady === true), action: designSource === 'KS_NATIVE' ? 'Deploy the KS Native Component System migration.' : 'Select an approved template.' },
    { label: 'Accessible client palette', ready: colourIssues.length === 0, action: 'Adjust custom colours until every contrast check passes.' },
  ];
  const blockers = prerequisites.filter(item => !item.ready);

  const markStageComplete = async (stage: OnboardingStage) => {
    if (!tenantId || !canManageStages || busy) return;
    setBusy(`stage:${stage.stageKey}`); setError(''); setNotice('');
    try { await agencyFetch(`/tenants/${tenantId}/onboarding/${stage.stageKey}`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETE', dueAt: stage.dueAt || null, notes: stage.notes || null, blockerCode: null, blockerNote: null }) }); setNotice(`${commercialDefinitions[stage.stageKey]?.title || label(stage.stageKey)} completed.`); await load(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The gate could not be updated.'); }
    finally { setBusy(''); }
  };

  const buildWorkspaceAndWebsite = async () => {
    if (!tenantId || !context || !draftBody || busy || !canProvision) return;
    setBusy('build'); setError(''); setNotice('');
    try {
      if (blockers.length) throw new Error(blockers.map(item => item.action).join(' '));
      const currentDraft = context.draft;
      const editable = currentDraft?.reference && EDITABLE_DRAFTS.has(currentDraft.status);
      const draft = await agencyFetch(editable ? `/provisioning-drafts/${currentDraft.reference}` : '/provisioning-drafts', { method: editable ? 'PATCH' : 'POST', body: JSON.stringify(draftBody) });
      const validation = await agencyFetch(`/provisioning-drafts/${draft.reference}/validate`, { method: 'POST' });
      if (validation.status !== 'READY_TO_PROVISION') throw new Error((validation.blockingIssues || []).map((issue: any) => issue.message).filter(Boolean).join(' ') || 'The delivery plan still has blocking issues.');
      const keyName = `ks-os-delivery-idempotency:${draft.reference}`;
      const idempotencyKey = sessionStorage.getItem(keyName) || `agency-delivery:${draft.reference}:${crypto.randomUUID()}`;
      sessionStorage.setItem(keyName, idempotencyKey);
      await agencyFetch('/provisioning-runs', { method: 'POST', body: JSON.stringify({ provisioningDraftReference: draft.reference, idempotencyKey }) });
      const designName = nativeThemeMode === 'LIBRARY' ? selectedLibraryTheme?.name : selectedPreset?.name;
      setNotice(`Build started. KS OS will use the active playbooks, create native booking, generate the website and apply ${designName || 'the selected design'} before internal review.`);
      await load(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The automated build could not be started.'); await load(false); }
    finally { setBusy(''); }
  };

  const retryProvisioning = async () => {
    if (!run?.reference || busy) return;
    setBusy('retry'); setError(''); setNotice('');
    try { await agencyFetch(`/provisioning-runs/${run.reference}/retry`, { method: 'POST', body: JSON.stringify({ reason: 'Retry requested from the unified client launch pipeline.' }) }); setNotice('The failed step has been queued again without duplicating completed work.'); await load(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The provisioning run could not be retried.'); }
    finally { setBusy(''); }
  };

  const runLaunchChecks = async () => {
    if (!tenantId || busy) return null;
    setBusy('checks'); setError(''); setNotice('');
    try { const result = await agencyFetch(`/tenants/${tenantId}/launch-checks`, { method: 'POST' }); setLaunchChecks(result.checks || []); setNotice(result.ready ? 'All workspace launch checks passed.' : 'Launch checks found items that still need attention.'); return result; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Launch checks could not be completed.'); return null; }
    finally { setBusy(''); }
  };

  const activateWorkspace = async () => {
    if (!tenantId || busy || workspaceActive) return;
    const result = await runLaunchChecks();
    if (!result?.ready) return;
    setBusy('launch'); setError('');
    try { await agencyFetch(`/tenants/${tenantId}/launch`, { method: 'POST' }); setNotice('The client workspace is active. Website publication remains protected by Site Studio review and quality gates.'); await load(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The workspace could not be activated.'); }
    finally { setBusy(''); }
  };

  if (loading) return <div className="grid min-h-80 place-items-center rounded-3xl border border-slate-800 bg-slate-900"><p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading launch pipeline…</p></div>;
  if (!tenantId || !tenant || !context || !onboarding) return <p role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error || 'The client launch pipeline is unavailable.'}</p>;

  const readiness = context.readiness || {};
  const source = context.sourcePreview || { services: [], locations: [], staff: [] };
  const briefReady = context.productionBrief?.status === 'LOCKED_FOR_PROVISIONING' && context.productionBrief?.readyForProvisioning;
  const reviewReady = readiness.review === 'READY';

  return <div className="space-y-6">
    <section className="rounded-3xl border border-violet-800/60 bg-gradient-to-br from-violet-950 via-slate-950 to-slate-900 p-6 shadow-2xl sm:p-8"><div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between"><div className="max-w-3xl"><div className="flex flex-wrap gap-2"><Status value={tenant.lifecycleStatus} /><Status value={run?.status || context.draft?.status || onboarding.status} /></div><p className="mt-4 text-xs font-black uppercase tracking-[0.22em] text-violet-300">One governed path from sale to live</p><h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Launch {tenant.name}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Confirm the commercial gates, use approved client facts and playbooks, select or customise the design, then let KS OS build booking, website and internal review in one run.</p></div><button type="button" onClick={() => void buildWorkspaceAndWebsite()} disabled={!canProvision || Boolean(busy) || activeRun || workspaceActive || blockers.length > 0} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-black text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"><Sparkles className="h-4 w-4" />{busy === 'build' ? 'Preparing build…' : activeRun ? 'Build in progress' : workspaceActive ? 'Workspace active' : 'Build workspace and website'}</button></div></section>

    {error ? <p role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p> : null}
    {notice ? <p role="status" className="rounded-2xl border border-emerald-800 bg-emerald-950/35 p-4 text-sm text-emerald-200">{notice}</p> : null}

    <ol aria-label="Client launch progress" className="grid gap-3 md:grid-cols-3 xl:grid-cols-6"><Stage index={1} title="Commercial ready" detail="Scope, contract and billing" ready={commercialReady} icon={FileCheck2} /><Stage index={2} title="Facts and playbooks" detail="Verified brief and active knowledge" ready={Boolean(briefReady && knowledgeReady)} icon={ShieldCheck} /><Stage index={3} title="Design and pages" detail="Theme, palette and site scope" ready={context.draft?.status === 'READY_TO_PROVISION' || Boolean(run)} icon={Palette} /><Stage index={4} title="Automated build" detail="Workspace, booking and website" ready={run?.status === 'READY'} icon={Wrench} /><Stage index={5} title="Internal review" detail="Preview, quality and approval" ready={reviewReady} icon={Globe2} /><Stage index={6} title="Client launch" detail="Final checks and activation" ready={workspaceActive} icon={Rocket} /></ol>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]"><div className="space-y-6">
      <Panel title="1. Commercial gates" description="These are the only confirmations KS OS cannot safely infer."><div className="grid gap-3 md:grid-cols-2">{commercialStages.map(stage => { const definition = commercialDefinitions[stage.stageKey]; const complete = COMPLETE_STAGE_STATUSES.has(stage.status); return <article key={stage.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{definition?.owner}</p><h3 className="mt-1 text-sm font-black text-white">{definition?.title}</h3></div><Status value={stage.status} /></div><p className="mt-3 text-xs leading-5 text-slate-400">{stage.blockerNote || definition?.description}</p>{!complete && canManageStages ? <button type="button" disabled={Boolean(busy)} onClick={() => void markStageComplete(stage)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-700 px-3 text-xs font-black text-emerald-200 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />Confirm complete</button> : null}</article>; })}</div></Panel>

      <Panel title="2. Approved facts and playbooks" description="The locked production brief and active PUBLIC_SITE knowledge pack are the only generation sources." action={<Link to="/agency/fact-finding" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-700 px-3 text-xs font-black text-violet-200">Review facts <ArrowRight className="h-3.5 w-3.5" /></Link>}><div className="grid gap-3 sm:grid-cols-3"><Metric title="Services" value={source.services.length} detail={source.services.length ? source.services.slice(0, 3).join(', ') : 'Add approved services.'} /><Metric title="Locations" value={source.locations.length} detail={source.locations.length ? source.locations.slice(0, 3).join(', ') : 'Add approved locations.'} /><Metric title="Staff" value={source.staff.length} detail={source.staff.length ? source.staff.slice(0, 3).join(', ') : 'Add approved staff.'} /></div><div className={`mt-4 rounded-2xl border p-4 ${knowledgeReady ? tone.READY : tone.BLOCKING}`}><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-xs font-black"><ShieldCheck className="h-4 w-4" />{knowledgeReady ? `${context.knowledge.name} ${context.knowledge.semanticVersion}` : 'Knowledge pack unavailable'}</p><p className="mt-2 text-xs leading-5 opacity-75">{knowledgeReady ? `${context.knowledge.ruleCount} rules · ${context.knowledge.pagePlaybookCount} page playbooks · ${context.knowledge.sectionPlaybookCount} section playbooks. The build pins this version and never reads raw CSV files.` : 'Activate exactly one approved PUBLIC_SITE pack before building.'}</p></div><Status value={knowledgeReady ? 'READY' : 'BLOCKING'} /></div></div></Panel>

      <Panel title="3. Website design and scope" description="Choose a KS preset or an approved Design Studio theme, then optionally customise all eight client colour tokens."><fieldset disabled={planLocked}><legend className="text-xs font-black uppercase tracking-wider text-slate-500">Design source</legend><div className="mt-3 grid gap-3 md:grid-cols-3"><button type="button" aria-pressed={designSource === 'KS_NATIVE'} onClick={() => setDesignSource('KS_NATIVE')} className={`min-h-32 rounded-2xl border p-4 text-left ${designSource === 'KS_NATIVE' ? 'border-violet-500 bg-violet-950/35' : 'border-slate-800 bg-slate-950'}`}><Sparkles className="h-5 w-5 text-violet-300" /><strong className="mt-4 block text-sm text-white">KS Native</strong><span className="mt-2 block text-[11px] leading-5 text-slate-500">Reusable presets and approved Studio themes. Default and recommended.</span></button><button type="button" aria-pressed={designSource === 'GOOGLE_STITCH'} onClick={() => setDesignSource('GOOGLE_STITCH')} className={`min-h-32 rounded-2xl border p-4 text-left ${designSource === 'GOOGLE_STITCH' ? 'border-violet-500 bg-violet-950/35' : 'border-slate-800 bg-slate-950'}`}><WandSparkles className="h-5 w-5 text-violet-300" /><strong className="mt-4 block text-sm text-white">Approved Stitch import</strong><span className="mt-2 block text-[11px] leading-5 text-slate-500">Use a previously reviewed Stitch template version.</span></button><button type="button" aria-pressed={designSource === 'LICENSED_TEMPLATE'} onClick={() => setDesignSource('LICENSED_TEMPLATE')} className={`min-h-32 rounded-2xl border p-4 text-left ${designSource === 'LICENSED_TEMPLATE' ? 'border-violet-500 bg-violet-950/35' : 'border-slate-800 bg-slate-950'}`}><Layers3 className="h-5 w-5 text-violet-300" /><strong className="mt-4 block text-sm text-white">Licensed template</strong><span className="mt-2 block text-[11px] leading-5 text-slate-500">Advanced project-specific import with its own licence.</span></button></div>
      {designSource === 'KS_NATIVE' ? <div className="mt-5 space-y-5"><div className="flex gap-2"><button type="button" onClick={() => setNativeThemeMode('PRESET')} aria-pressed={nativeThemeMode === 'PRESET'} className={`min-h-11 rounded-xl border px-4 text-xs font-black ${nativeThemeMode === 'PRESET' ? 'border-violet-500 bg-violet-950/40 text-white' : 'border-slate-700 text-slate-400'}`}>KS presets</button><button type="button" onClick={() => setNativeThemeMode('LIBRARY')} aria-pressed={nativeThemeMode === 'LIBRARY'} className={`min-h-11 rounded-xl border px-4 text-xs font-black ${nativeThemeMode === 'LIBRARY' ? 'border-violet-500 bg-violet-950/40 text-white' : 'border-slate-700 text-slate-400'}`}>Design Studio themes ({libraryThemes.length})</button></div>{nativeThemeMode === 'PRESET' ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{presets.map(preset => <button key={preset.key} type="button" onClick={() => { setPresetKey(preset.key); if (!customColours) setColourOverrides(coloursFromTheme(preset.theme)); }} aria-pressed={presetKey === preset.key} className={`rounded-2xl border p-3 text-left ${presetKey === preset.key ? 'border-violet-500 bg-violet-950/25' : 'border-slate-800 bg-slate-950'}`}><div className="flex gap-1">{(['primaryColour', 'secondaryColour', 'accentColour', 'backgroundColour'] as ColourKey[]).map(key => <span key={key} className="h-5 flex-1 rounded" style={{ backgroundColor: preset.theme[key] }} />)}</div><strong className="mt-3 block text-sm text-white">{preset.name}</strong><span className="mt-1 block text-[10px] leading-4 text-slate-500">{preset.description}</span></button>)}</div> : <div className="grid gap-3 sm:grid-cols-2">{libraryThemes.map(theme => <button key={theme.reference} type="button" onClick={() => { setLibraryThemeReference(theme.reference); if (!customColours) setColourOverrides(coloursFromTheme(theme.theme)); }} aria-pressed={libraryThemeReference === theme.reference} className={`rounded-2xl border p-3 text-left ${libraryThemeReference === theme.reference ? 'border-violet-500 bg-violet-950/25' : 'border-slate-800 bg-slate-950'}`}><ThemePreview name={theme.name} theme={theme.theme} preview={theme.preview} /><strong className="mt-3 block text-sm text-white">{theme.name}</strong><span className="mt-1 line-clamp-2 block text-[10px] leading-4 text-slate-500">{theme.description}</span></button>)}</div>}<div className="rounded-2xl border border-slate-800 bg-slate-950 p-4"><label className="flex min-h-11 cursor-pointer items-center gap-3 text-xs font-black text-white"><input type="checkbox" checked={customColours} onChange={event => { const checked = event.target.checked; setCustomColours(checked); if (checked) setColourOverrides(coloursFromTheme(selectedBaseTheme)); }} className="h-4 w-4 rounded border-slate-600" />Customise colours for this client</label>{customColours ? <div className="mt-4"><ColourEditor values={colourOverrides} onChange={(key, value) => setColourOverrides(current => ({ ...current, [key]: value }))} />{colourIssues.length ? <ul className="mt-4 rounded-xl border border-rose-800 bg-rose-950/30 p-3 text-xs text-rose-200">{colourIssues.map((issue, index) => <li key={`${String(issue)}-${index}`}>{String(issue)}</li>)}</ul> : <p className="mt-4 flex items-center gap-2 text-xs font-bold text-emerald-300"><CheckCircle2 className="h-4 w-4" />Palette passes automated contrast checks.</p>}</div> : null}</div><ThemePreview name={nativeThemeMode === 'LIBRARY' ? selectedLibraryTheme?.name || 'Choose a Studio theme' : selectedPreset?.name || 'KS preset'} theme={effectiveTheme} preview={selectedLibraryTheme?.preview} /></div> : <label className="mt-5 block text-xs font-bold text-slate-300">Approved template<select value={templateReference} onChange={event => setTemplateReference(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="">Choose approved template…</option>{availableAdvancedTemplates.map((template: any) => <option key={template.reference} value={template.reference}>{template.label}</option>)}</select></label>}
      <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-slate-300">Default section treatment<select value={defaultSectionVariant} onChange={event => setDefaultSectionVariant(event.target.value as SectionVariant)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white">{(context.designLibrary?.sectionVariants || []).map((variant: string) => <option key={variant} value={variant}>{label(variant)}</option>)}</select></label><div><p className="text-xs font-bold text-slate-300">Pages</p><div className="mt-2 grid grid-cols-2 gap-2">{PAGE_TYPES.map(pageType => <label key={pageType} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[11px] text-slate-300"><input type="checkbox" checked={pageTypes.includes(pageType)} onChange={event => setPageTypes(current => event.target.checked ? [...new Set([...current, pageType])] : current.filter(value => value !== pageType))} />{label(pageType)}</label>)}</div></div></div></fieldset></Panel>

      <Panel title="4. Booking and payment preferences" description="Native booking is mandatory. Payment connection can be completed now or left as a client action depending on the agreed launch scope."><div className="grid gap-3 sm:grid-cols-3">{([['allowPayLater', 'Allow launch before online payments'], ['onlinePaymentsRequested', 'Configure online payments'], ['depositCollectionRequested', 'Collect booking deposits']] as Array<[keyof PaymentPreference, string]>).map(([key, text]) => <label key={key} className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs font-bold text-slate-300"><input type="checkbox" checked={paymentPreference[key]} disabled={planLocked} onChange={event => setPaymentPreference(current => ({ ...current, [key]: event.target.checked }))} />{text}</label>)}</div></Panel>
    </div>

    <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start"><Panel title="Launch readiness" description="Only unresolved decisions are shown here."><div className="space-y-2">{prerequisites.map(item => <div key={item.label} className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${item.ready ? tone.READY : tone.ACTION_REQUIRED}`}><div><strong className="text-xs">{item.label}</strong>{!item.ready ? <p className="mt-1 text-[10px] leading-4 opacity-75">{item.action}</p> : null}</div><Status value={item.ready ? 'READY' : 'ACTION_REQUIRED'} /></div>)}</div>{['FAILED', 'PARTIALLY_FAILED', 'ACTION_REQUIRED'].includes(run?.status) ? <button type="button" onClick={() => void retryProvisioning()} disabled={Boolean(busy)} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-700 px-4 text-xs font-black text-amber-200 disabled:opacity-40"><Play className="h-4 w-4" />Retry required step</button> : null}</Panel>
      <Panel title="Review and go live" description="The generated website still passes controlled internal review, quality and publication gates.">{context.site ? <Link to={`/agency/sites/${context.site.reference}/studio`} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-violet-700 px-4 text-xs font-black text-violet-200"><Globe2 className="h-4 w-4" />Open Site Studio</Link> : <p className="rounded-xl border border-dashed border-slate-700 p-4 text-xs text-slate-500">Build the workspace and website to create the review preview.</p>}<button type="button" onClick={() => void runLaunchChecks()} disabled={Boolean(busy)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-300 disabled:opacity-40"><ShieldCheck className="h-4 w-4" />Run launch checks</button>{launchChecks.length ? <div className="mt-3 space-y-2">{launchChecks.map((check, index) => <div key={`${check.code || index}`} className={`rounded-xl border p-3 text-xs ${check.ready || check.status === 'PASS' ? tone.READY : tone.ACTION_REQUIRED}`}><strong>{check.label || check.name || check.code}</strong>{check.message ? <p className="mt-1 opacity-75">{check.message}</p> : null}</div>)}</div> : null}<button type="button" onClick={() => void activateWorkspace()} disabled={Boolean(busy) || workspaceActive} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-black text-slate-950 disabled:opacity-40"><Rocket className="h-4 w-4" />{workspaceActive ? 'Workspace active' : 'Check and activate client'}</button></Panel>
      <div className="rounded-3xl border border-violet-800/50 bg-violet-950/25 p-5"><CalendarCheck2 className="h-5 w-5 text-violet-300" /><h2 className="mt-3 text-sm font-black text-white">What the single build does</h2><ol className="mt-3 space-y-2 text-xs leading-5 text-slate-400"><li>1. Pins the verified brief and active knowledge pack.</li><li>2. Creates or reuses workspace, services, staff and availability.</li><li>3. Configures native KS OS booking and payments.</li><li>4. Generates structured pages from approved playbooks.</li><li>5. Applies the chosen theme and accessible client palette.</li><li>6. Opens the exact preview digest for internal review.</li></ol></div>
    </aside></div>
  </div>;
}
