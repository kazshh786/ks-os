import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Blocks,
  CheckCircle2,
  Eye,
  Globe2,
  Layers3,
  Library,
  Loader2,
  Palette,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { Link } from 'react-router';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';

type ItemKind = 'COMPONENT' | 'PAGE_SECTION' | 'SITE_THEME';
type SourceType = 'KS_AI' | 'GOOGLE_STITCH' | 'PREBUILT' | 'MANUAL';
type ItemStatus = 'GENERATING' | 'DRAFT' | 'READY_FOR_REVIEW' | 'APPROVED' | 'FAILED' | 'ARCHIVED';
type ColourKey = keyof ThemeColours;

type ThemeColours = {
  primaryColour: string;
  secondaryColour: string;
  accentColour: string;
  backgroundColour: string;
  surfaceColour: string;
  textColour: string;
  mutedTextColour: string;
  borderColour: string;
};

type Theme = Partial<ThemeColours> & {
  headingFontKey?: string;
  bodyFontKey?: string;
  radiusScale?: string;
  spacingDensity?: string;
  containerWidth?: string;
  buttonStyle?: string;
  imageStyle?: string;
  motionPreference?: string;
};

type DesignItem = {
  reference: string;
  slug: string;
  name: string;
  description: string;
  itemKind: ItemKind;
  category: string;
  status: ItemStatus;
  sourceType: SourceType;
  tags: string[];
  theme: Theme;
  definition: Record<string, unknown>;
  pageManifest: Array<{ pageType: string; required?: boolean; sections: string[] }>;
  preview: Record<string, unknown>;
  previewImageUrl?: string | null;
  sourceMetadata?: Record<string, unknown>;
  accessibility: { issues?: string[]; reviewed?: boolean; standard?: string };
  availableForClientDelivery: boolean;
  isSystem: boolean;
  assignedTenantCount: number;
  createdAt: string;
  updatedAt: string;
};

type StudioConfig = {
  aiAvailable: boolean;
  stitchAvailable: boolean;
  sectionTypes: string[];
  automaticSave: boolean;
  executableCodeAllowed: boolean;
  knowledge?: {
    available: boolean;
    message?: string;
    pack?: {
      reference: string;
      semanticVersion: string;
      sourceDigest: string;
      sourceCount: number;
      ruleCount: number;
      pagePlaybookCount: number;
      sectionPlaybookCount: number;
    } | null;
  };
};

type Tenant = { id: string; name: string; lifecycleStatus: string; subdomain: string };

const DEFAULT_COLOURS: ThemeColours = {
  primaryColour: '#2A1F4F',
  secondaryColour: '#51407A',
  accentColour: '#B54B78',
  backgroundColour: '#FAF8FF',
  surfaceColour: '#FFFFFF',
  textColour: '#211A3B',
  mutedTextColour: '#5A536E',
  borderColour: '#DDD7EA',
};

const colourLabels: Record<ColourKey, string> = {
  primaryColour: 'Primary',
  secondaryColour: 'Secondary',
  accentColour: 'Accent',
  backgroundColour: 'Background',
  surfaceColour: 'Surface',
  textColour: 'Text',
  mutedTextColour: 'Muted text',
  borderColour: 'Border',
};

const kindOptions: Array<{ value: ItemKind; label: string; detail: string; icon: React.ElementType }> = [
  { value: 'COMPONENT', label: 'Component', detail: 'Cards, buttons, forms and navigation patterns', icon: Blocks },
  { value: 'PAGE_SECTION', label: 'Page section', detail: 'Heroes, services, proof, FAQs and booking CTAs', icon: Layers3 },
  { value: 'SITE_THEME', label: 'Website theme', detail: 'A full palette, page manifest and section recipe', icon: Globe2 },
];

const titleCase = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, character => character.toUpperCase());
const statusClass = (value: ItemStatus) => value === 'APPROVED'
  ? 'border-emerald-700 bg-emerald-950/35 text-emerald-200'
  : value === 'READY_FOR_REVIEW'
    ? 'border-amber-700 bg-amber-950/35 text-amber-200'
    : value === 'FAILED'
      ? 'border-rose-800 bg-rose-950/40 text-rose-200'
      : 'border-slate-700 bg-slate-950 text-slate-300';

