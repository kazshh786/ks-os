import React, { useEffect, useState } from 'react';
import { FactFindingForm } from './FactFindingForm';

const SESSION_KEY = 'ks-os-fact-finding-session';

async function clientFetch(path: string, sessionToken?: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (sessionToken) headers.set('X-Fact-Finding-Session', sessionToken);
  const response = await fetch(`/api/v1/fact-finding${path}`, { ...options, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || 'The questionnaire request could not be completed.');
  return body?.data ?? body;
}

export default function ClientFactFindingPage() {
  const [sessionToken, setSessionToken] = useState(() => sessionStorage.getItem(SESSION_KEY) || '');
  const [questionnaire, setQuestionnaire] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [clarificationDrafts, setClarificationDrafts] = useState<Record<string, string>>({});

  const load = async (token: string) => {
    const data = await clientFetch('/questionnaire', token);
    setQuestionnaire(data);
    setAnswers(Object.fromEntries((data.responses || []).map((response: any) => [response.questionReference, response.answer])));
  };

  useEffect(() => {
    const invitation = new URLSearchParams(window.location.search).get('invitation');
    if (invitation) {
      void clientFetch('/session', undefined, { method: 'POST', body: JSON.stringify({ invitationToken: invitation }) })
        .then(data => {
          sessionStorage.setItem(SESSION_KEY, data.sessionToken);
          setSessionToken(data.sessionToken);
          window.history.replaceState({}, '', '/fact-finding');
          return load(data.sessionToken);
        })
        .catch(caught => setError(caught.message));
    } else if (sessionToken) {
      void load(sessionToken).catch(caught => setError(caught.message));
    }
  }, []);

  const save = async (references: string[]) => {
    setError('');
    for (const reference of [...new Set(references)]) {
      if (answers[reference] === undefined) continue;
      await clientFetch(`/responses/${reference}`, sessionToken, {
        method: 'PATCH',
        body: JSON.stringify({ questionReference: reference, answer: answers[reference], source: 'CLIENT_PROVIDED', clientConfirmed: true }),
      });
    }
    setNotice('Your progress is saved securely. You can close this page and return from the same invitation link.');
    await load(sessionToken);
  };

  const upload = async (question: any, file: File) => {
    setError('');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const data = await clientFetch('/uploads', sessionToken, {
      method: 'POST',
      body: JSON.stringify({
        questionReference: question.reference,
        fileName: file.name,
        mimeType: file.type,
        byteSize: file.size,
        digestSha256: digest,
        category: 'SUPPORTING_DOCUMENT',
        publicUsePermission: false,
        aiUsePermission: false,
        copyrightConfirmed: true,
        consentStatus: 'NOT_APPLICABLE',
      }),
    });
    const response = await fetch(data.signedUploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!response.ok) throw new Error('The private upload could not be transferred.');
    await clientFetch(`/uploads/${data.reference}/complete`, sessionToken, { method: 'POST', body: '{}' });
    const answer = [{ reference: data.reference, label: file.name }];
    setAnswers(current => ({ ...current, [question.reference]: answer }));
    await clientFetch(`/responses/${question.reference}`, sessionToken, {
      method: 'PATCH',
      body: JSON.stringify({ questionReference: question.reference, answer, source: 'CLIENT_PROVIDED', clientConfirmed: true }),
    });
    setNotice('Your file was verified, stored privately and queued for agency review.');
    await load(sessionToken);
  };

  const submit = async () => {
    setError('');
    await clientFetch('/submit', sessionToken, { method: 'POST' });
    sessionStorage.removeItem(SESSION_KEY);
    setSubmitted(true);
  };

  const respondToClarification = async (reference: string) => {
    const response = clarificationDrafts[reference]?.trim();
    if (!response) return;
    await clientFetch(`/clarifications/${reference}/respond`, sessionToken, { method: 'POST', body: JSON.stringify({ response }) });
    setNotice('Your clarification was sent to the agency.');
    await load(sessionToken);
  };

  if (submitted) return <main className="min-h-screen bg-slate-950 p-5 text-white"><div className="mx-auto mt-20 max-w-xl rounded-3xl border border-emerald-800 bg-slate-900 p-8 text-center"><p className="text-xs font-black uppercase tracking-widest text-emerald-300">Submitted</p><h1 className="mt-3 text-3xl font-black">Thank you</h1><p className="mt-3 text-slate-400">Your information is now locked for agency review. They will contact you only when something needs clarification.</p></div></main>;
  if (!questionnaire) return <main className="grid min-h-screen place-items-center bg-slate-950 p-5 text-white"><div className="max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6"><h1 className="text-xl font-black">Business intake form</h1><p className="mt-2 text-sm text-slate-400">{error || 'Opening your secure form…'}</p></div></main>;

  return <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-8"><div className="mx-auto max-w-6xl space-y-5">
    {error && <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-4 text-sm text-emerald-200">{notice}</p>}
    {questionnaire.clarifications?.length > 0 && <section className="rounded-3xl border border-amber-800 bg-amber-950/20 p-6"><h2 className="text-lg font-black text-amber-200">The agency needs a little more information</h2><p className="mt-1 text-sm text-amber-100/70">Respond here and continue the form where you left off.</p><div className="mt-4 space-y-4">{questionnaire.clarifications.map((item: any) => <article key={item.reference} className="rounded-2xl border border-amber-900/60 bg-slate-950 p-4"><p className="text-sm font-bold">{item.message}</p><textarea value={clarificationDrafts[item.reference] || ''} onChange={event => setClarificationDrafts(value => ({ ...value, [item.reference]: event.target.value }))} rows={3} placeholder="Write your response" className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm"/><button onClick={() => void respondToClarification(item.reference).catch(caught => setError(caught.message))} className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-xs font-black text-slate-950">Send clarification</button></article>)}</div></section>}
    <FactFindingForm questionnaire={questionnaire} answers={answers} onChange={(reference, value) => setAnswers(current => ({ ...current, [reference]: value }))} onSave={save} onSubmit={submit} onUpload={upload} />
  </div></main>;
}
