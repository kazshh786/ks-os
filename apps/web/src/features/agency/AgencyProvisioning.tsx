import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarCheck2,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Loader2,
  ShieldCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';
import { WorkspaceDataControls } from './WorkspaceDataControls';

const PAGE_TYPES = [
  'HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'LOCATION_DETAIL', 'ABOUT', 'TEAM_HUB',
  'TEAM_DETAIL', 'CONTACT', 'FAQ', 'POLICIES', 'BOOKING',
] as const;
const DEFAULT_PAGE_TYPES = ['HOME', 'SERVICE_HUB', 'ABOUT', 'CONTACT', 'POLICIES', 'BOOKING'];
const TERMINAL_RUNS = new Set(['READY', 'FAILED', 'PARTIALLY_FAILED', 'ACTION_REQUIRED', 'CANCELLED']);
const EDITABLE_DRAFTS = new Set(['DRAFT', 'VALIDATING', 'READY_TO_PROVISION']);

const tone: Record<string, string> = {
  READY: 'border-emerald-700 bg-emerald-950/35 text-emerald-200',
  COMPLETE: 'border-emerald-700 bg-emerald-950/35 text-emerald-200',
  ACTIVE: 'border-emerald-700 bg-emerald-950/35 text-emerald-200',
  ACTION_REQUIRED: 'border-amber-700 bg-amber-950/35 text-amber-200',
  WARNING: 'border-amber-700 bg-amber-950/35 text-amber-200',
  BLOCKING: 'border-rose-800 bg-rose-950/35 text-rose-200',
  FAILED: 'border-rose-800 bg-rose-950/35 text-rose-200',
  PARTIALLY_FAILED: 'border-rose-800 bg-rose-950/35 text-rose-200',
  IN_PROGRESS: 'border-violet-700 bg-violet-950/35 text-violet-200',
  QUEUED: 'border-violet-700 bg-violet-950/35 text-violet-200',
  NOT_STARTED: 'border-slate-800 bg-slate-950 text-slate-400',
  PENDING: 'border-slate-800 bg-slate-950 text-slate-400',
};

const statusClass = (value?: string) => tone[value || 'NOT_STARTED'] || tone.IN_PROGRESS;
const label = (value?: string) => (value || 'NOT_STARTED').replaceAll('_', ' ');
const isRemovedWorkspace = (tenant: any) => tenant.lifecycleStatus === 'OFFBOARDED'
  && tenant.name === 'Deleted workspace'
  && String(tenant.subdomain || '').startsWith('deleted-');

