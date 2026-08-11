import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Eye,
  Loader2,
  Paintbrush,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useParams } from 'react-router';
import {
  siteThemeAccessibilityIssues,
  type SiteDesignPreset,
  type SiteThemeEditor,
} from '@ks-os/contracts';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';
import { SiteQualityPanel } from './SiteQualityPanel';
import { SitePublishingPanel } from './SitePublishingPanel';
import { SearchIntelligencePanel } from './SearchIntelligencePanel';
import { LiveSiteIntelligencePanel } from './LiveSiteIntelligencePanel';

const pill = (value: string) => <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-black">{String(value || 'NOT STARTED').replaceAll('_', ' ')}</span>;

const headingFont: Record<SiteThemeEditor['headingFontKey'], string> = {
  SYSTEM_SANS: 'Inter, ui-sans-serif, system-ui, sans-serif',
  SYSTEM_SERIF: 'Georgia, Times New Roman, serif',
  EDITORIAL_SERIF: 'Iowan Old Style, Palatino Linotype, Georgia, serif',
};

const bodyFont: Record<SiteThemeEditor['bodyFontKey'], string> = {
  SYSTEM_SANS: 'Inter, ui-sans-serif, system-ui, sans-serif',
  SYSTEM_SERIF: 'Georgia, Times New Roman, serif',
};

function StructuredValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return <div className="space-y-2">{value.map((item, index) => <StructuredValue key={index} value={item} />)}</div>;
  if (typeof value === 'object') return <dl className="grid gap-2 sm:grid-cols-2">{Object.entries(value as Record<string, unknown>).map(([key, item]) => <div key={key} className="rounded-lg bg-white/70 p-3"><dt className="text-[10px] font-black uppercase text-slate-500">{key.replaceAll('_', ' ')}</dt><dd className="mt-1 text-sm"><StructuredValue value={item} /></dd></div>)}</dl>;
  return <>{String(value)}</>;
}

function ColourControl({
  id,
  label,
  description,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
    <label htmlFor={id} className="block text-xs font-black text-white">{label}</label>
    <p className="mt-1 text-[11px] leading-4 text-slate-500">{description}</p>
    <div className="mt-3 flex items-center gap-2">
      <input
        id={id}
        type="color"
        value={valid ? value : '#000000'}
        onChange={event => onChange(event.target.value.toUpperCase())}
        className="h-11 w-12 cursor-pointer rounded-lg border border-slate-700 bg-slate-900 p-1"
      />
      <input
        aria-label={`${label} hex value`}
        value={value}
        maxLength={7}
        onChange={event => onChange(event.target.value.toUpperCase())}
        className={`min-h-11 min-w-0 flex-1 rounded-lg border bg-slate-900 px-3 font-mono text-xs uppercase outline-none ${valid ? 'border-slate-700 focus:border-violet-500' : 'border-rose-600'}`}
      />
    </div>
  </div>;
}

function DesignPreview({ theme }: { theme: SiteThemeEditor }) {
  const radius = { NONE: 0, SMALL: 7, MEDIUM: 14, LARGE: 24 }[theme.radiusScale];
  const imageRadius = { SQUARE: 0, ROUNDED: 16, EDITORIAL: 4 }[theme.imageStyle];
  return <div
    aria-label="Design preview"
    className="overflow-hidden border shadow-2xl"
    style={{
      borderColor: theme.borderColour,
      borderRadius: radius,
      backgroundColor: theme.backgroundColour,
      color: theme.textColour,
      fontFamily: bodyFont[theme.bodyFontKey],
    }}
  >
    <div className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: theme.borderColour, backgroundColor: theme.surfaceColour }}>
      <strong style={{ fontFamily: headingFont[theme.headingFontKey] }}>Your business</strong>
      <span className="rounded-lg px-3 py-2 text-xs font-black" style={{ backgroundColor: theme.primaryColour, color: '#FFFFFF', borderRadius: radius }}>Book now</span>
    </div>
    <div className="grid gap-5 p-5 sm:grid-cols-[1.15fr_0.85fr] sm:items-center">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: theme.secondaryColour }}>Trusted local service</p>
        <h3 className="mt-3 text-3xl font-black leading-tight" style={{ fontFamily: headingFont[theme.headingFontKey] }}>A clear reason to choose this business</h3>
        <p className="mt-3 text-sm leading-6" style={{ color: theme.mutedTextColour }}>The preview demonstrates hierarchy, surfaces, buttons and readable supporting text before saving.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="px-4 py-2 text-xs font-black" style={{ backgroundColor: theme.primaryColour, color: '#FFFFFF', borderRadius: radius }}>Primary action</span>
          <span className="border px-4 py-2 text-xs font-black" style={{ borderColor: theme.primaryColour, color: theme.primaryColour, borderRadius: radius }}>Secondary action</span>
        </div>
      </div>
      <div className="aspect-[4/3]" style={{ borderRadius: imageRadius, background: `linear-gradient(145deg, ${theme.secondaryColour}, ${theme.accentColour})` }} />
    </div>
    <div className="grid gap-3 border-t p-5 sm:grid-cols-3" style={{ borderColor: theme.borderColour }}>
      {['Service one', 'Service two', 'Service three'].map(item => <div key={item} className="border p-3" style={{ borderColor: theme.borderColour, borderRadius: radius, backgroundColor: theme.surfaceColour }}><strong className="text-xs">{item}</strong><p className="mt-1 text-[11px]" style={{ color: theme.mutedTextColour }}>Short, useful supporting information.</p></div>)}
    </div>
  </div>;
}

