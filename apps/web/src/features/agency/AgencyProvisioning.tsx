import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { agencyFetch } from './AgencyAuth';

const WIZARD_STEPS = [
  'Plan and entitlement', 'Business profile', 'Locations', 'Services and pricing',
  'Staff and eligibility', 'Opening hours and availability', 'Booking configuration',
  'Forms and policies', 'Payments', 'Brand and visual direction', 'Website template',
  'Website page plan', 'Provisioning review', 'Provisioning progress', 'Workspace completion',
] as const;

const PAGE_TYPES = ['HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'LOCATION_DETAIL', 'ABOUT', 'TEAM_HUB', 'TEAM_DETAIL', 'CONTACT', 'FAQ', 'POLICIES', 'BOOKING'];

const tone: Record<string, string> = {
  COMPLETED: 'border-emerald-700 bg-emerald-950/40 text-emerald-200',
  READY: 'border-emerald-700 bg-emerald-950/40 text-emerald-200',
  IN_PROGRESS: 'border-violet-600 bg-violet-950/50 text-violet-200',
  PENDING: 'border-slate-800 bg-slate-900 text-slate-400',
  WARNING: 'border-amber-700 bg-amber-950/40 text-amber-200',
  ACTION_REQUIRED: 'border-amber-700 bg-amber-950/40 text-amber-200',
  FAILED: 'border-rose-800 bg-rose-950/40 text-rose-200',
  BLOCKED: 'border-rose-800 bg-rose-950/40 text-rose-200',
  SKIPPED: 'border-slate-800 bg-slate-950 text-slate-500',
};

const Field = ({ label, value, onChange, placeholder = '' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) => (
  <label className="text-xs font-bold text-slate-400">{label}<input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white" /></label>
);

export function AgencyProvisioningPage() {
  const [current, setCurrent] = useState(0);
  const [draftReference, setDraftReference] = useState(() => localStorage.getItem('ks-os-provisioning-draft') || '');
  const [run, setRun] = useState<any>(null);
  const [validation, setValidation] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    productionBriefReference: '', planVersionReference: '', templateVersionReference: '',
    name: '', subdomain: '', timezone: 'Europe/London', currency: 'GBP',
    requestedPageTypes: ['HOME', 'SERVICE_HUB', 'ABOUT', 'CONTACT', 'POLICIES', 'BOOKING'],
    allowPayLater: true, onlinePaymentsRequested: false, depositCollectionRequested: false,
  });

  const requestBody = useMemo(() => ({
    productionBriefReference: form.productionBriefReference,
    planVersionReference: form.planVersionReference,
    workspace: { name: form.name, subdomain: form.subdomain, timezone: form.timezone, currency: form.currency },
    templateVersionReference: form.templateVersionReference,
    pagePlan: { requestedPageTypes: form.requestedPageTypes, preferredLayoutReferences: {} },
    paymentPreference: {
      allowPayLater: form.allowPayLater,
      onlinePaymentsRequested: form.onlinePaymentsRequested,
      depositCollectionRequested: form.depositCollectionRequested,
    },
  }), [form]);

  useEffect(() => {
    if (!run?.reference || ['READY', 'CANCELLED'].includes(run.status)) return;
    const timer = window.setInterval(() => {
      void agencyFetch(`/provisioning-runs/${run.reference}`).then(setRun).catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [run?.reference, run?.status]);

  const command = async (operation: () => Promise<any>) => {
    setBusy(true); setError('');
    try { return await operation(); } catch (caught: any) { setError(caught.message); return null; } finally { setBusy(false); }
  };
  const save = async () => {
    const result = await command(() => agencyFetch(draftReference ? `/provisioning-drafts/${draftReference}` : '/provisioning-drafts', {
      method: draftReference ? 'PATCH' : 'POST', body: JSON.stringify(requestBody),
    }));
    if (result?.reference) { setDraftReference(result.reference); localStorage.setItem('ks-os-provisioning-draft', result.reference); }
  };
  const resume = async () => {
    const result = await command(() => agencyFetch(`/provisioning-drafts/${draftReference}`));
    if (!result) return;
    setForm(value => ({ ...value, ...result.workspace, ...result.paymentPreference, productionBriefReference: result.productionBriefReference, templateVersionReference: result.templateVersionReference, planVersionReference: result.plan?.versionReference || value.planVersionReference, requestedPageTypes: result.pagePlan?.requestedPageTypes || value.requestedPageTypes }));
  };
  const validate = async () => {
    if (!draftReference) await save();
    const reference = draftReference || localStorage.getItem('ks-os-provisioning-draft');
    if (!reference) return;
    const result = await command(() => agencyFetch(`/provisioning-drafts/${reference}/validate`, { method: 'POST' }));
    if (result) { setValidation(result); setCurrent(12); }
  };
  const start = async () => {
    const result = await command(() => agencyFetch('/provisioning-runs', {
      method: 'POST',
      body: JSON.stringify({ provisioningDraftReference: draftReference, idempotencyKey: `agency-ui:${draftReference}:${crypto.randomUUID()}` }),
    }));
    if (result) { setRun(result); setCurrent(13); }
  };

  return <div className="space-y-5">
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-violet-300">Agency only</p><h1 className="mt-1 text-2xl font-black">Provision workspace</h1><p className="mt-2 max-w-3xl text-sm text-slate-400">One controlled action creates canonical booking and website draft records from a locked production brief. It never publishes.</p></div><Link to="/agency/fact-finding" className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black">Open fact-finding</Link></div>
    </div>

    <ol aria-label="Provisioning steps" className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">{WIZARD_STEPS.map((label, index) => {
      const state = index < current ? 'COMPLETED' : index === current ? 'IN_PROGRESS' : index > 12 && !validation?.ready ? 'BLOCKED' : 'PENDING';
      return <li key={label}><button onClick={() => setCurrent(index)} className={`h-full w-full rounded-xl border p-3 text-left text-xs ${tone[state]}`}><span className="block text-[10px] font-black uppercase">{index + 1} · {state.replaceAll('_', ' ')}</span><strong className="mt-1 block">{label}</strong></button></li>;
    })}</ol>

    {error && <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p>}

    {current < 12 && <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-lg font-black">{WIZARD_STEPS[current]}</h2>
      <p className="mt-1 text-xs text-slate-500">Values remain a resumable draft until the locked brief is validated server-side.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Locked production brief reference" value={form.productionBriefReference} onChange={productionBriefReference => setForm(value => ({ ...value, productionBriefReference }))} />
        <Field label="Active plan version reference" value={form.planVersionReference} onChange={planVersionReference => setForm(value => ({ ...value, planVersionReference }))} />
        <Field label="Approved template version reference" value={form.templateVersionReference} onChange={templateVersionReference => setForm(value => ({ ...value, templateVersionReference }))} />
        <Field label="Workspace name" value={form.name} onChange={name => setForm(value => ({ ...value, name }))} />
        <Field label="Subdomain" value={form.subdomain} onChange={subdomain => setForm(value => ({ ...value, subdomain }))} />
        <Field label="Timezone" value={form.timezone} onChange={timezone => setForm(value => ({ ...value, timezone }))} />
      </div>
      <fieldset className="mt-5"><legend className="text-xs font-black uppercase tracking-wide text-slate-400">Website page plan</legend><div className="mt-2 flex flex-wrap gap-2">{PAGE_TYPES.map(type => <label key={type} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"><input type="checkbox" checked={form.requestedPageTypes.includes(type)} onChange={event => setForm(value => ({ ...value, requestedPageTypes: event.target.checked ? [...value.requestedPageTypes, type] : value.requestedPageTypes.filter(item => item !== type) }))} className="mr-2" />{type.replaceAll('_', ' ')}</label>)}</div></fieldset>
      <fieldset className="mt-5 flex flex-wrap gap-4 text-xs"><legend className="sr-only">Payment preferences</legend>{[
        ['allowPayLater', 'Allow pay later'], ['onlinePaymentsRequested', 'Online payments requested'], ['depositCollectionRequested', 'Deposit collection requested'],
      ].map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(form[key as keyof typeof form])} onChange={event => setForm(value => ({ ...value, [key]: event.target.checked }))} className="mr-2" />{label}</label>)}</fieldset>
      <div className="mt-6 flex flex-wrap gap-2"><button disabled={busy} onClick={() => void save()} className="rounded-xl bg-violet-600 px-5 py-3 text-xs font-black disabled:opacity-50">Save draft</button>{draftReference && <button disabled={busy} onClick={() => void resume()} className="rounded-xl border border-slate-700 px-5 py-3 text-xs font-black">Resume saved draft</button>}<button disabled={busy} onClick={() => void validate()} className="rounded-xl border border-emerald-700 px-5 py-3 text-xs font-black text-emerald-300">Validate complete plan</button></div>
    </section>}

    {current === 12 && <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-lg font-black">Provisioning review</h2><div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-xl bg-slate-950 p-4"><strong>Locked input</strong><p className="mt-1 text-xs text-slate-400">{form.productionBriefReference || 'Not selected'}</p></div><div className="rounded-xl bg-slate-950 p-4"><strong>Readiness</strong><p className="mt-1 text-xs text-slate-400">{validation?.ready ? 'READY TO PROVISION' : 'Blocking issues remain'}</p></div></div>{validation?.blockingIssues?.map((issue: any) => <p key={issue.code} className="mt-2 rounded-lg border border-rose-900 p-3 text-xs text-rose-200"><strong>{issue.code}</strong> — {issue.message}</p>)}<button disabled={!validation?.ready || busy} onClick={() => void start()} className="mt-5 rounded-xl bg-emerald-600 px-5 py-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-40">PROVISION WORKSPACE</button></section>}

    {current >= 13 && run && <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex items-center justify-between"><div><h2 className="text-lg font-black">{run.status === 'READY' ? 'Workspace completion' : 'Provisioning progress'}</h2><p className="text-xs text-slate-500">{run.completionPercentage}% complete · browser-independent durable run</p></div><span className={`rounded-full border px-3 py-1 text-xs font-black ${tone[run.status] || tone.IN_PROGRESS}`}>{run.status.replaceAll('_', ' ')}</span></div><div className="mt-5 h-2 rounded-full bg-slate-950"><div className="h-2 rounded-full bg-violet-500 transition-all" style={{ width: `${run.completionPercentage}%` }} /></div><div className="mt-5 space-y-2">{run.steps?.map((step: any) => <div key={step.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-xs ${tone[step.status] || tone.PENDING}`}><span><strong>{step.key.replaceAll('_', ' ')}</strong><small className="ml-2 opacity-70">{step.safeMessage}</small></span><span>{step.status.replaceAll('_', ' ')}</span></div>)}</div>{['FAILED', 'PARTIALLY_FAILED', 'ACTION_REQUIRED'].includes(run.status) && <div className="mt-5 flex gap-2"><button onClick={() => void command(() => agencyFetch(`/provisioning-runs/${run.reference}/retry`, { method: 'POST', body: JSON.stringify({ reason: 'Agency requested a safe provisioning retry.' }) }).then(setRun))} className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black">Retry failed step</button><a href="mailto:support@ks-os.com" className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black">Contact support</a></div>}{run.status === 'READY' && <div className="mt-6 flex flex-wrap gap-2"><Link to={`/agency/sites/${run.siteReference}/studio`} className="rounded-xl bg-violet-600 px-4 py-3 text-xs font-black">OPEN SITE STUDIO</Link>{run.siteReference && <Link to={`/agency/sites/${run.siteReference}/studio`} className="rounded-xl border border-slate-700 px-4 py-3 text-xs font-black">PREVIEW WEBSITE</Link>}<button onClick={() => setCurrent(12)} className="rounded-xl border border-slate-700 px-4 py-3 text-xs font-black">VIEW PROVISIONING REPORT</button></div>}</section>}
  </div>;
}
