import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { capabilitiesForAgencyRole } from '@ks-os/contracts';

const [
  migration,
  manifest,
  schema,
  service,
  routes,
  app,
  worker,
  workerHandlers,
  previewRuntime,
  previewRepository,
  studio,
] = await Promise.all([
  readFile(new URL(
    '../../../packages/database/migrations/20260727100000_phase_15_8_site_quality_gates.sql',
    import.meta.url,
  ), 'utf8'),
  readFile(new URL('../../../packages/database/src/manifest.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../../packages/database/src/schema.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/modules/sites/site-quality.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/modules/sites/site-quality.routes.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../site-worker/src/postgres-quality-executor.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../site-worker/src/handlers.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../sites/src/lib/runtime.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../sites/src/lib/repository.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../web/src/features/agency/SiteQualityPanel.tsx', import.meta.url), 'utf8'),
]);

test('Phase 15.8 migration is additive, ordered, and does not implement publication', () => {
  assert.match(manifest, /20260727100000_phase_15_8_site_quality_gates\.sql/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i);
  assert.doesNotMatch(migration, /site_publication_events|PUBLISHED|Vercel|Cloudflare|IONOS/i);
  assert.match(migration, /ALTER TABLE site_jobs[\s\S]*DROP CONSTRAINT IF EXISTS site_jobs_type_valid/);
  assert.match(migration, /RUN_FULL_SITE_QUALITY_AUDIT/);
  assert.match(migration, /EVALUATE_PUBLICATION_READINESS/);
});

test('all quality records are server-only with RLS and explicit service-role grants', () => {
  const tables = [
    'site_quality_runs',
    'site_quality_page_runs',
    'site_quality_checks',
    'site_quality_findings',
    'site_quality_evidence',
    'site_quality_waivers',
    'site_quality_human_reviews',
    'site_quality_remediation_events',
    'site_quality_run_comparisons',
    'site_quality_audit_sessions',
  ];
  for (const table of tables) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(schema, new RegExp(`pgTable\\('${table}'`));
  }
  assert.match(migration, /REVOKE ALL ON TABLE[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /GRANT .* TO (?:anon|authenticated)/);
  assert.match(migration, /TO service_role/);
});

test('quality runs pin exact version, pack, policy, engine, renderer and reason', () => {
  for (const field of [
    'site_version_digest_sha256',
    'knowledge_pack_semantic_version',
    'knowledge_pack_digest_sha256',
    'rule_selection_digest_sha256',
    'policy_version',
    'quality_engine_version',
    'renderer_version',
    'audit_type',
    'audit_reason',
    'idempotency_key',
  ]) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(service, /tenantReference:[\s\S]*siteVersionDigest:[\s\S]*knowledgePackReference:[\s\S]*policyVersion:[\s\S]*qualityEngineVersion:[\s\S]*rendererVersion:[\s\S]*auditType:[\s\S]*reason:/);
});

test('database ownership triggers reject cross-tenant and cross-version child records', () => {
  assert.match(migration, /ks_validate_site_quality_run_scope/);
  assert.match(migration, /ks_validate_site_quality_child_scope/);
  assert.match(migration, /SITE_QUALITY_RUN_SCOPE_INVALID/);
  assert.match(migration, /SITE_QUALITY_TENANT_SCOPE_INVALID/);
  assert.match(migration, /SITE_QUALITY_SITE_VERSION_SCOPE_INVALID/);
  assert.match(migration, /SITE_QUALITY_PAGE_SCOPE_INVALID/);
});

test('non-waivable policy is enforced by both service and database trigger', () => {
  assert.match(migration, /ks_validate_site_quality_waiver/);
  assert.match(migration, /SITE_QUALITY_WAIVER_NOT_PERMITTED/);
  assert.match(service, /assertFindingMayBeWaived/);
  assert.match(service, /qualityCheckById/);
  assert.match(service, /SITE_QUALITY_WAIVER_APPROVER_REQUIRED/);
});