function Status({ value }: { value?: string }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${statusClass(value)}`}>{label(value)}</span>;
}

function Panel({ title, description, action, children }: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-xl shadow-slate-950/20 sm:p-6">
    <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-base font-black text-white">{title}</h2>
        {description && <p className="mt-1 max-w-[50ch] text-xs leading-5 text-slate-400">{description}</p>}
      </div>
      {action}
    </div>
    <div className="pt-5">{children}</div>
  </section>;
}

function Fact({ label: factLabel, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
    <dt className="text-[10px] font-black uppercase tracking-wide text-slate-500">{factLabel}</dt>
    <dd className="mt-1 text-sm font-bold text-slate-200">{value}</dd>
  </div>;
}

function LoadingState() {
  return <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-800 bg-slate-900">
    <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading client delivery…</p>
  </div>;
}

export function AgencyProvisioningPage() {
  const [params, setParams] = useSearchParams();
  const tenantId = params.get('tenant');
  return tenantId
    ? <UnifiedClientDelivery tenantId={tenantId} onBack={() => setParams({})} />
    : <ClientDeliveryDirectory onSelect={id => setParams({ tenant: id })} />;
}

function ClientDeliveryDirectory({ onSelect }: { onSelect: (id: string) => void }) {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void agencyFetch('/tenants')
      .then((rows: any[]) => setTenants(rows.filter(row => !isRemovedWorkspace(row))))
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  return <div className="space-y-6">
    <div className="rounded-3xl border border-violet-800/60 bg-gradient-to-br from-violet-950 via-slate-950 to-slate-900 p-6 sm:p-8">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Client delivery</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-white">Set up booking and website together</h1>
      <p className="mt-3 max-w-[50ch] text-sm leading-6 text-slate-300">Choose a client to review approved facts, build the booking system, create the website and prepare the workspace for launch.</p>
    </div>

    <Panel
      title="Choose a client"
      description="Each client opens in one delivery timeline."
      action={<Link to="/agency/tenants/new" className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black text-white">Create client</Link>}
    >
      {loading ? <LoadingState /> : error ? (
        <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p>
      ) : tenants.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950 p-6 text-center">
          <h3 className="text-sm font-black text-white">Create your first client</h3>
          <p className="mx-auto mt-2 max-w-[50ch] text-xs leading-5 text-slate-400">Add the client account first. You can then collect facts, set up booking and build the website from this page.</p>
          <Link to="/agency/tenants/new" className="mt-4 inline-flex rounded-xl bg-violet-600 px-4 py-2 text-xs font-black text-white">Create client</Link>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {tenants.map(tenant => <button key={tenant.id} type="button" onClick={() => onSelect(tenant.id)} className="group rounded-2xl border border-slate-800 bg-slate-950 p-5 text-left transition hover:border-violet-600 hover:bg-violet-950/20">
            <div className="flex items-start justify-between gap-3">
              <div><strong className="text-base text-white">{tenant.name}</strong><p className="mt-1 font-mono text-xs text-indigo-300">{tenant.subdomain}.kasimshah.com</p></div>
              <Status value={tenant.lifecycleStatus} />
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4 text-xs text-slate-500">
              <span>{tenant.planKey || 'No plan'} · {tenant.primaryContactEmail || 'No contact email'}</span>
              <span className="font-black text-violet-300 group-hover:text-white">Open client →</span>
            </div>
          </button>)}
        </div>
      )}
    </Panel>
  </div>;
}

function UnifiedClientDelivery({ tenantId, onBack }: { tenantId: string; onBack: () => void }) {
  const { session } = useAgencyAuth();
  const [context, setContext] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [templateReference, setTemplateReference] = useState('');
  const [pageTypes, setPageTypes] = useState<string[]>(DEFAULT_PAGE_TYPES);
  const [paymentPreference, setPaymentPreference] = useState({ allowPayLater: true, onlinePaymentsRequested: false, depositCollectionRequested: false });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removeUser, setRemoveUser] = useState<any>(null);
  const [launchChecks, setLaunchChecks] = useState<any[]>([]);

  const load = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const [nextDetail, nextContext, nextUsers] = await Promise.all([
        agencyFetch(`/tenants/${tenantId}`),
        agencyFetch(`/tenants/${tenantId}/delivery-context`),
        agencyFetch(`/tenants/${tenantId}/users`),
      ]);
      setDetail(nextDetail);
      setContext(nextContext);
      setUsers(nextUsers);
      const draft = nextContext.draft;
      setTemplateReference(current => current || draft?.templateVersionReference || nextContext.approvedTemplates?.[0]?.reference || '');
      setPageTypes(draft?.pagePlan?.requestedPageTypes?.length ? draft.pagePlan.requestedPageTypes : DEFAULT_PAGE_TYPES);
      setPaymentPreference(draft?.paymentPreference || { allowPayLater: true, onlinePaymentsRequested: false, depositCollectionRequested: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not load this client. Try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [tenantId]);

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
  }, [context?.run?.reference, context?.run?.status]);

  const command = async (name: string, operation: () => Promise<any>, success: string) => {
    setBusy(name);
    setError('');
    setNotice('');
    try {
      const result = await operation();
      setNotice(success);
      await load(false);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not complete this action. Try again.');
      return null;
    } finally {
      setBusy('');
    }
  };

  const draftBody = useMemo(() => context ? ({
    productionBriefReference: context.productionBrief?.reference,
    planVersionReference: context.plan?.versionReference,
    workspace: {
      name: context.tenant.name,
      subdomain: context.tenant.subdomain,
      timezone: context.tenant.timezone,
      currency: context.tenant.currency,
    },
    templateVersionReference: templateReference,
    pagePlan: { requestedPageTypes: pageTypes, preferredLayoutReferences: {} },
    paymentPreference,
  }) : null, [context, templateReference, pageTypes, paymentPreference]);

  const saveDraft = async () => {
    if (!draftBody || !draftBody.productionBriefReference || !draftBody.planVersionReference || !templateReference) {
      setError('Add a locked brief, active plan and approved template before saving the delivery plan.');
      return null;
    }
    const current = context?.draft;
    const editable = current?.reference && EDITABLE_DRAFTS.has(current.status);
    return command('save-draft', () => agencyFetch(editable ? `/provisioning-drafts/${current.reference}` : '/provisioning-drafts', {
      method: editable ? 'PATCH' : 'POST',
      body: JSON.stringify(draftBody),
    }), 'Delivery plan saved.');
  };

  const validateDraft = async () => {
    const draft = await saveDraft();
    const reference = draft?.reference || context?.draft?.reference;
    if (!reference) return;
    await command('validate', () => agencyFetch(`/provisioning-drafts/${reference}/validate`, { method: 'POST' }), 'Delivery plan validated.');
  };

  const startProvisioning = async () => {
    const reference = context?.draft?.reference;
    if (!reference || context?.draft?.status !== 'READY_TO_PROVISION') return;
    const keyName = `ks-os-delivery-idempotency:${reference}`;
    const idempotencyKey = sessionStorage.getItem(keyName) || `agency-delivery:${reference}:${crypto.randomUUID()}`;
    sessionStorage.setItem(keyName, idempotencyKey);
    await command('start', () => agencyFetch('/provisioning-runs', {
      method: 'POST',
      body: JSON.stringify({ provisioningDraftReference: reference, idempotencyKey }),
    }), 'Provisioning started. Booking is created before the website.');
  };

  const runLaunchChecks = async () => {
    const result = await command('launch-checks', () => agencyFetch(`/tenants/${tenantId}/launch-checks`, { method: 'POST' }), 'Launch checks complete.');
    if (result) setLaunchChecks(result.checks || []);
    return result;
  };

  const launch = async () => {
    const result = await runLaunchChecks();
    if (!result?.ready) return;
    await command('launch', () => agencyFetch(`/tenants/${tenantId}/launch`, { method: 'POST' }), 'Workspace launched.');
  };

  if (loading) return <LoadingState />;
  if (!context || !detail) return <p role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error || 'Client delivery is unavailable.'}</p>;

  const readiness = context.readiness || {};
  const stages = [
    { name: 'Client account', detail: 'Account, plan and onboarding', ready: true, icon: Building2 },
    { name: 'Approved brief', detail: 'Reviewed facts ready for use', ready: context.productionBrief?.status === 'LOCKED_FOR_PROVISIONING', icon: ShieldCheck },
    { name: 'Booking system', detail: 'Services, staff and availability', ready: readiness.booking === 'READY', icon: CalendarCheck2 },
    { name: 'Website draft', detail: 'Template and generated pages', ready: readiness.website === 'READY', icon: Globe2 },
    { name: 'Internal review', detail: 'Preview and agency approval', ready: readiness.review === 'READY', icon: CheckCircle2 },
    { name: 'Client launch', detail: 'Workspace access enabled', ready: detail.tenant.lifecycleStatus === 'ACTIVE', icon: ExternalLink },
  ];
  const validation = context.draft?.validation;
  const run = context.run;
  const canManage = Boolean(session?.capabilities.includes('tenants.manage'));
  const isPlatformOwner = session?.user.role === 'PLATFORM_OWNER';

  return <div className="space-y-6">
    <div className="rounded-3xl border border-violet-800/60 bg-gradient-to-br from-violet-950 via-slate-950 to-slate-900 p-6 sm:p-8">
      <button type="button" onClick={onBack} className="flex items-center gap-2 text-xs font-black text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" />All clients</button>
      <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Client delivery</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-white">{context.tenant.name}</h1>
          <p className="mt-2 font-mono text-xs text-indigo-300">{context.tenant.subdomain}.kasimshah.com</p>
        </div>
        <div className="flex flex-wrap gap-2"><Status value={detail.tenant.lifecycleStatus} /><Status value={run?.status || context.draft?.status || 'NOT_STARTED'} /></div>
      </div>
      <p className="mt-5 max-w-[50ch] text-sm leading-6 text-slate-300">Approved facts create one shared source for booking and the website. Booking records are built first, then the website uses those same services, staff and locations.</p>
    </div>

    {error && <p role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="rounded-2xl border border-emerald-800 bg-emerald-950/35 p-4 text-sm text-emerald-200">{notice}</p>}

    <ol aria-label="Client delivery progress" className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {stages.map((stage, index) => <li key={stage.name} className={`rounded-2xl border p-4 ${stage.ready ? tone.READY : tone.NOT_STARTED}`}>
        <div className="flex items-center justify-between"><stage.icon className="h-5 w-5" /><span className="text-[10px] font-black">{index + 1}/6</span></div>
        <strong className="mt-4 block text-xs">{stage.name}</strong>
        <p className="mt-1 text-[11px] leading-4 opacity-70">{stage.detail}</p>
      </li>)}
    </ol>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
      <div className="space-y-6">
        <Panel title="1. Review approved facts" description="The active plan and latest approved brief are loaded for this client.">
          <dl className="grid gap-3 sm:grid-cols-3">
            <Fact label="Active plan" value={context.plan ? `${context.plan.name} · v${context.plan.version}` : 'Not assigned'} />
            <Fact label="Production brief" value={context.productionBrief ? `Version ${context.productionBrief.version} · ${label(context.productionBrief.status)}` : 'Not created'} />
            <Fact label="Ready to build" value={context.productionBrief?.readyForProvisioning ? 'Yes' : 'Review facts first'} />
          </dl>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {[['Services', context.sourcePreview.services], ['Locations', context.sourcePreview.locations], ['Staff', context.sourcePreview.staff]].map(([title, items]: any) => <div key={title} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <h3 className="text-xs font-black text-white">{title}</h3>
              <div className="mt-3 flex flex-wrap gap-2">{items.length ? items.map((item: string) => <span key={item} className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] text-slate-300">{item}</span>) : <span className="text-xs text-slate-500">No approved {title.toLowerCase()}</span>}</div>
            </div>)}
          </div>
          {!context.productionBrief && <Link to="/agency/fact-finding" className="mt-5 inline-flex rounded-xl border border-violet-700 px-4 py-2 text-xs font-black text-violet-200">Review facts</Link>}
        </Panel>

        <Panel title="2. Set the delivery plan" description="Choose the website layout and payment options. Booking data stays linked to the approved brief.">
          <label className="block text-xs font-bold text-slate-300">Website template
            <span className="mt-1 block font-normal text-slate-500">Choose an approved template for this client.</span>
            <select value={templateReference} onChange={event => setTemplateReference(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white">
              <option value="">Select a template</option>
              {context.approvedTemplates.map((template: any) => <option key={template.reference} value={template.reference}>{template.label}</option>)}
            </select>
          </label>
          <fieldset className="mt-5">
            <legend className="text-xs font-black uppercase tracking-wide text-slate-400">Website pages</legend>
            <div className="mt-3 flex flex-wrap gap-2">{PAGE_TYPES.map(type => <label key={type} className={`rounded-xl border px-3 py-2 text-xs ${pageTypes.includes(type) ? 'border-violet-600 bg-violet-950/40 text-violet-200' : 'border-slate-800 bg-slate-950 text-slate-500'}`}>
              <input type="checkbox" className="mr-2" checked={pageTypes.includes(type)} onChange={event => setPageTypes(current => event.target.checked ? [...current, type] : current.filter(item => item !== type))} />
              {type.replaceAll('_', ' ')}
            </label>)}</div>
          </fieldset>
          <fieldset className="mt-5 grid gap-3 sm:grid-cols-3">
            <legend className="sr-only">Payment options</legend>
            {[
              ['allowPayLater', 'Allow pay later'],
              ['onlinePaymentsRequested', 'Use online payments'],
              ['depositCollectionRequested', 'Collect deposits'],
            ].map(([key, text]) => <label key={key} className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
              <input type="checkbox" className="mr-2" checked={Boolean(paymentPreference[key as keyof typeof paymentPreference])} onChange={event => setPaymentPreference(current => ({ ...current, [key]: event.target.checked }))} />
              {text}
            </label>)}
          </fieldset>
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(busy)} onClick={() => void saveDraft()} className="rounded-xl border border-violet-700 px-4 py-3 text-xs font-black text-violet-200 disabled:opacity-50">{busy === 'save-draft' ? 'Saving…' : context.draft ? 'Save plan' : 'Create plan'}</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void validateDraft()} className="rounded-xl bg-violet-600 px-4 py-3 text-xs font-black text-white disabled:opacity-50">{busy === 'validate' ? 'Validating…' : 'Validate plan'}</button>
            <button type="button" disabled={Boolean(busy) || context.draft?.status !== 'READY_TO_PROVISION' || Boolean(run && !TERMINAL_RUNS.has(run.status))} onClick={() => void startProvisioning()} className="rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{busy === 'start' ? 'Starting…' : 'Start provisioning'}</button>
          </div>
          {validation?.blockingIssues?.length > 0 && <div className="mt-5 space-y-2">
            <h3 className="text-xs font-black uppercase text-rose-300">Fix these issues</h3>
            {validation.blockingIssues.map((issue: any) => <p key={issue.code} className="rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-xs text-rose-200"><strong>{issue.area}</strong> · {issue.message}</p>)}
          </div>}
        </Panel>

        <Panel title="3. Track provisioning" description="Booking is created before the website. Retry a failed step without duplicating completed work." action={run && <Status value={run.status} />}>
          {!run ? <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950 p-5"><h3 className="text-sm font-black text-white">Provisioning has not started</h3><p className="mt-2 max-w-[50ch] text-xs leading-5 text-slate-400">Validate the delivery plan, then start provisioning to create booking and the website.</p></div> : <>
            <div className="flex items-center justify-between text-xs text-slate-400"><span>{run.currentStep ? label(run.currentStep) : 'Waiting to start'}</span><strong className="text-white">{run.completionPercentage}%</strong></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-950"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${run.completionPercentage}%` }} /></div>
            <div className="mt-5 grid gap-2 md:grid-cols-2">{run.steps?.map((step: any) => <div key={step.key} className={`rounded-xl border p-3 text-xs ${statusClass(step.status)}`}>
              <div className="flex items-start justify-between gap-3"><strong>{label(step.key)}</strong><span className="text-[10px] font-black">{label(step.status)}</span></div>
              {step.safeMessage && <p className="mt-1 opacity-70">{step.safeMessage}</p>}
            </div>)}</div>
            {['FAILED', 'PARTIALLY_FAILED', 'ACTION_REQUIRED'].includes(run.status) && <button type="button" disabled={Boolean(busy)} onClick={() => void command('retry', () => agencyFetch(`/provisioning-runs/${run.reference}/retry`, { method: 'POST', body: JSON.stringify({ reason: 'Retry requested from client delivery.' }) }), 'Retry queued.')} className="mt-5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-black">Retry step</button>}
            {run.status === 'READY' && <div className="mt-5 flex flex-wrap gap-2">
              <a href={`/book/${context.tenant.subdomain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black">Test booking <ExternalLink className="h-3.5 w-3.5" /></a>
              {run.siteReference && <Link to={`/agency/sites/${run.siteReference}/studio`} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-xs font-black">Open Site Studio <Globe2 className="h-3.5 w-3.5" /></Link>}
            </div>}
          </>}
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel title="Delivery readiness" description="Review booking, website, payments and internal approval in one place.">
          <div className="space-y-2">{[['Workspace', readiness.workspace], ['Booking', readiness.booking], ['Website', readiness.website], ['Internal review', readiness.review], ['Payments', readiness.payments]].map(([area, value]) => <div key={area} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs"><span className="font-bold text-slate-300">{area}</span><Status value={String(value || 'NOT_STARTED')} /></div>)}</div>
          {readiness.blockingIssues?.map((issue: any) => <p key={issue.code} className="mt-2 rounded-xl border border-rose-900 bg-rose-950/25 p-3 text-xs text-rose-200">{issue.message}</p>)}
        </Panel>

        <Panel title="Launch client" description="Launch gives the client access. Publishing the website remains a separate step.">
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(busy)} onClick={() => void runLaunchChecks()} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black">{busy === 'launch-checks' ? 'Checking…' : 'Check launch'}</button>
            <button type="button" disabled={Boolean(busy) || detail.tenant.lifecycleStatus === 'ACTIVE'} onClick={() => void launch()} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black disabled:opacity-40">{busy === 'launch' ? 'Launching…' : detail.tenant.lifecycleStatus === 'ACTIVE' ? 'Workspace active' : 'Launch workspace'}</button>
          </div>
          {launchChecks.length > 0 && <div className="mt-4 space-y-2">{launchChecks.map(check => <div key={check.key} className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${check.ok ? tone.READY : tone.BLOCKING}`}>
            {check.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
            <span><strong>{label(check.key)}</strong><small className="mt-1 block opacity-75">{check.detail}</small></span>
          </div>)}</div>}
        </Panel>

        <Panel title="User access" description="Remove access without losing historic appointment attribution." action={<span className="flex items-center gap-2 text-xs text-slate-500"><Users className="h-4 w-4" />{users.length}</span>}>
          <div className="space-y-2">{users.length ? users.map(user => <div key={user.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="flex items-start justify-between gap-3"><span><strong className="text-sm text-white">{user.displayName}</strong><small className="block text-xs text-slate-500">{user.email}</small></span><Status value={user.status} /></div>
            {canManage && user.status !== 'DEACTIVATED' && <button type="button" onClick={() => setRemoveUser(user)} className="mt-3 inline-flex items-center gap-2 text-xs font-black text-rose-300 hover:text-rose-200"><UserMinus className="h-4 w-4" />Remove access</button>}
          </div>) : <div className="rounded-xl border border-dashed border-slate-700 p-4"><p className="text-xs font-bold text-white">No users added</p><p className="mt-1 text-xs text-slate-500">Invite the client or staff when the workspace is ready.</p></div>}</div>
        </Panel>

        <WorkspaceDataControls
          tenantId={tenantId}
          tenantName={detail.tenant.name}
          lifecycleStatus={detail.tenant.lifecycleStatus}
          canManage={canManage}
          isPlatformOwner={isPlatformOwner}
          onDeleted={onBack}
          onRefresh={() => load(false)}
          onNotice={setNotice}
          onError={setError}
        />
      </div>
    </div>

    {removeUser && <UserRemovalDialog
      tenantId={tenantId}
      user={removeUser}
      onClose={() => setRemoveUser(null)}
      onRemoved={async () => {
        setRemoveUser(null);
        setNotice('User access removed. Historic records are unchanged.');
        await load(false);
      }}
    />}
  </div>;
}

