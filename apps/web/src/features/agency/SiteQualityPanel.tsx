import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgencyCapability } from '@ks-os/contracts';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';

const tabs = [
  'OVERVIEW',
  'SEO',
  'ACCESSIBILITY',
  'UX',
  'CONVERSION',
  'BOOKING',
  'PERFORMANCE',
  'CONTENT',
  'ASSETS',
  'PUBLICATION_READINESS',
] as const;
type QualityTab = typeof tabs[number];

const categoriesByTab: Record<QualityTab, readonly string[]> = {
  OVERVIEW: [],
  SEO: [
    'TECHNICAL_SEO',
    'ON_PAGE_SEO',
    'LOCAL_SEO',
    'STRUCTURED_DATA',
    'INTERNAL_LINKING',
  ],
  ACCESSIBILITY: ['ACCESSIBILITY'],
  UX: ['RESPONSIVE_UX'],
  CONVERSION: ['CONVERSION'],
  BOOKING: ['BOOKING_INTEGRITY'],
  PERFORMANCE: ['PERFORMANCE'],
  CONTENT: ['CONTENT_INTEGRITY', 'TRUST_AND_FACTUAL_INTEGRITY'],
  ASSETS: ['ASSET_READINESS'],
  PUBLICATION_READINESS: ['PUBLICATION_READINESS', 'REVIEW_AND_APPROVAL'],
};

const auditTypeByTab: Record<QualityTab, string> = {
  OVERVIEW: 'FULL_SITE_QUALITY',
  SEO: 'TECHNICAL_SEO',
  ACCESSIBILITY: 'ACCESSIBILITY',
  UX: 'RESPONSIVE_UX',
  CONVERSION: 'CONVERSION',
  BOOKING: 'BOOKING_INTEGRITY',
  PERFORMANCE: 'PERFORMANCE',
  CONTENT: 'CONTENT_INTEGRITY',
  ASSETS: 'ASSET_READINESS',
  PUBLICATION_READINESS: 'PUBLICATION_READINESS',
};

const statusPill = (value: string) => (
  <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-black">
    {String(value || 'NOT EVALUATED').replaceAll('_', ' ')}
  </span>
);

function has(
  capabilities: readonly AgencyCapability[],
  capability: AgencyCapability,
) {
  return capabilities.includes(capability);
}

function safeDate(value: unknown) {
  if (typeof value !== 'string') return 'Not completed';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Not completed'
    : parsed.toLocaleString();
}