test('agency routes expose public-reference quality operations only', () => {
  for (const path of [
    'quality-runs',
    'quality-runs/:runReference/findings',
    'quality-runs/:runReference/evidence',
    'quality-runs/:runReference/summary',
    'compare/:otherRunReference',
    'quality-findings/:findingReference/acknowledge',
    'quality-findings/:findingReference/create-change-request',
    'quality-findings/:findingReference/resolve',
    'quality-findings/:findingReference/waive',
    'quality-findings/:findingReference/revoke-waiver',
    'publication-readiness',
    'publication-readiness/evaluate',
  ]) {
    assert.match(routes, new RegExp(path.replace(/[/:]/g, value =>
      value === '/' ? '\\/' : value === ':' ? ':' : value)));
  }
  assert.match(app, /agencySiteQualityRoutes[\s\S]*prefix: '\/api\/v1\/agency\/sites'/);
  assert.doesNotMatch(routes, /rule-definition|check-definition|policy-mutation/);
});

test('all quality mutations require explicit agency capabilities', () => {
  for (const capability of [
    'sites.quality.run',
    'sites.quality.cancel',
    'sites.quality.retry',
    'sites.quality.resolve',
    'sites.quality.waive',
    'sites.quality.human_review',
    'sites.publication_readiness.evaluate',
  ]) {
    assert.match(routes, new RegExp(`actor\\(request, '${capability.replaceAll('.', '\\.')}'\\)`));
  }
  const support = capabilitiesForAgencyRole('SUPPORT_ADMINISTRATOR');
  assert.ok(support.includes('sites.quality.read'));
  assert.ok(!support.includes('sites.quality.run'));
  assert.ok(!support.includes('sites.quality.waive'));
  const fulfilment = capabilitiesForAgencyRole('FULFILMENT_ADMINISTRATOR');
  assert.ok(fulfilment.includes('sites.quality.run'));
  assert.ok(!fulfilment.includes('sites.quality.waive'));
});

test('service and worker use the canonical reviewable generation lifecycle', () => {
  assert.match(service, /import \{ isQualityAuditableGenerationStatus \} from '@ks-os\/site-generation'/);
  assert.match(service, /!isQualityAuditableGenerationStatus\(context\.generationStatus\)/);
  assert.match(worker, /import \{ isQualityAuditableGenerationStatus \} from '@ks-os\/site-generation'/);
  assert.match(worker, /!isQualityAuditableGenerationStatus\(run\.versionGenerationStatus\)/);
  assert.doesNotMatch(service, /generationStatus (?:===|!==) 'COMPLETED'/);
  assert.doesNotMatch(worker, /versionGenerationStatus (?:===|!==) 'COMPLETED'/);
});

test('service rejects non-reviewable and superseded versions before enqueue', () => {
  assert.match(service, /!isQualityAuditableGenerationStatus\(context\.generationStatus\)/);
  assert.match(service, /context\.generationJobStatus !== 'COMPLETED'/);
  assert.match(service, /SITE_QUALITY_VERSION_INCOMPLETE/);
  assert.match(service, /versionStatus === 'SUPERSEDED'/);
  assert.match(service, /SITE_QUALITY_VERSION_SUPERSEDED/);
  assert.match(service, /Exactly one digest-bound ACTIVE PUBLIC_SITE knowledge pack/);
});

test('quality DTOs expose public references and exclude preview tokens and credentials', () => {
  assert.match(service, /reference: row\.publicReference/);
  assert.match(service, /siteVersionReference: row\.versionReference/);
  assert.doesNotMatch(service, /bearerToken|tokenDigestSha256|SITE_QUALITY_AI_API_KEY/);
  assert.doesNotMatch(routes, /databaseId|tenantId: request|siteId: request/);
});

test('secure preview is bearer-only for quality audits and bound to active exact scope', () => {
  assert.match(previewRuntime, /payload\.purpose === 'QUALITY_AUDIT'/);
  assert.match(previewRuntime, /!bearer/);
  assert.match(previewRuntime, /isQualityAuditSessionActive/);
  assert.match(previewRuntime, /X-Robots-Tag/);
  assert.match(previewRepository, /siteQualityAuditSessions\.tokenJti/);
  assert.match(previewRepository, /siteQualityRuns\.siteVersionDigestSha256/);
  assert.match(previewRepository, /siteVersions\.generationContentDigestSha256/);
  assert.match(previewRepository, /requestedPath/);
});