function UserRemovalDialog({ tenantId, user, onClose, onRemoved }: {
  tenantId: string;
  user: any;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [preview, setPreview] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void agencyFetch(`/tenants/${tenantId}/users/${user.id}/removal-preview`)
      .then(setPreview)
      .catch((cause: Error) => setError(cause.message));
  }, [tenantId, user.id]);

  const reasonReady = reason.trim().length >= 20;
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await agencyFetch(`/tenants/${tenantId}/users/${user.id}/remove`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim(), confirmed: true }),
      });
      onRemoved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not remove access. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/85 p-4 backdrop-blur-sm">
    <section role="dialog" aria-modal="true" aria-labelledby="remove-user-title" className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="remove-user-title" className="text-lg font-black text-white">Remove access</h2><p className="mt-1 max-w-[50ch] text-xs leading-5 text-slate-400">Stop {user.displayName} signing in or taking bookings. Keep their historic appointment records.</p></div>
        <button type="button" onClick={onClose} className="text-xs font-black text-slate-400 hover:text-white">Close</button>
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-800 bg-rose-950/35 p-3 text-xs text-rose-200">{error}</p>}
      {!preview ? <p className="mt-5 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Checking appointments and owner access…</p> : <>
        <div className="mt-5 space-y-2">
          {preview.blockers.map((blocker: any) => <p key={blocker.code} className="rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-xs text-rose-200">{blocker.message}</p>)}
          <dl className="grid gap-2 sm:grid-cols-2"><Fact label="Future bookings" value={preview.impact.futureAppointments} /><Fact label="History kept" value={preview.impact.historicalAppointmentsRetained} /></dl>
        </div>
        <label className="mt-5 block text-xs font-bold text-slate-300">Reason
          <span className="mt-1 block font-normal text-slate-500">Explain why access should end. Use at least 20 characters.</span>
          <textarea rows={3} minLength={20} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white" placeholder="Example: This team member has left the business." />
        </label>
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs">
          <p className={reasonReady ? 'text-emerald-300' : 'text-slate-500'}>{reasonReady ? '✓' : '○'} Reason has 20 characters</p>
          <p className={preview.canRemove ? 'mt-2 text-emerald-300' : 'mt-2 text-rose-300'}>{preview.canRemove ? '✓ No blockers' : '○ Resolve blockers first'}</p>
        </div>
        <button type="button" disabled={!preview.canRemove || !reasonReady || busy} onClick={() => void submit()} className="mt-5 w-full rounded-xl bg-rose-700 px-4 py-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Removing…' : 'Remove access'}</button>
      </>}
    </section>
  </div>;
}

export default AgencyProvisioningPage;
