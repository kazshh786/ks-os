import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  GripVertical,
  LayoutTemplate,
  Link2,
  Palette,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import type { FormField, FormSchemaJson } from '@ks-os/contracts';
import { fetchWithAuth } from '../api/client.js';
import { useWorkspace } from '../context/WorkspaceContext.js';
import { getDataProvider } from '../data/data-provider.js';
import { FormFieldControl } from '../features/forms/FormRenderer.js';

const palette = [
  ['SHORT_TEXT', 'Short text', 'Names, notes and short answers'],
  ['LONG_TEXT', 'Long text', 'Medical history and detailed answers'],
  ['EMAIL', 'Email', 'Validated email address'],
  ['PHONE', 'Phone', 'Mobile or contact number'],
  ['DATE', 'Date', 'Appointment or medical dates'],
  ['YES_NO', 'Yes or No', 'A clear two-choice answer'],
  ['SINGLE_CHOICE', 'Multiple choice', 'Choose one answer'],
  ['MULTIPLE_CHOICE', 'Checkboxes', 'Choose several answers'],
  ['SELECT', 'Dropdown', 'Compact choice list'],
  ['CONSENT_CHECKBOX', 'Consent statement', 'Explicit acknowledgement'],
  ['SIGNATURE', 'Signature', 'Electronic signature field'],
  ['FILE_UPLOAD', 'File upload', 'Photos and supporting files'],
  ['RATING', 'Rating', 'A one-to-five score'],
  ['HEADING', 'Section heading', 'Break the form into sections'],
  ['INFORMATION', 'Information panel', 'Explain treatment or policy details'],
  ['DIVIDER', 'Divider', 'Create visual separation'],
] as const;

