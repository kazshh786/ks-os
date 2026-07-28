import React, { useMemo, useState } from 'react';
import type { FormField, FormSchemaJson } from '@ks-os/contracts';
import { FormRenderer } from '../forms/FormRenderer';

type Question = {
  reference: string;
  label: string;
  guidance?: string;
  questionType: string;
  fieldMapping?: string;
  required?: boolean;
  conditions?: Array<{ questionReference: string; operator: string; value?: unknown }>;
  options?: Array<{ value: string; label: string }>;
  displayOrder?: number;
};

type Questionnaire = {
  tenantName?: string;
  questions: Question[];
  completion?: { completionPercentage?: number };
};

type Props = {
  questionnaire: Questionnaire;
  answers: Record<string, unknown>;
  onChange: (questionReference: string, value: unknown) => void;
  onSave: (questionReferences: string[]) => Promise<void>;
  onSubmit?: () => Promise<void>;
  onUpload?: (question: Question, file: File) => Promise<void>;
  submitLabel?: string;
  readOnly?: boolean;
};

const pageDefinitions = [
  { id: '10000000-0000-4000-8000-000000000001', key: 'BUSINESS', title: 'Business basics', description: 'Identity, contact details and the story behind the business.' },
  { id: '10000000-0000-4000-8000-000000000002', key: 'LOCATION', title: 'Locations', description: 'Premises, service areas and opening information.' },
  { id: '10000000-0000-4000-8000-000000000003', key: 'SERVICE', title: 'Services', description: 'What the business offers, pricing and booking requirements.' },
  { id: '10000000-0000-4000-8000-000000000004', key: 'STAFF', title: 'Team', description: 'People, roles, credentials and availability.' },
  { id: '10000000-0000-4000-8000-000000000005', key: 'BOOKING', title: 'Booking rules', description: 'Notice periods, deposits, cancellations and confirmations.' },
  { id: '10000000-0000-4000-8000-000000000006', key: 'BRAND', title: 'Brand and content', description: 'Visual direction, tone, proof and useful website content.' },
  { id: '10000000-0000-4000-8000-000000000007', key: 'ASSET', title: 'Files and evidence', description: 'Private uploads for agency review.' },
  { id: '10000000-0000-4000-8000-000000000008', key: 'OTHER', title: 'Additional details', description: 'Anything that does not fit the earlier sections.' },
] as const;

const customTypes = new Set(['MONEY', 'ADDRESS', 'OPENING_HOURS', 'SERVICE_LIST', 'STAFF_LIST', 'LOCATION_LIST', 'REPEATING_GROUP', 'FILE_UPLOAD', 'IMAGE_UPLOAD']);
const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function pageKey(question: Question) {
  if (['FILE_UPLOAD', 'IMAGE_UPLOAD'].includes(question.questionType)) return 'ASSET';
  const prefix = question.fieldMapping?.split('.')[0];
  return pageDefinitions.some(page => page.key === prefix) ? prefix : 'OTHER';
}

function fieldKey(reference: string) {
  return `q_${reference.replaceAll('-', '_')}`;
}

