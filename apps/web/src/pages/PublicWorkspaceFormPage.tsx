import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileText,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { FormSchemaJsonSchema, type FormSchemaJson } from '@ks-os/contracts';
import { FormRenderer } from '../features/forms/FormRenderer.js';
import { formatFormAnswer, formState } from '../features/forms/form-engine.js';
import { currentWorkspaceSlug } from '../lib/workspace-hostname.js';

type PublicWorkspaceFormData = {
  salon: { name: string; primaryColor: string; secondaryColor: string; accentColor: string };
  form: {
    title: string;
    description: string;
    publicSlug: string;
    schema: FormSchemaJson;
    acknowledgementText: string;
  };
};

type LegalDocumentType = 'acknowledgement' | 'terms';

function pathFormSlug(): string {
  if (typeof window === 'undefined') return '';
  const match = window.location.pathname.match(/^\/form\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

function formEndpoint(workspaceSlug: string, formSlug: string): string {
  return `/api/v1/public/forms/workspace/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(formSlug)}`;
}

async function loadPublicForm(workspaceSlug: string, formSlug: string): Promise<PublicWorkspaceFormData> {
  const response = await fetch(formEndpoint(workspaceSlug, formSlug));
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.code || 'FORM_NOT_FOUND');
  const value = body.data as Omit<PublicWorkspaceFormData, 'form'> & {
    form: Omit<PublicWorkspaceFormData['form'], 'schema'> & { schema: unknown };
  };
  return { ...value, form: { ...value.form, schema: FormSchemaJsonSchema.parse(value.form.schema) } };
}

function termsContent(schema: FormSchemaJson): string {
  return schema.settings.termsAndConditionsText?.trim()
    || schema.fields.find(field => field.type === 'TERMS_ACCEPTANCE' && field.description?.trim())?.description?.trim()
    || '';
}

function friendlySubmissionError(code: string): string {
  const errors: Record<string, string> = {
    FORM_REQUIRED_ANSWER_MISSING: 'Please complete every required answer before submitting.',
    FORM_ANSWER_TYPE_INVALID: 'One or more answers are not valid. Please review the highlighted fields and try again.',
    FORM_UNKNOWN_ANSWER: 'This form changed while you were completing it. Refresh the page and try again.',
    FORM_LOGIC_CYCLE: 'This form has a configuration issue. Please contact the business.',
    FORM_SUBMISSION_FAILED: 'Your form could not be submitted. Please check your connection and try again.',
  };
  return errors[code] || 'Your form could not be submitted. Please check your answers and try again.';
}

function linkedText(text: string): ReactNode[] {
  const urlPattern = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
  return text.split(urlPattern).filter(Boolean).map((part, index) => {
    if (!urlPattern.test(part)) return part;
    urlPattern.lastIndex = 0;
    const href = part.toLowerCase().startsWith('http') ? part : `https://${part}`;
    return (
      <a
        key={`${part}-${index}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-bold text-indigo-700 underline decoration-indigo-300 underline-offset-4 hover:text-indigo-900"
      >
        {part}
      </a>
    );
  });
}

function LegalDocumentBody({ content }: { content: string }) {
  const blocks = content.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
  return (
    <div className="space-y-6 text-[15px] leading-7 text-slate-700">
      {blocks.map((block, index) => {
        const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
        const heading = lines.length === 1 ? lines[0].match(/^(#{1,3})\s+(.+)$/) : null;
        if (heading) {
          const level = heading[1].length;
          const className = level === 1 ? 'pt-3 text-2xl font-black text-slate-950' : level === 2 ? 'pt-2 text-xl font-black text-slate-950' : 'pt-1 text-lg font-black text-slate-900';
          return <h2 key={`${block}-${index}`} className={className}>{linkedText(heading[2])}</h2>;
        }
        const bulletLines = lines.filter(line => /^[-*•]\s+/.test(line));
        if (bulletLines.length === lines.length) {
          return (
            <ul key={`${block}-${index}`} className="space-y-2 pl-5">
              {lines.map((line, lineIndex) => <li key={`${line}-${lineIndex}`} className="list-disc pl-1">{linkedText(line.replace(/^[-*•]\s+/, ''))}</li>)}
            </ul>
          );
        }
        const numberedLines = lines.filter(line => /^\d+[.)]\s+/.test(line));
        if (numberedLines.length === lines.length) {
          return (
            <ol key={`${block}-${index}`} className="space-y-2 pl-5">
              {lines.map((line, lineIndex) => <li key={`${line}-${lineIndex}`} className="list-decimal pl-1">{linkedText(line.replace(/^\d+[.)]\s+/, ''))}</li>)}
            </ol>
          );
        }
        return <p key={`${block}-${index}`} className="whitespace-pre-line">{linkedText(block)}</p>;
      })}
    </div>
  );
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
    loadPublicForm(workspaceSlug, formSlug)
      .then(value => {
        if (!active) return;
        setData(value);
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
    if (!data.form.schema.settings.autosave) return;
    setSaveState('Saving…');
    const timer = window.setTimeout(() => {
      sessionStorage.setItem(draftKey, JSON.stringify({ answers, page }));
      setSaveState('Saved on this device');
    }, 500);
    return () => window.clearTimeout(timer);
  }, [answers, data, draftKey, page]);

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-8" aria-live="polite"><div className="rounded-3xl border border-slate-200 bg-white px-8 py-10 text-center shadow-xl"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" /><p className="mt-4 font-bold text-slate-600">Loading your secure form…</p></div></main>;
  if (loadError || !data || !workspaceSlug) return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-center"><section className="max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-xl"><LockKeyhole className="mx-auto h-10 w-10 text-slate-400" /><h1 className="mt-4 text-2xl font-black text-slate-950">This form is unavailable</h1><p className="mt-3 leading-6 text-slate-600">Check the address or ask the business for the correct form link.</p></section></main>;

  const schema = data.form.schema;
  const pages = schema.pages.length ? schema.pages : [{ id: 'all', title: data.form.title }];
  const total = pages.length;
  const state = formState(schema, answers);
  const terms = termsContent(schema);
  const formPath = `/form/${encodeURIComponent(formSlug)}`;

  const reviewConsentForm = () => {
    setReview(false);
    setPage(0);
    setSubmitError('');
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const validationErrors = (scope: 'current' | 'all') => {
    const next: Record<string, string> = {};
    const activePage = schema.pages[page];
    for (const field of schema.fields) {
      const key = field.key || field.id;
      const fieldState = state.get(key);
      if (!fieldState?.visible) continue;
      if (scope === 'current' && activePage && field.pageId && field.pageId !== activePage.id) continue;
      const value = answers[key];
      if (fieldState.required && (value == null || value === '' || value === false || (Array.isArray(value) && !value.length))) {
        next[key] = field.validation.errorMessage || 'This answer is required.';
      }
    }
    setErrors(next);
    return next;
  };

  const focusFirstError = (next: Record<string, string>) => {
    const firstKey = Object.keys(next)[0];
    if (!firstKey) return;
    const field = schema.fields.find(candidate => (candidate.key || candidate.id) === firstKey);
    if (field?.pageId) {
      const fieldPage = schema.pages.findIndex(candidate => candidate.id === field.pageId);
      if (fieldPage >= 0) setPage(fieldPage);
    }
    window.requestAnimationFrame(() => document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const forward = () => {
    const next = validationErrors('current');
    if (Object.keys(next).length) {
      focusFirstError(next);
      return;
    }
    if (page < total - 1) setPage(current => current + 1);
    else setReview(true);
  };

  const submit = async () => {
    if (submitting) return;
    const next = validationErrors('all');
    if (Object.keys(next).length) {
      setSubmitError('Please complete the highlighted required answers before submitting.');
      setReview(false);
      focusFirstError(next);
      return;
    }
    if (!accepted || name.trim().length < 2) {
      setSubmitError('Please open the linked consent documents, tick the acceptance box and enter your full legal name.');
      window.requestAnimationFrame(() => document.getElementById('consent-confirmation')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const response = await fetch(`${formEndpoint(workspaceSlug, formSlug)}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers,
          acknowledgement: { accepted: true, name: name.trim() },
          idempotencyKey,
          language: navigator.language || 'en-GB',
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
      navigate(`${formPath}/success`, { replace: true });
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'FORM_SUBMISSION_FAILED';
      setSubmitError(friendlySubmissionError(code));
    } finally {
      setSubmitting(false);
    }
  };

  const progress = review ? 100 : Math.round((100 * (page + 1)) / total);
  const primary = schema.theme.primaryColor || data.salon.primaryColor;
  const accent = schema.theme.mutedColor || data.salon.accentColor;
  const brandGradient = `linear-gradient(90deg, ${primary}, ${accent})`;

  return <main className="relative min-h-screen overflow-hidden px-4 py-6 md:px-8 md:py-10" style={{ background: schema.theme.backgroundColor, color: schema.theme.textColor }}>
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[460px] opacity-80" style={{ background: `radial-gradient(circle at top left, ${primary}26, transparent 45%), radial-gradient(circle at top right, ${accent}22, transparent 42%)` }} />
    <div className="relative mx-auto max-w-3xl">
      <header className="mb-5 rounded-3xl border border-white/70 bg-white/80 p-5 shadow-sm backdrop-blur md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em]" style={{ color: primary }}>{data.salon.name}</p><p className="mt-1 text-sm font-semibold text-slate-500">Secure digital consent</p></div>
          <div className="flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black" style={{ borderColor: `${accent}40`, background: `${accent}12`, color: accent }}><ShieldCheck className="h-4 w-4" />Encrypted and private</div>
        </div>
        <div className="mt-5 flex items-center justify-between text-xs font-bold text-slate-500"><span>{review ? 'Final review' : `Step ${page + 1} of ${total}`}</span><span aria-live="polite">{saveState}</span></div>
        {schema.theme.progressStyle !== 'NONE' && <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: brandGradient }} /></div>}
      </header>

      <section className="overflow-hidden rounded-[32px] border border-slate-200/80 shadow-2xl shadow-slate-300/40" style={{ background: schema.theme.cardColor }}>
        {!review ? <>
          <div className="border-b border-slate-100 px-6 py-7 md:px-9 md:py-9">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-wide" style={{ background: `${accent}12`, color: accent }}><Sparkles className="h-3.5 w-3.5" />Please complete all required fields</div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950 md:text-4xl">{pages[page]?.title || data.form.title}</h1>
            {page === 0 && data.form.description && <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">{data.form.description}</p>}
            <div className="mt-6 h-1.5 w-28 rounded-full" style={{ background: brandGradient }} />
          </div>
          <div className="px-6 py-7 md:px-9 md:py-9"><FormRenderer schema={schema} answers={answers} onChange={(key, value) => { setAnswers(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: '' })); setSubmitError(''); }} page={schema.pages.length ? page : undefined} errors={errors} language={navigator.language} /></div>
          {submitError && <p role="alert" className="mx-6 mb-5 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700 md:mx-9">{submitError}</p>}
          <nav aria-label="Form navigation" className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-6 py-5 md:px-9">
            <button type="button" onClick={() => setPage(current => Math.max(0, current - 1))} disabled={page === 0} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-sm disabled:opacity-30"><ArrowLeft className="h-4 w-4" />Back</button>
            <button type="button" onClick={forward} className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black text-white shadow-md transition hover:brightness-95" style={{ background: brandGradient }}>{page === total - 1 ? 'Review answers' : 'Continue'}<ArrowRight className="h-4 w-4" /></button>
          </nav>
        </> : <>
          <div className="border-b border-slate-100 px-6 py-7 md:px-9 md:py-9"><div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-wide" style={{ background: `${accent}12`, color: accent }}><CheckCircle2 className="h-3.5 w-3.5" />Almost finished</div><h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Review and confirm</h1><p className="mt-2 text-slate-600">Check your information before sending it securely to {data.salon.name}.</p></div>
          <div className="px-6 py-7 md:px-9 md:py-9"><dl className="space-y-3">{schema.fields.filter(field => state.get(field.key || field.id)?.visible && !['INFORMATION', 'HEADING', 'DIVIDER', 'HIDDEN'].includes(field.type)).map(field => { const value = answers[field.key || field.id]; return <div key={field.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"><dt className="text-xs font-black uppercase tracking-wide text-slate-500">{field.label}</dt><dd className="mt-1 font-semibold text-slate-900">{formatFormAnswer(field, value)}</dd></div>; })}</dl>
            <section id="consent-confirmation" className="mt-6 rounded-2xl border p-5" style={{ borderColor: `${primary}35`, background: `${primary}0d` }}>
              <h2 className="font-black" style={{ color: primary }}>Consent acknowledgement</h2>
              <p className="mt-2 text-sm leading-6 text-slate-700">{data.form.acknowledgementText}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={formPath} onClick={event => { event.preventDefault(); reviewConsentForm(); }} className="inline-flex items-center gap-1.5 rounded-full border border-white bg-white px-3 py-2 text-xs font-black shadow-sm" style={{ color: primary }}><ArrowLeft className="h-3.5 w-3.5" />Review consent form</a>
                <a href={`${formPath}/acknowledgement`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-white bg-white px-3 py-2 text-xs font-black shadow-sm" style={{ color: primary }}><FileText className="h-3.5 w-3.5" />Consent acknowledgement<ExternalLink className="h-3 w-3" /></a>
                {terms && <a href={`${formPath}/terms`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-white bg-white px-3 py-2 text-xs font-black shadow-sm" style={{ color: primary }}><FileText className="h-3.5 w-3.5" />Terms &amp; conditions<ExternalLink className="h-3 w-3" /></a>}
              </div>
              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border bg-white p-4" style={{ borderColor: `${accent}45` }}><input type="checkbox" checked={accepted} onChange={event => { setAccepted(event.target.checked); setSubmitError(''); }} className="mt-0.5 h-5 w-5 rounded border-slate-300" style={{ accentColor: primary }} /><span className="text-sm font-bold text-slate-800">I have read and accept the linked consent acknowledgement{terms ? ' and terms and conditions' : ''}.</span></label>
              <label className="mt-4 block text-sm font-black text-slate-800">Full legal name<input value={name} onChange={event => { setName(event.target.value); setSubmitError(''); }} placeholder="Type your full name" aria-invalid={Boolean(submitError && name.trim().length < 2)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3.5 font-normal outline-none focus:ring-4" /></label>
            </section>
            {submitError && <p role="alert" aria-live="assertive" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{submitError}</p>}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-6 py-5 md:px-9"><button type="button" onClick={() => { setReview(false); setSubmitError(''); }} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700"><ArrowLeft className="h-4 w-4" />Edit answers</button><button type="button" onClick={() => void submit()} disabled={submitting} aria-busy={submitting} className="rounded-xl px-6 py-3 text-sm font-black text-white shadow-md disabled:cursor-wait disabled:opacity-60" style={{ background: brandGradient }}>{submitting ? 'Submitting securely…' : 'Submit consent form'}</button></div>
        </>}
      </section>

      <footer className="mt-5 flex items-center justify-center gap-2 text-center text-xs font-bold text-slate-500"><LockKeyhole className="h-3.5 w-3.5" />Your answers are encrypted and shared only with {data.salon.name}.</footer>
    </div>
  </main>;
}

export function PublicWorkspaceFormLegalPage({ documentType }: { documentType: LegalDocumentType }) {
  const formSlug = pathFormSlug();
  const workspaceSlug = currentWorkspaceSlug();
  const [data, setData] = useState<PublicWorkspaceFormData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!workspaceSlug || !formSlug) {
      setError('FORM_NOT_FOUND');
      return;
    }
    let active = true;
    loadPublicForm(workspaceSlug, formSlug)
      .then(value => { if (active) setData(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'FORM_NOT_FOUND'); });
    return () => { active = false; };
  }, [formSlug, workspaceSlug]);

  if (error) return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-center"><section className="max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-xl"><FileText className="mx-auto h-10 w-10 text-slate-400" /><h1 className="mt-4 text-2xl font-black text-slate-950">This document is unavailable</h1><p className="mt-3 text-slate-600">Return to the consent form or contact the business for assistance.</p></section></main>;
  if (!data) return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-8" aria-live="polite"><div className="rounded-3xl border border-slate-200 bg-white px-8 py-10 text-center shadow-xl"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" /><p className="mt-4 font-bold text-slate-600">Loading document…</p></div></main>;

  const content = documentType === 'terms' ? termsContent(data.form.schema) : data.form.acknowledgementText.trim();
  const title = documentType === 'terms' ? 'Terms and conditions' : 'Consent acknowledgement';
  const primary = data.form.schema.theme.primaryColor || data.salon.primaryColor;
  const accent = data.form.schema.theme.mutedColor || data.salon.accentColor;
  const formPath = `/form/${encodeURIComponent(formSlug)}`;

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-100 px-4 py-7 md:px-8 md:py-12">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px]" style={{ background: `radial-gradient(circle at top left, ${primary}24, transparent 45%), radial-gradient(circle at top right, ${accent}20, transparent 42%)` }} />
      <div className="relative mx-auto max-w-4xl">
        <a href={formPath} className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/90 px-4 py-2 text-sm font-black text-slate-700 shadow-sm backdrop-blur hover:bg-white"><ArrowLeft className="h-4 w-4" />Back to consent form</a>
        <article className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-2xl shadow-slate-300/50">
          <header className="border-b border-slate-100 px-6 py-8 md:px-12 md:py-12" style={{ background: `linear-gradient(135deg, ${primary}10, ${accent}0f)` }}>
            <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] shadow-sm" style={{ color: primary }}><ShieldCheck className="h-3.5 w-3.5" />Official consent document</div>
            <p className="mt-6 text-sm font-black uppercase tracking-[0.16em]" style={{ color: primary }}>{data.salon.name}</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 md:text-5xl">{title}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">Please read this document carefully. It forms part of the consent record for “{data.form.title}”.</p>
          </header>
          <div className="px-6 py-8 md:px-12 md:py-12">
            {content ? <LegalDocumentBody content={content} /> : <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><FileText className="mx-auto h-8 w-8 text-slate-400" /><h2 className="mt-3 font-black text-slate-900">No {title.toLowerCase()} have been provided</h2><p className="mt-2 text-sm text-slate-600">Please contact {data.salon.name} before accepting the consent form.</p></div>}
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 bg-slate-50 px-6 py-5 text-xs font-bold text-slate-500 md:px-12"><span className="inline-flex items-center gap-2"><LockKeyhole className="h-3.5 w-3.5" />Secure document provided by {data.salon.name}</span><a href={formPath} className="font-black underline underline-offset-4" style={{ color: primary }}>Return to form</a></footer>
        </article>
      </div>
    </main>
  );
}

export function PublicWorkspaceFormSuccessPage() {
  return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6"><section className="max-w-lg rounded-[32px] border border-slate-200 bg-white p-9 text-center shadow-2xl"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100"><CheckCircle2 className="h-9 w-9 text-emerald-600" /></div><h1 className="mt-5 text-3xl font-black tracking-tight text-slate-950">Form submitted</h1><p className="mt-3 leading-6 text-slate-600">Your response was received securely. You may now close this page.</p><div className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-black text-slate-600"><ShieldCheck className="h-4 w-4 text-emerald-600" />Securely recorded</div></section></main>;
}
