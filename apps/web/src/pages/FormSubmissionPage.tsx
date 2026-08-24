import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  MessageSquareText,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import { Link, useParams } from 'react-router';
import { getDataProvider } from '../data/data-provider.js';
import { fetchWithAuth } from '../api/client.js';

function formatDate(value?: string) {
  if (!value) return { date: 'Unknown date', time: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: 'Unknown date', time: '' };
  return {
    date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
    time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  };
}

function displayPrimitive(value: unknown) {
  if (value === null || value === undefined || value === '') return 'Not provided';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function AnswerValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400">Not provided</span>;
    return (
      <div className="flex flex-wrap gap-2">
        {value.map((item, index) => (
          <span key={`${displayPrimitive(item)}-${index}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-700">
            {displayPrimitive(item)}
          </span>
        ))}
      </div>
    );
  }

  if (typeof value === 'object' && value !== null) {
    return (
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  const displayed = displayPrimitive(value);
  return <span className={displayed === 'Not provided' ? 'text-slate-400' : 'text-slate-900'}>{displayed}</span>;
}

export default function FormSubmissionPage() {
  const { submissionId } = useParams();
  const [submission, setSubmission] = useState<any>();
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const load = async () => {
    if (!submissionId) return;
    try {
      const loaded = await getDataProvider().getFormSubmission(submissionId);
      setSubmission(loaded);
      setError('');
    } catch {
      setError('Submission not found or access denied.');
    }
  };

  useEffect(() => {
    void load();
  }, [submissionId]);

  const review = async (status: string) => {
    setBusy(true);
    setError('');
    setSuccessMessage('');
    try {
      const response = await fetchWithAuth(`/api/v1/form-submissions/${submissionId}/review`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, notes: notes || undefined, fieldKeys: selected }),
      });
      if (!response.ok) throw new Error('Review action failed');
      setSuccessMessage(
        status === 'APPROVED'
          ? 'Consent response approved.'
          : status === 'REJECTED'
            ? 'Consent response rejected.'
            : status === 'ARCHIVED'
              ? 'Consent response archived.'
              : 'Selected fields were marked for changes.',
      );
      setSelected([]);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review action failed');
    } finally {
      setBusy(false);
    }
  };

  if (error && !submission) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Link to="/app/forms" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700">
          <ArrowLeft className="h-4 w-4" />
          Back to consent forms
        </Link>
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 font-bold text-red-700">{error}</div>
      </div>
    );
  }

  if (!submission) return <div className="py-10 text-center text-sm font-bold text-slate-500">Loading sensitive response…</div>;

  const submitted = formatDate(submission.submittedAt);
  const answerCount = Array.isArray(submission.renderedAnswers) ? submission.renderedAnswers.length : 0;

  return (
    <main className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/app/forms" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-black text-slate-700 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700">
          <ArrowLeft className="h-4 w-4" />
          Consent forms
        </Link>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          Submitted
        </span>
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-slate-950 p-5 text-white sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-300">Customer consent record</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{submission.formTitle}</h1>
              <p className="mt-2 text-sm font-semibold text-slate-400">Published version {submission.versionNumber}</p>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:min-w-[420px]">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
                <div className="flex items-center gap-2 text-slate-400"><UserRound className="h-4 w-4" /><span className="text-xs font-black uppercase tracking-wide">Customer</span></div>
                <p className="mt-1.5 font-black text-white">{submission.clientName}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
                <div className="flex items-center gap-2 text-slate-400"><CalendarDays className="h-4 w-4" /><span className="text-xs font-black uppercase tracking-wide">Submitted</span></div>
                <p className="mt-1.5 font-black text-white">{submitted.date}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-slate-400"><Clock3 className="h-3.5 w-3.5" />{submitted.time}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-3 sm:p-5">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-2xl font-black text-slate-950">{answerCount}</p>
            <p className="mt-1 text-xs font-bold text-slate-500">Recorded answers</p>
          </div>
          <div className="rounded-2xl bg-indigo-50 p-4">
            <p className="text-sm font-black text-indigo-800">{submission.appointmentId ? 'Linked booking' : 'Direct consent'}</p>
            <p className="mt-1 text-xs font-bold text-indigo-600/80">Submission context</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-4">
            <p className="text-sm font-black text-emerald-800">Acknowledged</p>
            <p className="mt-1 text-xs font-bold text-emerald-600/80">Customer confirmed consent</p>
          </div>
        </div>
      </section>

      <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div>
          <p className="font-black">Sensitive client information</p>
          <p className="mt-1 leading-6 text-amber-900/80">This view contains the complete submitted consent record. Access it only when needed for the customer’s treatment, service or operational record.</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-labelledby="submission-answers-heading">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
          <div>
            <div className="flex items-center gap-2 text-indigo-600">
              <ClipboardCheck className="h-5 w-5" />
              <p className="text-xs font-black uppercase tracking-[0.14em]">Complete response</p>
            </div>
            <h2 id="submission-answers-heading" className="mt-2 text-xl font-black text-slate-950">All consent form answers</h2>
            <p className="mt-1 text-sm text-slate-500">Every saved option and answer from the submitted form is shown below.</p>
          </div>
          <p className="text-sm font-bold text-slate-500">{answerCount} field{answerCount === 1 ? '' : 's'}</p>
        </div>

        <div className="divide-y divide-slate-100">
          {submission.renderedAnswers.map((answer: any, index: number) => {
            const fieldKey = answer.fieldKey || answer.fieldId;
            const isSelected = selected.includes(fieldKey);
            return (
              <article key={fieldKey || index} className={`grid gap-4 p-5 transition sm:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)] sm:p-6 ${isSelected ? 'bg-amber-50/60' : 'hover:bg-slate-50/70'}`}>
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.1em] text-slate-400">Question {index + 1}</p>
                  <h3 className="mt-1.5 text-sm font-black leading-6 text-slate-800">{answer.label}</h3>
                  <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-500">
                    <input
                      type="checkbox"
                      aria-label={`Request change to ${answer.label}`}
                      checked={isSelected}
                      onChange={event => setSelected(current => event.target.checked ? [...current, fieldKey] : current.filter(item => item !== fieldKey))}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Mark for changes
                  </label>
                </div>
                <div className="min-w-0 rounded-2xl border border-slate-100 bg-white p-4 text-sm font-semibold leading-6 shadow-sm">
                  <AnswerValue value={answer.value} />
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">Consent acknowledgement</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-emerald-950">{submission.acknowledgementText}</p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/80 px-3 py-2 text-sm font-black text-emerald-900">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Acknowledged by {submission.acknowledgementName}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <MessageSquareText className="mt-0.5 h-5 w-5 text-indigo-600" />
          <div>
            <h2 className="text-lg font-black text-slate-950">Review decision</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Approve the record, reject it, archive it, or select specific answers above before requesting changes.</p>
          </div>
        </div>

        <label className="mt-5 block text-sm font-black text-slate-800">
          Internal note
          <textarea
            value={notes}
            onChange={event => setNotes(event.target.value)}
            rows={4}
            placeholder="Optional note for the internal record…"
            className="mt-2 w-full rounded-2xl border border-slate-200 p-3.5 font-normal leading-6 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          />
        </label>

        {selected.length > 0 && (
          <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">{selected.length} answer{selected.length === 1 ? '' : 's'} selected for changes.</div>
        )}
        {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
        {successMessage && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{successMessage}</p>}

        <div className="mt-5 flex flex-wrap gap-2">
          <button disabled={busy || !selected.length} onClick={() => void review('CHANGES_REQUESTED')} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-black text-amber-800 disabled:cursor-not-allowed disabled:opacity-50">
            Request selected changes
            <ChevronRight className="h-4 w-4" />
          </button>
          <button disabled={busy} onClick={() => void review('APPROVED')} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60">Approve</button>
          <button disabled={busy} onClick={() => void review('REJECTED')} className="min-h-11 rounded-xl bg-red-700 px-4 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60">Reject</button>
          <button disabled={busy} onClick={() => void review('ARCHIVED')} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 disabled:cursor-wait disabled:opacity-60">Archive</button>
        </div>
      </section>
    </main>
  );
}
