import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Blocks,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Eye,
  Filter,
  Globe2,
  Grid2X2,
  Layers3,
  Library,
  Loader2,
  Monitor,
  Palette,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';

type ItemKind = 'COMPONENT' | 'PAGE_SECTION' | 'SITE_THEME';
type SourceType = 'KS_AI' | 'GOOGLE_STITCH' | 'PREBUILT' | 'MANUAL';
type ItemStatus = 'GENERATING' | 'DRAFT' | 'READY_FOR_REVIEW' | 'APPROVED' | 'FAILED' | 'ARCHIVED';

type Theme = {
  primaryColour?: string;
  secondaryColour?: string;
  accentColour?: string;
  backgroundColour?: string;
  surfaceColour?: string;
  textColour?: string;
  mutedTextColour?: string;
  borderColour?: string;
  headingFontKey?: string;
  bodyFontKey?: string;
  radiusScale?: string;
  spacingDensity?: string;
  containerWidth?: string;
  buttonStyle?: string;
  imageStyle?: string;
  motionPreference?: string;
};

type PageManifest = { pageType: string; required?: boolean; sections: string[] };

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
  definition: Record<string, any>;
  pageManifest: PageManifest[];
  preview: Record<string, any>;
  previewImageUrl?: string | null;
  previewHtmlUrl?: string | null;
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
  itemKinds: ItemKind[];
  sectionTypes: string[];
  pageTypes: string[];
  sectionVariants: string[];
  automaticSave: boolean;
  executableCodeAllowed: boolean;
};

type Tenant = { id: string; name: string; lifecycleStatus: string; subdomain: string };

const DEFAULT_THEME: Required<Pick<Theme,
  'primaryColour' | 'secondaryColour' | 'accentColour' | 'backgroundColour'
  | 'surfaceColour' | 'textColour' | 'mutedTextColour' | 'borderColour'>> = {
  primaryColour: '#2A1F4F',
  secondaryColour: '#51407A',
  accentColour: '#B54B78',
  backgroundColour: '#FAF8FF',
  surfaceColour: '#FFFFFF',
  textColour: '#211A3B',
  mutedTextColour: '#5A536E',
  borderColour: '#DDD7EA',
};

const kindCopy: Record<ItemKind, { label: string; short: string; icon: React.ElementType }> = {
  COMPONENT: { label: 'Individual component', short: 'Cards, buttons, forms and navigation patterns', icon: Blocks },
  PAGE_SECTION: { label: 'Page section', short: 'Complete heroes, services, trust, FAQ and CTA sections', icon: Layers3 },
  SITE_THEME: { label: 'Website theme', short: 'Tokens plus required pages and section recipes', icon: Globe2 },
};

const statusTone: Record<ItemStatus, string> = {
  GENERATING: 'border-violet-700 bg-violet-950/40 text-violet-200',
  DRAFT: 'border-slate-700 bg-slate-950 text-slate-300',
  READY_FOR_REVIEW: 'border-amber-700 bg-amber-950/35 text-amber-200',
  APPROVED: 'border-emerald-700 bg-emerald-950/35 text-emerald-200',
  FAILED: 'border-rose-800 bg-rose-950/40 text-rose-200',
  ARCHIVED: 'border-slate-700 bg-slate-900 text-slate-500',
};

const titleCase = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, character => character.toUpperCase());
const dateTime = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