function optionId(index: number) {
  return `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function mapField(question: Question): FormField {
  const typeMap: Record<string, FormField['type']> = {
    SHORT_TEXT: 'SHORT_TEXT', LONG_TEXT: 'LONG_TEXT', RICH_TEXT_SAFE: 'LONG_TEXT', POLICY: 'LONG_TEXT',
    NUMBER: 'NUMBER', DURATION: 'NUMBER', DATE: 'DATE', BOOLEAN: 'YES_NO', SINGLE_SELECT: 'SELECT',
    MULTI_SELECT: 'MULTIPLE_CHOICE', PHONE: 'PHONE', EMAIL: 'EMAIL', URL: 'WEBSITE',
  };
  return {
    id: question.reference,
    key: fieldKey(question.reference),
    type: typeMap[question.questionType] || 'LONG_TEXT',
    label: question.label,
    description: question.guidance,
    required: Boolean(question.required),
    readOnly: false,
    hidden: false,
    width: '100',
    options: question.options?.map((option, index) => ({ id: optionId(index), label: option.label, value: option.value })),
    validation: {},
    sensitiveClassification: question.fieldMapping?.startsWith('BUSINESS.PUBLIC_') ? 'PERSONAL' : 'STANDARD',
    translations: {},
    accessibility: {},
  };
}

function answered(value: unknown) {
  if (value === undefined || value === null || value === '') return false;
  return !Array.isArray(value) || value.length > 0;
}

function visible(question: Question, answers: Record<string, unknown>) {
  return (question.conditions || []).every(condition => {
    const value = answers[condition.questionReference];
    if (condition.operator === 'IS_ANSWERED') return answered(value);
    if (condition.operator === 'EQUALS') return value === condition.value;
    if (condition.operator === 'NOT_EQUALS') return value !== condition.value;
    if (condition.operator === 'INCLUDES') return Array.isArray(value) && value.includes(condition.value);
    if (condition.operator === 'GREATER_THAN') return Number(value) > Number(condition.value);
    if (condition.operator === 'LESS_THAN') return Number(value) < Number(condition.value);
    return true;
  });
}

function AddressEditor({ value, onChange, disabled }: { value: unknown; onChange: (value: unknown) => void; disabled: boolean }) {
  const address = (value && typeof value === 'object' ? value : {}) as Record<string, string>;
  const update = (key: string, next: string) => onChange({ line1: address.line1 || '', city: address.city || '', postcode: address.postcode || '', countryCode: address.countryCode || 'GB', ...(address.line2 ? { line2: address.line2 } : {}), [key]: next });
  return <div className="mt-3 grid gap-3 md:grid-cols-2">
    <input disabled={disabled} value={address.line1 || ''} onChange={event => update('line1', event.target.value)} placeholder="Address line 1" className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm" />
    <input disabled={disabled} value={address.line2 || ''} onChange={event => update('line2', event.target.value)} placeholder="Address line 2 (optional)" className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm" />
    <input disabled={disabled} value={address.city || ''} onChange={event => update('city', event.target.value)} placeholder="Town or city" className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm" />
    <input disabled={disabled} value={address.postcode || ''} onChange={event => update('postcode', event.target.value.toUpperCase())} placeholder="Postcode" className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm" />
  </div>;
}

function MoneyEditor({ value, onChange, disabled }: { value: unknown; onChange: (value: unknown) => void; disabled: boolean }) {
  const amountMinor = Number((value as { amountMinor?: number } | undefined)?.amountMinor || 0);
  return <div className="mt-3 flex items-center rounded-xl border border-slate-700 bg-slate-950 focus-within:border-violet-500">
    <span className="px-3 text-sm font-black text-slate-400">£</span>
    <input disabled={disabled} type="number" min="0" step="0.01" value={amountMinor ? amountMinor / 100 : ''} onChange={event => onChange({ amountMinor: Math.round(Number(event.target.value || 0) * 100), currency: 'GBP' })} className="w-full bg-transparent p-3 text-sm outline-none" placeholder="0.00" />
  </div>;
}

function HoursEditor({ value, onChange, disabled }: { value: unknown; onChange: (value: unknown) => void; disabled: boolean }) {
  const rows = Array.isArray(value) && value.length === 7 ? value as Array<{ dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean }> : dayNames.map((_, dayOfWeek) => ({ dayOfWeek, opensAt: '09:00', closesAt: '17:00', closed: dayOfWeek > 4 }));
  const update = (index: number, patch: Partial<(typeof rows)[number]>) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  return <div className="mt-3 overflow-hidden rounded-xl border border-slate-800">
    {rows.map((row, index) => <div key={row.dayOfWeek} className="grid items-center gap-3 border-t border-slate-800 bg-slate-950 p-3 first:border-t-0 sm:grid-cols-[120px_1fr_1fr_auto]">
      <strong className="text-xs">{dayNames[index]}</strong>
      <input disabled={disabled || row.closed} type="time" value={row.opensAt} onChange={event => update(index, { opensAt: event.target.value })} className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs" />
      <input disabled={disabled || row.closed} type="time" value={row.closesAt} onChange={event => update(index, { closesAt: event.target.value })} className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs" />
      <label className="flex items-center gap-2 text-xs text-slate-400"><input disabled={disabled} type="checkbox" checked={row.closed} onChange={event => update(index, { closed: event.target.checked })} /> Closed</label>
    </div>)}
  </div>;
}

function ListEditor({ value, onChange, disabled, noun }: { value: unknown; onChange: (value: unknown) => void; disabled: boolean; noun: string }) {
  const items = Array.isArray(value) ? value as Array<{ reference: string; label: string }> : [];
  const add = () => onChange([...items, { reference: crypto.randomUUID(), label: '' }]);
  const update = (index: number, label: string) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, label } : item));
  return <div className="mt-3 space-y-2">
    {items.map((item, index) => <div key={item.reference} className="flex gap-2">
      <input disabled={disabled} value={item.label} onChange={event => update(index, event.target.value)} placeholder={`${noun} name`} className="flex-1 rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm" />
      <button disabled={disabled} type="button" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} className="rounded-xl border border-rose-900 px-3 text-xs font-black text-rose-300">Remove</button>
    </div>)}
    <button disabled={disabled} type="button" onClick={add} className="rounded-xl border border-violet-700 px-3 py-2 text-xs font-black text-violet-200">+ Add {noun.toLowerCase()}</button>
  </div>;
}

function CustomQuestion({ question, value, onChange, onUpload, readOnly }: { question: Question; value: unknown; onChange: (value: unknown) => void; onUpload?: Props['onUpload']; readOnly: boolean }) {
  let control: React.ReactNode;
  if (question.questionType === 'MONEY') control = <MoneyEditor value={value} onChange={onChange} disabled={readOnly} />;
  else if (question.questionType === 'ADDRESS') control = <AddressEditor value={value} onChange={onChange} disabled={readOnly} />;
  else if (question.questionType === 'OPENING_HOURS') control = <HoursEditor value={value} onChange={onChange} disabled={readOnly} />;
  else if (['SERVICE_LIST', 'STAFF_LIST', 'LOCATION_LIST', 'REPEATING_GROUP'].includes(question.questionType)) control = <ListEditor value={value} onChange={onChange} disabled={readOnly} noun={question.questionType === 'STAFF_LIST' ? 'Team member' : question.questionType === 'LOCATION_LIST' ? 'Location' : question.questionType === 'SERVICE_LIST' ? 'Service' : 'Item'} />;
  else control = <input disabled={readOnly} type="file" accept={question.questionType === 'IMAGE_UPLOAD' ? 'image/jpeg,image/png,image/webp,image/avif' : 'image/jpeg,image/png,image/webp,image/avif,application/pdf,text/plain'} onChange={event => { const file = event.target.files?.[0]; if (file && onUpload) void onUpload(question, file); }} className="mt-3 block w-full rounded-xl border border-dashed border-slate-700 bg-slate-950 p-4 text-xs" />;
  return <article className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
    <label className="text-sm font-black">{question.label}{question.required && <span className="ml-1 text-rose-300">*</span>}</label>
    {question.guidance && <p className="mt-1 text-xs leading-5 text-slate-500">{question.guidance}</p>}
    {control}
  </article>;
}

export function FactFindingForm({ questionnaire, answers, onChange, onSave, onSubmit, onUpload, submitLabel = 'Submit for review', readOnly = false }: Props) {
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const visibleQuestions = useMemo(() => questionnaire.questions.filter(question => visible(question, answers)).sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0)), [questionnaire.questions, answers]);
  const pages = useMemo(() => pageDefinitions.map(page => ({ ...page, questions: visibleQuestions.filter(question => pageKey(question) === page.key) })).filter(page => page.questions.length), [visibleQuestions]);
  const activePage = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))];
  const pageQuestions = activePage?.questions || [];
  const normalQuestions = pageQuestions.filter(question => !customTypes.has(question.questionType));
  const customQuestions = pageQuestions.filter(question => customTypes.has(question.questionType));
  const rendererAnswers = Object.fromEntries(normalQuestions.map(question => [fieldKey(question.reference), answers[question.reference]]));
  const schema: FormSchemaJson = {
    schemaVersion: 2,
    fields: normalQuestions.map(mapField),
    pages: [], sections: [], logic: [],
    theme: { backgroundColor: '#020617', cardColor: '#0f172a', primaryColor: '#7c3aed', textColor: '#f8fafc', mutedColor: '#94a3b8', errorColor: '#fda4af', radius: 'large', density: 'comfortable', progressStyle: 'BAR' },
    settings: { showIntroduction: false, showReview: true, completionMessage: 'Thank you. Your information was received.', autosave: true },
  };
  const completion = questionnaire.completion?.completionPercentage ?? Math.round((visibleQuestions.filter(question => answered(answers[question.reference])).length / Math.max(1, visibleQuestions.length)) * 100);
  const move = async (nextIndex: number) => {
    setBusy(true);
    try { await onSave(pageQuestions.map(question => question.reference).filter(reference => answered(answers[reference]))); setPageIndex(nextIndex); window.scrollTo({ top: 0, behavior: 'smooth' }); } finally { setBusy(false); }
  };
  const submit = async () => { if (!onSubmit) return; setBusy(true); try { await onSave(pageQuestions.map(question => question.reference).filter(reference => answered(answers[reference]))); await onSubmit(); } finally { setBusy(false); } };

  return <div className="space-y-5">
    <header className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-violet-300">{questionnaire.tenantName || 'Client onboarding'}</p><h2 className="mt-2 text-2xl font-black">Complete the business intake form</h2><p className="mt-2 max-w-2xl text-sm text-slate-400">The same controlled form powers client self-service and agency-assisted onboarding.</p></div><strong className="rounded-full bg-violet-950 px-3 py-2 text-xs text-violet-200">{completion}% complete</strong></div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-950"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${completion}%` }} /></div>
    </header>
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <nav aria-label="Form sections" className="space-y-2">{pages.map((page, index) => <button type="button" key={page.id} onClick={() => setPageIndex(index)} className={`w-full rounded-2xl border p-4 text-left ${index === pageIndex ? 'border-violet-500 bg-violet-950/30' : 'border-slate-800 bg-slate-900'}`}><strong className="text-sm">{page.title}</strong><span className="mt-1 block text-xs text-slate-500">{page.questions.filter(question => answered(answers[question.reference])).length} of {page.questions.length} answered</span></button>)}</nav>
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-7"><div className="border-b border-slate-800 pb-5"><p className="text-xs font-black uppercase tracking-widest text-violet-300">Section {pageIndex + 1} of {pages.length}</p><h3 className="mt-2 text-2xl font-black">{activePage?.title}</h3><p className="mt-2 text-sm text-slate-400">{activePage?.description}</p></div>
        {normalQuestions.length > 0 && <div className="mt-6"><FormRenderer schema={schema} answers={rendererAnswers} readOnly={readOnly} onChange={(key, value) => { const question = normalQuestions.find(item => fieldKey(item.reference) === key); if (question) onChange(question.reference, value); }} /></div>}
        {customQuestions.length > 0 && <div className="mt-6 space-y-4">{customQuestions.map(question => <CustomQuestion key={question.reference} question={question} value={answers[question.reference]} onChange={value => onChange(question.reference, value)} onUpload={onUpload} readOnly={readOnly} />)}</div>}
        {!readOnly && <div className="mt-8 flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={pageIndex === 0 || busy} onClick={() => void move(Math.max(0, pageIndex - 1))} className="rounded-xl border border-slate-700 px-4 py-3 text-xs font-black disabled:opacity-30">Previous</button><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void onSave(pageQuestions.map(question => question.reference).filter(reference => answered(answers[reference])))} className="rounded-xl border border-violet-700 px-4 py-3 text-xs font-black text-violet-200 disabled:opacity-40">Save progress</button>{pageIndex < pages.length - 1 ? <button type="button" disabled={busy} onClick={() => void move(pageIndex + 1)} className="rounded-xl bg-violet-600 px-4 py-3 text-xs font-black disabled:opacity-40">Save and continue</button> : <button type="button" disabled={busy || !onSubmit} onClick={() => void submit()} className="rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black disabled:opacity-40">{submitLabel}</button>}</div></div>}
      </section>
    </div>
  </div>;
}
