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

const inputClass = 'mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100 disabled:text-slate-500';

function optionValue(option: NonNullable<FormField['options']>[number]) {
  return option.value || option.id;
}

function FieldView({ field, value, onChange, error, required, language, readOnly }: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  required: boolean;
  language: string;
  readOnly: boolean;
}) {
  const key = field.key || field.id;
  const translation = field.translations?.[language];
  const label = translation?.label || field.label;
  const description = translation?.description || field.description || field.helpText;
  const common = {
    id: `field-${key}`,
    'aria-invalid': Boolean(error),
    'aria-describedby': description || error ? `${key}-details` : undefined,
    required,
    disabled: readOnly || field.readOnly,
  };

  if (field.type === 'HEADING') return <h2 className="col-span-full text-xl font-black">{label}</h2>;
  if (field.type === 'INFORMATION') return <div className="col-span-full rounded-xl bg-slate-50 p-4 text-sm text-slate-700">{label}</div>;
  if (field.type === 'DIVIDER') return <hr className="col-span-full my-2" />;
  if (field.type === 'HIDDEN' || field.type === 'CALCULATED') return null;

  let control: React.ReactNode;
  if (['LONG_TEXT', 'ADDRESS'].includes(field.type)) {
    control = <textarea {...common} value={String(value ?? '')} onChange={event => onChange(event.target.value)} className={inputClass} rows={4} />;
  } else if (['YES_NO', 'TOGGLE', 'CONSENT_CHECKBOX', 'TERMS_ACCEPTANCE'].includes(field.type)) {
    control = <input {...common} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} className="ml-3 h-5 w-5" />;
  } else if (['SINGLE_CHOICE', 'SELECT'].includes(field.type)) {
    control = <select {...common} value={String(value ?? '')} onChange={event => onChange(event.target.value)} className={inputClass}>
      <option value="">Select…</option>
      {field.options?.map(option => <option key={option.id} value={optionValue(option)}>{option.label}</option>)}
    </select>;
  } else if (field.type === 'MULTIPLE_CHOICE') {
    control = <fieldset className="mt-2 space-y-2">{field.options?.map(option => {
      const controlledValue = optionValue(option);
      return <label key={option.id} className="flex gap-2 font-normal"><input type="checkbox" disabled={readOnly || field.readOnly} checked={Array.isArray(value) && value.includes(controlledValue)} onChange={event => {
        const existing = Array.isArray(value) ? value as string[] : [];
        onChange(event.target.checked ? [...existing, controlledValue] : existing.filter(item => item !== controlledValue));
      }} />{option.label}</label>;
    })}</fieldset>;
  } else if (field.type === 'FILE_UPLOAD') {
    control = <div className="mt-2 rounded-xl border border-dashed p-4 text-sm text-slate-500">Private upload becomes available after the form is assigned.</div>;
  } else if (field.type === 'SIGNATURE') {
    control = <input {...common} value={String(value ?? '')} onChange={event => onChange(event.target.value)} placeholder="Type your full name as your signature" className={inputClass} />;
  } else {
    const inputType = field.type === 'EMAIL' ? 'email'
      : field.type === 'PHONE' ? 'tel'
        : ['NUMBER', 'RATING', 'SCALE'].includes(field.type) ? 'number'
          : field.type === 'DATE' ? 'date'
            : field.type === 'TIME' ? 'time'
              : field.type === 'DATETIME' ? 'datetime-local'
                : field.type === 'WEBSITE' ? 'url' : 'text';
    control = <input {...common} type={inputType} value={String(value ?? '')} onChange={event => onChange(['NUMBER', 'RATING', 'SCALE'].includes(field.type) ? event.target.valueAsNumber : event.target.value)} placeholder={translation?.placeholder || field.placeholder} className={inputClass} />;
  }

  return <label className={`block font-bold ${field.width === '100' ? 'col-span-full' : 'md:col-span-1'}`}>
    {label}{required && <span aria-hidden className="text-red-600"> *</span>}
    {description && <span id={`${key}-details`} className="mt-1 block text-sm font-normal text-slate-500">{description}</span>}
    {error && <span role="alert" className="mt-1 block text-sm font-normal text-red-700">{error}</span>}
    {control}
  </label>;
}

export const FormRenderer = memo(function FormRenderer({ schema, answers, onChange, page = 0, errors = {}, language = 'en-GB', readOnly = false }: Props) {
  const state = useMemo(() => formState(schema, answers), [schema, answers]);
  const activePage = schema.pages[page];
  const fields = schema.fields.filter(field => (!activePage || !field.pageId || field.pageId === activePage.id) && state.get(field.key || field.id)?.visible);
  return <section aria-label={activePage?.title || 'Form questions'}><div className="grid gap-5 md:grid-cols-2">{fields.map(field => {
    const key = field.key || field.id;
    const current = state.get(key)!;
    return <FieldView key={field.id} field={field} value={answers[key]} onChange={value => onChange(key, value)} error={errors[key]} required={current.required} language={language} readOnly={readOnly} />;
  })}</div></section>;
});
