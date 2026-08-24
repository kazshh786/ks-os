import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
} from 'lucide-react';
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

type SubmissionSummary = {
  id: string;
  formTitle: string;
  versionNumber: number;
  clientName: string;
  appointmentId?: string | null;
  submittedAt: string;
  status: string;
  reviewFlags?: unknown[];
};

type PublicLink = {
  publicSlug: string;
  workspaceSlug: string;
  path: string;
  status: string;
};

type SortMode = 'newest' | 'oldest' | 'customer' | 'form';

function formatSubmittedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: 'Unknown date', time: '' };
  return {
    date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  };
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || '?';
}

export default function ConsentFormsPage() {
  const { role } = useAuth();
  const [params] = useSearchParams();
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [links, setLinks] = useState<Record<string, PublicLink>>({});
  const [error, setError] = useState('');
  const [responsesError, setResponsesError] = useState('');
  const [responsesLoading, setResponsesLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [formFilter, setFormFilter] = useState('ALL');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const publicDomain = import.meta.env.VITE_PUBLIC_WORKSPACE_DOMAIN || 'kasimshah.com';
  const assignmentClientId = params.get('assign') === '1' ? params.get('clientId') : null;
  const assignmentAppointmentId = params.get('appointmentId');

  useEffect(() => {
    let active = true;

    getDataProvider()
      .listForms()
      .then(async rows => {
        if (!active) return;
        setForms(rows);

        const resolved = await Promise.all(
          rows.map(async (form: FormSummary) => {
            const response = await fetchWithAuth(`/api/v1/forms/${form.id}/public-link`);
            if (!response.ok) return null;
            const body = await response.json().catch(() => ({}));
            return body.data ? ([form.id, body.data as PublicLink] as const) : null;
          }),
        );

        if (active) {
          setLinks(
            Object.fromEntries(
              resolved.filter(Boolean) as Array<readonly [string, PublicLink]>,
            ),
          );
        }
      })
      .catch(() => {
        if (active) setError('Consent forms could not be loaded. No mock data has been substituted.');
      });

    if (!assignmentClientId) {
      setResponsesLoading(true);
      getDataProvider()
        .listFormSubmissions({ limit: '100' })
        .then(rows => {
          if (!active) return;
          setSubmissions(rows as SubmissionSummary[]);
          setResponsesError('');
        })
        .catch(() => {
          if (active) setResponsesError('Customer consent responses could not be loaded.');
        })
        .finally(() => {
          if (active) setResponsesLoading(false);
        });
    } else {
      setResponsesLoading(false);
    }

    return () => {
      active = false;
    };
  }, [assignmentClientId]);

  const publishedCount = forms.filter(form => form.status === 'PUBLISHED').length;
  const submissionCount = useMemo(
    () => forms.reduce((total, form) => total + Number(form.submissionCount || 0), 0),
    [forms],
  );

  const formOptions = useMemo(
    () => Array.from(new Set(submissions.map(submission => submission.formTitle).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [submissions],
  );

  const customerCount = useMemo(
    () => new Set(submissions.map(submission => submission.clientName.trim().toLowerCase()).filter(Boolean)).size,
    [submissions],
  );

  const visibleSubmissions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = submissions.filter(submission => {
      const matchesForm = formFilter === 'ALL' || submission.formTitle === formFilter;
      const matchesQuery = !normalizedQuery
        || submission.clientName.toLowerCase().includes(normalizedQuery)
        || submission.formTitle.toLowerCase().includes(normalizedQuery);
      return matchesForm && matchesQuery;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === 'oldest') return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
      if (sortMode === 'customer') return a.clientName.localeCompare(b.clientName);
      if (sortMode === 'form') return a.formTitle.localeCompare(b.formTitle);
      return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
    });
  }, [formFilter, query, sortMode, submissions]);

  const liveUrl = (formId: string) => {
    const link = links[formId];
    return link ? `https://${link.workspaceSlug}.${publicDomain}${link.path}` : '';
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {assignmentClientId && (
        <section className="flex flex-col gap-4 rounded-3xl border border-indigo-200 bg-indigo-50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-indigo-600">Customer inbox action</p>
            <h1 className="mt-1 text-xl font-black text-indigo-950">Choose a form to send</h1>
            <p className="mt-1 text-sm text-indigo-800">Only published forms can be assigned. The customer and linked booking are already selected.</p>
          </div>
          <Link to="/app/operations" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 text-xs font-black text-indigo-700">
            <ArrowLeft className="h-4 w-4" />
            Back to inbox
          </Link>
        </section>
      )}

      {!assignmentClientId && (
        <section className="relative overflow-hidden rounded-[32px] bg-slate-950 p-6 text-white shadow-xl sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-400/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-indigo-200">
                <Sparkles className="h-3.5 w-3.5" />
                Digital consent records
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Customer consent forms, all in one place</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Find a customer response quickly, filter by consent form, sort submissions by date, and open the complete submitted record without leaving the workspace.</p>
            </div>
            {role === 'owner' && (
              <Link to="/app/forms/new" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-indigo-500 px-5 text-sm font-black text-white shadow-lg shadow-indigo-950/30 transition hover:bg-indigo-400">
                <Plus className="h-5 w-5" />
                Create a form
              </Link>
            )}
          </div>
          <div className="relative mt-7 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-2xl font-black">{submissions.length}</p>
              <p className="mt-1 text-xs font-bold text-slate-400">Submitted responses</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-2xl font-black text-indigo-200">{customerCount}</p>
              <p className="mt-1 text-xs font-bold text-slate-400">Customers represented</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-2xl font-black text-emerald-300">{publishedCount}</p>
              <p className="mt-1 text-xs font-bold text-slate-400">Live consent forms</p>
            </div>
          </div>
        </section>
      )}

      <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div>
          <p className="font-black">Sensitive information stays protected</p>
          <p className="mt-1 text-emerald-900/80">Submitted consent records are only available to authorised workspace users. Open a response only when you have an operational reason to view it.</p>
        </div>
      </div>

      {!assignmentClientId && (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-labelledby="response-register-heading">
          <div className="border-b border-slate-100 p-5 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="flex items-center gap-2 text-indigo-600">
                  <ClipboardList className="h-5 w-5" />
                  <p className="text-xs font-black uppercase tracking-[0.16em]">Response register</p>
                </div>
                <h2 id="response-register-heading" className="mt-2 text-xl font-black text-slate-950">Customer consent forms</h2>
                <p className="mt-1 text-sm text-slate-500">Search by customer or form, filter a specific consent form, and sort the register without losing the customer context.</p>
              </div>
              <div className="text-sm font-bold text-slate-500">
                Showing <span className="text-slate-950">{visibleSubmissions.length}</span> of <span className="text-slate-950">{submissions.length}</span>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.45fr)_minmax(200px,0.35fr)]">
              <label className="relative block">
                <span className="sr-only">Search customer consent forms</span>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search customer or consent form…"
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                />
              </label>

              <label className="relative block">
                <span className="sr-only">Filter by consent form</span>
                <Filter className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  value={formFilter}
                  onChange={event => setFormFilter(event.target.value)}
                  className="min-h-12 w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-10 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                >
                  <option value="ALL">All consent forms</option>
                  {formOptions.map(title => <option key={title} value={title}>{title}</option>)}
                </select>
              </label>

              <label className="relative block">
                <span className="sr-only">Sort customer consent forms</span>
                <ArrowDownAZ className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  value={sortMode}
                  onChange={event => setSortMode(event.target.value as SortMode)}
                  className="min-h-12 w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-10 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="customer">Customer A–Z</option>
                  <option value="form">Form A–Z</option>
                </select>
              </label>
            </div>
          </div>

          {responsesError && <div role="alert" className="m-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700 sm:m-6">{responsesError}</div>}

          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-5 py-3.5 sm:px-6">Customer</th>
                  <th className="px-5 py-3.5">Consent form</th>
                  <th className="px-5 py-3.5">Submitted</th>
                  <th className="px-5 py-3.5">Context</th>
                  <th className="px-5 py-3.5 text-right sm:px-6">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleSubmissions.map(submission => {
                  const submitted = formatSubmittedAt(submission.submittedAt);
                  return (
                    <tr key={submission.id} className="group transition hover:bg-indigo-50/40">
                      <td className="px-5 py-4 sm:px-6">
                        <Link to={`/app/form-submissions/${submission.id}`} className="flex min-w-0 items-center gap-3 rounded-lg focus:outline-none focus:ring-4 focus:ring-indigo-100">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white">{initials(submission.clientName)}</span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-black text-slate-950 group-hover:text-indigo-700">{submission.clientName}</span>
                            <span className="mt-0.5 block text-xs font-semibold text-slate-400">Customer consent record</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-5 py-4">
                        <Link to={`/app/form-submissions/${submission.id}`} className="block rounded-lg focus:outline-none focus:ring-4 focus:ring-indigo-100">
                          <span className="block max-w-xs truncate text-sm font-black text-slate-800">{submission.formTitle}</span>
                          <span className="mt-0.5 block text-xs font-semibold text-slate-400">Version {submission.versionNumber || '—'}</span>
                        </Link>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                          <CalendarDays className="h-4 w-4 text-slate-400" />
                          <span>{submitted.date}</span>
                        </div>
                        <p className="mt-0.5 pl-6 text-xs font-semibold text-slate-400">{submitted.time}</p>
                      </td>
                      <td className="px-5 py-4">
                        {submission.appointmentId ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-black text-indigo-700">
                            <UsersRound className="h-3.5 w-3.5" />
                            Linked booking
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">
                            <UserRound className="h-3.5 w-3.5" />
                            Direct form
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right sm:px-6">
                        <Link
                          to={`/app/form-submissions/${submission.id}`}
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-black text-slate-700 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-100"
                        >
                          <Eye className="h-4 w-4" />
                          Open response
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {responsesLoading && (
            <div className="border-t border-slate-100 p-8 text-center text-sm font-bold text-slate-500">Loading customer consent responses…</div>
          )}

          {!responsesLoading && !responsesError && visibleSubmissions.length === 0 && (
            <div className="border-t border-slate-100 p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                <ClipboardList className="h-5 w-5 text-slate-500" />
              </div>
              <h3 className="mt-4 text-base font-black text-slate-950">No consent responses match this view</h3>
              <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">Try a different search or form filter. New submissions will appear here automatically.</p>
              {(query || formFilter !== 'ALL') && (
                <button type="button" onClick={() => { setQuery(''); setFormFilter('ALL'); }} className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700">
                  Clear filters
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">
          {error}
        </div>
      )}

      <section aria-labelledby="form-library-heading">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Form management</p>
            <h2 id="form-library-heading" className="mt-1 text-xl font-black text-slate-950">{assignmentClientId ? 'Published forms' : 'Consent form library'}</h2>
            <p className="mt-1 text-sm text-slate-500">{assignmentClientId ? 'Select the form that should be linked to this customer.' : `Manage the templates customers complete. ${submissionCount} secure response${submissionCount === 1 ? '' : 's'} have been captured across the library.`}</p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {forms.map(form => {
            const url = liveUrl(form.id);
            const isPublished = form.status === 'PUBLISHED';
            const assignmentHref = `/app/forms/${form.id}?clientId=${encodeURIComponent(assignmentClientId || '')}${assignmentAppointmentId ? `&appointmentId=${encodeURIComponent(assignmentAppointmentId)}` : ''}&returnTo=${encodeURIComponent('/app/operations')}`;

            return (
              <article key={form.id} className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-xl hover:shadow-slate-200/70">
                <div className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                      <FileText className="h-5 w-5" />
                    </div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${isPublished ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {isPublished && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                      {isPublished ? 'Live' : 'Draft'}
                    </span>
                  </div>
                  <h3 className="mt-5 text-xl font-black tracking-tight text-slate-950">{form.title}</h3>
                  <p className="mt-2 min-h-10 text-sm leading-6 text-slate-500">{form.description || 'No introduction has been added yet.'}</p>
                  <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-3 text-center">
                    <div>
                      <p className="font-black text-slate-900">{form.latestVersion || 0}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Version</p>
                    </div>
                    <div>
                      <p className="font-black text-slate-900">{form.assignmentCount || 0}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Assigned</p>
                    </div>
                    <div>
                      <p className="font-black text-slate-900">{form.submissionCount || 0}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Responses</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-center gap-2">
                    {assignmentClientId ? (
                      isPublished ? (
                        <Link to={assignmentHref} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white">
                          Assign this form
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      ) : (
                        <span className="flex-1 rounded-xl bg-slate-200 px-4 py-2.5 text-center text-sm font-black text-slate-500">Publish before assigning</span>
                      )
                    ) : (
                      <Link to={`/app/forms/${form.id}`} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white">
                        <ClipboardList className="h-4 w-4" />
                        View form activity
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    )}

                    {!assignmentClientId && role === 'owner' && (
                      <Link
                        to={`/app/forms/${form.id}/edit`}
                        aria-label={`Edit fields for ${form.title}`}
                        title="Edit form fields"
                        className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 hover:text-indigo-600"
                      >
                        <FileText className="h-4 w-4" />
                      </Link>
                    )}

                    {!assignmentClientId && url && (
                      <>
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(url)}
                          aria-label={`Copy public link for ${form.title}`}
                          className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 hover:text-indigo-600"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        {isPublished && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open live ${form.title}`}
                            className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 hover:text-emerald-600"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {!error && forms.length === 0 && (
            <div className="col-span-full rounded-3xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50">
                <CheckCircle2 className="h-7 w-7 text-indigo-500" />
              </div>
              <h3 className="mt-4 text-lg font-black text-slate-950">Create your first consent form</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Build the fields customers need, publish the form and every submitted response will appear in the customer consent register above.</p>
              {role === 'owner' && (
                <Link to="/app/forms/new" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white">
                  <Plus className="h-4 w-4" />
                  Create a form
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
