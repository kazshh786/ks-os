import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FactFindingForm } from '../fact-finding/FactFindingForm';
import { agencyFetch } from './AgencyAuth';

const statusBadge = (value: string) => <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-black text-slate-300">{value.replaceAll('_', ' ')}</span>;

type CaptureMode = 'ASSISTED' | 'EMAIL';

export function AgencyFactFindingPage() {
  const [searchParams] = useSearchParams();
  const [tenants, setTenants] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTenant, setSelectedTenant] = useState(() => searchParams.get('tenant') || '');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [mode, setMode] = useState<CaptureMode>('ASSISTED');
  const [participantName, setParticipantName] = useState('');
  const [participantEmail, setParticipantEmail] = useState('');
  const [search, setSearch] = useState('');
  const [questionnaire, setQuestionnaire] = useState<any>(null);
  const [manualForm, setManualForm] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [responses, setResponses] = useState<any[]>([]);
  const [brief, setBrief] = useState<any>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewAction, setReviewAction] = useState<{ reference: string; type: 'CLARIFY' | 'EVIDENCE' | 'REJECT' | 'EDIT' | 'NOT_APPLICABLE'; response?: any; question?: any } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewValue, setReviewValue] = useState('');
  const [discoveryLink, setDiscoveryLink] = useState('');

  useEffect(() => {
    void Promise.all([agencyFetch('/tenants'), agencyFetch('/fact-finding/templates')])
      .then(([tenantRows, templateRows]) => {
        setTenants(tenantRows);
        setTemplates(templateRows);
        const active = templateRows.find((template: any) => template.status === 'ACTIVE') || templateRows[0];
        if (active) setSelectedTemplate(active.reference);
        const requestedQuestionnaire = searchParams.get('questionnaire');
        if (requestedQuestionnaire) void loadReview(requestedQuestionnaire).catch(caught => setError(caught.message));
      })
      .catch(caught => setError(caught.message));
  }, []);

  const filteredTenants = useMemo(() => tenants.filter(tenant => `${tenant.name} ${tenant.legalBusinessName || ''} ${tenant.primaryContactEmail || ''}`.toLowerCase().includes(search.toLowerCase())), [tenants, search]);
  const selectedBusiness = tenants.find(tenant => tenant.agencyReference === selectedTenant);

  const run = async <T,>(operation: () => Promise<T>, success?: (value: T) => void) => {
    setBusy(true); setError(''); setNotice('');
    try { const value = await operation(); success?.(value); return value; }
    catch (caught: any) { setError(caught.message); return null; }
    finally { setBusy(false); }
  };

  const startManualAction = () => {
    setError('');
    setNotice('');
  };

  const loadManualForm = async (reference: string) => {
    const data = await agencyFetch(`/fact-finding/questionnaires/${reference}/manual-form`);
    setManualForm(data);
    setAnswers(Object.fromEntries((data.responses || []).map((response: any) => [response.questionReference, response.answer])));
    return data;
  };

  const loadReview = async (reference = questionnaire?.reference) => {
    if (!reference) return;
    const [detail, responseRows] = await Promise.all([
      agencyFetch(`/fact-finding/questionnaires/${reference}`),
      agencyFetch(`/fact-finding/questionnaires/${reference}/responses`),
    ]);
    setQuestionnaire(detail);
    setResponses(responseRows);
  };

  const begin = async () => {
    if (!selectedTenant || !selectedTemplate) { setError('Choose a client business and an intake-form template.'); return; }
    if (mode === 'EMAIL' && (!participantName.trim() || !participantEmail.trim())) { setError('Add the client contact name and email before sending a secure link.'); return; }
    await run(async () => {
      const created = await agencyFetch('/fact-finding/questionnaires', {
        method: 'POST',
        body: JSON.stringify({
          tenantReference: selectedTenant,
          questionnaire: {
            templateReference: selectedTemplate,
            participant: mode === 'EMAIL' ? { displayName: participantName.trim(), email: participantEmail.trim() } : undefined,
          },
        }),
      });
      const prepared = await agencyFetch(`/fact-finding/questionnaires/${created.reference}/prequalify`, {
        method: 'POST',
        body: JSON.stringify({ questionOverrides: created.questions.map((question: any) => ({ questionReference: question.reference, included: true, required: question.required })) }),
      });
      setQuestionnaire(prepared);
      if (mode === 'EMAIL') {
        const invitation = await agencyFetch(`/fact-finding/questionnaires/${prepared.reference}/invite`, { method: 'POST', body: '{}' });
        setDiscoveryLink(`${window.location.origin}/fact-finding?invitation=${encodeURIComponent(invitation.invitationToken)}`);
        const invited = await agencyFetch(`/fact-finding/questionnaires/${prepared.reference}`);
        setQuestionnaire(invited);
        setNotice(`Secure discovery link queued for ${participantEmail}. The copyable link below is shown for this invitation only.`);
      } else {
        await loadManualForm(prepared.reference);
        setNotice('Assisted intake is ready. Complete it with the client in person, by phone or from existing records.');
      }
      return prepared;
    });
  };

  const saveManualAnswers = async (references: string[]) => {
    startManualAction();
    for (const reference of [...new Set(references)]) {
      if (answers[reference] === undefined) continue;
      await agencyFetch(`/fact-finding/questionnaires/${questionnaire.reference}/manual-responses/${reference}`, {
        method: 'PATCH', body: JSON.stringify({ answer: answers[reference] }),
      });
    }
    setNotice('Assisted intake progress saved. Every changed answer remains versioned and must still pass agency review.');
    await loadManualForm(questionnaire.reference);
  };

  const uploadManual = async (question: any, file: File) => {
    startManualAction();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const data = await agencyFetch(`/fact-finding/questionnaires/${questionnaire.reference}/manual-uploads`, {
      method: 'POST',
      body: JSON.stringify({
        questionReference: question.reference,
        fileName: file.name,
        mimeType: file.type,
        byteSize: file.size,
        digestSha256: digest,
        category: question.fieldMapping === 'ASSET.LOGO' ? 'LOGO' : question.fieldMapping === 'ASSET.LOCATION_PHOTO' ? 'LOCATION_PHOTO' : question.fieldMapping === 'ASSET.TEAM_PHOTO' ? 'TEAM_PHOTO' : 'SUPPORTING_DOCUMENT',
        publicUsePermission: false,
        aiUsePermission: false,
        copyrightConfirmed: true,
        consentStatus: 'NOT_APPLICABLE',
      }),
    });
    const transfer = await fetch(data.signedUploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!transfer.ok) throw new Error('The private upload could not be transferred.');
    await agencyFetch(`/fact-finding/questionnaires/${questionnaire.reference}/manual-uploads/${data.reference}/complete`, { method: 'POST', body: '{}' });
    const answer = [{ reference: data.reference, label: file.name }];
    setAnswers(current => ({ ...current, [question.reference]: answer }));
    await agencyFetch(`/fact-finding/questionnaires/${questionnaire.reference}/manual-responses/${question.reference}`, { method: 'PATCH', body: JSON.stringify({ answer }) });
    setNotice('File verified and stored privately. It still requires an explicit agency asset review before use.');
    await loadManualForm(questionnaire.reference);
  };

  const submitManual = async () => {
    startManualAction();
    await agencyFetch(`/fact-finding/questionnaires/${questionnaire.reference}/submit-manually`, { method: 'POST', body: '{}' });
    setManualForm(null);
    setNotice('Intake submitted for controlled review. Approve each usable fact before building the workspace.');
    await loadReview(questionnaire.reference);
  };

  const approve = async (response: any, approvedValue?: unknown) => {
    const question = questionnaire.questions?.find((item: any) => item.reference === response.questionReference);
    const publicFact = response.dataClassification === 'PUBLIC_FACT';
    const generationFact = ['PUBLIC_FACT', 'CONTENT_PREFERENCE'].includes(response.dataClassification);
    await run(() => agencyFetch(`/fact-finding/responses/${response.reference}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        ...(approvedValue === undefined ? {} : { approvedValue }),
        publicUseEligible: publicFact && Boolean(question?.publicUseAllowed),
        bookingUseEligible: Boolean(question?.bookingUseAllowed),
        generationUseEligible: generationFact && Boolean(question?.generationUseAllowed),
        verificationBasis: question?.evidenceRequired ? 'VERIFIED' : 'AGENCY_CONFIRMED',
        note: approvedValue === undefined ? 'Accepted during controlled agency review.' : 'Edited and accepted during controlled agency review.',
      }),
    }), () => void loadReview());
  };

  const reviewUpload = async (uploadReference: string, decision: 'APPROVED' | 'REJECTED') => {
    await run(() => agencyFetch(`/fact-finding/uploads/${uploadReference}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }), () => {
      setNotice(decision === 'APPROVED' ? 'Asset approved for its recorded permissions.' : 'Asset rejected and excluded from the production brief.');
      void loadReview();
    });
  };

  const submitReviewAction = async () => {
    if (!reviewAction || !reviewNote.trim()) return;
    if (reviewAction.type === 'EDIT') {
      let approvedValue: unknown = reviewValue;
      try { approvedValue = JSON.parse(reviewValue); } catch { /* Plain text is a valid governed fact value. */ }
      await approve(reviewAction.response, approvedValue);
      setReviewAction(null); setReviewNote(''); setReviewValue('');
      return;
    }
    const path = reviewAction.type === 'NOT_APPLICABLE' ? 'not-applicable' : ['CLARIFY', 'EVIDENCE'].includes(reviewAction.type) ? 'request-clarification' : 'reject';
    const payload = ['CLARIFY', 'EVIDENCE'].includes(reviewAction.type)
      ? { message: reviewNote.trim(), requiredResponseType: reviewAction.type === 'EVIDENCE' ? 'FILE_UPLOAD' : 'LONG_TEXT', evidenceRequested: reviewAction.type === 'EVIDENCE' }
      : { reason: reviewNote.trim() };
    await run(() => agencyFetch(`/fact-finding/responses/${reviewAction.reference}/${path}`, { method: 'POST', body: JSON.stringify(payload) }), () => {
      setReviewAction(null); setReviewNote(''); void loadReview();
    });
  };

  const buildBrief = async () => {
    await run(() => agencyFetch(`/fact-finding/questionnaires/${questionnaire.reference}/build-brief`, { method: 'POST', body: '{}' }), value => {
      setBrief(value);
      setNotice('A versioned production brief was created from approved facts and approved assets only.');
    });
  };

  const reset = () => {
    setQuestionnaire(null); setManualForm(null); setAnswers({}); setResponses([]); setBrief(null); setNotice(''); setError(''); setParticipantName(''); setParticipantEmail(''); setDiscoveryLink('');
  };

  if (manualForm) return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><button onClick={reset} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black text-slate-300">← Exit intake</button><span className="text-xs text-slate-500">Agency-assisted · no email invitation required</span></div>
    {error && <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-4 text-sm text-emerald-200">{notice}</p>}
    {discoveryLink && <section className="rounded-2xl border border-violet-800 bg-violet-950/20 p-4"><p className="text-xs font-black uppercase tracking-widest text-violet-300">Secure discovery link · shown once</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input readOnly value={discoveryLink} className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs"/><button onClick={() => void navigator.clipboard.writeText(discoveryLink).then(() => setNotice('Secure discovery link copied. Share it only with the intended client.'))} className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black">Copy link</button></div><p className="mt-2 text-xs text-slate-500">The bearer link expires automatically and can be revoked below. KS OS stores only its digest.</p></section>}
    <FactFindingForm questionnaire={manualForm} answers={answers} onChange={(reference, value) => setAnswers(current => ({ ...current, [reference]: value }))} onSave={saveManualAnswers} onSubmit={submitManual} onUpload={uploadManual} submitLabel="Submit for agency review" />
  </div>;

  return <div className="space-y-5">
    <header className="rounded-3xl border border-slate-800 bg-slate-900 p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-violet-300">Client onboarding</p><h1 className="mt-2 text-3xl font-black">Business intake and fact-find</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Choose a client, complete the existing intake form together or send a secure self-service link, then verify the facts before provisioning.</p></div><Link to="/agency/provisioning" className="rounded-xl bg-violet-600 px-4 py-3 text-xs font-black">Open provisioning</Link></div></header>
    {error && <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-4 text-sm text-emerald-200">{notice}</p>}

    {!questionnaire && <>
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-slate-500">1. Choose client</p><h2 className="mt-2 text-xl font-black">Which business are you onboarding?</h2></div><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search client businesses" className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm sm:w-72" /></div><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredTenants.map(tenant => <button key={tenant.id} onClick={() => { setSelectedTenant(tenant.agencyReference); setParticipantName(tenant.primaryContactName || ''); setParticipantEmail(tenant.primaryContactEmail || ''); }} className={`rounded-2xl border p-4 text-left transition ${selectedTenant === tenant.agencyReference ? 'border-violet-500 bg-violet-950/30' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`}><div className="flex items-start justify-between gap-2"><strong>{tenant.name}</strong>{statusBadge(tenant.lifecycleStatus)}</div><p className="mt-2 text-xs text-slate-500">{tenant.primaryContactName || 'No primary contact'} · {tenant.primaryContactEmail || 'No email saved'}</p><p className="mt-2 text-[10px] font-black uppercase tracking-widest text-violet-300">{tenant.planName || tenant.planKey || 'Plan not assigned'}</p></button>)}</div></section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6"><p className="text-xs font-black uppercase tracking-widest text-slate-500">2. Choose intake form</p><h2 className="mt-2 text-xl font-black">Use the form that will drive booking and website setup</h2><div className="mt-5 grid gap-3 md:grid-cols-2">{templates.map(template => <button key={template.reference} onClick={() => setSelectedTemplate(template.reference)} className={`rounded-2xl border p-4 text-left ${selectedTemplate === template.reference ? 'border-violet-500 bg-violet-950/30' : 'border-slate-800 bg-slate-950'}`}><div className="flex items-start justify-between gap-2"><strong>{template.name}</strong>{statusBadge(template.status)}</div><p className="mt-2 text-xs leading-5 text-slate-500">{template.description || 'Controlled business intake template'} · version {template.version}</p></button>)}</div>{templates.length === 0 && <p className="mt-4 rounded-xl border border-amber-900 bg-amber-950/20 p-4 text-sm text-amber-200">No intake template is available yet. The recommended KS OS onboarding form migration must be applied.</p>}</section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6"><p className="text-xs font-black uppercase tracking-widest text-slate-500">3. Choose how to complete it</p><div className="mt-4 grid gap-4 md:grid-cols-2"><button onClick={() => setMode('ASSISTED')} className={`rounded-2xl border p-5 text-left ${mode === 'ASSISTED' ? 'border-emerald-500 bg-emerald-950/20' : 'border-slate-800 bg-slate-950'}`}><strong className="text-lg">Complete together now</strong><p className="mt-2 text-sm leading-6 text-slate-400">Use it in person, over the phone or from records you already hold. No email or client login is required.</p></button><button onClick={() => setMode('EMAIL')} className={`rounded-2xl border p-5 text-left ${mode === 'EMAIL' ? 'border-violet-500 bg-violet-950/30' : 'border-slate-800 bg-slate-950'}`}><strong className="text-lg">Send secure link</strong><p className="mt-2 text-sm leading-6 text-slate-400">The client completes the same form themselves and can return later from their invitation.</p></button></div>
        {mode === 'EMAIL' && <div className="mt-5 grid gap-3 md:grid-cols-2"><label className="text-xs font-bold text-slate-400">Client contact name<input value={participantName} onChange={event => setParticipantName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white" /></label><label className="text-xs font-bold text-slate-400">Client email<input type="email" value={participantEmail} onChange={event => setParticipantEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white" /></label></div>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">{selectedBusiness ? `Ready for ${selectedBusiness.name}` : 'Select a client business above'}</p><button disabled={busy || !selectedTenant || !selectedTemplate} onClick={() => void begin()} className="rounded-xl bg-violet-600 px-5 py-3 text-xs font-black disabled:opacity-40">{mode === 'ASSISTED' ? 'Start assisted intake' : 'Create and send form'}</button></div>
      </section>
    </>}

    {questionnaire && !manualForm && <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-violet-300">Current discovery</p><h2 className="mt-2 text-2xl font-black">{questionnaire.tenantName}</h2><p className="mt-1 text-xs text-slate-500">Version {questionnaire.version} · {questionnaire.participants?.[0]?.displayName || participantName || 'Agency-assisted'}</p></div>{statusBadge(questionnaire.status)}</div><div className="mt-5 flex flex-wrap gap-2"><button onClick={() => void loadReview()} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black">Refresh progress</button>{['PREQUALIFIED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'].includes(questionnaire.status) && mode === 'ASSISTED' && <button onClick={() => void run(() => loadManualForm(questionnaire.reference))} className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black">Continue assisted intake</button>}{!['APPROVED', 'CANCELLED', 'SUPERSEDED'].includes(questionnaire.status) && <button disabled={busy} onClick={() => void run(() => agencyFetch(`/fact-finding/questionnaires/${questionnaire.reference}/revoke`, { method: 'POST', body: '{}' }), value => { setQuestionnaire(value); setDiscoveryLink(''); setNotice('Discovery access revoked. Existing invitation and session links are no longer valid.'); })} className="rounded-xl border border-rose-800 px-4 py-2 text-xs font-black text-rose-300">Revoke access</button>}<button onClick={reset} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black text-slate-400">Start another discovery</button></div></section>}

    {questionnaire?.uploads?.length > 0 && <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6"><div><p className="text-xs font-black uppercase tracking-widest text-slate-500">Governed asset library</p><h2 className="mt-2 text-xl font-black">Review private files and usage rights</h2><p className="mt-2 text-sm text-slate-400">Approval never overrides provenance, public-use permission, AI-use permission or subject consent.</p></div><div className="mt-5 grid gap-3 md:grid-cols-2">{questionnaire.uploads.map((upload: any) => <article key={upload.reference} className="rounded-2xl border border-slate-800 bg-slate-950 p-4"><div className="flex items-start justify-between gap-3"><div><strong className="break-all text-sm">{upload.fileName}</strong><p className="mt-1 text-xs text-slate-500">{upload.category.replaceAll('_', ' ')} · {Math.max(1, Math.round(Number(upload.byteSize || 0) / 1024))} KB</p></div>{statusBadge(upload.reviewStatus)}</div><div className="mt-3 flex flex-wrap gap-2">{statusBadge(upload.uploadStatus)}{statusBadge(`SCAN ${upload.scanStatus}`)}{statusBadge(upload.provenance || 'UNKNOWN SOURCE')}{statusBadge(upload.publicUsePermission ? 'PUBLIC USE ALLOWED' : 'PRIVATE ONLY')}{statusBadge(upload.aiUsePermission ? 'AI USE ALLOWED' : 'NO AI USE')}{statusBadge(`CONSENT ${upload.consentStatus}`)}</div>{upload.reviewStatus === 'PENDING' && upload.uploadStatus === 'UPLOADED' && <div className="mt-4 flex gap-2"><button disabled={busy} onClick={() => void reviewUpload(upload.reference, 'APPROVED')} className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black disabled:opacity-40">Approve asset</button><button disabled={busy} onClick={() => void reviewUpload(upload.reference, 'REJECTED')} className="rounded-xl border border-rose-800 px-3 py-2 text-xs font-black text-rose-300 disabled:opacity-40">Reject</button></div>}</article>)}</div></section>}

    {responses.length > 0 && <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-slate-500">Controlled review</p><h2 className="mt-2 text-xl font-black">Verify each candidate fact</h2><p className="mt-2 text-sm text-slate-400">Raw discovery stays separate until an agency reviewer accepts, edits, rejects or requests more information.</p></div><button onClick={() => void buildBrief()} className="rounded-xl bg-violet-600 px-4 py-3 text-xs font-black">Generate production brief</button></div>
      <div className="mt-5 space-y-3">{responses.map(response => {
        const question = questionnaire.questions?.find((item: any) => item.reference === response.questionReference);
        const reviewable = response.status !== 'AGENCY_APPROVED' && response.status !== 'NOT_APPLICABLE';
        return <article key={response.reference} className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><strong>{question?.label || response.fieldMapping || 'Discovery response'}</strong><p className="mt-1 text-xs text-slate-500">{response.source === 'CLIENT_PROVIDED' ? 'Client provided' : 'Agency assisted'} · {response.fieldMapping || 'No public mapping'}</p><div className="mt-2 flex flex-wrap gap-2">{statusBadge(response.dataClassification || 'PRIVATE_OPERATIONAL')}{statusBadge(response.verificationBasis || 'UNVERIFIED')}{question?.evidenceRequired && statusBadge('EVIDENCE REQUIRED')}</div></div>{statusBadge(response.status)}</div>
          <pre className="mt-4 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900 p-4 text-xs text-slate-300">{JSON.stringify(response.approvedValue ?? response.answer, null, 2)}</pre>
          {reviewable && <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => void approve(response)} className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black">Accept</button>
            <button onClick={() => { setReviewAction({ reference: response.reference, type: 'EDIT', response, question }); setReviewValue(typeof response.answer === 'string' ? response.answer : JSON.stringify(response.answer, null, 2)); setReviewNote('Edited value reviewed against source.'); }} className="rounded-xl border border-emerald-700 px-3 py-2 text-xs font-black text-emerald-300">Edit and accept</button>
            <button onClick={() => { setReviewAction({ reference: response.reference, type: 'CLARIFY', response, question }); setReviewNote(''); }} className="rounded-xl border border-amber-700 px-3 py-2 text-xs font-black text-amber-300">Request information</button>
            <button onClick={() => { setReviewAction({ reference: response.reference, type: 'EVIDENCE', response, question }); setReviewNote('Please provide evidence supporting this claim.'); }} className="rounded-xl border border-amber-700 px-3 py-2 text-xs font-black text-amber-300">Evidence required</button>
            {!question?.required && !question?.systemRequired && <button onClick={() => { setReviewAction({ reference: response.reference, type: 'NOT_APPLICABLE', response, question }); setReviewNote('Not applicable to this client.'); }} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-black text-slate-300">Not applicable</button>}
            <button onClick={() => { setReviewAction({ reference: response.reference, type: 'REJECT', response, question }); setReviewNote(''); }} className="rounded-xl border border-rose-800 px-3 py-2 text-xs font-black text-rose-300">Reject</button>
          </div>}
        </article>;
      })}</div>
    </section>}

    {reviewAction && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4"><section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-6">
      <h2 className="text-xl font-black">{{ CLARIFY: 'Request more information', EVIDENCE: 'Request supporting evidence', REJECT: 'Reject this candidate fact', EDIT: 'Edit and accept', NOT_APPLICABLE: 'Mark not applicable' }[reviewAction.type]}</h2>
      <p className="mt-2 text-sm text-slate-400">{reviewAction.type === 'EDIT' ? 'The edited value becomes the verified fact; the submitted raw answer remains in version history.' : 'Record a clear reason that will make sense in the audit history.'}</p>
      {reviewAction.type === 'EDIT' && <textarea autoFocus value={reviewValue} onChange={event => setReviewValue(event.target.value)} rows={7} aria-label="Approved fact value" className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-sm"/>}
      <textarea autoFocus={reviewAction.type !== 'EDIT'} value={reviewNote} onChange={event => setReviewNote(event.target.value)} rows={reviewAction.type === 'EDIT' ? 3 : 5} aria-label="Review reason" className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm"/>
      <div className="mt-4 flex justify-end gap-2"><button onClick={() => { setReviewAction(null); setReviewValue(''); }} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-black">Cancel</button><button disabled={!reviewNote.trim() || busy || (reviewAction.type === 'EDIT' && !reviewValue.trim())} onClick={() => void submitReviewAction()} className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black">Confirm</button></div>
    </section></div>}

    {brief && <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-emerald-300">Production brief v{brief.version}</p><h2 className="mt-2 text-2xl font-black">Provisioning readiness</h2></div>{statusBadge(brief.status)}</div><div className="mt-5 grid gap-3 md:grid-cols-4"><div className="rounded-2xl bg-slate-950 p-4"><small className="text-slate-500">Completion</small><strong className="mt-1 block text-2xl">{brief.readiness?.completionPercentage || 0}%</strong></div><div className="rounded-2xl bg-slate-950 p-4"><small className="text-slate-500">Approved facts</small><strong className="mt-1 block text-2xl">{brief.readiness?.approvedFactCount || 0}</strong></div><div className="rounded-2xl bg-slate-950 p-4"><small className="text-slate-500">Open clarifications</small><strong className="mt-1 block text-2xl">{brief.readiness?.clarificationCount || 0}</strong></div><div className="rounded-2xl bg-slate-950 p-4"><small className="text-slate-500">Status</small><strong className="mt-1 block text-sm">{brief.readiness?.readyForProvisioning ? 'READY' : 'BLOCKED'}</strong></div></div>{brief.readiness?.blockingIssues?.map((issue: any) => <p key={issue.code} className="mt-3 rounded-xl border border-rose-900 bg-rose-950/20 p-3 text-xs text-rose-200">{issue.code} — {issue.message || 'Resolve before provisioning.'}</p>)}<div className="mt-5 flex flex-wrap gap-2"><button disabled={brief.status !== 'REVIEW_REQUIRED' || !brief.readiness?.readyForProvisioning} onClick={() => void run(() => agencyFetch(`/production-briefs/${brief.reference}/approve`, { method: 'POST' }), setBrief)} className="rounded-xl border border-emerald-700 px-4 py-2 text-xs font-black text-emerald-300 disabled:opacity-40">Approve brief</button><button disabled={brief.status !== 'APPROVED'} onClick={() => void run(() => agencyFetch(`/production-briefs/${brief.reference}/lock`, { method: 'POST' }), value => { setBrief(value); setNotice('Brief locked. Provisioning will now use this exact verified version.'); })} className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black disabled:opacity-40">Lock for provisioning</button></div></section>}
  </div>;
}
