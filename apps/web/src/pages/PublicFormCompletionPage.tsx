import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { FormSchemaJsonSchema } from '@ks-os/contracts';
import { FormRenderer } from '../features/forms/FormRenderer.js';
import { formState } from '../features/forms/form-engine.js';
import { AssignedConsentFormSuccessPage } from './ConsentFormSuccessPage.js';

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
    fetch(`/api/v1/public/forms/${token}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.code || 'FORM_TOKEN_INVALID');
        return body.data;
      })
      .then(value => {
        setData({ ...value, form: { ...value.form, schema: FormSchemaJsonSchema.parse(value.form.schema) } });
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
            <dl className="my-6 space-y-3">{schema.fields.filter(field => state.get(field.key || field.id)?.visible && !['INFORMATION', 'HEADING', 'DIVIDER', 'HIDDEN'].includes(field.type)).map(field => <div key={field.id} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs font-bold text-slate-500">{field.label}</dt><dd>{Array.isArray(answers[field.key || field.id]) ? (answers[field.key || field.id] as unknown[]).join(', ') : String(answers[field.key || field.id] ?? 'Not answered')}</dd></div>)}</dl>
            <section className="rounded-xl bg-slate-50 p-4">
              <p>{data.form.acknowledgementText}</p>
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

export function PublicFormSuccessPage() {
  return <AssignedConsentFormSuccessPage />;
}
