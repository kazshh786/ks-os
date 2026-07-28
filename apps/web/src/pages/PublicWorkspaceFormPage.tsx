import { useEffect, useMemo, useState } from 'react';
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

  if (loading) return <main className="mx-auto max-w-2xl p-8" aria-live="polite">Loading form…</main>;
  if (loadError || !data || !workspaceSlug) return <main className="mx-auto max-w-2xl p-8 text-center"><h1 className="text-2xl font-black">This form is unavailable</h1><p className="mt-3 text-slate-600">Check the address or ask the business for the correct form link.</p></main>;

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

  const progress = Math.round((100 * (page + 1)) / total);
  return <main className="min-h-screen p-4 md:p-8" style={{ background: schema.theme.backgroundColor, color: schema.theme.textColor }}><div className="mx-auto max-w-2xl"><header className="mb-5"><p className="font-bold" style={{ color: schema.theme.primaryColor }}>{data.salon.name}</p><div className="mt-4 flex items-center justify-between text-xs"><span>Step {page + 1} of {total}</span><span aria-live="polite">{saveState}</span></div>{schema.theme.progressStyle !== 'NONE' && <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200"><div className="h-full transition-all" style={{ width: `${progress}%`, background: schema.theme.primaryColor }} /></div>}</header><section className="rounded-2xl p-5 shadow-sm md:p-8" style={{ background: schema.theme.cardColor }}>{!review ? <><h1 className="text-2xl font-black">{pages[page]?.title || data.form.title}</h1>{page === 0 && <p className="mb-6 mt-2 text-slate-600">{data.form.description}</p>}<FormRenderer schema={schema} answers={answers} onChange={(key, value) => { setAnswers(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: '' })); }} page={schema.pages.length ? page : undefined} errors={errors} language={navigator.language} /><nav aria-label="Form navigation" className="mt-8 flex justify-between"><button type="button" onClick={() => setPage(current => Math.max(0, current - 1))} disabled={page === 0} className="rounded-xl border px-5 py-3 font-bold disabled:opacity-30">Back</button><button type="button" onClick={forward} className="rounded-xl px-5 py-3 font-bold text-white" style={{ background: schema.theme.primaryColor }}>{page === total - 1 ? 'Review answers' : 'Continue'}</button></nav></> : <><h1 className="text-2xl font-black">Review your answers</h1><p className="mt-2 text-slate-600">Check your information before sending it securely.</p><dl className="my-6 space-y-3">{schema.fields.filter(field => state.get(field.key || field.id)?.visible && !['INFORMATION', 'HEADING', 'DIVIDER', 'HIDDEN'].includes(field.type)).map(field => { const value = answers[field.key || field.id]; return <div key={field.id} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs font-bold text-slate-500">{field.label}</dt><dd>{Array.isArray(value) ? value.join(', ') : String(value ?? 'Not answered')}</dd></div>; })}</dl><section className="rounded-xl bg-slate-50 p-4"><p>{data.form.acknowledgementText}</p><label className="mt-4 block"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /> I have read and accept this acknowledgement.</label><label className="mt-4 block font-bold">Full name<input value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-lg border p-3 font-normal" /></label></section>{submitError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{submitError}</p>}<div className="mt-6 flex justify-between"><button type="button" onClick={() => setReview(false)} className="rounded-xl border px-5 py-3 font-bold">Edit answers</button><button type="button" onClick={() => void submit()} disabled={!accepted || submitting} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-40">{submitting ? 'Submitting…' : 'Submit securely'}</button></div></>}</section></div></main>;
}

export function PublicWorkspaceFormSuccessPage() {
  return <main className="mx-auto max-w-xl p-8 text-center"><h1 className="text-2xl font-black">Form submitted</h1><p className="mt-3 text-slate-600">Your response was received securely. You may close this page.</p></main>;
}
