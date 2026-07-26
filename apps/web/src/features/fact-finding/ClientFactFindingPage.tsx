import React, { useEffect, useMemo, useState } from 'react';

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

function decodeAnswer(question: any, raw: string | boolean) {
  if (question.questionType === 'BOOLEAN') return Boolean(raw);
  if (['NUMBER', 'DURATION'].includes(question.questionType)) return Number(raw);
  if (question.questionType === 'MONEY') return { amountMinor: Math.round(Number(raw) * 100), currency: 'GBP' };
  if (question.questionType === 'MULTI_SELECT') return String(raw).split(',').map(value => value.trim()).filter(Boolean);
  if (['ADDRESS', 'OPENING_HOURS', 'SERVICE_LIST', 'STAFF_LIST', 'LOCATION_LIST', 'REPEATING_GROUP'].includes(question.questionType)) {
    return JSON.parse(String(raw));
  }
  return String(raw);
}

function visible(question: any, answers: Record<string, unknown>) {
  return (question.conditions || []).every((condition: any) => {
    const answer = answers[condition.questionReference];
    if (condition.operator === 'IS_ANSWERED') return answer !== undefined && answer !== '';
    if (condition.operator === 'EQUALS') return answer === condition.value;
    if (condition.operator === 'NOT_EQUALS') return answer !== condition.value;
    if (condition.operator === 'INCLUDES') return Array.isArray(answer) && answer.includes(condition.value);
    if (condition.operator === 'GREATER_THAN') return Number(answer) > Number(condition.value);
    if (condition.operator === 'LESS_THAN') return Number(answer) < Number(condition.value);
    return true;
  });
}