function Status({ value }: { value: ItemStatus }) {
  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusClass(value)}`}>{value.replaceAll('_', ' ')}</span>;
}

function Preview({ item, compact = false }: { item: DesignItem; compact?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const theme = { ...DEFAULT_COLOURS, ...item.theme };
  const preview = item.preview;
  const headline = typeof preview.headline === 'string' ? preview.headline : item.name;
  const body = typeof preview.body === 'string' ? preview.body : item.description;
  const primaryAction = typeof preview.primaryAction === 'string' ? preview.primaryAction : 'Book now';
  const cards = Array.isArray(preview.cards) ? preview.cards.filter((value): value is string => typeof value === 'string').slice(0, 3) : ['Service one', 'Service two', 'Service three'];
  if (item.previewImageUrl && !imageFailed) {
    return <div className={`overflow-hidden rounded-xl border border-slate-700 bg-slate-950 ${compact ? 'aspect-[16/10]' : 'aspect-[16/9]'}`}>
      <img src={item.previewImageUrl} alt={`${item.name} website concept`} loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="h-full w-full object-cover object-top" />
    </div>;
  }
  return <div className={`overflow-hidden rounded-xl border shadow-2xl ${compact ? 'aspect-[16/10]' : 'aspect-[16/9]'}`} style={{ backgroundColor: theme.backgroundColour, borderColor: theme.borderColour, color: theme.textColour }} role="img" aria-label={`${item.name} website preview`}>
    <div className="flex h-[15%] items-center justify-between border-b px-[5%]" style={{ backgroundColor: theme.surfaceColour, borderColor: theme.borderColour }}>
      <strong className="text-[6px]">{item.name.split(' ').slice(0, 2).join(' ')}</strong>
      <span className="flex gap-2 text-[5px]" style={{ color: theme.mutedTextColour }}><span>Home</span><span>Services</span><span>About</span></span>
      <span className="rounded px-2 py-1 text-[5px] font-black text-white" style={{ backgroundColor: theme.primaryColour }}>{primaryAction}</span>
    </div>
    <div className="grid h-[58%] grid-cols-2 items-center gap-[5%] px-[6%] py-[5%]">
      <div><p className="text-[5px] font-black uppercase tracking-widest" style={{ color: theme.accentColour }}>{item.category}</p><p className="mt-2 text-[clamp(10px,2vw,24px)] font-black leading-none">{headline}</p><p className="mt-2 line-clamp-3 text-[5px] leading-relaxed" style={{ color: theme.mutedTextColour }}>{body}</p><span className="mt-3 inline-block rounded px-2 py-1 text-[5px] font-black text-white" style={{ backgroundColor: theme.primaryColour }}>{primaryAction}</span></div>
      <div className="relative h-full rounded-lg" style={{ background: `linear-gradient(135deg, ${theme.secondaryColour}, ${theme.primaryColour})` }}><div className="absolute inset-[12%] rounded-lg border border-white/30 bg-white/10" /></div>
    </div>
    <div className="grid h-[27%] grid-cols-3 gap-[2%] border-t px-[6%] py-[3%]" style={{ backgroundColor: theme.surfaceColour, borderColor: theme.borderColour }}>{cards.map((card, index) => <div key={`${card}-${index}`} className="rounded border p-1.5" style={{ borderColor: theme.borderColour }}><span className="mb-1 block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: index === 1 ? theme.accentColour : theme.primaryColour }} /><strong className="block truncate text-[5px]">{card}</strong></div>)}</div>
  </div>;
}

function ColourEditor({ values, onChange, disabled }: { values: ThemeColours; onChange: (key: ColourKey, value: string) => void; disabled?: boolean }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{(Object.keys(colourLabels) as ColourKey[]).map(key => <label key={key} className="text-xs font-bold text-slate-300">{colourLabels[key]}<span className="mt-2 flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-2"><input type="color" value={values[key]} disabled={disabled} onChange={event => onChange(key, event.target.value.toUpperCase())} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-not-allowed" /><input value={values[key]} disabled={disabled} maxLength={7} pattern="#[0-9A-Fa-f]{6}" onChange={event => onChange(key, event.target.value.toUpperCase())} aria-label={`${colourLabels[key]} hex colour`} className="min-w-0 flex-1 bg-transparent font-mono text-xs text-white outline-none" /></span></label>)}</div>;
}

export default function AgencyDesignStudioPage() {
  const { session } = useAgencyAuth();
  const [config, setConfig] = useState<StudioConfig | null>(null);
  const [items, setItems] = useState<DesignItem[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedReference, setSelectedReference] = useState('');
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Professional services');
  const [itemKind, setItemKind] = useState<ItemKind>('SITE_THEME');
  const [sourceType, setSourceType] = useState<'KS_AI' | 'GOOGLE_STITCH'>('KS_AI');
  const [sectionType, setSectionType] = useState('HERO');
  const [industryTags, setIndustryTags] = useState('');
  const [useAiPalette, setUseAiPalette] = useState(true);
  const [colours, setColours] = useState<ThemeColours>(DEFAULT_COLOURS);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'ALL' | ItemKind>('ALL');
  const [assignTenant, setAssignTenant] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canManage = Boolean(session?.capabilities.includes('sites.templates.manage'));
  const canApprove = Boolean(session?.capabilities.includes('sites.templates.approve'));

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [nextConfig, nextItems, nextTenants] = await Promise.all([
        agencyFetch('/design-library/config'),
        agencyFetch('/design-library'),
        agencyFetch('/tenants'),
      ]);
      setConfig(nextConfig);
      setItems(nextItems);
      setTenants(nextTenants);
      setSelectedReference(current => current || nextItems[0]?.reference || '');
      if (!nextConfig.stitchAvailable) setSourceType('KS_AI');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Design Studio could not be loaded.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = items.find(item => item.reference === selectedReference) || null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(item => (kindFilter === 'ALL' || item.itemKind === kindFilter) && (!needle || `${item.name} ${item.category} ${item.description} ${item.tags.join(' ')}`.toLowerCase().includes(needle)));
  }, [items, kindFilter, query]);
  const activeKnowledge = config?.knowledge?.available && config.knowledge.pack;
  const canGenerate = canManage && config?.aiAvailable && activeKnowledge && (sourceType !== 'GOOGLE_STITCH' || config.stitchAvailable);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canGenerate || busy) return;
    setBusy('generate'); setError(''); setNotice('');
    try {
      const created = await agencyFetch('/design-library/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          itemKind,
          sourceType,
          category,
          name: name.trim() || undefined,
          sectionType: itemKind === 'SITE_THEME' ? undefined : sectionType,
          industryTags: industryTags.split(',').map(value => value.trim()).filter(Boolean),
          themePreferences: useAiPalette ? undefined : colours,
        }),
      });
      setNotice(`${created.name} was generated with the active KS playbooks and saved for review.`);
      setPrompt(''); setName('');
      await load();
      setSelectedReference(created.reference);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The governed design generation failed. Its safe library record remains available.');
      await load();
    } finally { setBusy(''); }
  };

  const approve = async (item: DesignItem) => {
    if (!canApprove || busy) return;
    setBusy('approve'); setError(''); setNotice('');
    try { const result = await agencyFetch(`/design-library/${item.reference}/approve`, { method: 'POST' }); setNotice(`${result.name} is approved${result.availableForClientDelivery ? ' for client launch' : ''}.`); await load(); setSelectedReference(item.reference); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The design could not be approved.'); }
    finally { setBusy(''); }
  };

  const archive = async (item: DesignItem) => {
    if (!canManage || busy) return;
    setBusy('archive'); setError(''); setNotice('');
    try { await agencyFetch(`/design-library/${item.reference}/archive`, { method: 'POST' }); setNotice(`${item.name} was archived.`); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The design could not be archived.'); }
    finally { setBusy(''); }
  };

  const assign = async (item: DesignItem) => {
    if (!canManage || busy || !assignTenant) return;
    setBusy('assign'); setError(''); setNotice('');
    try { const result = await agencyFetch(`/design-library/${item.reference}/assign`, { method: 'POST', body: JSON.stringify({ tenantReference: assignTenant }) }); setNotice(`${result.designName} is assigned to ${result.tenantName}. Open that client’s Launch Pipeline to customise colours and build.`); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The theme could not be assigned.'); }
    finally { setBusy(''); }
  };

  if (loading) return <div className="grid min-h-96 place-items-center rounded-3xl border border-slate-800 bg-slate-900"><p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading Design Studio…</p></div>;

  return <div className="space-y-6">
    <section className="rounded-3xl border border-violet-800/60 bg-gradient-to-br from-violet-950 via-slate-950 to-slate-900 p-6 shadow-2xl sm:p-8">
      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-violet-300"><Sparkles className="h-4 w-4" />Governed design creation</p>
      <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">Design Studio</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Prompt KS AI or Stitch, apply the approved NotebookLM-derived rules and page playbooks, save the result to the reusable library, then select it inside one client Launch Pipeline.</p>
      <div className={`mt-5 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${activeKnowledge ? 'border-emerald-800 bg-emerald-950/25' : 'border-rose-800 bg-rose-950/30'}`}>
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><div><strong className="text-sm text-white">{activeKnowledge ? `Knowledge pack ${activeKnowledge.semanticVersion} active` : 'Active website knowledge pack required'}</strong><p className="mt-1 text-xs leading-5 text-slate-400">{activeKnowledge ? `${activeKnowledge.ruleCount} accepted rules · ${activeKnowledge.pagePlaybookCount} page playbooks · ${activeKnowledge.sectionPlaybookCount} section playbooks. Raw CSV and NotebookLM source material never enters the model.` : config?.knowledge?.message || 'Activate one approved PUBLIC_SITE knowledge pack before generating designs.'}</p></div></div>
        {activeKnowledge ? <span className="shrink-0 rounded-full border border-emerald-700 px-3 py-1 text-[10px] font-black uppercase text-emerald-200">Pinned and traceable</span> : null}
      </div>
    </section>

    {error ? <p role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p> : null}
    {notice ? <p role="status" className="rounded-2xl border border-emerald-800 bg-emerald-950/35 p-4 text-sm text-emerald-200">{notice}</p> : null}

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
      <div className="space-y-6">
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
          <div className="flex flex-col gap-3 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-black text-white">Create and save</h2><p className="mt-1 text-xs leading-5 text-slate-400">Every request creates a durable library draft before AI or Stitch is called.</p></div><div className="flex gap-2 text-[10px] font-black uppercase"><span className={`rounded-full border px-3 py-1 ${config?.aiAvailable ? 'border-emerald-700 text-emerald-300' : 'border-amber-700 text-amber-300'}`}>AI {config?.aiAvailable ? 'ready' : 'not configured'}</span><span className={`rounded-full border px-3 py-1 ${config?.stitchAvailable ? 'border-emerald-700 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>Stitch {config?.stitchAvailable ? 'ready' : 'optional'}</span></div></div>
          <form className="pt-5" onSubmit={generate}>
            <fieldset disabled={!canManage || Boolean(busy)}>
              <legend className="text-xs font-black uppercase tracking-wider text-slate-400">Reusable output</legend>
              <div className="mt-3 grid gap-3 md:grid-cols-3">{kindOptions.map(option => { const Icon = option.icon; const active = itemKind === option.value; return <button key={option.value} type="button" aria-pressed={active} onClick={() => setItemKind(option.value)} className={`min-h-28 rounded-2xl border p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${active ? 'border-violet-500 bg-violet-950/40' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}><Icon className="h-5 w-5 text-violet-300" /><strong className="mt-4 block text-sm text-white">{option.label}</strong><span className="mt-1 block text-[11px] leading-4 text-slate-500">{option.detail}</span></button>; })}</div>
              <label className="mt-5 block text-xs font-bold text-slate-300">Design brief<textarea required minLength={12} maxLength={2200} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Create a premium but approachable website theme for an independent clinic. Prioritise treatment discovery, verified trust and consultation booking." className="mt-2 min-h-32 w-full resize-y rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm leading-6 text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" /><span className="mt-1 flex justify-between text-[10px] font-normal text-slate-500"><span>Audience, industry, hierarchy, mood and booking goal.</span><span>{prompt.length}/2200</span></span></label>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><label className="text-xs font-bold text-slate-300">Optional name<input value={name} onChange={event => setName(event.target.value)} maxLength={160} placeholder="Generated automatically" className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white" /></label><label className="text-xs font-bold text-slate-300">Category<select value={category} onChange={event => setCategory(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option>Professional services</option><option>Local services</option><option>Healthcare</option><option>Wellness</option><option>Beauty and aesthetics</option><option>Hospitality</option><option>Creative</option><option>Education</option><option>Charity and community</option><option>Other</option></select></label>{itemKind !== 'SITE_THEME' ? <label className="text-xs font-bold text-slate-300">Section type<select value={sectionType} onChange={event => setSectionType(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white">{config?.sectionTypes.map(type => <option key={type} value={type}>{titleCase(type)}</option>)}</select></label> : <label className="text-xs font-bold text-slate-300">Output<span className="mt-2 flex min-h-11 items-center rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm font-normal text-slate-400">Theme + required pages</span></label>}<label className="text-xs font-bold text-slate-300">Tags<input value={industryTags} onChange={event => setIndustryTags(event.target.value)} maxLength={240} placeholder="clinic, premium, local" className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white" /></label></div>
              <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950 p-4"><label className="flex min-h-11 cursor-pointer items-center gap-3 text-xs font-bold text-white"><input type="checkbox" checked={useAiPalette} onChange={event => setUseAiPalette(event.target.checked)} className="h-4 w-4 rounded border-slate-600" />Let AI create the palette</label><p className="mt-1 text-[11px] leading-5 text-slate-500">Turn this off to direct all eight colour tokens. Generated and client-level palettes still must pass WCAG.</p>{!useAiPalette ? <div className="mt-4"><ColourEditor values={colours} onChange={(key, value) => setColours(current => ({ ...current, [key]: value }))} /></div> : null}</div>
              <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Design source</p><div className="mt-2 flex gap-2"><button type="button" aria-pressed={sourceType === 'KS_AI'} disabled={!config?.aiAvailable} onClick={() => setSourceType('KS_AI')} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-xs font-black disabled:opacity-40 ${sourceType === 'KS_AI' ? 'border-violet-500 bg-violet-950/50 text-violet-100' : 'border-slate-700 text-slate-400'}`}><Sparkles className="h-4 w-4" />KS AI</button><button type="button" aria-pressed={sourceType === 'GOOGLE_STITCH'} disabled={!config?.stitchAvailable || !config?.aiAvailable} onClick={() => setSourceType('GOOGLE_STITCH')} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-xs font-black disabled:opacity-40 ${sourceType === 'GOOGLE_STITCH' ? 'border-violet-500 bg-violet-950/50 text-violet-100' : 'border-slate-700 text-slate-400'}`}><WandSparkles className="h-4 w-4" />Stitch → AI</button></div></div><button type="submit" disabled={!canGenerate || Boolean(busy) || !prompt.trim()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 text-sm font-black text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'generate' ? <><Loader2 className="h-4 w-4 animate-spin" />Creating and saving…</> : <><Send className="h-4 w-4" />Generate and save</>}</button></div>
            </fieldset>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6"><div className="flex flex-col gap-3 border-b border-slate-800 pb-5 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-black text-white">Reusable library</h2><p className="mt-1 text-xs text-slate-400">Components, page sections and complete client-ready themes in one organised view.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search library" className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-xs text-white" /></label><select value={kindFilter} onChange={event => setKindFilter(event.target.value as 'ALL' | ItemKind)} className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white"><option value="ALL">All assets</option><option value="COMPONENT">Components</option><option value="PAGE_SECTION">Page sections</option><option value="SITE_THEME">Website themes</option></select></div></div><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map(item => <button key={item.reference} type="button" onClick={() => setSelectedReference(item.reference)} className={`rounded-2xl border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${selectedReference === item.reference ? 'border-violet-500 bg-violet-950/25' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>{item.itemKind === 'SITE_THEME' ? <Preview item={item} compact /> : <div className="grid aspect-[16/10] place-items-center rounded-xl border border-slate-800 bg-gradient-to-br from-slate-950 to-violet-950/40"><span className="rounded-2xl border border-violet-800 bg-violet-950/50 p-4">{item.itemKind === 'COMPONENT' ? <Blocks className="h-7 w-7 text-violet-300" /> : <Layers3 className="h-7 w-7 text-violet-300" />}</span></div>}<div className="mt-3 flex items-start justify-between gap-3"><div><strong className="text-sm text-white">{item.name}</strong><p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">{titleCase(item.itemKind)} · {item.category}</p></div><Status value={item.status} /></div></button>)}</div>{!filtered.length ? <p className="mt-5 rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No library items match these filters.</p> : null}</section>
      </div>

      <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">{selected ? <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wider text-violet-300">Selected asset</p><h2 className="mt-2 text-xl font-black text-white">{selected.name}</h2></div><Status value={selected.status} /></div><div className="mt-4">{selected.itemKind === 'SITE_THEME' ? <Preview item={selected} /> : <div className="grid aspect-video place-items-center rounded-2xl border border-slate-800 bg-slate-950"><Eye className="h-8 w-8 text-violet-300" /></div>}</div><p className="mt-4 text-xs leading-5 text-slate-400">{selected.description}</p>{Object.keys(selected.theme || {}).length ? <div className="mt-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Palette</p><div className="mt-2 grid grid-cols-8 gap-1">{(Object.keys(DEFAULT_COLOURS) as ColourKey[]).map(key => <span key={key} title={`${colourLabels[key]}: ${selected.theme[key] || DEFAULT_COLOURS[key]}`} className="aspect-square rounded border border-white/10" style={{ backgroundColor: selected.theme[key] || DEFAULT_COLOURS[key] }} />)}</div></div> : null}<div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl border border-slate-800 bg-slate-950 p-3"><strong className="text-lg text-white">{selected.pageManifest.length}</strong><p className="text-[10px] uppercase text-slate-500">Pages</p></div><div className="rounded-xl border border-slate-800 bg-slate-950 p-3"><strong className="text-lg text-white">{selected.assignedTenantCount}</strong><p className="text-[10px] uppercase text-slate-500">Clients</p></div></div>{selected.sourceMetadata && typeof selected.sourceMetadata.knowledge === 'object' ? <div className="mt-4 rounded-xl border border-emerald-900 bg-emerald-950/20 p-3"><p className="flex items-center gap-2 text-xs font-bold text-emerald-200"><ShieldCheck className="h-4 w-4" />Knowledge provenance pinned</p><p className="mt-1 text-[10px] leading-4 text-emerald-300/70">This item records the active pack version, context digest, rule IDs and playbook structure used during generation.</p></div> : null}{selected.status === 'READY_FOR_REVIEW' && canApprove ? <button type="button" onClick={() => void approve(selected)} disabled={Boolean(busy)} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black text-slate-950 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />Approve asset</button> : null}{selected.availableForClientDelivery ? <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4"><label className="text-xs font-bold text-slate-300">Assign theme to client<select value={assignTenant} onChange={event => setAssignTenant(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs text-white"><option value="">Choose client…</option>{tenants.filter(tenant => tenant.lifecycleStatus !== 'OFFBOARDED').map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label><button type="button" onClick={() => void assign(selected)} disabled={!assignTenant || Boolean(busy)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-violet-700 px-4 text-xs font-black text-violet-200 disabled:opacity-40"><Globe2 className="h-4 w-4" />Assign for launch</button>{assignTenant ? <Link to={`/agency/tenants/${assignTenant}/fulfilment`} className="mt-2 inline-flex min-h-11 w-full items-center justify-center text-xs font-bold text-slate-400 hover:text-white">Open client Launch Pipeline</Link> : null}</div> : null}{!selected.isSystem && selected.status !== 'ARCHIVED' && canManage ? <button type="button" onClick={() => void archive(selected)} disabled={Boolean(busy)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-400 disabled:opacity-40"><Archive className="h-4 w-4" />Archive</button> : null}</section> : <section className="rounded-3xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center text-sm text-slate-500"><Library className="mx-auto mb-3 h-7 w-7" />Select an asset to review it.</section>}
        <section className="rounded-3xl border border-violet-800/50 bg-violet-950/25 p-5"><Palette className="h-5 w-5 text-violet-300" /><h2 className="mt-3 text-sm font-black text-white">One path to live</h2><p className="mt-2 text-xs leading-5 text-slate-400">Create here, approve the theme, assign it to a client, then use the client Launch Pipeline to customise colours, build native booking and website, review quality and activate.</p></section>
      </aside>
    </div>
  </div>;
}
