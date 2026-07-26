import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { agencyFetch } from './AgencyAuth';

const pill = (value: string) => <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-black">{String(value || 'NOT STARTED').replaceAll('_', ' ')}</span>;

function StructuredValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return <div className="space-y-2">{value.map((item, index) => <StructuredValue key={index} value={item} />)}</div>;
  if (typeof value === 'object') return <dl className="grid gap-2 sm:grid-cols-2">{Object.entries(value as Record<string, unknown>).map(([key, item]) => <div key={key} className="rounded-lg bg-white/70 p-3"><dt className="text-[10px] font-black uppercase text-slate-500">{key.replaceAll('_', ' ')}</dt><dd className="mt-1 text-sm"><StructuredValue value={item} /></dd></div>)}</dl>;
  return <>{String(value)}</>;
}

export function SiteStudioPage() {
  const { siteReference } = useParams();
  const [studio, setStudio] = useState<any>(null);
  const [readiness, setReadiness] = useState<any>(null);
  const [selectedPage, setSelectedPage] = useState('');
  const [viewport, setViewport] = useState<'MOBILE' | 'TABLET' | 'DESKTOP'>('DESKTOP');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!siteReference) return;
    try {
      const data = await agencyFetch(`/sites/${siteReference}/studio`);
      setStudio(data);
      if (!selectedPage && data.pages?.[0]) setSelectedPage(data.pages[0].reference);
      const state = await agencyFetch(`/tenants/${data.site.tenantReference}/readiness`);
      setReadiness(state);
    } catch (caught: any) { setError(caught.message); }
  };
  useEffect(() => { void load(); }, [siteReference]);
  const page = studio?.pages?.find((item: any) => item.reference === selectedPage);
  const width = viewport === 'MOBILE' ? '390px' : viewport === 'TABLET' ? '768px' : '100%';
  const command = async (operation: () => Promise<any>, success: string) => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); setNotice(success); await load(); } catch (caught: any) { setError(caught.message); } finally { setBusy(false); }
  };
  const regeneratePage = () => page && command(
    () => agencyFetch(`/sites/${siteReference}/versions/${studio.version.reference}/pages/${page.reference}/regenerate`, { method: 'POST', body: '{}' }),
    'Bounded page regeneration was queued.',
  );
  const regenerateSection = () => {
    const section = page?.sections?.[0];
    const instruction = section && prompt('Bounded regeneration instruction for the first section on this page');
    if (!section || !instruction) return;
    void command(
      () => agencyFetch(`/sites/${siteReference}/versions/${studio.version.reference}/pages/${page.reference}/sections/${section.reference}/regenerate`, { method: 'POST', body: JSON.stringify({ regenerationInstruction: instruction }) }),
      'Bounded section regeneration was queued.',
    );
  };
  const approve = () => studio.review && command(
    () => agencyFetch(`/sites/${siteReference}/review-cycles/${studio.review.reference}/approve`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVE', approvalLevel: 'AGENCY_FINAL', notes: 'Approved in Site Studio after structured review.' }) }),
    'Agency final approval was recorded through the review service.',
  );

  if (!studio) return <p className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">{error || 'Loading Site Studio…'}</p>;
  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-4 text-sm text-emerald-200">{notice}</p>}
    <header className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-violet-300">Structured site studio</p><h1 className="mt-1 text-2xl font-black">{studio.site.displayName}</h1><p className="mt-2 text-sm text-slate-400">Review controlled page structures, facts, findings, and native booking actions. This is not a freeform page builder.</p></div>{pill(studio.site.status)}</div></header>

    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Unified readiness</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">{['workspace', 'booking', 'website', 'review', 'payments', 'publication'].map(key => <div key={key} className="rounded-xl bg-slate-950 p-3"><small className="block uppercase text-slate-500">{key}</small><div className="mt-2">{pill(readiness?.[key] || studio.publication?.status)}</div></div>)}</div>{readiness?.blockingIssues?.map((issue: any) => <p key={issue.code} className="mt-3 rounded-lg border border-rose-900 p-3 text-xs text-rose-200"><strong>{issue.area}: {issue.code}</strong> — {issue.message}</p>)}{readiness?.warnings?.map((issue: any) => <p key={issue.code} className="mt-3 rounded-lg border border-amber-800 p-3 text-xs text-amber-200"><strong>Post-provision action: {issue.code}</strong> — {issue.message}</p>)}</section>

    <div className="grid gap-5 xl:grid-cols-[250px_1fr_330px]">
      <aside className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Page navigation</h2><div className="mt-3 space-y-2">{studio.pages.map((item: any) => <button key={item.reference} onClick={() => setSelectedPage(item.reference)} className={`w-full rounded-xl border p-3 text-left ${selectedPage === item.reference ? 'border-violet-500 bg-violet-950/30' : 'border-slate-800 bg-slate-950'}`}><strong className="text-sm">{item.title}</strong><span className="mt-1 block text-[10px] text-slate-500">{item.pageType} · /{item.slug}</span></button>)}</div><div className="mt-5 border-t border-slate-800 pt-4"><h3 className="text-xs font-black">Version history</h3><p className="mt-2 text-xs text-slate-500">Version {studio.version?.versionNumber} · {studio.version?.status}</p><button className="mt-2 text-xs font-bold text-violet-300">Compare selected version</button></div></aside>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-black">Structured preview</h2><p className="text-xs text-slate-500">{page?.pageType} · {page?.conversionRole}</p></div><div className="flex rounded-lg border border-slate-700 bg-slate-950 p-1">{(['MOBILE', 'TABLET', 'DESKTOP'] as const).map(size => <button key={size} onClick={() => setViewport(size)} className={`rounded-md px-3 py-2 text-[10px] font-black ${viewport === size ? 'bg-violet-600' : ''}`}>{size}</button>)}</div></div>
        <div className="mt-5 overflow-auto rounded-xl bg-slate-950 p-3"><div style={{ width, maxWidth: '100%' }} className="mx-auto min-h-[520px] rounded-xl border border-slate-700 bg-white p-6 text-slate-900 shadow-2xl transition-all">
          <div className="border-b border-slate-200 pb-5"><p className="text-xs font-bold uppercase tracking-wide text-violet-600">{studio.site.tenantName}</p><h3 className="mt-2 text-3xl font-black">{page?.title || 'Select a page'}</h3><p className="mt-2 text-sm text-slate-500">Structured content is rendered from approved template sections; arbitrary HTML, CSS, and JavaScript are unavailable.</p></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-slate-100 p-4"><strong>Metadata proposal</strong><p className="mt-2 text-xs">{page?.seoTitle || 'Pending structured metadata review'}</p></div><div className="rounded-xl bg-slate-100 p-4"><strong>Structured-data summary</strong><p className="mt-2 text-xs">Validated server-side inputs for {page?.pageType || 'this page'}.</p></div></div>
          <div className="mt-6 space-y-4">{page?.sections?.length ? page.sections.map((section: any) => <article key={section.reference} className="rounded-xl border border-slate-200 bg-slate-50 p-5"><p className="text-[10px] font-black uppercase tracking-widest text-violet-600">{section.type} · {section.key}</p><div className="mt-3"><StructuredValue value={section.content} /></div></article>) : <div className="rounded-xl border-2 border-dashed border-slate-300 p-8 text-center"><strong>No generated sections yet</strong><p className="mt-2 text-xs text-slate-500">The generation status and findings explain what remains.</p></div>}</div>
        </div></div>
        <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy || !page} onClick={() => void regeneratePage()} className="rounded-xl border border-violet-700 px-4 py-2 text-xs font-black disabled:opacity-40">Regenerate page</button><button disabled={busy || !page?.sections?.length} onClick={regenerateSection} className="rounded-xl border border-violet-700 px-4 py-2 text-xs font-black disabled:opacity-40">Regenerate first section</button><button disabled={busy || !studio.review} onClick={() => void approve()} className="rounded-xl border border-emerald-700 px-4 py-2 text-xs font-black text-emerald-300 disabled:opacity-40">Agency final approval</button></div>
      </section>

      <aside className="space-y-5"><section className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Review status</h2><div className="mt-3 flex items-center justify-between"><span>Client review</span>{pill(studio.review?.status || 'NOT_STARTED')}</div><div className="mt-3 flex items-center justify-between"><span>Agency approval</span>{pill(studio.review?.agencyApprovalRequired ? 'REQUIRED' : 'NOT_REQUIRED')}</div><p className="mt-4 text-xs text-slate-500">{studio.review?.comments?.length || 0} comments · {studio.review?.changeRequests?.length || 0} change requests</p></section><section className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Generation findings</h2><div className="mt-3 space-y-2">{studio.findings.length ? studio.findings.map((finding: any) => <div key={finding.reference} className="rounded-lg bg-slate-950 p-3 text-xs"><div className="flex justify-between"><strong>{finding.code}</strong>{pill(finding.severity)}</div><p className="mt-1 text-slate-500">{finding.message}</p></div>) : <p className="text-xs text-slate-500">No current generation findings.</p>}</div></section><section className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Booking actions</h2><div className="mt-3 space-y-2">{studio.booking.links.length ? studio.booking.links.filter((link: any) => !page || link.pageReference === page.reference).map((link: any) => <div key={`${link.pageReference}:${link.sectionReference}`} className="rounded-lg bg-slate-950 p-3 text-xs"><div className="flex justify-between"><strong>KS OS BOOKING</strong>{pill('VALID')}</div><p className="mt-2 text-slate-500">Service {link.action.serviceReference || 'customer choice'}<br/>Location {link.action.locationReference || 'customer choice'}<br/>Staff {link.action.staffReference || 'customer choice'}</p><button onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')} className="mt-3 font-black text-violet-300">Test booking journey</button></div>) : <p className="text-xs text-slate-500">No booking action on this page.</p>}</div><p className="mt-3 text-[10px] text-slate-500">Destinations are constructed server-side and cannot be edited here.</p></section><section className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Canonical connections</h2><dl className="mt-3 space-y-2 text-xs"><div className="flex justify-between"><dt>Services</dt><dd>{studio.canonical.services.length}</dd></div><div className="flex justify-between"><dt>Locations</dt><dd>{studio.canonical.locations.length}</dd></div><div className="flex justify-between"><dt>Staff</dt><dd>{studio.canonical.staff.length}</dd></div></dl></section></aside>
    </div>
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Canonical booking records used by the site</h2><div className="mt-4 grid gap-4 lg:grid-cols-3">
      <div className="space-y-3"><h3 className="font-black">Services</h3>{studio.canonical.services.map((service: any) => <article key={service.reference} className="rounded-xl bg-slate-950 p-4 text-xs"><strong>{service.name}</strong><p className="mt-1 text-slate-400">{service.durationMinutes} min · {(service.priceMinor / 100).toFixed(2)} · deposit {service.requiresDeposit ? 'required' : 'not required'}</p><p className="mt-2 text-slate-500">{service.eligibleLocationReferences.length} locations · {service.eligibleStaffReferences.length} eligible staff</p></article>)}</div>
      <div className="space-y-3"><h3 className="font-black">Locations</h3>{studio.canonical.locations.map((location: any) => <article key={location.reference} className="rounded-xl bg-slate-950 p-4 text-xs"><strong>{location.name}</strong><p className="mt-1 text-slate-400">{location.address}, {location.postcode}</p><p className="mt-2 text-slate-500">{location.timezone} · {location.serviceReferences.length} services</p></article>)}</div>
      <div className="space-y-3"><h3 className="font-black">Staff eligibility and availability</h3>{studio.canonical.staff.map((member: any) => <article key={member.reference} className="rounded-xl bg-slate-950 p-4 text-xs"><strong>{member.name}</strong><p className="mt-1 text-slate-400">{member.role || 'Team member'} · booking {member.bookingEnabled ? 'enabled' : 'disabled'}</p><p className="mt-2 text-slate-500">{member.serviceReferences.length} services · {member.availability.length} availability windows</p></article>)}</div>
    </div></section>
  </div>;
}