export function SiteStudioPage() {
  const { siteReference } = useParams();
  const { session } = useAgencyAuth();
  const [studio, setStudio] = useState<any>(null);
  const [design, setDesign] = useState<any>(null);
  const [readiness, setReadiness] = useState<any>(null);
  const [selectedPage, setSelectedPage] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [viewport, setViewport] = useState<'MOBILE' | 'TABLET' | 'DESKTOP'>('DESKTOP');
  const [themeDraft, setThemeDraft] = useState<SiteThemeEditor | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [contentDraft, setContentDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const canManage = Boolean(session?.capabilities.includes('sites.manage'));
  const canApproveLiveChanges = Boolean(session?.capabilities.includes('sites.studio.approve'));
  const canDesign = Boolean(canManage && design?.editable);

  const load = useCallback(async () => {
    if (!siteReference) return;
    setError('');
    try {
      const [data, designData] = await Promise.all([
        agencyFetch(`/sites/${siteReference}/studio`),
        agencyFetch(`/sites/${siteReference}/studio/design`),
      ]);
      setStudio(data);
      setDesign(designData);
      setThemeDraft(designData.theme);
      if (!selectedPage && data.pages?.[0]) setSelectedPage(data.pages[0].reference);
      const state = await agencyFetch(`/tenants/${data.site.tenantReference}/readiness`);
      setReadiness(state);
    } catch (caught: any) {
      setError(caught.message);
    }
  }, [selectedPage, siteReference]);

  useEffect(() => { void load(); }, [load]);

  const page = studio?.pages?.find((item: any) => item.reference === selectedPage);
  const section = page?.sections?.find((item: any) => item.reference === selectedSection) || page?.sections?.[0];
  const width = viewport === 'MOBILE' ? '390px' : viewport === 'TABLET' ? '768px' : '100%';
  const contrastIssues = useMemo(() => themeDraft ? siteThemeAccessibilityIssues(themeDraft) : [], [themeDraft]);
  const invalidTheme = !themeDraft || contrastIssues.length > 0;
  const componentOptions = useMemo(() => {
    if (!section || !page || !design?.componentCatalog) return [];
    return design.componentCatalog.filter((component: any) =>
      component.compatibleSectionTypes.includes(section.type)
      && component.supportedPageTypes.includes(page.pageType)
      && component.supportedConversionRoles.includes(page.conversionRole));
  }, [design?.componentCatalog, page, section]);
  const pageTitlesByReference = useMemo(() => Object.fromEntries(
    (studio?.pages ?? []).map((item: any) => [item.reference, item.title]),
  ), [studio?.pages]);

  useEffect(() => {
    if (page?.sections?.length && !page.sections.some((item: any) => item.reference === selectedSection)) {
      setSelectedSection(page.sections[0].reference);
    }
  }, [page, selectedSection]);

  useEffect(() => {
    if (section?.content) {
      setContentDraft(Object.fromEntries(
        ['heading', 'body', 'eyebrow', 'message', 'legalText', 'imageAssetReference']
          .filter(field => field in section.content)
          .map(field => [field, section.content[field]]),
      ));
    }
  }, [section?.reference]);

  const command = async (key: string, operation: () => Promise<any>, success: string) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await operation();
      setNotice(success);
      await load();
    } catch (caught: any) {
      setError(caught.message);
    } finally {
      setBusy('');
    }
  };

  const regeneratePage = () => page && command(
    'page',
    () => agencyFetch(`/sites/${siteReference}/versions/${studio.version.reference}/pages/${page.reference}/regenerate`, { method: 'POST', body: '{}' }),
    'Bounded page regeneration was queued.',
  );

  const regenerateSection = () => {
    if (!section) return;
    const instruction = prompt(`Bounded regeneration instruction for ${section.type.toLowerCase().replaceAll('_', ' ')}`);
    if (!instruction) return;
    void command(
      'section',
      () => agencyFetch(`/sites/${siteReference}/versions/${studio.version.reference}/pages/${page.reference}/sections/${section.reference}/regenerate`, { method: 'POST', body: JSON.stringify({ regenerationInstruction: instruction }) }),
      'Bounded section regeneration was queued.',
    );
  };

  const approve = () => studio.review && command(
    'approve',
    () => agencyFetch(`/sites/${siteReference}/review-cycles/${studio.review.reference}/approve`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVE', approvalLevel: 'AGENCY_FINAL', notes: 'Approved in Site Studio after structured review.' }) }),
    'Agency final approval was recorded through the review service.',
  );

  const applyPreset = (preset: SiteDesignPreset) => {
    setSelectedPreset(preset.key);
    setThemeDraft({ ...preset.theme });
  };

  const saveTheme = () => themeDraft && command(
    'theme',
    () => agencyFetch(`/sites/${siteReference}/studio/design/theme`, {
      method: 'PATCH',
      body: JSON.stringify({ presetKey: selectedPreset || undefined, theme: themeDraft }),
    }),
    'The design system was saved. Internal review reopened and a fresh quality audit is now required.',
  );

  const saveVariant = (variant: string) => section && command(
    'variant',
    () => agencyFetch(`/sites/${siteReference}/studio/design/pages/${page.reference}/sections/${section.reference}/variant`, {
      method: 'PATCH',
      body: JSON.stringify({ variant }),
    }),
    'The component variation was saved. Internal review reopened and a fresh quality audit is now required.',
  );

  const saveComponent = (componentKey: string) => section && command(
    'component',
    () => agencyFetch(`/sites/${siteReference}/studio/design/pages/${page.reference}/sections/${section.reference}/component`, {
      method: 'PATCH',
      body: JSON.stringify({ componentKey }),
    }),
    'The designed component was saved. Internal review reopened and a fresh quality audit is now required.',
  );

  const saveContent = () => section && command(
    'content',
    () => agencyFetch(`/sites/${siteReference}/studio/design/pages/${page.reference}/sections/${section.reference}/content`, {
      method: 'PATCH',
      body: JSON.stringify({ patch: contentDraft }),
    }),
    'The section content and imagery were saved through the controlled schema.',
  );

  const moveSection = (offset: -1 | 1) => {
    if (!section || !page) return;
    const references = page.sections.map((item: any) => item.reference);
    const index = references.indexOf(section.reference);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= references.length) return;
    [references[index], references[target]] = [references[target], references[index]];
    void command(
      'order',
      () => agencyFetch(`/sites/${siteReference}/studio/design/pages/${page.reference}/sections/order`, {
        method: 'PATCH',
        body: JSON.stringify({ sectionReferences: references }),
      }),
      'The governed section order was saved.',
    );
  };

  const duplicateSection = () => section && command(
    'duplicate',
    () => agencyFetch(`/sites/${siteReference}/studio/design/pages/${page.reference}/sections/${section.reference}/duplicate`, { method: 'POST', body: '{}' }),
    'The section was duplicated as a new governed component.',
  );

  const removeSection = () => {
    if (!section || !window.confirm('Remove this section from the current draft version?')) return;
    void command(
      'remove',
      () => agencyFetch(`/sites/${siteReference}/studio/design/pages/${page.reference}/sections/${section.reference}`, { method: 'DELETE' }),
      'The section was removed from the current draft version.',
    );
  };

  if (!studio || !design || !themeDraft) return <p className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">{error || 'Loading Site Studio…'}</p>;

  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-4 text-sm text-emerald-200">{notice}</p>}

    <header className="rounded-3xl border border-slate-800 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.2),transparent_38%),#0f172a] p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl"><p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-violet-300"><Paintbrush className="h-4 w-4" />KS Design Studio</p><h1 className="mt-2 text-3xl font-black">{studio.site.displayName}</h1><p className="mt-2 text-sm leading-6 text-slate-400">Choose an owned design system, adjust an accessible palette, then mix component variations without exposing arbitrary HTML, CSS or JavaScript.</p></div>
        {pill(studio.site.status)}
      </div>
    </header>

    <section aria-labelledby="design-library-title" className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-violet-300"><Sparkles className="h-4 w-4" />Reusable design library</p><h2 id="design-library-title" className="mt-2 text-xl font-black">Ten original KS design systems</h2><p className="mt-1 text-xs leading-5 text-slate-500">Every preset uses the same secure components and native booking data. Select a starting point, then customise it.</p></div>
        <button type="button" disabled={!canDesign || busy === 'theme' || invalidTheme} onClick={() => void saveTheme()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><Save className="h-4 w-4" />{busy === 'theme' ? 'Saving…' : 'Save design'}</button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {design.presets.map((preset: SiteDesignPreset) => <button key={preset.key} type="button" disabled={!canDesign} aria-pressed={selectedPreset === preset.key} onClick={() => applyPreset(preset)} className={`rounded-2xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${selectedPreset === preset.key ? 'border-violet-500 bg-violet-950/40' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
          <span className="flex gap-1" aria-hidden="true">{[preset.theme.primaryColour, preset.theme.secondaryColour, preset.theme.accentColour, preset.theme.backgroundColour].map(colour => <span key={colour} className="h-6 flex-1 first:rounded-l-lg last:rounded-r-lg" style={{ backgroundColor: colour }} />)}</span>
          <strong className="mt-3 block text-sm text-white">{preset.name}</strong><span className="mt-1 block text-[11px] leading-4 text-slate-500">{preset.description}</span>
          {selectedPreset === preset.key ? <span className="mt-3 inline-flex items-center gap-1 text-[10px] font-black uppercase text-violet-300"><Check className="h-3 w-3" />Selected</span> : null}
        </button>)}
      </div>

      <div className="mt-6 grid gap-5 2xl:grid-cols-[1fr_1.15fr]">
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ColourControl id="primary-colour" label="Primary" description="Main actions and strong brand surfaces." value={themeDraft.primaryColour} onChange={primaryColour => setThemeDraft({ ...themeDraft, primaryColour })} />
            <ColourControl id="secondary-colour" label="Secondary" description="Supporting brand surfaces and labels." value={themeDraft.secondaryColour} onChange={secondaryColour => setThemeDraft({ ...themeDraft, secondaryColour })} />
            <ColourControl id="accent-colour" label="Accent" description="Focus, emphasis and decorative details." value={themeDraft.accentColour} onChange={accentColour => setThemeDraft({ ...themeDraft, accentColour })} />
            <ColourControl id="background-colour" label="Page background" description="The main page canvas behind sections." value={themeDraft.backgroundColour} onChange={backgroundColour => setThemeDraft({ ...themeDraft, backgroundColour })} />
            <ColourControl id="surface-colour" label="Surface" description="Cards, menus and raised content areas." value={themeDraft.surfaceColour} onChange={surfaceColour => setThemeDraft({ ...themeDraft, surfaceColour })} />
            <ColourControl id="text-colour" label="Text" description="Primary reading colour for headings and body." value={themeDraft.textColour} onChange={textColour => setThemeDraft({ ...themeDraft, textColour })} />
            <ColourControl id="muted-colour" label="Supporting text" description="Secondary copy that must remain readable." value={themeDraft.mutedTextColour} onChange={mutedTextColour => setThemeDraft({ ...themeDraft, mutedTextColour })} />
            <ColourControl id="border-colour" label="Borders" description="Dividers, card outlines and field boundaries." value={themeDraft.borderColour} onChange={borderColour => setThemeDraft({ ...themeDraft, borderColour })} />
          </div>
          <div className={`mt-3 rounded-2xl border p-4 ${contrastIssues.length ? 'border-rose-800 bg-rose-950/30' : 'border-emerald-800 bg-emerald-950/30'}`} role="status" aria-live="polite">
            <strong className={`text-xs ${contrastIssues.length ? 'text-rose-200' : 'text-emerald-200'}`}>{contrastIssues.length ? `${contrastIssues.length} accessibility issue${contrastIssues.length === 1 ? '' : 's'}` : 'Core colour contrast checks pass'}</strong>
            {contrastIssues.length ? <ul className="mt-2 space-y-1 text-[11px] leading-4 text-rose-200">{contrastIssues.map(issue => <li key={issue}>• {issue}</li>)}</ul> : <p className="mt-1 text-[11px] text-emerald-300">The palette meets the editor’s WCAG contrast guardrails. Full automated accessibility testing still runs before publication.</p>}
          </div>
          <button type="button" onClick={() => { setThemeDraft(design.theme); setSelectedPreset(''); }} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-3 text-xs font-black"><RotateCcw className="h-4 w-4" />Reset unsaved changes</button>
        </div>
        <DesignPreview theme={themeDraft} />
      </div>
    </section>

    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Unified readiness</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">{['workspace', 'booking', 'website', 'review', 'payments', 'publication'].map(key => <div key={key} className="rounded-xl bg-slate-950 p-3"><small className="block uppercase text-slate-500">{key}</small><div className="mt-2">{pill(readiness?.[key] || studio.publication?.status)}</div></div>)}</div>{readiness?.blockingIssues?.map((issue: any) => <p key={issue.code} className="mt-3 rounded-lg border border-rose-900 p-3 text-xs text-rose-200"><strong>{issue.area}: {issue.code}</strong> — {issue.message}</p>)}{readiness?.warnings?.map((issue: any) => <p key={issue.code} className="mt-3 rounded-lg border border-amber-800 p-3 text-xs text-amber-200"><strong>Post-provision action: {issue.code}</strong> — {issue.message}</p>)}</section>

    <SearchIntelligencePanel siteReference={siteReference!} siteName={studio.site.tenantName || studio.site.displayName} canManage={canManage} pageTitlesByReference={pageTitlesByReference} />
    <LiveSiteIntelligencePanel siteReference={siteReference!} canManage={canManage} canApprove={canApproveLiveChanges} />
    <SiteQualityPanel siteReference={siteReference!} siteVersionReference={studio.version.reference} onOpenPage={setSelectedPage} />
    <SitePublishingPanel siteReference={siteReference!} publication={studio.publication} onChanged={load} />

    <div className="grid gap-5 xl:grid-cols-[250px_1fr_330px]">
      <aside className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Page navigation</h2><div className="mt-3 space-y-2">{studio.pages.map((item: any) => <button key={item.reference} onClick={() => setSelectedPage(item.reference)} className={`w-full rounded-xl border p-3 text-left ${selectedPage === item.reference ? 'border-violet-500 bg-violet-950/30' : 'border-slate-800 bg-slate-950'}`}><strong className="text-sm">{item.title}</strong><span className="mt-1 block text-[10px] text-slate-500">{item.pageType} · /{item.slug}</span></button>)}</div><div className="mt-5 border-t border-slate-800 pt-4"><h3 className="text-xs font-black">Version history</h3><p className="mt-2 text-xs text-slate-500">Version {studio.version?.versionNumber} · {studio.version?.status}</p></div></aside>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="flex items-center gap-2 text-lg font-black"><Eye className="h-5 w-5 text-violet-300" />Structured preview</h2><p className="text-xs text-slate-500">{page?.pageType} · {page?.conversionRole}</p></div><div className="flex rounded-lg border border-slate-700 bg-slate-950 p-1">{(['MOBILE', 'TABLET', 'DESKTOP'] as const).map(size => <button key={size} onClick={() => setViewport(size)} className={`rounded-md px-3 py-2 text-[10px] font-black ${viewport === size ? 'bg-violet-600' : ''}`}>{size}</button>)}</div></div>
        <div className="mt-5 overflow-auto rounded-xl bg-slate-950 p-3"><div style={{ width, maxWidth: '100%' }} className="mx-auto min-h-[520px] rounded-xl border border-slate-700 bg-white p-6 text-slate-900 shadow-2xl transition-all">
          <div className="border-b border-slate-200 pb-5"><p className="text-xs font-bold uppercase tracking-wide text-violet-600">{studio.site.tenantName}</p><h3 className="mt-2 text-3xl font-black">{page?.title || 'Select a page'}</h3><p className="mt-2 text-sm text-slate-500">Select a component below to change its controlled visual variation.</p></div>
          <div className="mt-6 space-y-4">{page?.sections?.length ? page.sections.map((item: any) => <button type="button" key={item.reference} onClick={() => setSelectedSection(item.reference)} className={`block w-full rounded-xl border p-5 text-left ${section?.reference === item.reference ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-200' : 'border-slate-200 bg-slate-50'}`}><p className="text-[10px] font-black uppercase tracking-widest text-violet-600">{item.type} · {item.content?.componentKey || item.content?.variant || 'V1 fallback'}</p><div className="mt-3"><StructuredValue value={item.content} /></div></button>) : <div className="rounded-xl border-2 border-dashed border-slate-300 p-8 text-center"><strong>No generated sections yet</strong><p className="mt-2 text-xs text-slate-500">The generation status and findings explain what remains.</p></div>}</div>
        </div></div>
        <div className="mt-4 flex flex-wrap gap-2"><button disabled={Boolean(busy) || !page} onClick={() => void regeneratePage()} className="rounded-xl border border-violet-700 px-4 py-2 text-xs font-black disabled:opacity-40">Regenerate page</button><button disabled={Boolean(busy) || !section} onClick={regenerateSection} className="rounded-xl border border-violet-700 px-4 py-2 text-xs font-black disabled:opacity-40">Regenerate selected component</button><button disabled={Boolean(busy) || !studio.review} onClick={() => void approve()} className="rounded-xl border border-emerald-700 px-4 py-2 text-xs font-black text-emerald-300 disabled:opacity-40">Agency final approval</button></div>
      </section>

      <aside className="space-y-5">
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><div className="flex items-center justify-between gap-2"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Designed component</h2><span className="text-[10px] text-slate-600">Registry v{design.componentRegistryVersion || 1}</span></div>{section ? <><p className="mt-2 text-sm font-black">{section.type.replaceAll('_', ' ')}</p><p className="mt-1 text-[11px] leading-4 text-slate-500">Choose only compatible deterministic implementations. Content and native booking actions are retained.</p><div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">{componentOptions.map((component: any) => <button key={component.componentKey} type="button" disabled={!canDesign || Boolean(busy)} onClick={() => void saveComponent(component.componentKey)} aria-pressed={section.content?.componentKey === component.componentKey} className={`min-h-11 w-full rounded-xl border p-3 text-left ${section.content?.componentKey === component.componentKey ? 'border-violet-500 bg-violet-950/40 text-violet-100' : 'border-slate-700 bg-slate-950 text-slate-300'}`}><span className="block text-[10px] font-black uppercase">{busy === 'component' ? <Loader2 className="h-3 w-3 animate-spin" /> : component.componentKey.replace(/-v\d+$/, '').replaceAll('-', ' ')}</span><span className="mt-1 block text-[10px] leading-4 text-slate-500">{component.layoutIntent} · {component.visualWeight.toLowerCase()} weight</span>{component.requiredAssetSlots.length ? <span className="mt-1 block text-[9px] font-bold uppercase text-amber-400">Needs {component.requiredAssetSlots.join(', ').replaceAll('_', ' ')}</span> : null}</button>)}</div><details className="mt-4 border-t border-slate-800 pt-3"><summary className="cursor-pointer text-[10px] font-black uppercase text-slate-500">Legacy V1 variation fallback</summary><div className="mt-3 grid grid-cols-2 gap-2">{design.sectionVariants.map((variant: string) => <button key={variant} type="button" disabled={!canDesign || Boolean(busy)} onClick={() => void saveVariant(variant)} aria-pressed={(section.content?.variant || 'standard') === variant} className={`min-h-11 rounded-xl border px-3 text-left text-[10px] font-black uppercase ${section.content?.variant === variant || (!section.content?.variant && variant === 'standard') ? 'border-violet-500 bg-violet-950/40 text-violet-200' : 'border-slate-700 bg-slate-950 text-slate-300'}`}>{busy === 'variant' ? <Loader2 className="h-3 w-3 animate-spin" /> : variant}</button>)}</div></details></> : <p className="mt-3 text-xs text-slate-500">Select a page component to customise it.</p>}</section>
        {section ? <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Content, imagery and order</h2><div className="mt-3 space-y-3">{'heading' in section.content ? <label className="block text-[10px] font-black uppercase text-slate-500">Heading<input value={String(contentDraft.heading || '')} onChange={event => setContentDraft({ ...contentDraft, heading: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm normal-case text-white" /></label> : null}{'body' in section.content ? <label className="block text-[10px] font-black uppercase text-slate-500">Body<textarea value={String(contentDraft.body || '')} onChange={event => setContentDraft({ ...contentDraft, body: event.target.value })} rows={5} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm font-normal normal-case leading-5 text-white" /></label> : null}{'imageAssetReference' in section.content || componentOptions.some((component: any) => component.requiredAssetSlots.length) ? <label className="block text-[10px] font-black uppercase text-slate-500">Approved imagery<select value={String(contentDraft.imageAssetReference || '')} onChange={event => setContentDraft({ ...contentDraft, imageAssetReference: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs normal-case text-white"><option value="" disabled>Select an approved asset</option>{design.approvedAssets.map((asset: any) => <option key={asset.publicReference} value={asset.publicReference}>{asset.purpose.replaceAll('_', ' ')} · {asset.alt}</option>)}</select></label> : null}<button type="button" disabled={!canDesign || Boolean(busy)} onClick={() => void saveContent()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 text-xs font-black disabled:opacity-40"><Save className="h-4 w-4" />Save controlled content</button></div><div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-800 pt-3"><button type="button" disabled={!canDesign || Boolean(busy) || page.sections[0]?.reference === section.reference} onClick={() => moveSection(-1)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-700 text-[10px] font-black disabled:opacity-30"><ArrowUp className="h-3 w-3" />Move up</button><button type="button" disabled={!canDesign || Boolean(busy) || page.sections.at(-1)?.reference === section.reference} onClick={() => moveSection(1)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-700 text-[10px] font-black disabled:opacity-30"><ArrowDown className="h-3 w-3" />Move down</button><button type="button" disabled={!canDesign || Boolean(busy) || ['HEADER', 'FOOTER', 'BOOKING_CTA', 'FINAL_CTA'].includes(section.type)} onClick={() => void duplicateSection()} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-700 text-[10px] font-black disabled:opacity-30"><Copy className="h-3 w-3" />Duplicate</button><button type="button" disabled={!canDesign || Boolean(busy) || ['HEADER', 'FOOTER', 'BOOKING_CTA', 'FINAL_CTA'].includes(section.type)} onClick={removeSection} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-rose-900 text-[10px] font-black text-rose-300 disabled:opacity-30"><Trash2 className="h-3 w-3" />Remove</button></div></section> : null}
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Review status</h2><div className="mt-3 flex items-center justify-between"><span>Client review</span>{pill(studio.review?.status || 'NOT_STARTED')}</div><div className="mt-3 flex items-center justify-between"><span>Agency approval</span>{pill(studio.review?.agencyApprovalRequired ? 'REQUIRED' : 'NOT_REQUIRED')}</div><p className="mt-4 text-xs text-slate-500">{studio.review?.comments?.length || 0} comments · {studio.review?.changeRequests?.length || 0} change requests</p></section>
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Generation findings</h2><div className="mt-3 space-y-2">{studio.findings.length ? studio.findings.map((finding: any) => <div key={finding.reference} className="rounded-lg bg-slate-950 p-3 text-xs"><div className="flex justify-between"><strong>{finding.code}</strong>{pill(finding.severity)}</div><p className="mt-1 text-slate-500">{finding.message}</p></div>) : <p className="text-xs text-slate-500">No current generation findings.</p>}</div></section>
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Booking actions</h2><div className="mt-3 space-y-2">{studio.booking.links.length ? studio.booking.links.filter((link: any) => !page || link.pageReference === page.reference).map((link: any) => <div key={`${link.pageReference}:${link.sectionReference}`} className="rounded-lg bg-slate-950 p-3 text-xs"><div className="flex justify-between"><strong>KS OS BOOKING</strong>{pill('VALID')}</div><p className="mt-2 text-slate-500">Service {link.action.serviceReference || 'customer choice'}<br />Location {link.action.locationReference || 'customer choice'}<br />Staff {link.action.staffReference || 'customer choice'}</p><button onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')} className="mt-3 font-black text-violet-300">Test booking journey</button></div>) : <p className="text-xs text-slate-500">No booking action on this page.</p>}</div></section>
      </aside>
    </div>
  </div>;
}

export default SiteStudioPage;
