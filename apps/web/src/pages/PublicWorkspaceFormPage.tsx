import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { FormSchemaJsonSchema } from '@ks-os/contracts';
import { FormRenderer } from '../features/forms/FormRenderer.js';
import { formState } from '../features/forms/form-engine.js';
import { currentWorkspaceSlug } from '../lib/workspace-hostname.js';

type PublicWorkspaceFormData = {
  salon: { name: string; primaryColor: string; secondaryColor: string; accentColor: string };
  form: { title: string; description: string; publicSlug: string; schema: unknown; acknowledgementText: string };
};

function pathFormSlug(): string {
  if (typeof window === 'undefined') return '';
  const match = window.location.pathname.match(/^\/form\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

function formEndpoint(workspaceSlug: string, formSlug: string): string {
  return `/api/v1/public/forms/workspace/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(formSlug)}`;
}

export default function PublicWorkspaceFormPage() {
  const params = useParams();
  const formSlug = params.formSlug || pathFormSlug();
  const workspaceSlug = currentWorkspaceSlug();
  const navigate = useNavigate();
  const [data, setData] = useState<PublicWorkspaceFormData | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [page, setPage] = useState(0);
  const [review, setReview] = useState(false);
  const [name, setName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [saveState, setSaveState] = useState('Not saved');
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const draftKey = workspaceSlug && formSlug ? `public-form-draft-${workspaceSlug}-${formSlug}` : '';

  useEffect(() => {
    if (!workspaceSlug || !formSlug) {
      setLoadError('FORM_NOT_FOUND');
      setLoading(false);
      return;
    }
    let active = true;
    fetch(formEndpoint(workspaceSlug, formSlug))
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error?.code || 'FORM_NOT_FOUND');
        return body.data as PublicWorkspaceFormData;
      })
      .then(value => {
        if (!active) return;
        const schema = FormSchemaJsonSchema.parse(value.form.schema);
        setData({ ...value, form: { ...value.form, schema } });
        try {
          const draft = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
          if (draft?.answers) setAnswers(draft.answers);
          if (Number.isInteger(draft?.page)) setPage(draft.page);
        } catch {
          sessionStorage.removeItem(draftKey);
        }
      })
      .catch(cause => { if (active) setLoadError(cause instanceof Error ? cause.message : 'FORM_NOT_FOUND'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [draftKey, formSlug, workspaceSlug]);

  useEffect(() => {
    if (!data || !draftKey || !Object.keys(answers).length) return;
    const schema = FormSchemaJsonSchema.parse(data.form.schema);
    if (!schema.settings.autosave) return;
    setSaveState('Saving…');
    const timer = window.setTimeout(() => {
      sessionStorage.setItem(draftKey, JSON.stringify({ answers, page }));
      setSaveState('Saved on this device');
    }, 500);
    return () => window.clearTimeout(timer);
  }, [answers, data, draftKey, page]);

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-8" aria-live="polite"><div className="rounded-3xl border border-slate-200 bg-white px-8 py-10 text-center shadow-xl"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" /><p className="mt-4 font-bold text-slate-600">Loading your secure form…</p></div></main>;
  if (loadError || !data || !workspaceSlug) return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-center"><section className="max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-xl"><LockKeyhole className="mx-auto h-10 w-10 text-slate-400" /><h1 className="mt-4 text-2xl font-black text-slate-950">This form is unavailable</h1><p className="mt-3 leading-6 text-slate-600">Check the address or ask the business for the correct form link.</p></section></main>;

  const schema = FormSchemaJsonSchema.parse(data.form.schema);
  const pages = schema.pages.length ? schema.pages : [{ id: 'all', title: data.form.title }];
  const total = pages.length;
  const state = formState(schema, answers);

  const validate = () => {
    const next: Record<string, string> = {};
    for (const field of schema.fields) {
      const key = field.key || field.id;
      const fieldState = state.get(key);
      const value = answers[key];
      if (fieldState?.visible && fieldState.required && (value == null || value === '' || value === false || (Array.isArray(value) && !value.length))) next[key] = field.validation.errorMessage || 'This answer is required.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const forward = () => {
    if (!validate()) {
      document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (page < total - 1) setPage(current => current + 1);
    else setReview(true);
  };

  const submit = async () => {
    if (!accepted || !name.trim()) return setSubmitError('Please accept the acknowledgement and enter your full name.');
    setSubmitting(true);
    setSubmitError('');
    try {
      const response = await fetch(`${formEndpoint(workspaceSlug, formSlug)}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers,
          acknowledgement: { accepted: true, name },
          idempotencyKey,
          language: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          trackingParameters: {
            source: new URLSearchParams(window.location.search).get('source') || '',
            campaign: new URLSearchParams(window.location.search).get('campaign') || '',
          },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.code || 'FORM_SUBMISSION_FAILED');
      sessionStorage.removeItem(draftKey);
      navigate(`/form/${encodeURIComponent(formSlug)}/success`, { replace: true });
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'FORM_SUBMISSION_FAILED');
    } finally {
      setSubmitting(false);
    }
  };

  const progress = review ? 100 : Math.round((100 * (page + 1)) / total);
  const primary = schema.theme.primaryColor || data.salon.primaryColor;

  return <main className="relative min-h-screen overflow-hidden px-4 py-6 md:px-8 md:py-10" style={{ background: schema.theme.backgroundColor, color: schema.theme.textColor }}>
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-70" style={{ background: `radial-gradient(circle at top left, ${primary}22, transparent 45%), radial-gradient(circle at top right, ${data.salon.accentColor}18, transparent 40%)` }} />
    <div className="relative mx-auto max-w-3xl">
      <header className="mb-5 rounded-3xl border border-white/70 bg-white/80 p-5 shadow-sm backdrop-blur md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em]" style={{ color: primary }}>{data.salon.name}</p><p className="mt-1 text-sm font-semibold text-slate-500">Secure digital consent</p></div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700"><ShieldCheck className="h-4 w-4" />Encrypted and private</div>
        </div>
        <div className="mt-5 flex items-center justify-between text-xs font-bold text-slate-500"><span>{review ? 'Final review' : `Step ${page + 1} of ${total}`}</span><span aria-live="polite">{saveState}</span></div>
        {schema.theme.progressStyle !== 'NONE' && <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: primary }} /></div>}
      </header>

      <section className="overflow-hidden rounded-[32px] border border-slate-200/80 shadow-2xl shadow-slate-300/40" style={{ background: schema.theme.cardColor }}>
        {!review ? <>
          <div className="border-b border-slate-100 px-6 py-7 md:px-9 md:py-9">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-slate-600"><Sparkles className="h-3.5 w-3.5" />Please complete all required fields</div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950 md:text-4xl">{pages[page]?.title || data.form.title}</h1>
            {page === 0 && data.form.description && <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">{data.form.description}</p>}
          </div>
          <div className="px-6 py-7 md:px-9 md:py-9"><FormRenderer schema={schema} answers={answers} onChange={(key, value) => { setAnswers(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: '' })); }} page={schema.pages.length ? page : undefined} errors={errors} language={navigator.language} /></div>
          <nav aria-label="Form navigation" className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-6 py-5 md:px-9">
            <button type="button" onClick={() => setPage(current => Math.max(0, current - 1))} disabled={page === 0} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-sm disabled:opacity-30"><ArrowLeft className="h-4 w-4" />Back</button>
            <button type="button" onClick={forward} className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black text-white shadow-md transition hover:brightness-95" style={{ background: primary }}>{page === total - 1 ? 'Review answers' : 'Continue'}<ArrowRight className="h-4 w-4" /></button>
          </nav>
        </> : <>
          <div className="border-b border-slate-100 px-6 py-7 md:px-9 md:py-9"><div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Almost finished</div><h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Review and confirm</h1><p className="mt-2 text-slate-600">Check your information before sending it securely to {data.salon.name}.</p></div>
          <div className="px-6 py-7 md:px-9 md:py-9"><dl className="space-y-3">{schema.fields.filter(field => state.get(field.key || field.id)?.visible && !['INFORMATION', 'HEADING', 'DIVIDER', 'HIDDEN'].includes(field.type)).map(field => { const value = answers[field.key || field.id]; return <div key={field.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"><dt className="text-xs font-black uppercase tracking-wide text-slate-500">{field.label}</dt><dd className="mt-1 font-semibold text-slate-900">{Array.isArray(value) ? value.join(', ') : value === true ? 'Yes' : value === false ? 'No' : String(value ?? 'Not answered')}</dd></div>; })}</dl>
            <section className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5"><h2 className="font-black text-indigo-950">Consent acknowledgement</h2><p className="mt-2 text-sm leading-6 text-indigo-950/80">{data.form.acknowledgementText}</p><label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-indigo-200 bg-white p-4"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} className="mt-0.5 h-5 w-5 rounded border-slate-300 text-indigo-600" /><span className="text-sm font-bold text-slate-800">I have read and accept this acknowledgement.</span></label><label className="mt-4 block text-sm font-black text-slate-800">Full legal name<input value={name} onChange={event => setName(event.target.value)} placeholder="Type your full name" className="mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3.5 font-normal outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" /></label></section>
            {submitError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{submitError}</p>}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-6 py-5 md:px-9"><button type="button" onClick={() => setReview(false)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700"><ArrowLeft className="h-4 w-4" />Edit answers</button><button type="button" onClick={() => void submit()} disabled={!accepted || !name.trim() || submitting} className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-black text-white shadow-md disabled:opacity-40">{submitting ? 'Submitting securely…' : 'Submit consent form'}</button></div>
        </>}
      </section>

      <footer className="mt-5 flex items-center justify-center gap-2 text-center text-xs font-bold text-slate-500"><LockKeyhole className="h-3.5 w-3.5" />Your answers are encrypted and shared only with {data.salon.name}.</footer>
    </div>
  </main>;
}

export function PublicWorkspaceFormSuccessPage() {
  return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6"><section className="max-w-lg rounded-[32px] border border-slate-200 bg-white p-9 text-center shadow-2xl"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100"><CheckCircle2 className="h-9 w-9 text-emerald-600" /></div><h1 className="mt-5 text-3xl font-black tracking-tight text-slate-950">Form submitted</h1><p className="mt-3 leading-6 text-slate-600">Your response was received securely. You may now close this page.</p><div className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-black text-slate-600"><ShieldCheck className="h-4 w-4 text-emerald-600" />Securely recorded</div></section></main>;
}