export default function ClientFactFindingPage() {
  const [sessionToken, setSessionToken] = useState(() => sessionStorage.getItem(SESSION_KEY) || '');
  const [questionnaire, setQuestionnaire] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [drafts, setDrafts] = useState<Record<string, string | boolean>>({});
  const [section, setSection] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState('');

  const load = async (token: string) => {
    const data = await clientFetch('/questionnaire', token);
    setQuestionnaire(data);
    const saved = Object.fromEntries((data.responses || []).map((response: any) => [response.questionReference, response.answer]));
    setAnswers(saved);
    setDrafts(Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, typeof value === 'string' || typeof value === 'boolean' ? value : JSON.stringify(value, null, 2)])));
  };

  useEffect(() => {
    const invitation = new URLSearchParams(window.location.search).get('invitation');
    if (invitation) {
      void clientFetch('/session', undefined, { method: 'POST', body: JSON.stringify({ invitationToken: invitation }) })
        .then(data => { sessionStorage.setItem(SESSION_KEY, data.sessionToken); setSessionToken(data.sessionToken); window.history.replaceState({}, '', '/fact-finding'); return load(data.sessionToken); })
        .catch(caught => setError(caught.message));
    } else if (sessionToken) void load(sessionToken).catch(caught => setError(caught.message));
  }, []);

  const sections = useMemo(() => {
    const grouped = new Map<string, any[]>();
    for (const question of (questionnaire?.questions || []).filter((item: any) => visible(item, answers))) {
      const key = question.sectionReference || 'Business questionnaire';
      grouped.set(key, [...(grouped.get(key) || []), question]);
    }
    return [...grouped.entries()].map(([reference, questions], index) => ({ reference, title: `Section ${index + 1}`, questions }));
  }, [questionnaire, answers]);

  const save = async (question: any) => {
    setSaving(question.reference); setError('');
    try {
      const answer = decodeAnswer(question, drafts[question.reference] ?? '');
      await clientFetch(`/responses/${question.reference}`, sessionToken, { method: 'PATCH', body: JSON.stringify({ questionReference: question.reference, answer, source: 'CLIENT_PROVIDED', clientConfirmed: true }) });
      setAnswers(value => ({ ...value, [question.reference]: answer }));
      setNotice('Progress saved securely. You can close this page and return from your invitation.');
    } catch (caught: any) { setError(caught.message); } finally { setSaving(''); }
  };

  const upload = async (question: any, file: File) => {
    setSaving(question.reference); setError('');
    try {
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      const data = await clientFetch('/uploads', sessionToken, { method: 'POST', body: JSON.stringify({
        questionReference: question.reference, fileName: file.name, mimeType: file.type,
        byteSize: file.size, digestSha256: digest,
        category: question.questionType === 'IMAGE_UPLOAD' ? 'SUPPORTING_DOCUMENT' : 'SUPPORTING_DOCUMENT',
        publicUsePermission: false, aiUsePermission: false, copyrightConfirmed: true,
        consentStatus: 'NOT_APPLICABLE',
      }) });
      const response = await fetch(data.signedUploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw new Error('The private upload could not be transferred.');
      await clientFetch(`/uploads/${data.reference}/complete`, sessionToken, { method: 'POST', body: '{}' });
      setNotice('Upload verified privately and queued for agency review.');
    } catch (caught: any) { setError(caught.message); } finally { setSaving(''); }
  };

  if (submitted) return <main className="min-h-screen bg-slate-950 p-5 text-white"><div className="mx-auto mt-20 max-w-xl rounded-3xl border border-emerald-800 bg-slate-900 p-8 text-center"><p className="text-xs font-black uppercase tracking-widest text-emerald-300">Submitted</p><h1 className="mt-3 text-3xl font-black">Thank you</h1><p className="mt-3 text-slate-400">Your answers are locked for agency review. The agency will contact you if any field needs clarification.</p></div></main>;
  if (!questionnaire) return <main className="grid min-h-screen place-items-center bg-slate-950 p-5 text-white"><div className="max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6"><h1 className="text-xl font-black">Business fact-finding</h1><p className="mt-2 text-sm text-slate-400">{error || 'Opening your secure questionnaire…'}</p></div></main>;

  const active = sections[Math.min(section, Math.max(0, sections.length - 1))];
  const completion = questionnaire.completion?.completionPercentage || Math.round((Object.keys(answers).length / Math.max(1, questionnaire.questions.length)) * 100);
  return <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-8"><div className="mx-auto max-w-5xl space-y-5">
    <header className="rounded-3xl border border-slate-800 bg-slate-900 p-6"><p className="text-xs font-black uppercase tracking-widest text-violet-300">{questionnaire.tenantName}</p><h1 className="mt-2 text-3xl font-black">Tell us about your business</h1><p className="mt-2 text-sm text-slate-400">Work one section at a time. Most businesses complete this in 20–30 minutes. Your uploads remain private until the agency approves a permitted use.</p><div className="mt-5 flex items-center gap-3"><div className="h-2 flex-1 rounded-full bg-slate-950"><div className="h-2 rounded-full bg-violet-500" style={{ width: `${completion}%` }} /></div><strong className="text-xs">{completion}%</strong></div></header>
    {error && <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p>}{notice && <p role="status" className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-4 text-sm text-emerald-200">{notice}</p>}
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]"><nav aria-label="Questionnaire sections" className="space-y-2">{sections.map((item, index) => <button key={item.reference} onClick={() => setSection(index)} className={`w-full rounded-xl border p-3 text-left text-xs ${index === section ? 'border-violet-500 bg-violet-950/40' : 'border-slate-800 bg-slate-900'}`}><strong>{item.title}</strong><span className="mt-1 block text-slate-500">{item.questions.length} questions</span></button>)}</nav>
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-7"><h2 className="text-xl font-black">{active?.title || 'Review'}</h2><div className="mt-6 space-y-6">{active?.questions.map((question: any) => <article key={question.reference}><label className="block text-sm font-bold" htmlFor={question.reference}>{question.label}{question.required && <span className="ml-1 text-rose-300">*</span>}</label>{question.guidance && <p className="mt-1 text-xs text-slate-500">{question.guidance}</p>}{['FILE_UPLOAD', 'IMAGE_UPLOAD'].includes(question.questionType) ? <input id={question.reference} type="file" accept={question.questionType === 'IMAGE_UPLOAD' ? 'image/jpeg,image/png,image/webp,image/avif' : 'image/jpeg,image/png,image/webp,image/avif,application/pdf,text/plain'} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(question, file); }} className="mt-3 block w-full rounded-xl border border-dashed border-slate-700 bg-slate-950 p-4 text-xs"/> : question.questionType === 'BOOLEAN' ? <label className="mt-3 flex items-center gap-2 rounded-xl bg-slate-950 p-4 text-sm"><input id={question.reference} type="checkbox" checked={Boolean(drafts[question.reference])} onChange={event => setDrafts(value => ({ ...value, [question.reference]: event.target.checked }))}/> Yes</label> : <textarea id={question.reference} rows={['LONG_TEXT', 'RICH_TEXT_SAFE', 'POLICY', 'ADDRESS', 'OPENING_HOURS', 'REPEATING_GROUP'].includes(question.questionType) ? 5 : 2} value={String(drafts[question.reference] ?? '')} onChange={event => setDrafts(value => ({ ...value, [question.reference]: event.target.value }))} placeholder={['ADDRESS', 'OPENING_HOURS', 'REPEATING_GROUP'].includes(question.questionType) ? 'Use the structured example provided by your agency.' : 'Your answer'} className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm"/>}<button disabled={saving === question.reference} onClick={() => void save(question)} className="mt-2 rounded-lg border border-violet-700 px-3 py-2 text-xs font-black text-violet-200 disabled:opacity-50">{answers[question.reference] !== undefined ? 'Update saved answer' : 'Save answer'}</button></article>)}</div><div className="mt-8 flex flex-wrap justify-between gap-2"><button disabled={section === 0} onClick={() => setSection(value => Math.max(0, value - 1))} className="rounded-xl border border-slate-700 px-4 py-3 text-xs font-black disabled:opacity-30">Previous section</button>{section < sections.length - 1 ? <button onClick={() => setSection(value => Math.min(sections.length - 1, value + 1))} className="rounded-xl bg-violet-600 px-4 py-3 text-xs font-black">Next section</button> : <button onClick={() => void clientFetch('/submit', sessionToken, { method: 'POST' }).then(() => { sessionStorage.removeItem(SESSION_KEY); setSubmitted(true); }).catch(caught => setError(caught.message))} className="rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black">Review and submit</button>}</div></section>
    </div>
    {questionnaire.clarifications?.length > 0 && <section className="rounded-3xl border border-amber-800 bg-amber-950/20 p-6"><h2 className="text-lg font-black text-amber-200">Clarification requested</h2>{questionnaire.clarifications.map((item: any) => <div key={item.reference} className="mt-3 rounded-xl bg-slate-950 p-4"><p className="text-sm">{item.message}</p><button onClick={() => { const response = prompt('Your clarification response'); if (response) void clientFetch(`/clarifications/${item.reference}/respond`, sessionToken, { method: 'POST', body: JSON.stringify({ response }) }).then(() => load(sessionToken)).catch(caught => setError(caught.message)); }} className="mt-3 rounded-lg border border-amber-700 px-3 py-2 text-xs font-black">Respond</button></div>)}</section>}
  </div></main>;
}
