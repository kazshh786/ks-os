import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { agencyFetch } from './AgencyAuth';

type StageState = 'NOT_STARTED' | 'NEEDS_CLIENT' | 'NEEDS_AGENCY' | 'PROCESSING' | 'BLOCKED' | 'READY_FOR_REVIEW' | 'APPROVED' | 'COMPLETE';
type Stage = {
  number: number;
  name: string;
  state: StageState;
  owner: string;
  summary: string;
  blockers: string[];
  artifact: string;
  action?: React.ReactNode;
};

const V3_TEMPLATE_REFERENCE = 'e054818e-c185-44fd-b453-010000000005';
const DEFAULT_PAGE_TYPES = ['HOME', 'SERVICE_HUB', 'ABOUT', 'CONTACT', 'FAQ', 'POLICIES', 'BOOKING'];

function priorityReferences(priorities: unknown, candidates: Array<{ reference: string; name: string }> | undefined) {
  const requested = (Array.isArray(priorities) ? priorities : [])
    .flatMap(value => typeof value === 'string' ? value.split(/[\n,;]+/) : [])
    .map(value => value.trim().toLocaleLowerCase())
    .filter(Boolean);
  if (!requested.length) return [];
  return (candidates || [])
    .filter(candidate => requested.includes(candidate.name.trim().toLocaleLowerCase()))
    .map(candidate => candidate.reference);
}

function explicitPageRequests(value: unknown) {
  return [...new Set((Array.isArray(value) ? value : [])
    .flatMap(item => typeof item === 'string' ? item.split(/[\n;]+/) : [])
    .map(item => item.trim())
    .filter(Boolean))]
    .slice(0, 50)
    .map(title => ({ title: title.slice(0, 160), pageType: 'GUIDE' }));
}

const stateTone: Record<StageState, string> = {
  NOT_STARTED: 'border-slate-700 text-slate-300',
  NEEDS_CLIENT: 'border-sky-700 text-sky-200',
  NEEDS_AGENCY: 'border-amber-700 text-amber-200',
  PROCESSING: 'border-violet-700 text-violet-200',
  BLOCKED: 'border-rose-700 text-rose-200',
  READY_FOR_REVIEW: 'border-cyan-700 text-cyan-200',
  APPROVED: 'border-emerald-700 text-emerald-200',
  COMPLETE: 'border-emerald-700 text-emerald-200',
};