test('worker preserves safe evidence, fails partial browser audits and never publishes', () => {
  assert.match(worker, /QUALITY_CATEGORY_PARTIAL_FAILURE/);
  assert.match(worker, /failedBrowserAudits > 0/);
  assert.match(worker, /SITE_QUALITY_FINDING_CREATED/);
  assert.match(worker, /SITE_QUALITY_FINDING_REOPENED/);
  assert.match(worker, /SITE_QUALITY_RUN_COMPLETED/);
  assert.match(worker, /publicationPerformed: false/);
  assert.doesNotMatch(worker, /sitePublicationEvents|publishSite|Vercel|Cloudflare|IONOS/);
  assert.doesNotMatch(worker, /console\.log|bearerToken.*metadata|contentJson.*metadata/);
});

test('all ten quality worker handlers are registered with cancellation support', () => {
  for (const jobType of [
    'RUN_FULL_SITE_QUALITY_AUDIT',
    'RUN_TECHNICAL_SEO_AUDIT',
    'RUN_ACCESSIBILITY_AUDIT',
    'RUN_RESPONSIVE_UX_AUDIT',
    'RUN_CONVERSION_AUDIT',
    'RUN_BOOKING_INTEGRITY_AUDIT',
    'RUN_PERFORMANCE_AUDIT',
    'RUN_CONTENT_INTEGRITY_AUDIT',
    'RUN_ASSET_READINESS_AUDIT',
    'EVALUATE_PUBLICATION_READINESS',
  ]) {
    assert.match(workerHandlers, new RegExp(`qualityHandler\\('${jobType}'`));
  }
  assert.match(workerHandlers, /supportsCancellation: true/);
});

test('finding remediation reuses review change requests and no arbitrary JSON editor', () => {
  assert.match(service, /this\.reviews\.addAgencyChangeRequest/);
  assert.match(service, /siteQualityRemediationEvents/);
  assert.doesNotMatch(service, /update\(sitePages\).*contentJson/s);
  assert.doesNotMatch(studio, /contenteditable|arbitrary JSON|raw JSON editor/i);
});

test('publication readiness evaluates explicit gates and returns publicationPerformed false', () => {
  assert.match(service, /evaluatePublicationReadiness/);
  assert.match(service, /humanReviewIncompleteCount/);
  assert.match(service, /staleWaiverCount/);
  assert.match(service, /publicationPerformed: false/);
  assert.doesNotMatch(service, /PREPARE_PUBLICATION|CREATE_SITE_SNAPSHOT|sites\.publish/);
});

test('required quality audit and waiver lifecycle events are durable', () => {
  for (const event of [
    'SITE_QUALITY_RUN_REQUESTED',
    'SITE_QUALITY_RUN_STARTED',
    'SITE_QUALITY_RUN_COMPLETED',
    'SITE_QUALITY_RUN_FAILED',
    'SITE_QUALITY_RUN_CANCEL_REQUESTED',
    'SITE_QUALITY_RUN_CANCELLED',
    'SITE_QUALITY_FINDING_CREATED',
    'SITE_QUALITY_FINDING_RESOLVED',
    'SITE_QUALITY_FINDING_REOPENED',
    'SITE_QUALITY_FINDING_ACKNOWLEDGED',
    'SITE_QUALITY_WAIVER_CREATED',
    'SITE_QUALITY_WAIVER_REVOKED',
    'SITE_QUALITY_WAIVER_INVALIDATED',
    'SITE_QUALITY_HUMAN_REVIEW_COMPLETED',
    'SITE_PUBLICATION_READINESS_EVALUATED',
    'SITE_PUBLICATION_READINESS_BLOCKED',
    'SITE_PUBLICATION_READINESS_READY',
  ]) {
    assert.match(`${service}\n${worker}`, new RegExp(event));
  }
});

test('Site Studio quality UI shows explicit gates and hides actions by capability', () => {
  assert.match(studio, /Site quality and publication readiness/);
  assert.match(studio, /siteVersionDigest/);
  assert.match(studio, /knowledgePack/);
  assert.match(studio, /policyVersion/);
  assert.match(studio, /categorySummary/);
  assert.match(studio, /Previous-run comparison/);
  assert.match(studio, /has\(capabilities, 'sites\.quality\.run'\)/);
  assert.match(studio, /has\(capabilities, 'sites\.quality\.waive'\)/);
  assert.match(studio, /has\(capabilities, 'sites\.quality\.human_review'\)/);
  assert.match(studio, /READY never publishes/);
});
