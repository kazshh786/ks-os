import { useEffect, useState } from 'react';
import { ArrowLeft, Copy, ExternalLink } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { getDataProvider } from '../data/data-provider.js';
import { useAuth } from '../auth/index.js';

export default function FormDetailPage() {
  const { formId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const [form, setForm] = useState<any>();
  const [versions, setVersions] = useState<any[]>([]);
  const [clientId, setClientId] = useState(params.get('clientId') || '');
  const [appointmentId, setAppointmentId] = useState(params.get('appointmentId') || '');
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState('');
  const [assigning, setAssigning] = useState(false);
  const returnTo = params.get('returnTo');

  useEffect(() => {
    if (!formId) return;
    Promise.all([getDataProvider().getForm(formId), getDataProvider().listFormVersions(formId)])
      .then(([loadedForm, loadedVersions]) => { setForm(loadedForm); setVersions(loadedVersions); })
      .catch(() => setMsg('Form could not be loaded.'));
  }, [formId]);

  const assign = async () => {
    if (!formId || !clientId) return;
    setAssigning(true);
    setMsg('');
    try {
      const assignment = await getDataProvider().createFormAssignment({ formId, clientId, appointmentId: appointmentId || undefined });
      setLink(`${location.origin}${assignment.completionPath}`);
      setMsg('Secure form link created. Review and share it only with the intended client.');
    } catch {
      setMsg('Assignment failed. Confirm the published form, client and appointment access.');
    } finally {
      setAssigning(false);
    }
  };

  const copyAndReturn = async () => {
    await navigator.clipboard.writeText(link);
    if (returnTo) navigate(returnTo);
  };

  if (!form) return <div>{msg || 'Loading…'}</div>;

  return <div className="space-y-5">
    {returnTo && <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4"><div><p className="text-xs font-black uppercase tracking-wider text-indigo-600">Customer inbox action</p><p className="mt-1 text-sm font-bold text-indigo-950">Customer and appointment context have been prefilled.</p></div><button type="button" onClick={() => navigate(returnTo)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 text-xs font-black text-indigo-700"><ArrowLeft className="h-4 w-4" />Inbox</button></div>}
    <div className="flex justify-between gap-4"><div><h1 className="text-2xl font-black">{form.title}</h1><p>{form.description}</p></div>{role === 'owner' && <Link to={`/app/forms/${formId}/edit`} className="rounded-xl border px-4 py-2 font-bold">Edit future draft</Link>}</div>
    <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Published versions</h2>{versions.map(version => <Link key={version.id} to={`/app/forms/${formId}/versions/${version.id}`} className="mt-2 block text-sm underline">Version {version.versionNumber} · {new Date(version.publishedAt).toLocaleString()}</Link>)}</section>
    <section className="space-y-3 rounded-2xl border bg-white p-5">
      <div><h2 className="font-bold">Assign published form</h2><p className="mt-1 text-sm text-slate-500">The secure completion link is generated only after the client and optional appointment are validated by the API.</p></div>
      <label className="block text-sm font-bold text-slate-700">Client ID<input value={clientId} onChange={event => setClientId(event.target.value)} placeholder="Client ID" className="mt-1 w-full rounded-lg border p-2" /></label>
      <label className="block text-sm font-bold text-slate-700">Appointment ID <span className="font-medium text-slate-400">Required for staff where access is appointment-scoped</span><input value={appointmentId} onChange={event => setAppointmentId(event.target.value)} placeholder="Appointment ID" className="mt-1 w-full rounded-lg border p-2" /></label>
      <button type="button" disabled={assigning || !clientId} onClick={() => void assign()} className="rounded-xl bg-slate-950 px-4 py-2 font-bold text-white disabled:opacity-50">{assigning ? 'Creating secure link…' : 'Create secure link'}</button>
      {msg && <p role="status" className="rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">{msg}</p>}
      {link && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><code className="block break-all text-xs text-amber-950">{link}</code><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void navigator.clipboard.writeText(link)} className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-amber-900 ring-1 ring-amber-200"><Copy className="h-4 w-4" />Copy secure link</button><a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-amber-900 ring-1 ring-amber-200"><ExternalLink className="h-4 w-4" />Preview form</a>{returnTo && <button type="button" onClick={() => void copyAndReturn()} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white">Copy and return to inbox</button>}</div><p className="mt-3 text-xs text-amber-900">This URL grants access to a sensitive client form. Share it only with the intended client.</p></div>}
    </section>
  </div>;
}
