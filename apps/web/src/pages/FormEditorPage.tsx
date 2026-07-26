import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Eye, GripVertical, Plus, Save, Trash2, Undo2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import type { FormField, FormSchemaJson } from '@ks-os/contracts';
import { getDataProvider } from '../data/data-provider.js';
import { FormRenderer } from '../features/forms/FormRenderer.js';

const palette = [
  ['SHORT_TEXT', 'Short text'], ['LONG_TEXT', 'Long text'], ['EMAIL', 'Email'], ['PHONE', 'Phone'],
  ['NUMBER', 'Number'], ['DATE', 'Date'], ['SINGLE_CHOICE', 'Multiple choice'], ['MULTIPLE_CHOICE', 'Checkboxes'],
  ['SELECT', 'Dropdown'], ['YES_NO', 'Yes / No'], ['CONSENT_CHECKBOX', 'Consent'], ['SIGNATURE', 'Signature'],
  ['FILE_UPLOAD', 'File upload'], ['HEADING', 'Heading'], ['INFORMATION', 'Instructions'], ['DIVIDER', 'Divider'],
] as const;
const choiceTypes = new Set(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SELECT']);
const theme = { backgroundColor: '#f8fafc', cardColor: '#ffffff', primaryColor: '#4f46e5', textColor: '#0f172a', mutedColor: '#64748b', errorColor: '#b91c1c', radius: 'large' as const, density: 'comfortable' as const, progressStyle: 'BAR' as const };
const emptySchema = (): FormSchemaJson => ({ schemaVersion: 2, fields: [], pages: [], sections: [], logic: [], theme, settings: { showIntroduction: true, showReview: true, completionMessage: 'Thank you. Your response was received.', autosave: true } });

function makeField(type: string, index: number): FormField {
  const label = palette.find(item => item[0] === type)?.[1] || 'Question';
  const field: any = { id: crypto.randomUUID(), key: `field_${index}`, type, label, required: false, width: '100', validation: {}, sensitiveClassification: type === 'CONSENT_CHECKBOX' ? 'CONSENT' : 'STANDARD', translations: {}, accessibility: {} };
  if (choiceTypes.has(type)) field.options = [{ id: crypto.randomUUID(), label: 'Option 1' }, { id: crypto.randomUUID(), label: 'Option 2' }];
  if (type === 'CONSENT_CHECKBOX') field.description = 'I explicitly consent to the use of this information for the stated purpose.';
  return field;
}

function normalise(value: any): FormSchemaJson {
  const base = emptySchema();
  return { ...base, ...value, fields: (value?.fields || []).map((field: any, index: number) => ({ ...field, key: field.key || `field_${index + 1}`, width: field.width || '100', validation: field.validation || {}, sensitiveClassification: field.sensitiveClassification || 'STANDARD', translations: field.translations || {}, accessibility: field.accessibility || {} })), pages: value?.pages || [], sections: value?.sections || [], logic: value?.logic || [], theme: { ...theme, ...value?.theme }, settings: { ...base.settings, ...value?.settings } };
}

export default function FormEditorPage() {
  const { formId } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState('Untitled form');
  const [description, setDescription] = useState('');
  const [acknowledgement, setAcknowledgement] = useState('I confirm that the information provided is accurate.');
  const [schema, setSchema] = useState<FormSchemaJson>(emptySchema());
  const [selectedId, setSelectedId] = useState<string>();
  const [preview, setPreview] = useState(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState('Saved');
  const [revision, setRevision] = useState(1);
  const history = useRef<FormSchemaJson[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    if (!formId) {
      const first = makeField('SHORT_TEXT', 1);
      setSchema(current => ({ ...current, fields: [first] }));
      setSelectedId(first.id);
      loaded.current = true;
      return;
    }
    getDataProvider().getForm(formId).then(form => {
      setTitle(form.title); setDescription(form.description || ''); setAcknowledgement(form.acknowledgementText || '');
      setSchema(normalise(form.fieldsJson)); setRevision(form.draftRevision || 1); loaded.current = true;
    }).catch(error => setStatus(error instanceof Error ? error.message : 'Load failed'));
  }, [formId]);

  const change = useCallback((next: FormSchemaJson) => {
    history.current = [...history.current.slice(-49), schema];
    setSchema(next); setStatus('Unsaved changes');
  }, [schema]);
  const updateField = (id: string, patch: Partial<FormField>) => change({ ...schema, fields: schema.fields.map(field => field.id === id ? { ...field, ...patch } as FormField : field) });
  const addField = (type: string) => {
    const field = makeField(type, schema.fields.length + 1);
    change({ ...schema, fields: [...schema.fields, field] }); setSelectedId(field.id);
  };
  const removeField = (id: string) => {
    if (!window.confirm('Delete this field?')) return;
    change({ ...schema, fields: schema.fields.filter(field => field.id !== id) }); setSelectedId(undefined);
  };
  const selected = schema.fields.find(field => field.id === selectedId);

  const payload = useMemo(() => ({ title, description, internalDescription: '', formType: 'CUSTOM', acknowledgementText: acknowledgement, defaultLanguage: 'en-GB', supportedLanguages: ['en-GB'], schema, expectedRevision: formId ? revision : undefined }), [acknowledgement, description, formId, revision, schema, title]);
  const save = useCallback(async () => {
    setStatus('Saving…');
    try {
      const form = formId ? await getDataProvider().updateForm(formId, payload) : await getDataProvider().createForm(payload);
      setRevision(form.draftRevision || revision + 1); setStatus('Saved');
      if (!formId) navigate(`/app/forms/${form.id}/edit`, { replace: true });
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Save failed'); }
  }, [formId, navigate, payload, revision]);
  const publish = async () => {
    if (!formId) { setStatus('Save the draft before publishing'); return; }
    if (!window.confirm('Publish this version? Customers assigned this form will receive an immutable copy.')) return;
    setStatus('Publishing…');
    try { await getDataProvider().updateForm(formId, payload); await getDataProvider().publishForm(formId); setStatus('Published'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Publish failed'); }
  };
  useEffect(() => {
    if (!loaded.current || status !== 'Unsaved changes' || !formId) return;
    const timer = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(timer);
  }, [acknowledgement, description, formId, save, schema, status, title]);

  return <div className="-m-4 min-h-[calc(100vh-7rem)] bg-slate-100">
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b bg-white px-4 py-3">
      <input aria-label="Form name" value={title} onChange={event => { setTitle(event.target.value); setStatus('Unsaved changes'); }} className="min-w-56 flex-1 bg-transparent text-lg font-black outline-none" />
      <span aria-live="polite" className="text-xs font-bold text-slate-500">{status}</span>
      <button type="button" disabled={!history.current.length} onClick={() => { const prior = history.current.pop(); if (prior) setSchema(prior); }} className="rounded-lg p-2 disabled:opacity-30" aria-label="Undo"><Undo2 /></button>
      <button type="button" onClick={() => setPreview(value => !value)} className="flex gap-2 rounded-lg border px-3 py-2 text-sm font-bold"><Eye size={18} />Preview</button>
      <button type="button" onClick={() => void save()} className="flex gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white"><Save size={18} />Save</button>
      <button type="button" onClick={() => void publish()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white">Publish</button>
    </header>
    <div className="grid min-h-[calc(100vh-11rem)] grid-cols-1 xl:grid-cols-[240px_minmax(480px,1fr)_340px]">
      <aside className="border-r bg-white p-4">
        <h2 className="font-black">Add a field</h2><p className="mt-1 text-xs text-slate-500">Click a field type to add it to the form.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">{palette.map(([type, label]) => <button key={type} type="button" onClick={() => addField(type)} className="rounded-lg border p-2 text-left text-xs font-bold hover:border-indigo-400 hover:bg-indigo-50"><Plus size={14} />{label}</button>)}</div>
      </aside>
      <main className="overflow-auto p-5">
        <section className="mx-auto min-h-96 max-w-3xl rounded-2xl bg-white p-6 shadow-sm" style={{ background: schema.theme.cardColor, color: schema.theme.textColor }}>
          <input aria-label="Form title" value={title} onChange={event => { setTitle(event.target.value); setStatus('Unsaved changes'); }} className="w-full text-2xl font-black outline-none" />
          <textarea value={description} onChange={event => { setDescription(event.target.value); setStatus('Unsaved changes'); }} placeholder="Add an introduction…" className="mb-6 mt-2 w-full resize-none text-slate-500 outline-none" />
          {preview ? <FormRenderer schema={schema} answers={answers} onChange={(key, value) => setAnswers(current => ({ ...current, [key]: value }))} /> : <div className="space-y-3">{schema.fields.map((field, index) => <article key={field.id} onClick={() => setSelectedId(field.id)} className={`flex items-start gap-2 rounded-xl border p-4 ${selectedId === field.id ? 'border-indigo-500 ring-2 ring-indigo-100' : 'hover:border-slate-300'}`}>
            <GripVertical className="mt-1 text-slate-400" /><div className="min-w-0 flex-1"><p className="font-bold">{field.label}</p><p className="text-xs text-slate-400">{field.type}{field.required ? ' · Required' : ''}</p>{field.options && <p className="mt-1 truncate text-xs text-slate-500">{field.options.map(option => option.label).join(' · ')}</p>}</div>
            <button type="button" aria-label="Duplicate field" onClick={event => { event.stopPropagation(); const copy = { ...field, id: crypto.randomUUID(), key: `${field.key}_copy`, options: field.options?.map(option => ({ ...option, id: crypto.randomUUID() })) }; change({ ...schema, fields: [...schema.fields.slice(0, index + 1), copy as FormField, ...schema.fields.slice(index + 1)] }); }}><Copy size={17} /></button>
            <button type="button" aria-label="Delete field" onClick={event => { event.stopPropagation(); removeField(field.id); }}><Trash2 size={17} /></button>
          </article>)}</div>}
        </section>
      </main>
      <aside className="overflow-y-auto border-l bg-white p-5">
        <h2 className="text-lg font-black">Field properties</h2>
        {!selected ? <p className="mt-3 text-sm text-slate-500">Select a field in the form to edit it.</p> : <div className="mt-5 space-y-5">
          <label className="block text-sm font-bold">Question or heading<input value={selected.label} onChange={event => updateField(selected.id, { label: event.target.value })} className="mt-1.5 w-full rounded-lg border p-2.5 font-normal" /></label>
          <label className="block text-sm font-bold">Description<textarea value={selected.description || ''} onChange={event => updateField(selected.id, { description: event.target.value || undefined })} rows={3} className="mt-1.5 w-full rounded-lg border p-2.5 font-normal" /></label>
          {!['HEADING', 'INFORMATION', 'DIVIDER'].includes(selected.type) && <label className="block text-sm font-bold">Placeholder<input value={selected.placeholder || ''} onChange={event => updateField(selected.id, { placeholder: event.target.value || undefined })} className="mt-1.5 w-full rounded-lg border p-2.5 font-normal" /></label>}
          <label className="block text-sm font-bold">Help text<textarea value={selected.helpText || ''} onChange={event => updateField(selected.id, { helpText: event.target.value || undefined })} rows={2} className="mt-1.5 w-full rounded-lg border p-2.5 font-normal" /></label>
          {choiceTypes.has(selected.type) && <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="flex items-center justify-between"><div><h3 className="font-black text-indigo-950">Choices</h3><p className="text-xs text-indigo-700">Change what customers can select.</p></div><button type="button" onClick={() => updateField(selected.id, { options: [...(selected.options || []), { id: crypto.randomUUID(), label: `Option ${(selected.options?.length || 0) + 1}` }] })} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-indigo-700"><Plus size={14} className="inline" /> Add</button></div>
            <div className="mt-3 space-y-2">{selected.options?.map((option, optionIndex) => <div key={option.id} className="flex gap-2"><input aria-label={`Choice ${optionIndex + 1}`} value={option.label} onChange={event => updateField(selected.id, { options: selected.options!.map(item => item.id === option.id ? { ...item, label: event.target.value } : item) })} className="min-w-0 flex-1 rounded-lg border bg-white p-2 text-sm" /><button type="button" disabled={(selected.options?.length || 0) <= 2} onClick={() => updateField(selected.id, { options: selected.options!.filter(item => item.id !== option.id) })} aria-label={`Remove ${option.label}`} className="rounded-lg border bg-white p-2 text-rose-700 disabled:opacity-30"><Trash2 size={16} /></button></div>)}</div>
          </section>}
          <div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold">Width<select value={selected.width} onChange={event => updateField(selected.id, { width: event.target.value as FormField['width'] })} className="mt-1.5 w-full rounded-lg border p-2.5 font-normal">{['25', '33', '50', '66', '75', '100'].map(value => <option key={value} value={value}>{value}%</option>)}</select></label><label className="text-sm font-bold">Data type<select value={selected.sensitiveClassification} onChange={event => updateField(selected.id, { sensitiveClassification: event.target.value as FormField['sensitiveClassification'] })} className="mt-1.5 w-full rounded-lg border p-2.5 font-normal"><option value="STANDARD">Standard</option><option value="PERSONAL">Personal</option><option value="SENSITIVE">Sensitive</option><option value="MEDICAL">Medical</option><option value="CONSENT">Consent</option></select></label></div>
          {!['HEADING', 'INFORMATION', 'DIVIDER'].includes(selected.type) && <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={selected.required} onChange={event => updateField(selected.id, { required: event.target.checked })} />Required answer</label>}
          <label className="block text-sm font-bold">Validation message<input value={selected.validation.errorMessage || ''} onChange={event => updateField(selected.id, { validation: { ...selected.validation, errorMessage: event.target.value || undefined } })} placeholder="Please complete this field." className="mt-1.5 w-full rounded-lg border p-2.5 font-normal" /></label>
          <label className="block text-sm font-bold">Internal field key<input value={selected.key || ''} onChange={event => updateField(selected.id, { key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} className="mt-1.5 w-full rounded-lg border p-2.5 font-mono font-normal" /></label>
          <label className="block border-t pt-5 text-sm font-bold">Acknowledgement<textarea value={acknowledgement} onChange={event => { setAcknowledgement(event.target.value); setStatus('Unsaved changes'); }} rows={3} className="mt-1.5 w-full rounded-lg border p-2.5 font-normal" /></label>
        </div>}
      </aside>
    </div>
  </div>;
}
