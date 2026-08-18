import React, { memo, useMemo } from 'react';
import type { FormField, FormSchemaJson } from '@ks-os/contracts';
import { formState } from './form-engine.js';

interface Props {
  schema: FormSchemaJson;
  answers: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  page?: number;
  errors?: Record<string, string>;
  language?: string;
  readOnly?: boolean;
}

export interface FormFieldControlProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  required?: boolean;
  language?: string;
  readOnly?: boolean;
  builderMode?: boolean;
}

const inputClass = 'mt-2.5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';

function optionValue(option: NonNullable<FormField['options']>[number]) {
  return option.value || option.id;
}

function isSelected(value: unknown, option: string) {
  return String(value ?? '') === option;
}

function publicDocumentPath(document: 'acknowledgement' | 'terms'): string | null {
  if (typeof window === 'undefined') return null;
  const workspace = window.location.pathname.match(/^\/form\/[^/]+/i);
  if (workspace) return `${workspace[0]}/${document}`;
  const assigned = window.location.pathname.match(/^\/forms\/complete\/[^/]+/i);
  if (assigned && document === 'acknowledgement') return `${assigned[0]}/acknowledgement`;
  return null;
}

export function FormFieldControl({
  field,
  value,
  onChange,
  error,
  required = field.required,
  language = 'en-GB',
  readOnly = false,
  builderMode = false,
}: FormFieldControlProps) {
  const key = field.key || field.id;
  const translation = field.translations?.[language];
  const label = translation?.label || field.label;
  const description = translation?.description || field.description || field.helpText;
  const disabled = readOnly || field.readOnly;
  const showDescription = !['CONSENT_CHECKBOX', 'TERMS_ACCEPTANCE'].includes(field.type);
  const common = {
    id: `field-${key}`,
    'aria-label': label,
    'aria-invalid': Boolean(error),
    'aria-describedby': (showDescription && description) || error ? `${key}-details` : undefined,
    required,
    disabled,
  };

  if (field.type === 'HEADING') {
    return <div className="col-span-full border-b border-slate-100 pb-3"><h2 className="text-xl font-black tracking-tight text-slate-950">{label}</h2>{description && <p className="mt-1 text-sm text-slate-500">{description}</p>}</div>;
  }
  if (field.type === 'INFORMATION') {
    return <div className="col-span-full rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm leading-6 text-indigo-950"><p className="font-bold">{label}</p>{description && <p className="mt-1 text-indigo-800/80">{description}</p>}</div>;
  }
  if (field.type === 'DIVIDER') return <hr className="col-span-full my-2 border-slate-200" />;
  if (field.type === 'HIDDEN' || field.type === 'CALCULATED') return null;

  const details = <>{showDescription && description && <span id={`${key}-details`} className="mt-1.5 block text-sm font-normal leading-5 text-slate-500">{description}</span>}{error && <span role="alert" className="mt-1.5 block text-sm font-semibold text-red-700">{error}</span>}</>;
  const heading = <span className="block text-sm font-black leading-5 text-slate-900">{label}{required && <span aria-hidden className="ml-1 text-rose-600">*</span>}</span>;

  let control: React.ReactNode;
  if (['LONG_TEXT', 'ADDRESS'].includes(field.type)) {
    control = <textarea {...common} value={String(value ?? '')} onChange={event => onChange(event.target.value)} placeholder={translation?.placeholder || field.placeholder} className={inputClass} rows={4} />;
  } else if (field.type === 'YES_NO') {
    const options = [{ label: 'Yes', value: true }, { label: 'No', value: false }];
    control = <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label={label}>{options.map(option => <button key={option.label} type="button" disabled={disabled} aria-pressed={value === option.value} onClick={() => onChange(option.value)} className={`rounded-2xl border px-4 py-3 text-sm font-black transition ${value === option.value ? 'border-indigo-600 bg-indigo-600 text-white shadow-md' : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50'}`}>{option.label}</button>)}</div>;
  } else if (field.type === 'CONSENT_CHECKBOX') {
    const consentPath = builderMode ? null : publicDocumentPath('acknowledgement');
    control = <label className={`mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${value === true ? 'border-indigo-500 bg-indigo-50 shadow-sm' : 'border-slate-200 bg-slate-50/70 hover:border-indigo-300'}`}><input {...common} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} className="mt-0.5 h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /><span className="text-sm font-semibold leading-5 text-slate-700"><span className="block">{field.description || 'I confirm that I have read and agree to this consent statement.'}</span>{consentPath && <a href={consentPath} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} className="mt-2 inline-block font-black text-indigo-700 underline decoration-indigo-300 underline-offset-4 hover:text-indigo-900">Read consent form</a>}</span></label>;
  } else if (field.type === 'TERMS_ACCEPTANCE') {
    const termsPath = builderMode ? null : publicDocumentPath('terms');
    control = <label className={`mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${value === true ? 'border-indigo-500 bg-indigo-50 shadow-sm' : 'border-slate-200 bg-slate-50/70 hover:border-indigo-300'}`}><input {...common} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} className="mt-0.5 h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /><span className="text-sm font-semibold leading-5 text-slate-700">I have read and agree to the {termsPath ? <a href={termsPath} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} className="font-black text-indigo-700 underline decoration-indigo-300 underline-offset-4 hover:text-indigo-900">terms and conditions</a> : 'terms and conditions'}.</span></label>;
  } else if (field.type === 'TOGGLE') {
    control = <button type="button" disabled={disabled} aria-label={label} aria-pressed={value === true} onClick={() => onChange(value !== true)} className={`mt-3 flex w-full items-center justify-between rounded-2xl border p-4 text-left text-sm font-bold transition ${value === true ? 'border-indigo-500 bg-indigo-50 text-indigo-950' : 'border-slate-200 bg-white text-slate-700'}`}><span>{value === true ? 'Enabled' : 'Disabled'}</span><span className={`relative h-6 w-11 rounded-full transition ${value === true ? 'bg-indigo-600' : 'bg-slate-300'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${value === true ? 'left-6' : 'left-1'}`} /></span></button>;
  } else if (field.type === 'SINGLE_CHOICE') {
    control = <div className="mt-3 grid gap-2" role="radiogroup" aria-label={label}>{field.options?.map(option => { const optionKey = optionValue(option); const checked = isSelected(value, optionKey); return <label key={option.id} className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-bold transition ${checked ? 'border-indigo-500 bg-indigo-50 text-indigo-950 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'}`}><input type="radio" name={`field-${key}`} disabled={disabled} checked={checked} onChange={() => onChange(optionKey)} className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500" />{option.label}</label>; })}</div>;
  } else if (field.type === 'SELECT') {
    control = <select {...common} value={String(value ?? '')} onChange={event => onChange(event.target.value)} className={inputClass}><option value="">Select an option…</option>{field.options?.map(option => <option key={option.id} value={optionValue(option)}>{option.label}</option>)}</select>;
  } else if (field.type === 'MULTIPLE_CHOICE') {
    control = <div className="mt-3 grid gap-2" role="group" aria-label={label}>{field.options?.map(option => { const controlledValue = optionValue(option); const checked = Array.isArray(value) && value.includes(controlledValue); return <label key={option.id} className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-bold transition ${checked ? 'border-indigo-500 bg-indigo-50 text-indigo-950' : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'}`}><input type="checkbox" disabled={disabled} checked={checked} onChange={event => { const existing = Array.isArray(value) ? value as string[] : []; onChange(event.target.checked ? [...existing, controlledValue] : existing.filter(item => item !== controlledValue)); }} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />{option.label}</label>; })}</div>;
  } else if (field.type === 'FILE_UPLOAD') {
    control = <div className="mt-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm font-semibold text-slate-500" role="group" aria-label={label}><span className="block text-slate-800">Drop files here or choose a file</span><span className="mt-1 block text-xs font-normal">JPG, PNG or PDF. Secure upload is enabled on the assigned form.</span></div>;
  } else if (field.type === 'SIGNATURE') {
    control = <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"><input {...common} value={String(value ?? '')} onChange={event => onChange(event.target.value)} placeholder="Type your full name as your signature" className="w-full border-0 border-b border-slate-300 bg-transparent px-1 py-3 font-serif text-xl italic text-indigo-800 outline-none focus:border-indigo-500" /><p className="mt-3 text-xs text-slate-500">Typing your name represents your electronic signature.</p></div>;
  } else if (field.type === 'RATING') {
    const rating = Number(value || 0);
    control = <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={label}>{[1, 2, 3, 4, 5].map(score => <button key={score} type="button" disabled={disabled} aria-label={`${score} out of 5`} aria-pressed={rating === score} onClick={() => onChange(score)} className={`h-11 w-11 rounded-xl border text-xl transition ${rating >= score ? 'border-amber-300 bg-amber-50 text-amber-500' : 'border-slate-200 bg-white text-slate-300 hover:border-amber-200'}`}>★</button>)}</div>;
  } else {
    const inputType = field.type === 'EMAIL' ? 'email' : field.type === 'PHONE' ? 'tel' : ['NUMBER', 'SCALE'].includes(field.type) ? 'number' : field.type === 'DATE' ? 'date' : field.type === 'TIME' ? 'time' : field.type === 'DATETIME' ? 'datetime-local' : field.type === 'WEBSITE' ? 'url' : 'text';
    control = <input {...common} type={inputType} value={String(value ?? '')} onChange={event => onChange(['NUMBER', 'SCALE'].includes(field.type) ? event.target.valueAsNumber : event.target.value)} placeholder={translation?.placeholder || field.placeholder} className={inputClass} />;
  }

  const widthClass = field.width === '100' ? 'col-span-full' : 'md:col-span-1';
  return <div className={`block ${widthClass} ${builderMode ? 'pointer-events-auto' : ''}`}>{heading}{details}{control}</div>;
}

export const FormRenderer = memo(function FormRenderer({ schema, answers, onChange, page = 0, errors = {}, language = 'en-GB', readOnly = false }: Props) {
  const state = useMemo(() => formState(schema, answers), [schema, answers]);
  const activePage = schema.pages[page];
  const fields = schema.fields.filter(field => (!activePage || !field.pageId || field.pageId === activePage.id) && state.get(field.key || field.id)?.visible);
  return <section aria-label={activePage?.title || 'Form questions'}><div className="grid gap-6 md:grid-cols-2">{fields.map(field => { const key = field.key || field.id; const current = state.get(key)!; return <FormFieldControl key={field.id} field={field} value={answers[key]} onChange={value => onChange(key, value)} error={errors[key]} required={current.required} language={language} readOnly={readOnly} />; })}</div></section>;
});