function StageCard({ stage }: { stage: Stage }) {
  return <details className="group rounded-2xl border border-slate-800 bg-slate-900 open:border-slate-700">
    <summary className="flex min-h-20 cursor-pointer list-none items-center gap-4 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400 sm:p-5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-950 text-sm font-black text-violet-300">{stage.number}</span>
      <span className="min-w-0 flex-1"><strong className="block text-sm text-white">{stage.name}</strong><span className="mt-1 block text-xs leading-5 text-slate-400">{stage.summary}</span></span>
      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black ${stateTone[stage.state]}`}>{stage.state.replaceAll('_', ' ')}</span>
    </summary>
    <div className="border-t border-slate-800 px-4 py-5 sm:px-5">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-slate-950 p-3"><small className="font-black uppercase tracking-wide text-slate-500">Owner</small><p className="mt-2 text-xs text-slate-200">{stage.owner}</p></div>
        <div className="rounded-xl bg-slate-950 p-3 md:col-span-2"><small className="font-black uppercase tracking-wide text-slate-500">Evidence / artifact</small><p className="mt-2 text-xs text-slate-200">{stage.artifact}</p></div>
      </div>
      {stage.blockers.length > 0 ? <div className="mt-3 rounded-xl border border-rose-900 bg-rose-950/20 p-3"><small className="font-black uppercase tracking-wide text-rose-300">Blockers</small>{stage.blockers.map(blocker => <p key={blocker} className="mt-1 text-xs leading-5 text-rose-200">{blocker}</p>)}</div> : null}
      {stage.action ? <div className="mt-4 flex flex-wrap gap-2">{stage.action}</div> : null}
    </div>
  </details>;
}

const actionClass = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-violet-700 px-4 text-xs font-black text-violet-200 disabled:cursor-not-allowed disabled:opacity-40';

export function AgencyLaunchCommandCenter({ tenantId, onBack }: { tenantId: string; onBack: () => void }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [detail, context, booking, questionnaires] = await Promise.all([
      agencyFetch(`/tenants/${tenantId}`),
      agencyFetch(`/tenants/${tenantId}/delivery-context`),
      agencyFetch(`/tenants/${tenantId}/onboarding-booking`),
      agencyFetch(`/fact-finding/questionnaires?tenantReference=${encodeURIComponent(tenantId)}`),
    ]);
    const siteReference = context.site?.reference || context.run?.siteReference || null;
    let site: any = { blueprints: [], blueprint: null, search: null, generations: [], studio: null, quality: [], domains: [], publications: [] };
    if (siteReference) {
      const [blueprints, search, generations, studio, quality, domains, publications] = await Promise.all([
        agencyFetch(`/sites/${siteReference}/blueprints`).catch(() => []),
        agencyFetch(`/sites/${siteReference}/search-intelligence`).catch(() => null),
        agencyFetch(`/sites/${siteReference}/generation-runs`).catch(() => []),
        agencyFetch(`/sites/${siteReference}/studio`).catch(() => null),
        agencyFetch(`/sites/${siteReference}/quality-runs`).catch(() => []),
        agencyFetch(`/sites/${siteReference}/domains`).catch(() => []),
        agencyFetch(`/sites/${siteReference}/publications`).catch(() => []),
      ]);
      const latestBlueprint = blueprints[0] || null;
      const blueprint = latestBlueprint?.reference
        ? await agencyFetch(`/sites/${siteReference}/blueprints/${latestBlueprint.reference}`).catch(() => latestBlueprint)
        : null;
      site = { blueprints, blueprint, search, generations, studio, quality, domains, publications };
    }
    setData({ detail, context, booking, questionnaires, siteReference, site });
  }, [tenantId]);

  useEffect(() => { void load().catch(cause => setError(cause.message)); }, [load]);

  const command = async (key: string, operation: () => Promise<any>, message: string) => {
    setBusy(key); setError(''); setNotice('');
    try {
      const result = await operation();
      setNotice(message);
      await load();
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The launch action could not be completed.');
      return null;
    } finally { setBusy(''); }
  };

  const latestDiscovery = data?.questionnaires?.[0] || null;
  const createSite = () => command('site', () => agencyFetch('/sites', {
    method: 'POST',
    body: JSON.stringify({
      tenantReference: data.context.tenant.businessReference,
      displayName: `${data.context.tenant.name} website`,
      idempotencyKey: `agency-launch-v2:${data.context.tenant.businessReference}`,
    }),
  }), 'Managed draft site created. Nothing was generated or published.');

  const preparePlan = () => command('plan', async () => {
    const requestedPageTypes = data.context.websiteRequirements?.requestedPageTypes?.length
      ? data.context.websiteRequirements.requestedPageTypes
      : DEFAULT_PAGE_TYPES;
    const body = {
      productionBriefReference: data.context.productionBrief.reference,
      planVersionReference: data.context.plan.versionReference,
      workspace: {
        name: data.context.tenant.name,
        subdomain: data.context.tenant.subdomain,
        timezone: data.context.tenant.timezone,
        currency: data.context.tenant.currency,
      },
      templateVersionReference: V3_TEMPLATE_REFERENCE,
      pagePlan: {
        requestedPageTypes,
        targetMarketingPageCount: Math.min(30, Math.max(1, requestedPageTypes.filter((value: string) => value !== 'BOOKING').length)),
        preferredLayoutReferences: {},
        design: { source: 'KS_NATIVE', presetKey: 'NORTHLIGHT', defaultSectionVariant: 'standard' },
      },
      paymentPreference: { allowPayLater: true, onlinePaymentsRequested: false, depositCollectionRequested: false },
    };
    const draft = await agencyFetch('/provisioning-drafts', { method: 'POST', body: JSON.stringify(body) });
    return agencyFetch(`/provisioning-drafts/${draft.reference}/validate`, { method: 'POST', body: '{}' });
  }, 'Website plan saved and validated. No provisioning run was started.');

  const generateBlueprint = () => command('blueprint', () => agencyFetch(`/sites/${data.siteReference}/blueprints/generate`, {
    method: 'POST',
    body: JSON.stringify({
      templateVersionReference: V3_TEMPLATE_REFERENCE,
      name: `${data.context.tenant.name} governed website architecture`,
      preferences: {
        prioritisedServiceReferences: priorityReferences(data.context.websiteRequirements?.prioritisedServices, data.context.canonical?.services),
        prioritisedLocationReferences: priorityReferences(data.context.websiteRequirements?.prioritisedLocations, data.context.canonical?.locations),
        prioritisedStaffReferences: [],
        preferredLayoutReferences: {},
        includePageTypes: data.context.websiteRequirements?.requestedPageTypes || [],
        explicitPages: explicitPageRequests(data.context.websiteRequirements?.explicitPages),
      },
    }),
  }), 'Draft blueprint generated for review. It has not been approved.');

  const validateBlueprint = () => command('blueprint-validate', () => agencyFetch(`/sites/${data.siteReference}/blueprints/${data.site.blueprint.reference}/validate`, { method: 'POST', body: '{}' }), 'Blueprint validation refreshed. Review every page and blocking action item.');
  const approveBlueprint = () => {
    if (!window.confirm('Approve this exact blueprint revision and page architecture? This is a human governance decision.')) return;
    void command('blueprint-approve', () => agencyFetch(`/sites/${data.siteReference}/blueprints/${data.site.blueprint.reference}/approve`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: data.site.blueprint.revision, reason: 'Agency reviewed the exact page architecture, relationships, URLs and validation findings.' }),
    }), 'The exact blueprint revision was explicitly approved.');
  };
  const createSearch = () => command('search', () => agencyFetch(`/sites/${data.siteReference}/search-intelligence/create-draft`, { method: 'POST', body: '{}' }), 'Search Intelligence draft created with one governed brief per blueprint page. Approval is still required.');
  const generateWebsite = () => command('generation', () => agencyFetch(`/sites/${data.siteReference}/generation-runs`, {
    method: 'POST',
    body: JSON.stringify({ blueprintReference: data.site.blueprint.reference, generationReason: 'INITIAL_SITE' }),
  }), 'Website generation queued through the governed service. Publication remains separate.');

  const stages = useMemo<Stage[]>(() => {
    if (!data) return [];
    const { context, booking, site, siteReference } = data;
    const discoverySubmitted = latestDiscovery && ['SUBMITTED', 'AGENCY_REVIEW', 'APPROVED'].includes(latestDiscovery.status);
    const factsLocked = context.productionBrief?.status === 'LOCKED_FOR_PROVISIONING';
    const bookingReady = booking.readiness?.readyForBuild === true;
    const approvedAssets = Number(latestDiscovery?.approvedAssetCount || 0);
    const planReady = Boolean(context.draft);
    const blueprint = site.blueprint;
    const blueprintBlocking = (blueprint?.actionItems || []).filter((item: any) => item.status === 'OPEN' && item.severity === 'BLOCKING');
    const search = site.search;
    const searchResearchRequired = Boolean(search && (
      search.researchReadiness?.status === 'RESEARCH_REQUIRED'
      || search.strategy?.provenance?.providerKey === 'ks-os-governed-draft'
      || Number(search.researchFreshness?.evidenceCount || 0) === 0
    ));
    const generation = site.generations?.[0] || null;
    const providerReady = context.generationProvider?.ready === true;
    const generationReady = Boolean(factsLocked && bookingReady && planReady && blueprint?.status === 'APPROVED' && search?.status === 'APPROVED' && !searchResearchRequired && context.knowledge?.ready && context.designLibrary?.nativeTemplateReady && providerReady);
    const quality = site.quality?.[0] || null;
    const canonicalDomain = site.domains?.find((domain: any) => (domain.domainRole || domain.role) === 'CANONICAL');
    const publication = site.publications?.[0] || null;
    return [
      { number: 1, name: 'Client', state: 'COMPLETE', owner: 'Agency', summary: `${context.tenant.name} workspace exists`, blockers: [], artifact: `Tenant ${context.tenant.agencyReference}` },
      { number: 2, name: 'Discovery', state: !latestDiscovery ? 'NOT_STARTED' : discoverySubmitted ? 'COMPLETE' : ['INVITED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'].includes(latestDiscovery.status) ? 'NEEDS_CLIENT' : 'NEEDS_AGENCY', owner: latestDiscovery && ['INVITED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'].includes(latestDiscovery.status) ? 'Client' : 'Agency', summary: !latestDiscovery ? 'Create a secure client discovery request' : `${latestDiscovery.status.replaceAll('_', ' ')} · ${latestDiscovery.openFollowUpCount || 0} open follow-ups`, blockers: [], artifact: latestDiscovery ? `Discovery v${latestDiscovery.version} · ${latestDiscovery.consentCount || 0} consent decisions` : 'No discovery artifact yet', action: <Link className={actionClass} to={`/agency/fact-finding?tenant=${tenantId}${latestDiscovery ? `&questionnaire=${latestDiscovery.reference}` : ''}`}>{latestDiscovery ? 'Open discovery' : 'Create discovery'}</Link> },
      { number: 3, name: 'Facts', state: factsLocked ? 'APPROVED' : Number(latestDiscovery?.candidateFactCount || 0) ? 'NEEDS_AGENCY' : 'BLOCKED', owner: 'Agency reviewer', summary: factsLocked ? 'Production facts are versioned and locked' : `${latestDiscovery?.candidateFactCount || 0} candidate facts require review`, blockers: factsLocked ? [] : ['Approve or reject candidate facts, resolve evidence requests, then lock the production brief.'], artifact: context.productionBrief ? `Production brief v${context.productionBrief.version} · ${context.productionBrief.status}` : 'No production brief', action: <Link className={actionClass} to={`/agency/fact-finding?tenant=${tenantId}${latestDiscovery ? `&questionnaire=${latestDiscovery.reference}` : ''}`}>Review facts</Link> },
      { number: 4, name: 'Booking', state: bookingReady ? 'COMPLETE' : 'NEEDS_AGENCY', owner: 'Agency operations', summary: bookingReady ? 'Minimum booking configuration is ready' : 'Services, locations, staff or availability remain incomplete', blockers: bookingReady ? [] : (booking.readiness?.blockingIssues || []).map((item: any) => item.message || item.code), artifact: `${booking.services?.length || 0} services · ${booking.locations?.length || 0} locations`, action: <Link className={actionClass} to={`/agency/bookings?tenant=${tenantId}`}>Open booking setup</Link> },
      { number: 5, name: 'Brand and assets', state: approvedAssets > 0 ? 'COMPLETE' : latestDiscovery ? 'NEEDS_AGENCY' : 'BLOCKED', owner: 'Agency creative', summary: approvedAssets > 0 ? `${approvedAssets} governed assets approved` : 'Review provenance, usage rights and required imagery', blockers: approvedAssets > 0 ? [] : ['No approved public asset is currently available; generation will retain explicit asset gaps.'], artifact: `Image policy: ${context.websiteRequirements?.imageSourcePolicy || 'not confirmed'}`, action: <Link className={actionClass} to={`/agency/fact-finding?tenant=${tenantId}${latestDiscovery ? `&questionnaire=${latestDiscovery.reference}` : ''}`}>Review asset library</Link> },
      { number: 6, name: 'Website plan', state: planReady ? 'COMPLETE' : factsLocked && bookingReady ? 'NEEDS_AGENCY' : 'BLOCKED', owner: 'Agency strategist', summary: planReady ? 'Versioned V3 website plan saved' : 'Confirm requested pages, priorities, exclusions and design direction', blockers: [!factsLocked ? 'Production facts must be locked.' : '', !bookingReady ? 'Booking minimum readiness is incomplete.' : '', !context.designLibrary?.nativeTemplateReady ? 'Approved V3 native template/renderers are not ready.' : ''].filter(Boolean), artifact: context.draft ? `Plan ${context.draft.reference} · ${context.draft.status}` : `${context.websiteRequirements?.requestedPageTypes?.length || 0} requested page types`, action: !planReady ? <button className={actionClass} disabled={Boolean(busy) || !factsLocked || !bookingReady || !context.designLibrary?.nativeTemplateReady} onClick={() => void preparePlan()}>Prepare V3 website plan</button> : undefined },
      { number: 7, name: 'Blueprint', state: !siteReference || !blueprint ? 'NOT_STARTED' : blueprint.status === 'APPROVED' ? 'APPROVED' : blueprintBlocking.length ? 'BLOCKED' : 'READY_FOR_REVIEW', owner: 'Agency strategist', summary: !blueprint ? 'Generate the draft architecture after the plan is ready' : `Revision ${blueprint.revision} · ${blueprint.pages?.length || blueprint.pageCount || 0} pages · ${blueprint.status}`, blockers: blueprintBlocking.map((item: any) => item.message), artifact: blueprint ? `Template ${blueprint.templateVersionReference || V3_TEMPLATE_REFERENCE}` : 'No blueprint', action: <>{!siteReference ? <button className={actionClass} disabled={Boolean(busy) || !planReady} onClick={() => void createSite()}>Create managed draft site</button> : !blueprint ? <button className={actionClass} disabled={Boolean(busy) || !planReady} onClick={() => void generateBlueprint()}>Generate draft blueprint</button> : blueprint.status !== 'APPROVED' ? <><button className={actionClass} disabled={Boolean(busy)} onClick={() => void validateBlueprint()}>Validate blueprint</button><button className={actionClass} disabled={Boolean(busy) || blueprintBlocking.length > 0} onClick={approveBlueprint}>Approve exact revision</button></> : <Link className={actionClass} to={`/agency/sites/${siteReference}/studio`}>Inspect approved architecture</Link>}</> },
      { number: 8, name: 'Search Intelligence', state: blueprint?.status !== 'APPROVED' ? 'BLOCKED' : !search ? 'NOT_STARTED' : searchResearchRequired ? 'NEEDS_AGENCY' : search.status === 'APPROVED' ? 'APPROVED' : 'READY_FOR_REVIEW', owner: 'Agency search strategist', summary: !search ? 'Create one governed brief per approved blueprint page' : searchResearchRequired ? `Planning draft · research required · ${search.briefs?.length || 0} blueprint-bound briefs` : `Strategy v${search.strategy?.strategyVersion || 1} · ${search.briefs?.length || 0} briefs · ${search.status}`, blockers: blueprint?.status !== 'APPROVED' ? ['Approve the exact blueprint first.'] : searchResearchRequired ? ['Complete governed search research, import the evidence-bound strategy and review every page brief before approval.'] : [], artifact: search ? `${search.strategy?.provenance?.providerKey} · exact blueprint revision binding` : 'No Search Intelligence artifact', action: blueprint?.status === 'APPROVED' && !search ? <button className={actionClass} disabled={Boolean(busy)} onClick={() => void createSearch()}>Create Search Intelligence strategy</button> : siteReference ? <Link className={actionClass} to={`/agency/sites/${siteReference}/studio`}>{searchResearchRequired ? 'Complete governed research' : 'Review Search Intelligence'}</Link> : undefined },
      { number: 9, name: 'Website build', state: generation ? ['PENDING', 'PREPARING_CONTEXT', 'GENERATING', 'VALIDATING'].includes(generation.status) ? 'PROCESSING' : generation.status === 'READY_FOR_REVIEW' ? 'READY_FOR_REVIEW' : generation.status === 'FAILED' ? 'BLOCKED' : 'COMPLETE' : generationReady ? 'NEEDS_AGENCY' : 'BLOCKED', owner: generation ? 'KS OS site worker' : 'Agency', summary: generation ? `Generation ${generation.status.replaceAll('_', ' ')}` : generationReady ? 'All mandatory generation prerequisites are approved' : 'Generation remains fail-closed', blockers: generationReady || generation ? [] : [!factsLocked ? 'Production facts are not locked.' : '', !bookingReady ? 'Booking is not ready.' : '', blueprint?.status !== 'APPROVED' ? 'Blueprint is not approved.' : '', search?.status !== 'APPROVED' ? 'Search Intelligence is not approved.' : '', searchResearchRequired ? 'Search Intelligence research is required.' : '', !context.knowledge?.ready ? 'No single active PUBLIC_SITE knowledge pack.' : '', !context.designLibrary?.nativeTemplateReady ? 'V3 renderer is not ready.' : '', !providerReady ? context.generationProvider?.blocker || 'Generation provider is not ready.' : ''].filter(Boolean), artifact: generation ? `Run ${generation.reference} · version ${generation.versionReference || 'pending'}` : `${context.generationProvider?.providerKey || 'provider'} · ${context.generationProvider?.modelKey || 'model pending'}`, action: !generation && generationReady ? <button className={actionClass} disabled={Boolean(busy)} onClick={() => void generateWebsite()}>Generate website</button> : undefined },
      { number: 10, name: 'Review and quality', state: !generation || generation.status !== 'READY_FOR_REVIEW' ? 'BLOCKED' : site.studio?.version?.status === 'APPROVED' && quality?.status === 'PASSED' ? 'APPROVED' : 'NEEDS_AGENCY', owner: 'Agency design reviewer', summary: quality ? `Quality ${quality.status}` : 'Signed/noindex preview and visual review required', blockers: !generation || generation.status !== 'READY_FOR_REVIEW' ? ['Website generation must reach READY_FOR_REVIEW.'] : [], artifact: site.studio?.version ? `Site version ${site.studio.version.reference} · ${site.studio.version.status}` : 'No reviewable version', action: siteReference ? <Link className={actionClass} to={`/agency/sites/${siteReference}/studio`}>Open Site Studio review</Link> : undefined },
      { number: 11, name: 'Domain and launch', state: publication?.status === 'LIVE' ? 'COMPLETE' : canonicalDomain?.status === 'ACTIVE' ? 'NEEDS_AGENCY' : 'BLOCKED', owner: 'Agency launch owner', summary: publication?.status === 'LIVE' ? 'Explicit publication is live' : 'Domain, quality and exact-version publication approval remain separate', blockers: [!canonicalDomain || canonicalDomain.status !== 'ACTIVE' ? 'Canonical or managed hostname is not active.' : '', quality?.status !== 'PASSED' ? 'Publication quality gate has not passed.' : '', site.studio?.version?.status !== 'APPROVED' ? 'The exact site version lacks final human approval.' : ''].filter(Boolean), artifact: canonicalDomain ? `${canonicalDomain.hostname} · ${canonicalDomain.status}` : 'No canonical domain', action: siteReference ? <Link className={actionClass} to={`/agency/sites/${siteReference}/studio`}>Review launch gates</Link> : undefined },
    ];
  }, [busy, data, latestDiscovery, tenantId]);

  if (!data) return <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-sm text-slate-400">Loading governed launch workspace…</div>;
  const complete = stages.filter(stage => ['APPROVED', 'COMPLETE'].includes(stage.state)).length;
  return <div className="space-y-6">
    <header className="rounded-3xl border border-violet-800/60 bg-gradient-to-br from-violet-950 via-slate-950 to-slate-900 p-6 sm:p-8">
      <button type="button" onClick={onBack} className="min-h-11 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-300">← All clients</button>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Agency Launch V2</p><h1 className="mt-2 text-3xl font-black text-white">{data.context.tenant.name}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">A governed command centre for discovery, facts, booking, architecture, search, generation, review and launch. Completeness never implies approval.</p></div><div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-right"><small className="font-black uppercase text-slate-500">Approved / complete</small><strong className="mt-1 block text-2xl text-white">{complete} / {stages.length}</strong></div></div>
    </header>
    {error ? <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/35 p-4 text-sm text-rose-200">{error}</p> : null}
    {notice ? <p role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/35 p-4 text-sm text-emerald-200">{notice}</p> : null}
    <section aria-label="Client launch stages" className="space-y-3">{stages.map(stage => <StageCard key={stage.number} stage={stage} />)}</section>
  </div>;
}
