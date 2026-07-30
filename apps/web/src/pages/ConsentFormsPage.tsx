import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardList, Copy, ExternalLink, FileText, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { fetchWithAuth } from '../api/client.js';
import { getDataProvider } from '../data/data-provider.js';
import { useAuth } from '../auth/index.js';

type FormSummary = {
  id: string;
  title: string;
  description?: string;
  status: string;
  latestVersion?: number;
  assignmentCount?: number;
  submissionCount?: number;
  updatedAt?: string;
};

type PublicLink = { publicSlug: string; workspaceSlug: string; path: string; status: string };

export default function ConsentFormsPage() {
  const { role } = useAuth();
  const [params] = useSearchParams();
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [links, setLinks] = useState<Record<string, PublicLink>>({});
  const [error, setError] = useState('');
  const publicDomain = import.meta.env.VITE_PUBLIC_WORKSPACE_DOMAIN || 'kasimshah.com';
  const assignmentClientId = params.get('assign') === '1' ? params.get('clientId') : null;
  const assignmentAppointmentId = params.get('appointmentId');

  useEffect(() => {
    let active = true;
    getDataProvider().listForms().then(async rows => {
      if (!active) return;
      setForms(rows);
      const resolved = await Promise.all(rows.map(async (form: FormSummary) => {
        const response = await fetchWithAuth(`/api/v1/forms/${form.id}/public-link`);
        if (!response.ok) return null;
        const body = await response.json().catch(() => ({}));
        return body.data ? [form.id, body.data as PublicLink] as const : null;
      }));
      if (active) setLinks(Object.fromEntries(resolved.filter(Boolean) as Array<readonly [string, PublicLink]>));
    }).catch(() => setError('Consent forms could not be loaded. No mock data has been substituted.'));
    return () => { active = false; };
  }, []);

  const publishedCount = forms.filter(form => form.status === 'PUBLISHED').length;
  const submissionCount = useMemo(() => forms.reduce((total, form) => total + Number(form.submissionCount || 0), 0), [forms]);

  const liveUrl = (formId: string) => {
    const link = links[formId];
    return link ? `https://${link.workspaceSlug}.${publicDomain}${link.path}` : '';
  };

  return <div className="mx-auto max-w-7xl space-y-6">
    {assignmentClientId && <section className="flex flex-col gap-4 rounded-3xl border border-indigo-200 bg-indigo-50 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-xs font-black uppercase tracking-wider text-indigo-600">Customer inbox action</p><h1 className="mt-1 text-xl font-black text-indigo-950">Choose a form to send</h1><p className="mt-1 text-sm text-indigo-800">Only published forms can be assigned. The customer and linked booking are already selected.</p></div>
      <Link to="/app/operations" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 text-xs font-black text-indigo-700"><ArrowLeft className="h-4 w-4" />Back to inbox</Link>
    </section>}

    {!assignmentClientId && <section className="relative overflow-hidden rounded-[32px] bg-slate-950 p-6 text-white shadow-xl sm:p-8">
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-400/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-indigo-200"><Sparkles className="h-3.5 w-3.5" />Digital consent</div><h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Beautiful forms that clients can complete anywhere</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Build consent, consultation and intake forms directly in the customer view, publish them to a simple link, and keep every response connected to the client record.</p></div>
        {role === 'owner' && <Link to="/app/forms/new" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-indigo-500 px-5 text-sm font-black text-white shadow-lg shadow-indigo-950/30 transition hover:bg-indigo-400"><Plus className="h-5 w-5" />Create a form</Link>}
      </div>
      <div className="relative mt-7 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-2xl font-black">{forms.length}</p><p className="mt-1 text-xs font-bold text-slate-400">Total forms</p></div><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-2xl font-black text-emerald-300">{publishedCount}</p><p className="mt-1 text-xs font-bold text-slate-400">Live forms</p></div><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-2xl font-black text-indigo-200">{submissionCount}</p><p className="mt-1 text-xs font-bold text-slate-400">Secure submissions</p></div></div>
    </section>}

    <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><div><p className="font-black">Sensitive information stays protected</p><p className="mt-1 text-emerald-900/80">Public links open only published versions. Assigned completion links should still be shared only with the intended client.</p></div></div>
    {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">{error}</div>}

    <section aria-labelledby="form-library-heading"><div className="mb-4 flex items-end justify-between gap-4"><div><h2 id="form-library-heading" className="text-xl font-black text-slate-950">{assignmentClientId ? 'Published forms' : 'Your form library'}</h2><p className="mt-1 text-sm text-slate-500">{assignmentClientId ? 'Select the form that should be linked to this customer.' : 'Open a form to edit fields, publish updates or review activity.'}</p></div></div>
      <div className="grid gap-5 lg:grid-cols-2">{forms.map(form => {
        const url = liveUrl(form.id);
        const isPublished = form.status === 'PUBLISHED';
        const assignmentHref = `/app/forms/${form.id}?clientId=${encodeURIComponent(assignmentClientId || '')}${assignmentAppointmentId ? `&appointmentId=${encodeURIComponent(assignmentAppointmentId)}` : ''}&returnTo=${encodeURIComponent('/app/operations')}`;
        return <article key={form.id} className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-xl hover:shadow-slate-200/70">
          <div className="p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><FileText className="h-5 w-5" /></div><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${isPublished ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{isPublished && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}{isPublished ? 'Live' : 'Draft'}</span></div><h3 className="mt-5 text-xl font-black tracking-tight text-slate-950">{form.title}</h3><p className="mt-2 min-h-10 text-sm leading-6 text-slate-500">{form.description || 'No introduction has been added yet.'}</p><div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-3 text-center"><div><p className="font-black text-slate-900">{form.latestVersion || 0}</p><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Version</p></div><div><p className="font-black text-slate-900">{form.assignmentCount || 0}</p><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Assigned</p></div><div><p className="font-black text-slate-900">{form.submissionCount || 0}</p><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Responses</p></div></div></div>
          <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center gap-2">{assignmentClientId ? (isPublished ? <Link to={assignmentHref} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white">Assign this form<ArrowRight className="h-4 w-4" /></Link> : <span className="flex-1 rounded-xl bg-slate-200 px-4 py-2.5 text-center text-sm font-black text-slate-500">Publish before assigning</span>) : role === 'owner' ? <Link to={`/app/forms/${form.id}/edit`} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white"><ClipboardList className="h-4 w-4" />Open builder<ArrowRight className="h-4 w-4" /></Link> : <Link to={`/app/forms/${form.id}`} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white">View form<ArrowRight className="h-4 w-4" /></Link>}{!assignmentClientId && url && <><button type="button" onClick={() => void navigator.clipboard.writeText(url)} aria-label={`Copy public link for ${form.title}`} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 hover:text-indigo-600"><Copy className="h-4 w-4" /></button>{isPublished && <a href={url} target="_blank" rel="noreferrer" aria-label={`Open live ${form.title}`} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 hover:text-emerald-600"><ExternalLink className="h-4 w-4" /></a>}</>}</div></div>
        </article>;
      })}{!error && forms.length === 0 && <div className="col-span-full rounded-3xl border-2 border-dashed border-slate-200 bg-white p-12 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50"><CheckCircle2 className="h-7 w-7 text-indigo-500" /></div><h3 className="mt-4 text-lg font-black text-slate-950">Create your first consent form</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Drag fields directly onto the customer view, save the draft and publish it to a simple public link.</p>{role === 'owner' && <Link to="/app/forms/new" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white"><Plus className="h-4 w-4" />Create a form</Link>}</div>}</div>
    </section>
  </div>;
}