function StatusPill({ value }: { value: ItemStatus }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusTone[value]}`}>{value.replaceAll('_', ' ')}</span>;
}

function SourcePill({ value }: { value: SourceType }) {
  const text = value === 'KS_AI' ? 'KS AI' : value === 'GOOGLE_STITCH' ? 'Google Stitch' : titleCase(value);
  return <span className="inline-flex rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-400">{text}</span>;
}

function WebsitePreview({ item, compact = false }: { item: DesignItem; compact?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const theme = { ...DEFAULT_THEME, ...item.theme };
  const preview = item.preview || {};
  const cards = Array.isArray(preview.cards) && preview.cards.length ? preview.cards.slice(0, 3) : ['Service one', 'Service two', 'Service three'];
  const radius = item.theme.radiusScale === 'NONE' ? '0px' : item.theme.radiusScale === 'SMALL' ? '5px' : item.theme.radiusScale === 'LARGE' ? '16px' : '10px';
  const label = `${item.name} website preview`;

  if (item.previewImageUrl && !imageFailed) {
    return <div className={`overflow-hidden border border-slate-700 bg-slate-950 ${compact ? 'aspect-[16/10]' : 'aspect-[16/9]'}`} style={{ borderRadius: radius }} role="img" aria-label={label}>
      <img src={item.previewImageUrl} alt={`${item.name} generated by Google Stitch`} loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="h-full w-full object-cover object-top" />
    </div>;
  }

  return <div
    className={`relative overflow-hidden border shadow-2xl ${compact ? 'aspect-[16/10]' : 'aspect-[16/9]'}`}
    style={{ backgroundColor: theme.backgroundColour, borderColor: theme.borderColour, color: theme.textColour, borderRadius: radius }}
    role="img"
    aria-label={label}
  >
    <div className="flex h-[14%] items-center justify-between border-b px-[4%]" style={{ borderColor: theme.borderColour, backgroundColor: theme.surfaceColour }}>
      <span className="flex items-center gap-1.5 text-[7px] font-black tracking-tight"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: theme.primaryColour }} />{item.name.split(' ').slice(0, 2).join(' ')}</span>
      <span className="flex gap-2 text-[5px] font-bold" style={{ color: theme.mutedTextColour }}><span>Home</span><span>Services</span><span>About</span><span>Contact</span></span>
      <span className="rounded px-2 py-1 text-[5px] font-black text-white" style={{ backgroundColor: theme.primaryColour, borderRadius: radius }}>{preview.primaryAction || 'Book now'}</span>
    </div>
    <div className={`grid h-[58%] items-center gap-[4%] px-[6%] py-[5%] ${preview.layout === 'editorial' || preview.layout === 'editorial-collage' ? 'grid-cols-[1.15fr_0.85fr]' : 'grid-cols-2'}`}>
      <div className="min-w-0">
        <div className="mb-2 text-[5px] font-black uppercase tracking-[0.18em]" style={{ color: theme.accentColour }}>{preview.eyebrow || item.category}</div>
        <div className="max-w-[95%] text-[clamp(10px,2vw,25px)] font-black leading-[0.95] tracking-tight">{preview.headline || item.name}</div>
        <div className="mt-2 max-w-[90%] text-[5px] leading-relaxed" style={{ color: theme.mutedTextColour }}>{preview.body || item.description}</div>
        <div className="mt-3 flex gap-1.5"><span className="rounded px-2 py-1 text-[5px] font-black text-white" style={{ backgroundColor: theme.primaryColour, borderRadius: radius }}>{preview.primaryAction || 'Get started'}</span><span className="rounded border px-2 py-1 text-[5px] font-black" style={{ borderColor: theme.borderColour, borderRadius: radius }}>{preview.secondaryAction || 'Learn more'}</span></div>
      </div>
      <div className="relative h-full overflow-hidden" style={{ borderRadius: radius, background: `linear-gradient(135deg, ${theme.secondaryColour}, ${theme.primaryColour})` }}>
        <div className="absolute inset-[12%] border border-white/30 bg-white/10" style={{ borderRadius: radius }} />
        <div className="absolute bottom-[12%] left-[10%] right-[10%] grid grid-cols-3 gap-1">
          {cards.map((card: string) => <span key={card} className="truncate rounded bg-white/90 px-1 py-1 text-center text-[4px] font-black" style={{ color: theme.textColour, borderRadius: radius }}>{card}</span>)}
        </div>
        <div className="absolute right-[12%] top-[14%] h-[34%] w-[34%] rounded-full border-[6px] border-white/15 bg-white/10" />
      </div>
    </div>
    <div className="grid h-[28%] grid-cols-3 gap-[2%] border-t px-[6%] py-[3%]" style={{ borderColor: theme.borderColour, backgroundColor: theme.surfaceColour }}>
      {cards.map((card: string, index: number) => <div key={card} className="border p-1.5" style={{ borderColor: theme.borderColour, borderRadius: radius }}><span className="mb-1 block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: index === 1 ? theme.accentColour : theme.primaryColour }} /><strong className="block truncate text-[5px]">{card}</strong><span className="mt-1 block h-1 w-4/5 rounded bg-current opacity-10" /></div>)}
    </div>
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4"><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-white">{value}</p>{detail ? <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p> : null}</div>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950 p-8 text-center text-sm leading-6 text-slate-500">{children}</div>;
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
  const [itemKind, setItemKind] = useState<ItemKind>('PAGE_SECTION');
  const [sourceType, setSourceType] = useState<'KS_AI' | 'GOOGLE_STITCH'>('KS_AI');
  const [sectionType, setSectionType] = useState('HERO');
  const [industryTags, setIndustryTags] = useState('');
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'ALL' | ItemKind>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ItemStatus>('ALL');
  const [assignTenant, setAssignTenant] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canManage = Boolean(session?.capabilities.includes('sites.templates.manage'));
  const canApprove = Boolean(session?.capabilities.includes('sites.templates.approve'));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = items.find(item => item.reference === selectedReference) || null;
  const prebuiltThemes = items.filter(item => item.itemKind === 'SITE_THEME' && item.isSystem && item.status === 'APPROVED');
  const generatedCount = items.filter(item => ['KS_AI', 'GOOGLE_STITCH'].includes(item.sourceType)).length;
  const approvedThemeCount = items.filter(item => item.itemKind === 'SITE_THEME' && item.status === 'APPROVED' && item.availableForClientDelivery).length;
  const componentCount = items.filter(item => item.itemKind === 'COMPONENT').length;
  const sectionCount = items.filter(item => item.itemKind === 'PAGE_SECTION').length;

  const filteredItems = useMemo(() => {
    const needle = query.toLowerCase();
    return items.filter(item => {
      if (kindFilter !== 'ALL' && item.itemKind !== kindFilter) return false;
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      return !needle || `${item.name} ${item.description} ${item.category} ${item.tags.join(' ')}`.toLowerCase().includes(needle);
    });
  }, [items, kindFilter, statusFilter, query]);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || busy) return;
    setBusy('generate');
    setError('');
    setNotice('');
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
        }),
      });
      setNotice(`${created.name} was generated and saved to the library for review.`);
      setPrompt('');
      setName('');
      await load();
      setSelectedReference(created.reference);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The design could not be generated. Its saved failure record remains in the library.');
      await load();
    } finally {
      setBusy('');
    }
  };

  const approve = async (item: DesignItem) => {
    if (!canApprove || busy) return;
    setBusy(`approve:${item.reference}`); setError(''); setNotice('');
    try {
      const approved = await agencyFetch(`/design-library/${item.reference}/approve`, { method: 'POST' });
      setNotice(`${approved.name} is approved${approved.availableForClientDelivery ? ' and available for client delivery' : ''}.`);
      await load();
      setSelectedReference(item.reference);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The design could not be approved.'); }
    finally { setBusy(''); }
  };

  const archive = async (item: DesignItem) => {
    if (!canManage || busy) return;
    setBusy(`archive:${item.reference}`); setError(''); setNotice('');
    try {
      await agencyFetch(`/design-library/${item.reference}/archive`, { method: 'POST' });
      setNotice(`${item.name} was archived.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The design could not be archived.'); }
    finally { setBusy(''); }
  };

  const assign = async (item: DesignItem) => {
    if (!canManage || busy || !assignTenant) return;
    setBusy(`assign:${item.reference}`); setError(''); setNotice('');
    try {
      const result = await agencyFetch(`/design-library/${item.reference}/assign`, {
        method: 'POST', body: JSON.stringify({ tenantReference: assignTenant }),
      });
      setNotice(`${result.designName} is now assigned to ${result.tenantName} and will be applied to its next native website build.`);
      await load();
      setSelectedReference(item.reference);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The theme could not be assigned.'); }
    finally { setBusy(''); }
  };

  if (loading) return <div className="grid min-h-96 place-items-center rounded-3xl border border-slate-800 bg-slate-900"><p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading Design Studio…</p></div>;

  return <div className="space-y-6">
    <section className="overflow-hidden rounded-3xl border border-violet-800/60 bg-gradient-to-br from-violet-950 via-slate-950 to-slate-900 p-6 shadow-2xl sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-violet-300"><Sparkles className="h-4 w-4" />KS-owned website design</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">Design Studio</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Prompt KS AI or Google Stitch, convert the result into controlled components, sections or complete website themes, and save every creation into an organised reusable library.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:min-w-[480px]">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><strong className="block text-xl text-white">{generatedCount}</strong><span className="text-slate-400">Generated</span></div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><strong className="block text-xl text-white">{componentCount}</strong><span className="text-slate-400">Components</span></div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><strong className="block text-xl text-white">{sectionCount}</strong><span className="text-slate-400">Sections</span></div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><strong className="block text-xl text-white">{approvedThemeCount}</strong><span className="text-slate-400">Client themes</span></div>
        </div>
      </div>
    </section>

    {error ? <p role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p> : null}
    {notice ? <p role="status" className="rounded-2xl border border-emerald-800 bg-emerald-950/35 p-4 text-sm text-emerald-200">{notice}</p> : null}

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
      <div className="space-y-6">
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
          <div className="flex flex-col gap-3 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="text-lg font-black text-white">Create something reusable</h2><p className="mt-1 text-xs leading-5 text-slate-400">The library draft is saved before AI or Stitch runs, so no creation disappears if a provider fails.</p></div>
            <div className="flex gap-2"><span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase ${config?.aiAvailable ? 'border-emerald-700 text-emerald-300' : 'border-amber-700 text-amber-300'}`}>AI {config?.aiAvailable ? 'ready' : 'not configured'}</span><span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase ${config?.stitchAvailable ? 'border-emerald-700 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>Stitch {config?.stitchAvailable ? 'ready' : 'not configured'}</span></div>
          </div>

          <form className="pt-5" onSubmit={generate}>
            <fieldset disabled={!canManage || Boolean(busy)}>
              <legend className="text-xs font-black uppercase tracking-wider text-slate-400">What are you creating?</legend>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {(Object.entries(kindCopy) as Array<[ItemKind, typeof kindCopy[ItemKind]]>).map(([kind, copy]) => { const Icon = copy.icon; const active = itemKind === kind; return <button key={kind} type="button" aria-pressed={active} onClick={() => setItemKind(kind)} className={`min-h-28 rounded-2xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${active ? 'border-violet-500 bg-violet-950/40' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}><Icon className="h-5 w-5 text-violet-300" /><strong className="mt-4 block text-sm text-white">{copy.label}</strong><span className="mt-1 block text-[11px] leading-4 text-slate-500">{copy.short}</span></button>; })}
              </div>

              <label className="mt-5 block text-xs font-bold text-slate-300">Describe the design<textarea required minLength={12} maxLength={4000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={itemKind === 'SITE_THEME' ? 'Create a premium but approachable website theme for an independent aesthetics clinic, with strong trust, treatment discovery and consultation booking.' : 'Create a split hero section with a confident headline, service proof, one primary booking action and a softer secondary action.'} className="mt-2 min-h-36 w-full resize-y rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm leading-6 text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" /><span className="mt-1 flex justify-between text-[10px] font-normal text-slate-500"><span>Include audience, hierarchy, visual mood, content and conversion intent.</span><span>{prompt.length}/4000</span></span></label>

              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <label className="text-xs font-bold text-slate-300">Optional name<input value={name} onChange={event => setName(event.target.value)} maxLength={160} placeholder="Generated automatically" className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white" /></label>
                <label className="text-xs font-bold text-slate-300">Category<select value={category} onChange={event => setCategory(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option>Professional services</option><option>Local services</option><option>Healthcare</option><option>Wellness</option><option>Beauty and aesthetics</option><option>Hospitality</option><option>Creative</option><option>Education</option><option>Charity and community</option><option>Other</option></select></label>
                {itemKind !== 'SITE_THEME' ? <label className="text-xs font-bold text-slate-300">Controlled section type<select value={sectionType} onChange={event => setSectionType(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white">{config?.sectionTypes.map(type => <option key={type} value={type}>{titleCase(type)}</option>)}</select></label> : <label className="text-xs font-bold text-slate-300">Required output<span className="mt-2 flex min-h-11 items-center rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm font-normal text-slate-400">Theme + page manifest</span></label>}
                <label className="text-xs font-bold text-slate-300">Tags<input value={industryTags} onChange={event => setIndustryTags(event.target.value)} maxLength={240} placeholder="clinic, premium, local" className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white" /></label>
              </div>

              <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:flex-row sm:items-center sm:justify-between">
                <fieldset><legend className="text-[10px] font-black uppercase tracking-wider text-slate-500">Design source</legend><div className="mt-2 flex flex-wrap gap-2"><button type="button" aria-pressed={sourceType === 'KS_AI'} disabled={!config?.aiAvailable} onClick={() => setSourceType('KS_AI')} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-xs font-black disabled:opacity-40 ${sourceType === 'KS_AI' ? 'border-violet-500 bg-violet-950/50 text-violet-100' : 'border-slate-700 text-slate-400'}`}><Sparkles className="h-4 w-4" />KS AI</button><button type="button" aria-pressed={sourceType === 'GOOGLE_STITCH'} disabled={!config?.stitchAvailable || !config?.aiAvailable} onClick={() => setSourceType('GOOGLE_STITCH')} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-xs font-black disabled:opacity-40 ${sourceType === 'GOOGLE_STITCH' ? 'border-violet-500 bg-violet-950/50 text-violet-100' : 'border-slate-700 text-slate-400'}`}><WandSparkles className="h-4 w-4" />Stitch → AI</button></div></fieldset>
                <button type="submit" disabled={!canManage || Boolean(busy) || !prompt.trim() || !config?.aiAvailable || (sourceType === 'GOOGLE_STITCH' && !config?.stitchAvailable)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 text-sm font-black text-white shadow-lg shadow-violet-950/40 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'generate' ? <><Loader2 className="h-4 w-4 animate-spin" />Creating and saving…</> : <><Send className="h-4 w-4" />Generate and save</>}</button>
              </div>
            </fieldset>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
          <div className="flex flex-col gap-3 border-b border-slate-800 pb-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Ready to reuse</p><h2 className="mt-1 text-lg font-black text-white">Prebuilt website themes</h2><p className="mt-1 text-xs leading-5 text-slate-400">Each preview includes accessible tokens, required pages and the section recipe used by client delivery.</p></div><span className="text-xs font-bold text-slate-500">{prebuiltThemes.length} KS-owned themes</span></div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{prebuiltThemes.map(item => <button type="button" key={item.reference} onClick={() => setSelectedReference(item.reference)} className={`rounded-2xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${selectedReference === item.reference ? 'border-violet-500 bg-violet-950/25' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}><WebsitePreview item={item} compact /><div className="mt-3 flex items-start justify-between gap-3"><div><strong className="text-sm text-white">{item.name}</strong><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{item.description}</p></div><Eye className="h-4 w-4 shrink-0 text-violet-300" /></div><div className="mt-3 flex items-center justify-between text-[10px] font-bold text-slate-500"><span>{item.pageManifest.length} required pages</span><span>{item.assignedTenantCount} clients</span></div></button>)}</div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
          <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Organised automatically</p><h2 className="mt-1 text-lg font-black text-white">Design library</h2><p className="mt-1 text-xs leading-5 text-slate-400">Filter components, sections and themes without mixing draft work into approved client assets.</p></div><div className="flex flex-col gap-2 sm:flex-row"><label className="relative"><span className="sr-only">Search design library</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search library" className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-3 text-sm text-white sm:w-56" /></label><label className="relative"><span className="sr-only">Filter by kind</span><Grid2X2 className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" /><select value={kindFilter} onChange={event => setKindFilter(event.target.value as 'ALL' | ItemKind)} className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-8 text-sm text-white"><option value="ALL">All types</option><option value="COMPONENT">Components</option><option value="PAGE_SECTION">Sections</option><option value="SITE_THEME">Themes</option></select></label><label className="relative"><span className="sr-only">Filter by status</span><Filter className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" /><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'ALL' | ItemStatus)} className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-8 text-sm text-white"><option value="ALL">All statuses</option><option value="READY_FOR_REVIEW">Needs review</option><option value="APPROVED">Approved</option><option value="FAILED">Failed</option><option value="ARCHIVED">Archived</option></select></label></div></div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredItems.length ? filteredItems.map(item => { const Icon = kindCopy[item.itemKind].icon; return <button type="button" key={item.reference} onClick={() => setSelectedReference(item.reference)} className={`rounded-2xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${selectedReference === item.reference ? 'border-violet-500 bg-violet-950/25' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}><WebsitePreview item={item} compact /><div className="mt-3 flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex items-center gap-2"><Icon className="h-4 w-4 shrink-0 text-violet-300" /><strong className="truncate text-sm text-white">{item.name}</strong></div><p className="mt-1 text-[10px] font-black uppercase tracking-wide text-slate-500">{kindCopy[item.itemKind].label} · {item.category}</p></div><StatusPill value={item.status} /></div><div className="mt-3 flex items-center justify-between"><SourcePill value={item.sourceType} /><span className="text-[10px] text-slate-600">{dateTime(item.updatedAt)}</span></div></button>; }) : <div className="md:col-span-2 xl:col-span-3"><EmptyState>No library items match the current search and filters.</EmptyState></div>}</div>
        </section>
      </div>

      <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-4"><Monitor className="h-5 w-5 text-violet-300" /><h2 className="text-sm font-black text-white">Preview and details</h2></div>
          {selected ? <div className="pt-5">
            <WebsitePreview item={selected} />
            <div className="mt-4 flex flex-wrap gap-2"><StatusPill value={selected.status} /><SourcePill value={selected.sourceType} />{selected.availableForClientDelivery ? <span className="inline-flex rounded-full border border-emerald-700 bg-emerald-950/35 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-200">Client-ready</span> : null}</div>
            <h3 className="mt-4 text-lg font-black text-white">{selected.name}</h3>
            <p className="mt-2 text-xs leading-5 text-slate-400">{selected.description}</p>
            <dl className="mt-5 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-slate-950 p-3"><dt className="text-[9px] font-black uppercase text-slate-600">Type</dt><dd className="mt-1 font-bold text-slate-300">{kindCopy[selected.itemKind].label}</dd></div><div className="rounded-xl bg-slate-950 p-3"><dt className="text-[9px] font-black uppercase text-slate-600">Category</dt><dd className="mt-1 font-bold text-slate-300">{selected.category}</dd></div><div className="rounded-xl bg-slate-950 p-3"><dt className="text-[9px] font-black uppercase text-slate-600">Revision</dt><dd className="mt-1 font-bold text-slate-300">{selected.isSystem ? 'KS system' : 'Generated'}</dd></div><div className="rounded-xl bg-slate-950 p-3"><dt className="text-[9px] font-black uppercase text-slate-600">Clients</dt><dd className="mt-1 font-bold text-slate-300">{selected.assignedTenantCount}</dd></div></dl>

            <div className="mt-5"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Theme colours</p><div className="mt-2 flex overflow-hidden rounded-xl border border-slate-700" aria-label="Theme colour swatches">{['primaryColour', 'secondaryColour', 'accentColour', 'backgroundColour', 'surfaceColour'].map(key => <span key={key} className="h-10 flex-1" title={`${titleCase(key)} ${selected.theme[key as keyof Theme] || ''}`} style={{ backgroundColor: selected.theme[key as keyof Theme] || DEFAULT_THEME[key as keyof typeof DEFAULT_THEME] }} />)}</div></div>

            {selected.pageManifest.length ? <div className="mt-5"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Required website structure</p><div className="mt-2 space-y-2">{selected.pageManifest.map(page => <details key={page.pageType} className="rounded-xl border border-slate-800 bg-slate-950 p-3"><summary className="cursor-pointer text-xs font-black text-slate-300">{titleCase(page.pageType)} <span className="font-normal text-slate-600">· {page.sections.length} sections</span></summary><div className="mt-2 flex flex-wrap gap-1.5">{page.sections.map(section => <span key={section} className="rounded-lg border border-slate-800 px-2 py-1 text-[9px] font-bold text-slate-500">{titleCase(section)}</span>)}</div></details>)}</div></div> : null}

            <div className="mt-5"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Accessibility</p>{selected.accessibility?.issues?.length ? <div className="mt-2 space-y-2">{selected.accessibility.issues.map(issue => <p key={issue} className="flex gap-2 rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-xs leading-5 text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{issue}</p>)}</div> : <p className="mt-2 flex gap-2 rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-xs leading-5 text-emerald-200"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />Automated colour and controlled-structure checks have no blocking findings. Full page audits still run before publication.</p>}</div>

            {selected.status === 'READY_FOR_REVIEW' && canApprove ? <button type="button" disabled={Boolean(busy)} onClick={() => void approve(selected)} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white disabled:opacity-40">{busy === `approve:${selected.reference}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve design</button> : null}

            {selected.itemKind === 'SITE_THEME' && selected.availableForClientDelivery ? <div className="mt-5 rounded-2xl border border-violet-800 bg-violet-950/25 p-4"><p className="text-xs font-black text-violet-200">Use this theme for a client</p><p className="mt-1 text-[11px] leading-5 text-violet-300/70">The assignment becomes the source for that client’s next KS-native website build.</p><label className="mt-3 block text-[10px] font-black uppercase text-violet-300">Client workspace<select value={assignTenant} onChange={event => setAssignTenant(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-violet-800 bg-slate-950 px-3 text-sm font-normal normal-case text-white"><option value="">Select client</option>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name} · {titleCase(tenant.lifecycleStatus)}</option>)}</select></label><button type="button" disabled={!assignTenant || Boolean(busy) || !canManage} onClick={() => void assign(selected)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-black text-white disabled:opacity-40">{busy === `assign:${selected.reference}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}Assign to client</button></div> : null}

            {!selected.isSystem && selected.status !== 'ARCHIVED' && canManage ? <button type="button" disabled={Boolean(busy)} onClick={() => void archive(selected)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-400 hover:text-white disabled:opacity-40">{busy === `archive:${selected.reference}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}Archive</button> : null}
          </div> : <EmptyState>Select a design to inspect its preview, page structure, accessibility result and client assignments.</EmptyState>}
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5"><div className="flex items-center gap-2"><Library className="h-5 w-5 text-violet-300" /><h2 className="text-sm font-black text-white">How the library works</h2></div><ol className="mt-4 space-y-4">{[
          ['Describe', 'Prompt AI directly or ask Stitch to create the visual reference first.'],
          ['Convert safely', 'AI maps the design to controlled KS tokens, section types and data bindings.'],
          ['Review', 'Accessibility blockers prevent approval and client delivery.'],
          ['Reuse', 'Approved components stay organised; approved themes can be assigned to clients.'],
        ].map(([heading, detail], index) => <li key={heading} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-violet-700 bg-violet-950 text-[10px] font-black text-violet-200">{index + 1}</span><span><strong className="block text-xs text-slate-200">{heading}</strong><span className="mt-1 block text-[11px] leading-5 text-slate-500">{detail}</span></span></li>)}</ol><div className="mt-5 grid grid-cols-2 gap-2"><div className="rounded-xl border border-emerald-900 bg-emerald-950/20 p-3"><CheckCircle2 className="h-4 w-4 text-emerald-300" /><p className="mt-2 text-[10px] font-bold leading-4 text-emerald-200">Structured and reusable</p></div><div className="rounded-xl border border-slate-800 bg-slate-950 p-3"><CircleDashed className="h-4 w-4 text-slate-500" /><p className="mt-2 text-[10px] font-bold leading-4 text-slate-500">No arbitrary code</p></div></div></section>
      </aside>
    </div>
  </div>;
}
