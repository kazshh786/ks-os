import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleDashed, Clock3, Copy, ExternalLink, Globe2, Save, Users } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { FormSchemaJsonSchema } from '@ks-os/contracts';
import { getDataProvider } from '../data/data-provider.js';
import { useAuth } from '../auth/index.js';

type AssignmentStatus = 'PENDING' | 'OPENED' | 'SUBMITTED' | 'EXPIRED' | 'CANCELLED';
type FormAssignmentSummary = {
  id: string;
  clientId: string;
  clientName: string;
  appointmentId?: string;
  status: AssignmentStatus;
  createdAt: string;
  openedAt?: string;
  submittedAt?: string;
  expiresAt: string;
};

const statusLabel: Record<AssignmentStatus, string> = {
  PENDING: 'Not started',
  OPENED: 'In progress',
  SUBMITTED: 'Completed',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

function formattedDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function validateWebsiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
    return url.toString();
  } catch {
    throw new Error('Enter a full website URL beginning with https:// or http://.');
  }
}

export default function FormDetailPage() {
  const { formId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const [form, setForm] = useState<any>();
  const [versions, setVersions] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<FormAssignmentSummary[]>([]);
  const [clientId, setClientId] = useState(params.get('clientId') || '');
  const [appointmentId, setAppointmentId] = useState(params.get('appointmentId') || '');
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState('');
  const [activityError, setActivityError] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [savingCompletion, setSavingCompletion] = useState(false);
  const [completionMessage, setCompletionMessage] = useState('Thank you. Your response was received securely.');
  const [completionRedirectUrl, setCompletionRedirectUrl] = useState('');
  const returnTo = params.get('returnTo');

  const loadActivity = async (id: string) => {
    try {
      const rows = await getDataProvider().listFormAssignments({ formId: id, limit: '100' });
      setAssignments(rows as FormAssignmentSummary[]);
      setActivityError('');
    } catch {
      setActivityError('Completion activity could not be loaded.');
    }
  };

  useEffect(() => {
    if (!formId) return;
    Promise.all([
      getDataProvider().getForm(formId),
      getDataProvider().listFormVersions(formId),
      getDataProvider().listFormAssignments({ formId, limit: '100' }),
    ])
      .then(([loadedForm, loadedVersions, loadedAssignments]) => {
        setForm(loadedForm);
        setVersions(loadedVersions);
        setAssignments(loadedAssignments as FormAssignmentSummary[]);
        setCompletionMessage(loadedForm.fieldsJson?.settings?.completionMessage || 'Thank you. Your response was received securely.');
        setCompletionRedirectUrl(loadedForm.fieldsJson?.settings?.completionRedirectUrl || '');
      })
      .catch(() => setMsg('Form could not be loaded.'));
  }, [formId]);

  const completedAssignments = useMemo(() => assignments.filter(assignment => assignment.status === 'SUBMITTED'), [assignments]);
  const outstandingAssignments = useMemo(() => assignments.filter(assignment => ['PENDING', 'OPENED'].includes(assignment.status)), [assignments]);
  const inactiveAssignments = useMemo(() => assignments.filter(assignment => ['EXPIRED', 'CANCELLED'].includes(assignment.status)), [assignments]);
  const measurableAssignments = completedAssignments.length + outstandingAssignments.length;
  const completionRate = measurableAssignments ? Math.round((completedAssignments.length / measurableAssignments) * 100) : 0;

  const assign = async () => {
    if (!formId || !clientId) return;
    setAssigning(true);
    setMsg('');
    try {
      const assignment = await getDataProvider().createFormAssignment({ formId, clientId, appointmentId: appointmentId || undefined });
      setLink(`${location.origin}${assignment.completionPath}`);
      setMsg('Secure form link created. Review and share it only with the intended client.');
      await loadActivity(formId);
    } catch {
      setMsg('Assignment failed. Confirm the published form, client and appointment access.');
    } finally {
      setAssigning(false);
    }
  };

  const saveCompletionSettings = async () => {
    if (!formId || !form) return;
    setSavingCompletion(true);
    setMsg('');
    try {
      const redirectUrl = validateWebsiteUrl(completionRedirectUrl);
      const schema = FormSchemaJsonSchema.parse(form.fieldsJson);
      const updatedSchema = {
        ...schema,
        settings: {
          ...schema.settings,
          completionMessage: completionMessage.trim() || 'Thank you. Your response was received securely.',
          completionRedirectUrl: redirectUrl || undefined,
        },
      };
      const updated = await getDataProvider().updateForm(formId, {
        title: form.title,
        description: form.description || '',
        internalDescription: form.internalDescription || '',
        formType: form.formType || 'CONSENT',
        acknowledgementText: form.acknowledgementText || '',
        defaultLanguage: form.defaultLanguage || 'en-GB',
        supportedLanguages: form.supportedLanguages?.length ? form.supportedLanguages : ['en-GB'],
        schema: updatedSchema,
        expectedRevision: form.draftRevision || undefined,
      });
      await getDataProvider().publishForm(formId);
      setForm(updated);
      setCompletionRedirectUrl(redirectUrl);
      const nextVersions = await getDataProvider().listFormVersions(formId);
      setVersions(nextVersions);
      setMsg('Success page settings saved and published for new consent completions.');
    } catch (cause) {
      setMsg(cause instanceof Error ? cause.message : 'Success page settings could not be saved.');
    } finally {
      setSavingCompletion(false);
    }
  };

  const copyAndReturn = async () => {
    await navigator.clipboard.writeText(link);
    if (returnTo) navigate(returnTo);
  };

  if (!form) return <div>{msg || 'Loading…'}</div>;

  return <div className="space-y-6">
    {returnTo && <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4"><div><p className="text-xs font-black uppercase tracking-wider text-indigo-600">Customer inbox action</p><p className="mt-1 text-sm font-bold text-indigo-950">Customer and appointment context have been prefilled.</p></div><button type="button" onClick={() => navigate(returnTo)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 text-xs font-black text-indigo-700"><ArrowLeft className="h-4 w-4" />Inbox</button></div>}

    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-black text-slate-950">{form.title}</h1><p className="mt-1 text-slate-600">{form.description}</p></div>{role === 'owner' && <Link to={`/app/forms/${formId}/edit`} className="rounded-xl border border-slate-200 bg-white px-4 py-2 font-bold text-slate-800">Edit form fields</Link>}</div>

    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5 sm:p-6"><div className="flex items-start gap-3"><Users className="mt-0.5 h-5 w-5 text-indigo-600" /><div><h2 className="text-lg font-black text-slate-950">Consent completion</h2><p className="mt-1 text-sm text-slate-500">See who has completed this form and who still needs to respond.</p></div></div></div>
      <div className="grid gap-3 p-5 sm:grid-cols-4 sm:p-6">
        <div className="rounded-2xl bg-slate-950 p-4 text-white"><p className="text-2xl font-black">{measurableAssignments}</p><p className="mt-1 text-xs font-bold text-slate-400">Active assignments</p></div>
        <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-2xl font-black text-emerald-700">{completedAssignments.length}</p><p className="mt-1 text-xs font-bold text-emerald-800">Completed</p></div>
        <div className="rounded-2xl bg-amber-50 p-4"><p className="text-2xl font-black text-amber-700">{outstandingAssignments.length}</p><p className="mt-1 text-xs font-bold text-amber-800">Still outstanding</p></div>
        <div className="rounded-2xl bg-indigo-50 p-4"><p className="text-2xl font-black text-indigo-700">{completionRate}%</p><p className="mt-1 text-xs font-bold text-indigo-800">Completion rate</p></div>
      </div>
      {activityError && <p role="alert" className="mx-5 mb-5 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700 sm:mx-6">{activityError}</p>}
      <div className="grid gap-5 border-t border-slate-100 p-5 lg:grid-cols-2 sm:p-6">
        <div><div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" /><h3 className="font-black text-slate-950">Completed</h3></div><div className="mt-3 space-y-2">{completedAssignments.map(assignment => <div key={assignment.id} className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-900">{assignment.clientName}</p><p className="mt-1 text-xs font-semibold text-slate-500">Completed {formattedDate(assignment.submittedAt)}</p></div><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">Completed</span></div></div>)}{completedAssignments.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">No clients have completed this consent form yet.</div>}</div></div>
        <div><div className="flex items-center gap-2"><CircleDashed className="h-5 w-5 text-amber-600" /><h3 className="font-black text-slate-950">Still to complete</h3></div><div className="mt-3 space-y-2">{outstandingAssignments.map(assignment => <div key={assignment.id} className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-900">{assignment.clientName}</p><p className="mt-1 text-xs font-semibold text-slate-500">{assignment.status === 'OPENED' ? `Opened ${formattedDate(assignment.openedAt)}` : `Assigned ${formattedDate(assignment.createdAt)}`}</p></div><span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-700">{statusLabel[assignment.status]}</span></div></div>)}{outstandingAssignments.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">Nobody is currently waiting to complete this form.</div>}</div></div>
      </div>
      {inactiveAssignments.length > 0 && <details className="border-t border-slate-100 px-5 py-4 sm:px-6"><summary className="cursor-pointer text-sm font-black text-slate-600">Show {inactiveAssignments.length} expired or cancelled assignment{inactiveAssignments.length === 1 ? '' : 's'}</summary><div className="mt-3 divide-y divide-slate-100">{inactiveAssignments.map(assignment => <div key={assignment.id} className="flex items-center justify-between gap-4 py-3 text-sm"><span className="font-bold text-slate-700">{assignment.clientName}</span><span className="text-slate-500">{statusLabel[assignment.status]}</span></div>)}</div></details>}
    </section>

    {role === 'owner' && <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3"><Globe2 className="mt-0.5 h-5 w-5 text-indigo-600" /><div><h2 className="text-lg font-black text-slate-950">Success page</h2><p className="mt-1 text-sm leading-6 text-slate-500">Shown immediately after a client submits this consent form. Add the business website so they can return in one click.</p></div></div>
      <div className="mt-5 grid gap-5">
        <label className="block text-sm font-black text-slate-800">Success message<textarea value={completionMessage} onChange={event => setCompletionMessage(event.target.value)} rows={4} maxLength={2000} className="mt-2 w-full rounded-2xl border border-slate-200 p-3.5 font-normal leading-6 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" /></label>
        <label className="block text-sm font-black text-slate-800">Website clients return to<input type="url" value={completionRedirectUrl} onChange={event => setCompletionRedirectUrl(event.target.value)} placeholder="https://www.clientwebsite.co.uk" className="mt-2 w-full rounded-2xl border border-slate-200 p-3.5 font-normal outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" /><span className="mt-2 block text-xs font-normal leading-5 text-slate-500">Leave blank to show “You may now safely close this page.” Full HTTPS URLs are recommended.</span></label>
        <button type="button" disabled={savingCompletion} onClick={() => void saveCompletionSettings()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60"><Save className="h-4 w-4" />{savingCompletion ? 'Saving and publishing…' : 'Save and publish success page'}</button>
      </div>
    </section>}

    <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Published versions</h2>{versions.map(version => <Link key={version.id} to={`/app/forms/${formId}/versions/${version.id}`} className="mt-2 block text-sm underline">Version {version.versionNumber} · {new Date(version.publishedAt).toLocaleString()}</Link>)}</section>

    <section className="space-y-3 rounded-2xl border bg-white p-5">
      <div><h2 className="font-bold">Assign published form</h2><p className="mt-1 text-sm text-slate-500">The secure completion link is generated only after the client and optional appointment are validated by the API.</p></div>
      <label className="block text-sm font-bold text-slate-700">Client ID<input value={clientId} onChange={event => setClientId(event.target.value)} placeholder="Client ID" className="mt-1 w-full rounded-lg border p-2" /></label>
      <label className="block text-sm font-bold text-slate-700">Appointment ID <span className="font-medium text-slate-400">Required for staff where access is appointment-scoped</span><input value={appointmentId} onChange={event => setAppointmentId(event.target.value)} placeholder="Appointment ID" className="mt-1 w-full rounded-lg border p-2" /></label>
      <button type="button" disabled={assigning || !clientId} onClick={() => void assign()} className="rounded-xl bg-slate-950 px-4 py-2 font-bold text-white disabled:opacity-50">{assigning ? 'Creating secure link…' : 'Create secure link'}</button>
      {msg && <p role="status" className="rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">{msg}</p>}
      {link && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><code className="block break-all text-xs text-amber-950">{link}</code><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void navigator.clipboard.writeText(link)} className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-amber-900 ring-1 ring-amber-200"><Copy className="h-4 w-4" />Copy secure link</button><a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-amber-900 ring-1 ring-amber-200"><ExternalLink className="h-4 w-4" />Preview form</a>{returnTo && <button type="button" onClick={() => void copyAndReturn()} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white">Copy and return to inbox</button>}</div><p className="mt-3 text-xs text-amber-900">This URL grants access to a sensitive client form. Share it only with the intended client.</p></div>}
    </section>

    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Clock3 className="h-4 w-4" />Completion status updates automatically when an assigned client opens or submits their secure link.</div>
  </div>;
}