const choiceTypes = new Set(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SELECT']);
type ThemeColourKey = 'primaryColor' | 'mutedColor' | 'backgroundColor' | 'cardColor';
const theme = {
  backgroundColor: '#f1f5f9',
  cardColor: '#ffffff',
  primaryColor: '#4f46e5',
  textColor: '#0f172a',
  mutedColor: '#0ea5e9',
  errorColor: '#b91c1c',
  radius: 'large' as const,
  density: 'comfortable' as const,
  progressStyle: 'BAR' as const,
};

const emptySchema = (): FormSchemaJson => ({
  schemaVersion: 2,
  fields: [],
  pages: [],
  sections: [],
  logic: [],
  theme,
  settings: {
    showIntroduction: true,
    showReview: true,
    completionMessage: 'Thank you. Your response was received securely.',
    autosave: true,
  },
});

type DragSource = { kind: 'palette'; type: string } | { kind: 'field'; index: number } | null;
type PublicLink = { formId: string; publicSlug: string; workspaceSlug: string; path: string; status: string };

function makeField(type: string, index: number): FormField {
  const label = palette.find(item => item[0] === type)?.[1] || 'Question';
  const field: FormField = {
    id: crypto.randomUUID(),
    key: `field_${index}`,
    type: type as FormField['type'],
    label,
    required: false,
    readOnly: false,
    hidden: false,
    width: '100',
    validation: {},
    sensitiveClassification: type === 'CONSENT_CHECKBOX' ? 'CONSENT' : type === 'SIGNATURE' ? 'PERSONAL' : 'STANDARD',
    translations: {},
    accessibility: {},
  };
  if (choiceTypes.has(type)) field.options = [{ id: crypto.randomUUID(), label: 'Option 1' }, { id: crypto.randomUUID(), label: 'Option 2' }];
  if (type === 'CONSENT_CHECKBOX') {
    field.label = 'Treatment consent';
    field.description = 'I confirm that I understand the treatment, possible risks and aftercare guidance, and I consent to proceed.';
    field.required = true;
  }
  if (type === 'SIGNATURE') field.label = 'Your electronic signature';
  if (type === 'HEADING') field.label = 'New section';
  if (type === 'INFORMATION') field.label = 'Add important information for the client here.';
  return field;
}

function normalise(value: unknown): FormSchemaJson {
  const base = emptySchema();
  const source = value as Partial<FormSchemaJson> | undefined;
  return {
    ...base,
    ...source,
    fields: (source?.fields || []).map((field, index) => ({
      ...field,
      key: field.key || `field_${index + 1}`,
      width: field.width || '100',
      validation: field.validation || {},
      sensitiveClassification: field.sensitiveClassification || 'STANDARD',
      translations: field.translations || {},
      accessibility: field.accessibility || {},
    })),
    pages: source?.pages || [],
    sections: source?.sections || [],
    logic: source?.logic || [],
    theme: { ...theme, ...source?.theme },
    settings: { ...base.settings, ...source?.settings },
  } as FormSchemaJson;
}

export default function FormEditorPage() {
  const { formId: routeFormId } = useParams();
  const navigate = useNavigate();
  const { activeTenant } = useWorkspace();
  const [currentFormId, setCurrentFormId] = useState(routeFormId);
  const [title, setTitle] = useState('Untitled consent form');
  const [description, setDescription] = useState('Please complete this form carefully before your appointment.');
  const [acknowledgement, setAcknowledgement] = useState('I confirm that the information provided is accurate and that I have read and accepted the consent statement above.');
  const [schema, setSchema] = useState<FormSchemaJson>(emptySchema());
  const [selectedId, setSelectedId] = useState<string>();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState('Draft not saved');
  const [revision, setRevision] = useState(1);
  const [dragSource, setDragSource] = useState<DragSource>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [publicLink, setPublicLink] = useState<PublicLink | null>(null);
  const history = useRef<FormSchemaJson[]>([]);
  const loaded = useRef(false);

  const markDirty = () => setStatus('Unsaved changes');
  const change = useCallback((next: FormSchemaJson) => {
    history.current = [...history.current.slice(-49), schema];
    setSchema(next);
    markDirty();
  }, [schema]);

  const updateTheme = (key: ThemeColourKey, value: string) => {
    change({ ...schema, theme: { ...schema.theme, [key]: value } });
  };

  const loadPublicLink = useCallback(async (id: string) => {
    const response = await fetchWithAuth(`/api/v1/forms/${id}/public-link`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || 'The public form link could not be loaded.');
    setPublicLink(body.data as PublicLink);
    return body.data as PublicLink;
  }, []);

  useEffect(() => {
    if (!routeFormId) {
      const first = makeField('SHORT_TEXT', 1);
      first.label = 'Full name';
      first.required = true;
      setSchema(current => ({ ...current, fields: [first] }));
      setSelectedId(first.id);
      loaded.current = true;
      return;
    }
    setCurrentFormId(routeFormId);
    getDataProvider().getForm(routeFormId).then(async form => {
      setTitle(form.title);
      setDescription(form.description || '');
      setAcknowledgement(form.acknowledgementText || '');
      const nextSchema = normalise(form.fieldsJson);
      setSchema(nextSchema);
      setRevision(form.draftRevision || 1);
      setSelectedId(nextSchema.fields[0]?.id);
      setStatus(form.status === 'PUBLISHED' ? 'Published' : 'Draft saved');
      loaded.current = true;
      await loadPublicLink(routeFormId).catch(() => undefined);
    }).catch(error => setStatus(error instanceof Error ? error.message : 'Load failed'));
  }, [loadPublicLink, routeFormId]);

  const updateField = (id: string, patch: Partial<FormField>) => change({
    ...schema,
    fields: schema.fields.map(field => field.id === id ? { ...field, ...patch } as FormField : field),
  });

  const addField = (type: string, index = schema.fields.length) => {
    const field = makeField(type, schema.fields.length + 1);
    const fields = [...schema.fields];
    fields.splice(index, 0, field);
    change({ ...schema, fields });
    setSelectedId(field.id);
  };

  const duplicateField = (field: FormField, index: number) => {
    const copy = {
      ...field,
      id: crypto.randomUUID(),
      key: `${field.key || `field_${index + 1}`}_copy`,
      options: field.options?.map(option => ({ ...option, id: crypto.randomUUID() })),
    } as FormField;
    const fields = [...schema.fields];
    fields.splice(index + 1, 0, copy);
    change({ ...schema, fields });
    setSelectedId(copy.id);
  };

  const removeField = (id: string) => {
    if (schema.fields.length === 1) {
      setStatus('A form needs at least one answer field.');
      return;
    }
    if (!window.confirm('Delete this field?')) return;
    const fields = schema.fields.filter(field => field.id !== id);
    change({ ...schema, fields });
    setSelectedId(fields[0]?.id);
  };

  const onPaletteDragStart = (event: DragEvent, type: string) => {
    setDragSource({ kind: 'palette', type });
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', `palette:${type}`);
  };

  const onFieldDragStart = (event: DragEvent, index: number) => {
    setDragSource({ kind: 'field', index });
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `field:${index}`);
  };

  const dropAt = (event: DragEvent, index: number) => {
    event.preventDefault();
    if (!dragSource) return;
    if (dragSource.kind === 'palette') {
      addField(dragSource.type, index);
    } else {
      const fields = [...schema.fields];
      const [moved] = fields.splice(dragSource.index, 1);
      const adjustedIndex = dragSource.index < index ? index - 1 : index;
      fields.splice(adjustedIndex, 0, moved);
      change({ ...schema, fields });
      setSelectedId(moved.id);
    }
    setDragSource(null);
    setDropIndex(null);
  };

  const selected = schema.fields.find(field => field.id === selectedId);
  const payload = useMemo(() => ({
    title: title.trim() || 'Untitled consent form',
    description,
    internalDescription: '',
    formType: 'CONSENT',
    acknowledgementText: acknowledgement,
    defaultLanguage: 'en-GB',
    supportedLanguages: ['en-GB'],
    schema,
    expectedRevision: currentFormId ? revision : undefined,
  }), [acknowledgement, currentFormId, description, revision, schema, title]);

  const persistDraft = useCallback(async () => {
    const form = currentFormId
      ? await getDataProvider().updateForm(currentFormId, payload)
      : await getDataProvider().createForm(payload);
    const id = currentFormId || form.id;
    if (!currentFormId) {
      setCurrentFormId(id);
      navigate(`/app/forms/${id}/edit`, { replace: true });
    }
    setRevision(form.draftRevision || revision + 1);
    await loadPublicLink(id).catch(() => undefined);
    return id;
  }, [currentFormId, loadPublicLink, navigate, payload, revision]);

  const save = useCallback(async () => {
    setStatus('Saving…');
    try {
      await persistDraft();
      setStatus('Draft saved');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }, [persistDraft]);

  const publish = async () => {
    setStatus('Saving and publishing…');
    try {
      const id = await persistDraft();
      await getDataProvider().publishForm(id);
      const link = await loadPublicLink(id);
      setPublicLink({ ...link, status: 'PUBLISHED' });
      setStatus('Published');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Publish failed');
    }
  };

  useEffect(() => {
    if (!loaded.current || status !== 'Unsaved changes' || !currentFormId) return;
    const timer = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(timer);
  }, [acknowledgement, currentFormId, description, save, schema, status, title]);

  const publicDomain = import.meta.env.VITE_PUBLIC_WORKSPACE_DOMAIN || 'kasimshah.com';
  const liveUrl = publicLink
    ? `https://${publicLink.workspaceSlug}.${publicDomain}${publicLink.path}`
    : activeTenant?.subdomain
      ? `https://${activeTenant.subdomain}.${publicDomain}/form/${title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'form'}`
      : '';
  const isLive = publicLink?.status === 'PUBLISHED';
  const accentColor = schema.theme.mutedColor;

  return <div className="-m-4 min-h-[calc(100vh-7rem)] bg-slate-100">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate('/app/forms')} aria-label="Back to consent forms" className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"><ArrowLeft size={18} /></button>
        <div className="min-w-48 flex-1">
          <input aria-label="Form name" value={title} onChange={event => { setTitle(event.target.value); markDirty(); }} className="w-full bg-transparent text-lg font-black text-slate-950 outline-none" />
          <div className="mt-0.5 flex items-center gap-2 text-xs font-bold"><span className={status === 'Published' ? 'text-emerald-700' : status.includes('failed') || status.includes('required') ? 'text-rose-700' : 'text-slate-500'}>{status}</span>{isLive && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Live</span>}</div>
        </div>
        <button type="button" disabled={!history.current.length} onClick={() => { const prior = history.current.pop(); if (prior) { setSchema(prior); markDirty(); } }} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 disabled:opacity-30" aria-label="Undo"><Undo2 size={18} /></button>
        <button type="button" onClick={() => void save()} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-800 hover:bg-slate-50"><Save size={17} />Save draft</button>
        <button type="button" onClick={() => void publish()} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-black text-white shadow-sm hover:bg-emerald-700"><CheckCircle2 size={17} />Save and publish</button>
      </div>
    </header>

    <div className="mx-auto grid min-h-[calc(100vh-11rem)] max-w-[1600px] grid-cols-1 xl:grid-cols-[260px_minmax(520px,1fr)_360px]">
      <aside className="border-r border-slate-200 bg-white p-4 xl:sticky xl:top-[73px] xl:h-[calc(100vh-73px)] xl:overflow-y-auto">
        <div className="rounded-2xl bg-slate-950 p-4 text-white">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-indigo-300" /><h2 className="font-black">Add a field</h2></div>
          <p className="mt-1 text-xs leading-5 text-slate-300">Drag a field onto the form or click it to add it at the end.</p>
        </div>
        <div className="mt-4 space-y-2">{palette.map(([type, label, descriptionText]) => <button key={type} type="button" draggable onDragStart={event => onPaletteDragStart(event, type)} onClick={() => addField(type)} className="group w-full cursor-grab rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50 active:cursor-grabbing"><div className="flex items-start gap-3"><span className="mt-0.5 rounded-lg bg-slate-100 p-1.5 text-slate-500 group-hover:bg-white group-hover:text-indigo-600"><Plus size={14} /></span><span><span className="block text-sm font-black text-slate-800">{label}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{descriptionText}</span></span></div></button>)}</div>
      </aside>

      <main className="relative overflow-auto p-4 sm:p-6 lg:p-8" style={{ background: `radial-gradient(circle at top left, ${schema.theme.primaryColor}16, transparent 38%), radial-gradient(circle at top right, ${accentColor}16, transparent 36%), ${schema.theme.backgroundColor}` }}>
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs font-black uppercase tracking-[0.18em]" style={{ color: schema.theme.primaryColor }}>Live form canvas</p><h2 className="mt-1 text-xl font-black text-slate-950">Build directly in the customer view</h2></div>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500">{schema.fields.length} {schema.fields.length === 1 ? 'field' : 'fields'}</span>
          </div>

          <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-xl shadow-slate-200/60" style={{ color: schema.theme.textColor }}>
            <div className="border-b border-slate-100 px-6 py-7 sm:px-8" style={{ background: schema.theme.cardColor }}>
              <div className="mb-5 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em]" style={{ color: schema.theme.primaryColor }}><LayoutTemplate size={16} />Consent form</div>
              <input aria-label="Form title" value={title} onChange={event => { setTitle(event.target.value); markDirty(); }} className="w-full bg-transparent text-3xl font-black tracking-tight text-slate-950 outline-none" />
              <textarea aria-label="Form introduction" value={description} onChange={event => { setDescription(event.target.value); markDirty(); }} placeholder="Add an introduction…" rows={2} className="mt-3 w-full resize-none bg-transparent text-sm leading-6 text-slate-500 outline-none" />
              <div className="mt-5 h-1.5 w-24 rounded-full" style={{ background: `linear-gradient(90deg, ${schema.theme.primaryColor}, ${accentColor})` }} />
            </div>

            <div className="space-y-1 px-4 py-5 sm:px-6 sm:py-7" style={{ background: schema.theme.cardColor }}>
              {schema.fields.map((field, index) => {
                const key = field.key || field.id;
                return <Fragment key={field.id}>
                  <div onDragOver={event => { event.preventDefault(); setDropIndex(index); }} onDragLeave={() => setDropIndex(current => current === index ? null : current)} onDrop={event => dropAt(event, index)} className={`h-3 rounded-full transition ${dropIndex === index ? 'my-2 h-12 border-2 border-dashed border-indigo-400 bg-indigo-50' : ''}`} aria-hidden />
                  <article onClick={() => setSelectedId(field.id)} className={`group relative rounded-2xl border p-5 transition ${selectedId === field.id ? 'border-indigo-500 bg-indigo-50/20 ring-4 ring-indigo-100' : 'border-transparent hover:border-slate-200 hover:bg-slate-50/60'}`}>
                    <div className="absolute -left-3 top-5 flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-1 opacity-0 shadow-sm transition group-hover:opacity-100 focus-within:opacity-100">
                      <button type="button" draggable onDragStart={event => onFieldDragStart(event, index)} onDragEnd={() => { setDragSource(null); setDropIndex(null); }} className="cursor-grab rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 active:cursor-grabbing" aria-label={`Drag ${field.label}`}><GripVertical size={16} /></button>
                      <button type="button" onClick={event => { event.stopPropagation(); duplicateField(field, index); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600" aria-label={`Duplicate ${field.label}`}><Copy size={15} /></button>
                      <button type="button" onClick={event => { event.stopPropagation(); removeField(field.id); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete ${field.label}`}><Trash2 size={15} /></button>
                    </div>
                    <FormFieldControl field={field} value={answers[key]} onChange={value => setAnswers(current => ({ ...current, [key]: value }))} builderMode />
                  </article>
                </Fragment>;
              })}
              <div onDragOver={event => { event.preventDefault(); setDropIndex(schema.fields.length); }} onDragLeave={() => setDropIndex(current => current === schema.fields.length ? null : current)} onDrop={event => dropAt(event, schema.fields.length)} className={`flex min-h-20 items-center justify-center rounded-2xl border-2 border-dashed text-center text-sm font-bold transition ${dropIndex === schema.fields.length || schema.fields.length === 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-400'}`}><span>Drop a field here</span></div>
            </div>
          </section>
        </div>
      </main>

      <aside className="border-l border-slate-200 bg-white p-5 xl:sticky xl:top-[73px] xl:h-[calc(100vh-73px)] xl:overflow-y-auto">
        <h2 className="text-lg font-black text-slate-950">Field settings</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">Select a field on the canvas to edit the wording and behaviour.</p>
        {!selected ? <div className="mt-5 rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">Select a field to customise it.</div> : <div className="mt-5 space-y-5">
          <div className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-indigo-700">{palette.find(item => item[0] === selected.type)?.[1] || selected.type}</div>
          <label className="block text-sm font-bold text-slate-800">Question or heading<input value={selected.label} onChange={event => updateField(selected.id, { label: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 p-3 font-normal outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" /></label>
          <label className="block text-sm font-bold text-slate-800">Description or consent wording<textarea value={selected.description || ''} onChange={event => updateField(selected.id, { description: event.target.value || undefined })} rows={4} className="mt-1.5 w-full rounded-xl border border-slate-200 p-3 font-normal outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" /></label>
          {!['HEADING', 'INFORMATION', 'DIVIDER'].includes(selected.type) && <label className="block text-sm font-bold text-slate-800">Placeholder<input value={selected.placeholder || ''} onChange={event => updateField(selected.id, { placeholder: event.target.value || undefined })} className="mt-1.5 w-full rounded-xl border border-slate-200 p-3 font-normal" /></label>}
          {choiceTypes.has(selected.type) && <section className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4"><div className="flex items-center justify-between"><div><h3 className="font-black text-indigo-950">Choices</h3><p className="text-xs text-indigo-700">Edit the available answers.</p></div><button type="button" onClick={() => updateField(selected.id, { options: [...(selected.options || []), { id: crypto.randomUUID(), label: `Option ${(selected.options?.length || 0) + 1}` }] })} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-indigo-700 shadow-sm"><Plus size={14} className="inline" /> Add</button></div><div className="mt-3 space-y-2">{selected.options?.map((option, optionIndex) => <div key={option.id} className="flex gap-2"><input aria-label={`Choice ${optionIndex + 1}`} value={option.label} onChange={event => updateField(selected.id, { options: selected.options!.map(item => item.id === option.id ? { ...item, label: event.target.value } : item) })} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-2.5 text-sm" /><button type="button" disabled={(selected.options?.length || 0) <= 2} onClick={() => updateField(selected.id, { options: selected.options!.filter(item => item.id !== option.id) })} aria-label={`Remove ${option.label}`} className="rounded-xl border border-slate-200 bg-white p-2.5 text-rose-700 disabled:opacity-30"><Trash2 size={16} /></button></div>)}</div></section>}
          {!['HEADING', 'INFORMATION', 'DIVIDER'].includes(selected.type) && <label className="flex items-center justify-between rounded-2xl border border-slate-200 p-4 text-sm font-bold"><span><span className="block text-slate-900">Required answer</span><span className="mt-0.5 block text-xs font-normal text-slate-500">Clients cannot submit without it.</span></span><input type="checkbox" checked={selected.required} onChange={event => updateField(selected.id, { required: event.target.checked })} className="h-5 w-5 rounded text-indigo-600" /></label>}
          <div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold">Width<select value={selected.width} onChange={event => updateField(selected.id, { width: event.target.value as FormField['width'] })} className="mt-1.5 w-full rounded-xl border border-slate-200 p-2.5 font-normal">{['50', '100'].map(value => <option key={value} value={value}>{value}%</option>)}</select></label><label className="text-sm font-bold">Data type<select value={selected.sensitiveClassification} onChange={event => updateField(selected.id, { sensitiveClassification: event.target.value as FormField['sensitiveClassification'] })} className="mt-1.5 w-full rounded-xl border border-slate-200 p-2.5 font-normal"><option value="STANDARD">Standard</option><option value="PERSONAL">Personal</option><option value="SENSITIVE">Sensitive</option><option value="MEDICAL">Medical</option><option value="CONSENT">Consent</option></select></label></div>
          <label className="block text-sm font-bold">Internal field key<input value={selected.key || ''} onChange={event => updateField(selected.id, { key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} className="mt-1.5 w-full rounded-xl border border-slate-200 p-2.5 font-mono font-normal" /></label>
        </div>}

        <section className="mt-7 border-t border-slate-200 pt-6">
          <div className="flex items-start gap-3"><Palette className="mt-0.5 h-5 w-5 text-indigo-600" /><div><h3 className="font-black text-slate-950">Brand controls</h3><p className="mt-1 text-xs leading-5 text-slate-500">Use the same primary and accent colours as your booking page, or give this form its own campaign look.</p></div></div>
          <div className="mt-5 grid grid-cols-2 gap-4">
            <label className="text-sm font-bold">Primary colour<input aria-label="Primary colour" type="color" value={schema.theme.primaryColor} onChange={event => updateTheme('primaryColor', event.target.value)} className="mt-1 h-12 w-full cursor-pointer rounded-lg border p-1" /></label>
            <label className="text-sm font-bold">Accent colour<input aria-label="Accent colour" type="color" value={accentColor} onChange={event => updateTheme('mutedColor', event.target.value)} className="mt-1 h-12 w-full cursor-pointer rounded-lg border p-1" /></label>
          </div>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Surface colours</p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <label className="text-xs font-bold">Page background<input aria-label="Page background colour" type="color" value={schema.theme.backgroundColor} onChange={event => updateTheme('backgroundColor', event.target.value)} className="mt-1 h-10 w-full cursor-pointer rounded-lg border p-1" /></label>
              <label className="text-xs font-bold">Form card<input aria-label="Form card colour" type="color" value={schema.theme.cardColor} onChange={event => updateTheme('cardColor', event.target.value)} className="mt-1 h-10 w-full cursor-pointer rounded-lg border p-1" /></label>
            </div>
          </div>
        </section>
        <section className="mt-6"><label className="block text-sm font-bold text-slate-800">Final acknowledgement<textarea value={acknowledgement} onChange={event => { setAcknowledgement(event.target.value); markDirty(); }} rows={4} className="mt-1.5 w-full rounded-xl border border-slate-200 p-3 font-normal" /></label></section>

        <section className={`mt-6 rounded-2xl border p-4 ${isLive ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}><div className="flex items-center gap-2"><Link2 size={16} className={isLive ? 'text-emerald-600' : 'text-slate-500'} /><h3 className="text-sm font-black text-slate-900">{isLive ? 'Public form is live' : 'Public form link'}</h3></div><p className="mt-2 break-all text-xs leading-5 text-slate-600">{liveUrl || 'Save the form to create its public address.'}</p>{liveUrl && <div className="mt-3 flex gap-2"><button type="button" onClick={() => void navigator.clipboard.writeText(liveUrl)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700"><Copy size={14} />Copy</button>{isLive && <a href={liveUrl} target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white"><ExternalLink size={14} />Open live</a>}</div>}</section>
      </aside>
    </div>
  </div>;
}
