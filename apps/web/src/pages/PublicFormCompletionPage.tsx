import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { FormSchemaJsonSchema } from '@ks-os/contracts';
import { FormRenderer } from '../features/forms/FormRenderer.js';
import { formatFormAnswer, formState } from '../features/forms/form-engine.js';
import { AssignedConsentFormSuccessPage } from './ConsentFormSuccessPage.js';

async function loadAssignedForm(token: string) {
  const response = await fetch(`/api/v1/public/forms/${token}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.code || 'FORM_TOKEN_INVALID');
  const value = body.data;
  return { ...value, form: { ...value.form, schema: FormSchemaJsonSchema.parse(value.form.schema) } };
}

export default function PublicFormCompletionPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [page, setPage] = useState(0);
  const [review, setReview] = useState(false);
  const [name, setName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState('Not saved');
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    loadAssignedForm(token)
      .then(value => {
        setData(value);
        try {
          const draft = JSON.parse(sessionStorage.getItem(`form-draft-${token}`) || 'null');
          if (draft?.answers) setAnswers(draft.answers);
          if (Number.isInteger(draft?.page)) setPage(draft.page);
        } catch {
          sessionStorage.removeItem(`form-draft-${token}`);
        }
        void fetch(`/api/v1/public/forms/${token}/analytics`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            eventType: 'VIEW',
            deviceType: innerWidth < 640 ? 'MOBILE' : innerWidth < 1024 ? 'TABLET' : 'DESKTOP',
            language: navigator.language,
          }),
        });
      })
      .catch(cause => setError(cause.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!data || !data.form.schema.settings.autosave || !Object.keys(answers).length) return;
    setSaveState('Saving…');
    const timer = setTimeout(() => {
      sessionStorage.setItem(`form-draft-${token}`, JSON.stringify({ answers, page }));
      setSaveState('Saved on this device');
    }, 500);
    return () => clearTimeout(timer);
  }, [answers, page, data, token]);

  if (loading) return <main className="mx-auto max-w-2xl p-8" aria-live="polite">Loading secure form…</main>;
  if (error && !data) return <main className="mx-auto max-w-2xl p-8"><h1 className="text-xl font-black">This form is unavailable</h1><p>{error === 'FORM_ASSIGNMENT_EXPIRED' ? 'The secure link expired. Please request another.' : 'Ask the business for a new secure link.'}</p></main>;

  const schema = FormSchemaJsonSchema.parse(data.form.schema);
  const pages = schema.pages.length ? schema.pages : [{ id: 'all', title: data.form.title }];
  const total = pages.length;
  const progress = Math.round(100 * (page + 1) / total);
  const state = formState(schema, answers);
  const formPath = `/forms/complete/${token}`;

  const reviewConsentForm = () => {
    setReview(false);
    setPage(0);
    setError('');
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    for (const field of schema.fields) {
      const key = field.key || field.id;
      const fieldState = state.get(key);
      if (!fieldState?.visible || !fieldState.required) continue;
      const value = answers[key];
      if (value == null || value === '' || value === false || (Array.isArray(value) && !value.length)) next[key] = field.validation.errorMessage || 'This answer is required.';
    }
    setErrors(next);
    return !Object.keys(next).length;
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
    if (!accepted || !name.trim()) {
      setError('Please accept the acknowledgement and enter your full name.');
      return;
    }
    setError('');
    const response = await fetch(`/api/v1/public/forms/${token}/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers,
        acknowledgement: { accepted: true, name },
        idempotencyKey,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        trackingParameters: { source: new URLSearchParams(location.search).get('source') || '' },
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.code || 'FORM_SUBMISSION_FAILED');
      return;
    }

    sessionStorage.removeItem(`form-draft-${token}`);
    sessionStorage.setItem(`form-success-${token}`, JSON.stringify({
      salonName: data.salon.name,
      message: schema.settings.completionMessage,
      redirectUrl: schema.settings.completionRedirectUrl,
      primaryColor: schema.theme.primaryColor || data.salon.primaryColor,
      accentColor: schema.theme.mutedColor || data.salon.accentColor,
    }));
    navigate(`/forms/complete/${token}/success`, { replace: true });
  };

  return (
    <main className="min-h-screen p-4 md:p-8" style={{ background: schema.theme.backgroundColor, color: schema.theme.textColor }}>
      <div className="mx-auto max-w-2xl">
        <header className="mb-5">
          <p className="font-bold" style={{ color: schema.theme.primaryColor }}>{data.salon.name}</p>
          <div className="mt-4 flex items-center justify-between text-xs"><span aria-live="polite">Step {page + 1} of {total}</span><span aria-live="polite">{saveState}</span></div>
          {schema.theme.progressStyle !== 'NONE' && <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200"><div className="h-full transition-all" style={{ width: `${progress}%`, background: schema.theme.primaryColor }} /></div>}
        </header>
        <section className="rounded-2xl p-5 shadow-sm md:p-8" style={{ background: schema.theme.cardColor }}>
          {!review ? <>
            <h1 className="text-2xl font-black">{pages[page]?.title || data.form.title}</h1>
            {page === 0 && <p className="mb-6 mt-2 text-slate-600">{data.form.description}</p>}
            <FormRenderer schema={schema} answers={answers} onChange={(key, value) => { setAnswers(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: '' })); }} page={schema.pages.length ? page : undefined} errors={errors} language={navigator.language} />
            <nav aria-label="Form navigation" className="mt-8 flex justify-between">
              <button type="button" onClick={() => setPage(current => Math.max(0, current - 1))} disabled={page === 0} className="rounded-xl border px-5 py-3 font-bold disabled:opacity-30">Back</button>
              <button type="button" onClick={forward} className="rounded-xl px-5 py-3 font-bold text-white" style={{ background: schema.theme.primaryColor }}>{page === total - 1 && schema.settings.showReview ? 'Review answers' : 'Continue'}</button>
            </nav>
          </> : <>
            <h1 className="text-2xl font-black">Review your answers</h1>
            <p className="mt-2 text-slate-600">Check your information before sending it securely.</p>
            <dl className="my-6 space-y-3">{schema.fields.filter(field => state.get(field.key || field.id)?.visible && !['INFORMATION', 'HEADING', 'DIVIDER', 'HIDDEN'].includes(field.type)).map(field => <div key={field.id} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs font-bold text-slate-500">{field.label}</dt><dd>{formatFormAnswer(field, answers[field.key || field.id])}</dd></div>)}</dl>
            <section className="rounded-xl bg-slate-50 p-4">
              <p>{data.form.acknowledgementText}</p>
              <a href={formPath} onClick={event => { event.preventDefault(); reviewConsentForm(); }} className="mt-3 inline-block text-sm font-black text-indigo-700 underline decoration-indigo-300 underline-offset-4 hover:text-indigo-900">Review consent form</a>
              <label className="mt-4 block"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /> I have read and accept this acknowledgement.</label>
              <label className="mt-4 block font-bold">Full name<input value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-lg border p-3 font-normal" /></label>
            </section>
            {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
            <div className="mt-6 flex justify-between"><button type="button" onClick={() => setReview(false)} className="rounded-xl border px-5 py-3 font-bold">Edit answers</button><button type="button" onClick={() => void submit()} disabled={!accepted} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-40">Submit securely</button></div>
          </>}
        </section>
      </div>
    </main>
  );
}

export function AssignedConsentFormLegalPage() {
  const location = useLocation();
  const match = location.pathname.match(/^\/forms\/complete\/([^/]+)\/acknowledgement$/i);
  const token = match?.[1] ? decodeURIComponent(match[1]) : '';
  const [data, setData] = useState<any>();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('FORM_TOKEN_INVALID');
      return;
    }
    let active = true;
    loadAssignedForm(token)
      .then(value => { if (active) setData(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'FORM_TOKEN_INVALID'); });
    return () => { active = false; };
  }, [token]);

  if (error) return <main className="mx-auto max-w-2xl p-8"><h1 className="text-xl font-black">This consent form is unavailable</h1><p>Return to the secure form or ask the business for a new link.</p></main>;
  if (!data) return <main className="mx-auto max-w-2xl p-8" aria-live="polite">Loading consent form…</main>;

  const schema = FormSchemaJsonSchema.parse(data.form.schema);
  const primary = schema.theme.primaryColor || data.salon.primaryColor;
  const formPath = `/forms/complete/${encodeURIComponent(token)}`;
  const content = String(data.form.acknowledgementText || '').trim();

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8">
      <div className="mx-auto max-w-3xl">
        <a href={formPath} className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm">Back to consent form</a>
        <article className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
          <header className="border-b border-slate-100 px-6 py-8 md:px-10">
            <p className="text-xs font-black uppercase tracking-[0.16em]" style={{ color: primary }}>{data.salon.name}</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Consent form</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">Please read this consent information before confirming the treatment consent checkbox.</p>
          </header>
          <div className="px-6 py-8 md:px-10">
            {content ? <p className="whitespace-pre-line text-[15px] leading-7 text-slate-700">{content}</p> : <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">No consent statement has been provided. Please contact {data.salon.name} before continuing.</div>}
          </div>
          <footer className="border-t border-slate-100 bg-slate-50 px-6 py-5 text-right md:px-10"><a href={formPath} className="font-black underline underline-offset-4" style={{ color: primary }}>Return to consent form</a></footer>
        </article>
      </div>
    </main>
  );
}

export function PublicFormSuccessPage() {
  return <AssignedConsentFormSuccessPage />;
}