export function SiteQualityPanel(props: {
  siteReference: string;
  siteVersionReference: string;
  onOpenPage: (pageReference: string) => void;
}) {
  const { session } = useAgencyAuth();
  const capabilities = session?.capabilities ?? [];
  const [tab, setTab] = useState<QualityTab>('OVERVIEW');
  const [runs, setRuns] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [readiness, setReadiness] = useState<any>(null);
  const [comparison, setComparison] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!has(capabilities, 'sites.quality.read')) return;
    setError('');
    try {
      const loadedRuns = await agencyFetch(
        `/sites/${props.siteReference}/quality-runs`,
      ) as any[];
      setRuns(loadedRuns);
      const latest = loadedRuns[0];
      if (latest) {
        const loadedSummary = await agencyFetch(
          `/sites/${props.siteReference}/quality-runs/${latest.reference}/summary`,
        );
        setSummary(loadedSummary);
        const previous = loadedRuns.find(
          (candidate: any) =>
            candidate.reference !== latest.reference
            && candidate.auditType === latest.auditType,
        );
        if (previous) {
          setComparison(await agencyFetch(
            `/sites/${props.siteReference}/quality-runs/${latest.reference}`
            + `/compare/${previous.reference}`,
          ));
        } else {
          setComparison(null);
        }
      } else {
        setSummary(null);
        setComparison(null);
      }
      if (has(capabilities, 'sites.publication_readiness.read')) {
        setReadiness(await agencyFetch(
          `/sites/${props.siteReference}/publication-readiness`,
        ));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Quality data could not be loaded.');
    }
  }, [capabilities, props.siteReference]);

  useEffect(() => {
    void load();
  }, [load]);

  const command = async (
    operation: () => Promise<unknown>,
    success: string,
  ) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      setNotice(success);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The quality action failed safely.');
    } finally {
      setBusy(false);
    }
  };

  const startRun = () => command(
    () => agencyFetch(`/sites/${props.siteReference}/quality-runs`, {
      method: 'POST',
      body: JSON.stringify({
        siteVersionReference: props.siteVersionReference,
        auditType: auditTypeByTab[tab],
        reason: 'MANUAL_RECHECK',
      }),
    }),
    `${auditTypeByTab[tab].replaceAll('_', ' ')} was queued for the exact version.`,
  );

  const findings = useMemo(() => {
    const all = summary?.findings ?? [];
    const categories = categoriesByTab[tab];
    return categories.length === 0
      ? all
      : all.filter((finding: any) => categories.includes(finding.category));
  }, [summary, tab]);

  const pageStatuses = useMemo(() => {
    const values = new Map<string, { blocking: number; warnings: number }>();
    for (const finding of summary?.findings ?? []) {
      if (!finding.pageReference) continue;
      const current = values.get(finding.pageReference)
        ?? { blocking: 0, warnings: 0 };
      if (
        ['OPEN', 'ACKNOWLEDGED', 'IN_REMEDIATION'].includes(finding.status)
        && finding.publicationEffect === 'BLOCK'
      ) current.blocking += 1;
      if (
        ['OPEN', 'ACKNOWLEDGED', 'IN_REMEDIATION'].includes(finding.status)
        && finding.publicationEffect === 'WARNING'
      ) current.warnings += 1;
      values.set(finding.pageReference, current);
    }
    return [...values.entries()];
  }, [summary]);

  if (!has(capabilities, 'sites.quality.read')) {
    return null;
  }

  const latest = summary?.run ?? runs[0];
  const humanChecks = (summary?.checks ?? []).filter(
    (check: any) => check.validationMethod === 'HUMAN_REVIEW',
  );

  return (
    <section
      aria-labelledby="site-quality-title"
      className="rounded-2xl border border-slate-800 bg-slate-900 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-violet-300">
            Phase 15.8 quality gates
          </p>
          <h2 id="site-quality-title" className="mt-1 text-xl font-black">
            Site quality and publication readiness
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Explicit findings, evidence and approvals determine the gate. Supporting
            counts are not an unexplained quality score, and READY never publishes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {statusPill(latest?.publicationGateStatus ?? readiness?.status)}
          {has(capabilities, 'sites.quality.run') && (
            <button
              disabled={busy}
              onClick={() => void startRun()}
              className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black disabled:opacity-40"
            >
              Run {tab === 'OVERVIEW' ? 'full quality audit' : tab.toLowerCase()}
            </button>
          )}
          {has(capabilities, 'sites.publication_readiness.evaluate') && (
            <button
              disabled={busy}
              onClick={() => void command(
                () => agencyFetch(
                  `/sites/${props.siteReference}/publication-readiness/evaluate`,
                  { method: 'POST', body: '{}' },
                ),
                'Publication readiness was evaluated without publishing.',
              )}
              className="rounded-xl border border-emerald-700 px-4 py-2 text-xs font-black text-emerald-300 disabled:opacity-40"
            >
              Evaluate readiness
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 rounded-xl border border-emerald-900 bg-emerald-950/40 p-3 text-sm text-emerald-200">
          {notice}
        </p>
      )}

      <div className="mt-5 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Site quality categories">
        {tabs.map(value => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`whitespace-nowrap rounded-lg border px-3 py-2 text-[10px] font-black ${
              tab === value
                ? 'border-violet-500 bg-violet-950/50 text-violet-100'
                : 'border-slate-700 text-slate-400'
            }`}
          >
            {value.replaceAll('_', ' ')}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {[
          ['Gate', latest?.publicationGateStatus ?? 'NOT_EVALUATED'],
          ['Run', latest?.status ?? 'NOT_STARTED'],
          ['Blocking', latest?.blockingCount ?? 0],
          ['Warnings', latest?.warningCount ?? 0],
          ['Waivers', latest?.waivedCount ?? 0],
          ['Human tasks', humanChecks.filter((check: any) => check.result !== 'PASS').length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl bg-slate-950 p-3">
            <small className="block uppercase text-slate-500">{label}</small>
            <strong className="mt-2 block text-sm">{String(value).replaceAll('_', ' ')}</strong>
          </div>
        ))}
      </div>

      {latest && (
        <dl className="mt-4 grid gap-3 rounded-xl border border-slate-800 p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-slate-500">Latest quality run</dt><dd className="mt-1 break-all">{latest.reference}</dd></div>
          <div><dt className="text-slate-500">Site-version digest</dt><dd className="mt-1 break-all font-mono">{latest.siteVersionDigest}</dd></div>
          <div><dt className="text-slate-500">Knowledge pack</dt><dd className="mt-1">{latest.knowledgePack?.semanticVersion}</dd></div>
          <div><dt className="text-slate-500">Quality policy</dt><dd className="mt-1">{latest.policyVersion}</dd></div>
          <div><dt className="text-slate-500">Audit type</dt><dd className="mt-1">{latest.auditType?.replaceAll('_', ' ')}</dd></div>
          <div><dt className="text-slate-500">Pages checked</dt><dd className="mt-1">{latest.pageCountCompleted} / {latest.pageCountPlanned}</dd></div>
          <div><dt className="text-slate-500">Last checked</dt><dd className="mt-1">{safeDate(latest.completedAt)}</dd></div>
          <div><dt className="text-slate-500">Renderer</dt><dd className="mt-1">{latest.rendererVersion}</dd></div>
        </dl>
      )}

      {latest && (
        <div className="mt-3 flex flex-wrap gap-2">
          {has(capabilities, 'sites.quality.cancel')
            && ['PENDING', 'PREPARING', 'RENDERING', 'RUNNING_DETERMINISTIC_CHECKS', 'RUNNING_BROWSER_CHECKS'].includes(latest.status)
            && (
              <button
                disabled={busy}
                onClick={() => void command(
                  () => agencyFetch(
                    `/sites/${props.siteReference}/quality-runs/${latest.reference}/cancel`,
                    {
                      method: 'POST',
                      body: JSON.stringify({ reason: 'Cancelled by an authorised Site Studio operator.' }),
                    },
                  ),
                  'Quality cancellation was requested safely.',
                )}
                className="rounded-lg border border-rose-800 px-3 py-2 text-xs font-bold text-rose-300"
              >
                Cancel run
              </button>
            )}
          {has(capabilities, 'sites.quality.retry')
            && ['FAILED', 'CANCELLED'].includes(latest.status)
            && (
              <button
                disabled={busy}
                onClick={() => void command(
                  () => agencyFetch(
                    `/sites/${props.siteReference}/quality-runs/${latest.reference}/retry`,
                    {
                      method: 'POST',
                      body: JSON.stringify({ reason: 'Authorised Site Studio quality retry.' }),
                    },
                  ),
                  'The bounded quality retry was queued.',
                )}
                className="rounded-lg border border-violet-700 px-3 py-2 text-xs font-bold text-violet-300"
              >
                Retry run
              </button>
            )}
        </div>
      )}

      {tab === 'PUBLICATION_READINESS' && readiness && (
        <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-black">Publication-readiness decision</h3>
            {statusPill(readiness.status)}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Publication performed: {readiness.publicationPerformed ? 'yes' : 'no'}.
          </p>
          <div className="mt-3 space-y-2">
            {readiness.blockingReasons?.map((reason: any) => (
              <p key={reason.code} className="rounded-lg border border-rose-900 p-3 text-xs text-rose-200">
                <strong>{reason.code}</strong> — {reason.message}
              </p>
            ))}
            {readiness.warnings?.map((warning: string) => (
              <p key={warning} className="rounded-lg border border-amber-800 p-3 text-xs text-amber-200">
                {warning}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_300px]">
        <div>
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
            {tab.replaceAll('_', ' ')} findings
          </h3>
          <div className="mt-3 space-y-3">
            {findings.length === 0 && (
              <p className="rounded-xl bg-slate-950 p-4 text-sm text-slate-500">
                No findings are recorded for this view. DATA REQUIRED checks remain
                visible in the check list until evaluated.
              </p>
            )}
            {findings.map((finding: any) => (
              <article key={finding.reference} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    {statusPill(finding.severity)}
                    {statusPill(finding.publicationEffect)}
                    {statusPill(finding.status)}
                  </div>
                  <span className="text-[10px] font-black text-slate-500">
                    {finding.category?.replaceAll('_', ' ')}
                  </span>
                </div>
                <h4 className="mt-3 font-black">{finding.code}</h4>
                <p className="mt-2 text-sm text-slate-300">{finding.message}</p>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div><dt className="text-slate-500">Check</dt><dd>{finding.checkId}</dd></div>
                  <div><dt className="text-slate-500">Rule references</dt><dd>{(finding.ruleIds ?? []).join(', ') || 'Platform policy'}</dd></div>
                  <div><dt className="text-slate-500">Evidence</dt><dd>{finding.evidenceSummary}</dd></div>
                  <div><dt className="text-slate-500">Recommended action</dt><dd>{finding.remediationGuidance}</dd></div>
                  <div><dt className="text-slate-500">Waivable</dt><dd>{finding.waivable ? 'Permitted by policy' : 'No'}</dd></div>
                  <div><dt className="text-slate-500">Last checked</dt><dd>{safeDate(finding.lastDetectedAt)}</dd></div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {finding.pageReference && (
                    <button
                      onClick={() => props.onOpenPage(finding.pageReference)}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold"
                    >
                      Open page
                    </button>
                  )}
                  {has(capabilities, 'sites.quality.resolve') && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => void command(
                          () => agencyFetch(
                            `/sites/${props.siteReference}/quality-findings/${finding.reference}/create-change-request`,
                            { method: 'POST', body: '{}' },
                          ),
                          'A controlled review change request was created.',
                        )}
                        className="rounded-lg border border-violet-700 px-3 py-2 text-xs font-bold text-violet-300"
                      >
                        Create change request
                      </button>
                      {finding.status === 'OPEN' && (
                        <button
                          disabled={busy}
                          onClick={() => void command(
                            () => agencyFetch(
                              `/sites/${props.siteReference}/quality-findings/${finding.reference}/acknowledge`,
                              { method: 'POST', body: '{}' },
                            ),
                            'The finding was acknowledged.',
                          )}
                          className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold"
                        >
                          Acknowledge
                        </button>
                      )}
                      {['OPEN', 'ACKNOWLEDGED', 'IN_REMEDIATION'].includes(finding.status) && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            const note = window.prompt('Resolution evidence note (minimum 8 characters)');
                            if (!note) return;
                            void command(
                              () => agencyFetch(
                                `/sites/${props.siteReference}/quality-findings/${finding.reference}/resolve`,
                                { method: 'POST', body: JSON.stringify({ note }) },
                              ),
                              'The finding was resolved with an audit note.',
                            );
                          }}
                          className="rounded-lg border border-emerald-800 px-3 py-2 text-xs font-bold text-emerald-300"
                        >
                          Resolve
                        </button>
                      )}
                    </>
                  )}
                  {finding.waivable
                    && has(capabilities, 'sites.quality.waive')
                    && ['OPEN', 'ACKNOWLEDGED', 'IN_REMEDIATION'].includes(finding.status)
                    && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          const reason = window.prompt('Waiver reason (minimum 20 characters)');
                          const riskAcceptance = reason
                            ? window.prompt('Risk acceptance (minimum 20 characters)')
                            : null;
                          if (!reason || !riskAcceptance) return;
                          void command(
                            () => agencyFetch(
                              `/sites/${props.siteReference}/quality-findings/${finding.reference}/waive`,
                              {
                                method: 'POST',
                                body: JSON.stringify({ reason, riskAcceptance }),
                              },
                            ),
                            'The permitted waiver was recorded and version-bound.',
                          );
                        }}
                        className="rounded-lg border border-amber-800 px-3 py-2 text-xs font-bold text-amber-300"
                      >
                        Waive
                      </button>
                    )}
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
              Category summaries
            </h3>
            <div className="mt-3 space-y-2 text-xs">
              {Object.entries(summary?.categorySummary ?? {})
                .filter(([category]) =>
                  categoriesByTab[tab].length === 0
                  || categoriesByTab[tab].includes(category))
                .map(([category, counts]: [string, any]) => (
                  <div key={category} className="rounded-lg border border-slate-800 p-3">
                    <strong>{category.replaceAll('_', ' ')}</strong>
                    <p className="mt-1 text-slate-500">
                      {counts.blocking} blocking · {counts.warnings} warnings · {counts.recommendations} recommendations
                    </p>
                  </div>
                ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
              Page-level status
            </h3>
            <div className="mt-3 space-y-2 text-xs">
              {pageStatuses.length === 0
                ? <p className="text-slate-500">No page-specific findings.</p>
                : pageStatuses.map(([reference, counts]) => (
                  <button
                    key={reference}
                    onClick={() => props.onOpenPage(reference)}
                    className="w-full rounded-lg border border-slate-800 p-3 text-left"
                  >
                    <span className="block break-all font-bold">{reference}</span>
                    <span className="mt-1 block text-slate-500">
                      {counts.blocking} blocking · {counts.warnings} warnings
                    </span>
                  </button>
                ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
              Human-review tasks
            </h3>
            <div className="mt-3 space-y-3 text-xs">
              {humanChecks.length === 0 && <p className="text-slate-500">No human-review check in this run.</p>}
              {humanChecks.map((check: any) => (
                <div key={check.reference} className="rounded-lg border border-slate-800 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong>{check.checkId}</strong>
                    {statusPill(check.result)}
                  </div>
                  <p className="mt-2 text-slate-500">{check.safeSummary}</p>
                  {check.result !== 'PASS'
                    && has(capabilities, 'sites.quality.human_review')
                    && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          const notes = window.prompt('Agency review notes (minimum 8 characters)');
                          if (!notes) return;
                          void command(
                            () => agencyFetch(
                              `/sites/${props.siteReference}/quality-runs/${latest.reference}`
                              + `/human-reviews/${check.reference}`,
                              {
                                method: 'POST',
                                body: JSON.stringify({ decision: 'PASS', notes }),
                              },
                            ),
                            'The authorised human-review task was completed.',
                          );
                        }}
                        className="mt-3 rounded-lg border border-emerald-800 px-3 py-2 font-bold text-emerald-300"
                      >
                        Mark human review complete
                      </button>
                    )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
              Previous-run comparison
            </h3>
            {comparison ? (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div><dt className="text-slate-500">New</dt><dd>{comparison.newFindings?.length ?? 0}</dd></div>
                <div><dt className="text-slate-500">Resolved</dt><dd>{comparison.resolvedFindings?.length ?? 0}</dd></div>
                <div><dt className="text-slate-500">Recurring</dt><dd>{comparison.recurringFindings?.length ?? 0}</dd></div>
                <div><dt className="text-slate-500">Severity changes</dt><dd>{comparison.severityChanges?.length ?? 0}</dd></div>
              </dl>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                A previous same-site run is required for comparison.
              </p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
