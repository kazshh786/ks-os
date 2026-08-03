import { createHash } from 'node:crypto';
import {
  and,
  asc,
  eq,
  getDatabase,
  inArray,
  max,
  or,
  sql,
} from '@ks-os/database';
import {
  agencyUsers,
  bookingPageForms,
  bookingPages,
  forms,
  factFindingResponses,
  knowledgePacks,
  locations,
  platformAuditEvents,
  platformPlanEntitlements,
  platformPlans,
  productionBriefFacts,
  productionBriefs,
  provisioningActivity,
  provisioningDrafts,
  provisioningRecordLinks,
  provisioningRuns,
  provisioningRunSteps,
  serviceLocations,
  services,
  siteBlueprintActionItems,
  siteBlueprintPages,
  siteBlueprints,
  siteGenerationRuns,
  siteJobEvents,
  siteJobs,
  sites,
  siteVersions,
  staffSchedules,
  staffServiceAssignments,
  templateLayoutPageTypes,
  templateLayouts,
  templateSources,
  templateVersions,
  tenantPlanAssignments,
  tenants,
  users,
} from '@ks-os/database';
import {
  BlueprintGenerationRequestSchema,
  SitePageTypeSchema,
  type SitePageType,
} from '@ks-os/contracts';
import { generateBlueprintPlan } from '@ks-os/site-blueprints';
import {
  SITE_GENERATION_PROMPT_TEMPLATE_VERSION,
  buildVerifiedBusinessFacts,
  generationDigest,
  generationIdempotencyKey,
} from '@ks-os/site-generation';
import {
  GenerateSitePayloadSchema,
  ProvisionWorkspacePayloadSchema,
  SiteJobExecutionError,
  type SiteJobLeaseContext,
  type SiteJobResult,
} from '@ks-os/site-jobs';
import {
  PROVISIONING_STEPS,
  type ProvisioningStepKey,
} from '@ks-os/workspace-provisioning';
import type { z } from 'zod';
import type { SiteWorkerConfig } from './config.js';
import type { WorkspaceProvisioningJobExecutor } from './handlers.js';

type Database = ReturnType<typeof getDatabase>;
type Payload = z.infer<typeof ProvisionWorkspacePayloadSchema>;

interface ProvisioningContext {
  runId: string;
  runReference: string;
  runStatus: string;
  tenantId: string;
  tenantReference: string;
  tenantName: string;
  siteId: string;
  siteReference: string;
  draftId: string;
  draftReference: string;
  workspace: unknown;
  pagePlan: unknown;
  paymentPreference: unknown;
  briefId: string;
  briefReference: string;
  briefStatus: string;
  briefDigest: string;
  factSetDigest: string;
  assetSetDigest: string;
  planVersionId: string;
  planKey: string;
  templateVersionId: string;
  templateVersionReference: string;
  templateVersionStatus: string;
  templateAnalysisStatus: string;
  templateSourceId: string;
  templateSourceType: string;
  requestedByAgencyUserId: string;
  requestedByAgencyUserReference: string;
}

interface ApprovedFact {
  reference: string;
  mapping: string;
  value: unknown;
  digest: string;
}

interface LinkedRecord {
  type: string;
  reference: string;
  source?: ApprovedFact;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function flatten(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [value];
  return value.flatMap(flatten);
}

function mapped(facts: ApprovedFact[], mapping: string): Array<{ value: unknown; fact: ApprovedFact }> {
  return facts.filter(fact => fact.mapping === mapping)
    .flatMap(fact => flatten(fact.value).map(value => ({ value, fact })));
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const row = object(value);
  for (const key of ['name', 'label', 'value', 'text', 'address']) {
    if (typeof row[key] === 'string' && String(row[key]).trim()) return String(row[key]).trim();
  }
  return null;
}

function integerValue(value: unknown, keys: string[] = []): number | null {
  if (Number.isInteger(value)) return Number(value);
  const row = object(value);
  for (const key of keys) {
    if (Number.isInteger(row[key])) return Number(row[key]);
  }
  return null;
}

function booleanValue(value: unknown, keys: string[] = []): boolean | null {
  if (typeof value === 'boolean') return value;
  const row = object(value);
  for (const key of keys) if (typeof row[key] === 'boolean') return Boolean(row[key]);
  return null;
}

function stableEmail(runReference: string, index: number) {
  return `provisioning+${runReference.slice(0, 8)}-${index + 1}@invalid.ks-os.local`;
}

function addressParts(value: unknown) {
  const row = object(value);
  const structured = ['line1', 'line2', 'city', 'countryCode']
    .map(key => row[key])
    .filter(item => typeof item === 'string' && item.trim())
    .join(', ');
  const address = stringValue(value) || structured || null;
  const explicitPostcode = ['postcode', 'postalCode'].map(key => row[key])
    .find(item => typeof item === 'string' && item.trim());
  const extracted = address?.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0];
  return {
    address,
    postcode: explicitPostcode ? String(explicitPostcode).trim() : extracted || null,
  };
}

const dayNumber = (value: unknown): number | null => {
  if (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 6) return Number(value);
  const days: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  return typeof value === 'string' ? days[value.trim().toLowerCase()] ?? null : null;
};

function schedulesFrom(value: unknown) {
  const candidates = flatten(value).flatMap(item => {
    const row = object(item);
    if (Array.isArray(row.entries)) return row.entries;
    if (Array.isArray(row.schedule)) return row.schedule;
    return [item];
  });
  return candidates.flatMap(item => {
    const row = object(item);
    const day = dayNumber(row.dayOfWeek ?? row.day);
    if (row.closed === true) return [];
    const startValue = row.startTime ?? row.start ?? row.opensAt;
    const endValue = row.endTime ?? row.end ?? row.closesAt;
    const start = typeof startValue === 'string' ? startValue : '';
    const end = typeof endValue === 'string' ? endValue : '';
    return day !== null && /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && start < end
      ? [{ dayOfWeek: day, startTime: start, endTime: end }]
      : [];
  });
}

function statusForStep(step: ProvisioningStepKey) {
  if (['VALIDATE_DRAFT', 'RESOLVE_PLAN', 'CREATE_TENANT', 'CREATE_WORKSPACE'].includes(step)) return 'PROVISIONING_TENANT';
  if (['CREATE_BUSINESS_PROFILE', 'CREATE_LOCATIONS'].includes(step)) return 'PROVISIONING_BUSINESS';
  if (step === 'CREATE_SERVICES') return 'PROVISIONING_SERVICES';
  if (['CREATE_STAFF', 'CREATE_STAFF_SERVICE_RELATIONSHIPS', 'CREATE_LOCATION_SERVICE_RELATIONSHIPS'].includes(step)) return 'PROVISIONING_STAFF';
  if (['CREATE_OPENING_HOURS', 'CREATE_AVAILABILITY'].includes(step)) return 'PROVISIONING_AVAILABILITY';
  if (step === 'CREATE_BOOKING_CONFIGURATION') return 'PROVISIONING_BOOKING';
  if (step === 'CREATE_FORMS_AND_POLICIES') return 'PROVISIONING_FORMS';
  if (step === 'CREATE_PAYMENT_CONFIGURATION') return 'PROVISIONING_PAYMENTS';
  if (['CREATE_SITE', 'SELECT_TEMPLATE', 'GENERATE_BLUEPRINT', 'APPROVE_BLUEPRINT'].includes(step)) return 'PLANNING_SITE';
  return 'GENERATING_SITE';
}

export class PostgresWorkspaceProvisioningExecutor implements WorkspaceProvisioningJobExecutor {
  constructor(
    private readonly db: Database,
    private readonly generation: SiteWorkerConfig['generation'],
  ) {}

  async execute(rawPayload: unknown, lease: SiteJobLeaseContext): Promise<SiteJobResult> {
    const payload = ProvisionWorkspacePayloadSchema.parse(rawPayload);
    const run = await this.load(payload);
    await this.assertPinnedPayload(run, payload);
    const facts = await this.approvedFacts(run);
    let lastOutputs: string[] = [];
    try {
      for (const [index, step] of PROVISIONING_STEPS.entries()) {
        if (step === 'GENERATE_SITE') {
          lastOutputs = await this.executeStep(run, step, () => this.queueGeneration(run, facts), false);
          await lease.updateProgress({
            current: index + 1,
            total: PROVISIONING_STEPS.length,
            message: this.generation.enabled
              ? 'Structured site generation is queued.'
              : 'Site generation requires a configured server-side provider.',
          });
          return {
            summary: this.generation.enabled
              ? 'Workspace records are provisioned and structured site generation is queued.'
              : 'Workspace records are provisioned; site generation requires agency action.',
            outputReferences: [run.runReference, run.siteReference, ...lastOutputs].slice(0, 50),
            metrics: { stepsCompleted: index, stepsTotal: PROVISIONING_STEPS.length },
          };
        }
        if (['VALIDATE_NATIVE_BOOKING', 'CREATE_INTERNAL_REVIEW', 'CREATE_PREVIEW', 'MARK_READY', 'RECORD_AUDIT'].includes(step)) {
          continue;
        }
        lastOutputs = await this.executeStep(run, step, () => this.perform(run, facts, step));
        await lease.updateProgress({
          current: index + 1,
          total: PROVISIONING_STEPS.length,
          message: `${step.replaceAll('_', ' ').toLowerCase()} completed.`,
        });
        if (lease.signal.aborted || await lease.isCancellationRequested()) {
          throw new SiteJobExecutionError('CANCELLED_BY_USER', 'Workspace provisioning was cancelled.');
        }
      }
      throw new SiteJobExecutionError('UNEXPECTED_HANDLER_FAILURE', 'Provisioning did not reach generation hand-off.');
    } catch (error) {
      if (error instanceof SiteJobExecutionError && error.code === 'CANCELLED_BY_USER') {
        await this.db.update(provisioningRuns).set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(provisioningRuns.id, run.runId));
      }
      throw error;
    }
  }

  private async executeStep(
    run: ProvisioningContext,
    step: ProvisioningStepKey,
    action: () => Promise<LinkedRecord[]>,
    markCompleted = true,
  ) {
    const [stored] = await this.db.select({
      status: provisioningRunSteps.status,
      outputs: provisioningRunSteps.outputReferencesJson,
    }).from(provisioningRunSteps).where(and(
      eq(provisioningRunSteps.provisioningRunId, run.runId),
      eq(provisioningRunSteps.stepKey, step),
    )).limit(1);
    if (!stored) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', `The ${step} ledger entry is missing.`);
    if (stored.status === 'COMPLETED' || stored.status === 'WARNING') {
      return Array.isArray(stored.outputs) ? stored.outputs.filter((value): value is string => typeof value === 'string') : [];
    }
    const runStatus = statusForStep(step);
    await this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`provisioning-step:${run.runReference}:${step}`}::text, 0))`);
      await tx.update(provisioningRunSteps).set({
        status: 'IN_PROGRESS',
        attemptCount: sql`${provisioningRunSteps.attemptCount} + 1`,
        startedAt: new Date(),
        failureCode: null,
        safeMessage: `The ${step.replaceAll('_', ' ').toLowerCase()} step is running.`,
        updatedAt: new Date(),
      }).where(and(eq(provisioningRunSteps.provisioningRunId, run.runId), eq(provisioningRunSteps.stepKey, step)));
      await tx.update(provisioningRuns).set({
        status: runStatus,
        currentStep: step,
        attemptCount: sql`${provisioningRuns.attemptCount} + 1`,
        startedAt: sql`coalesce(${provisioningRuns.startedAt}, now())`,
        updatedAt: new Date(),
      }).where(eq(provisioningRuns.id, run.runId));
      await tx.insert(provisioningActivity).values({
        provisioningRunId: run.runId,
        tenantId: run.tenantId,
        eventType: 'PROVISIONING_STEP_STARTED',
        statusFrom: run.runStatus,
        statusTo: runStatus,
        stepKey: step,
        safeMessage: `The ${step.replaceAll('_', ' ').toLowerCase()} step started.`,
      });
    });
    try {
      const linked = await action();
      const outputs = linked.map(item => item.reference);
      await this.db.transaction(async tx => {
        for (const item of linked) {
          await tx.insert(provisioningRecordLinks).values({
            provisioningRunId: run.runId,
            tenantId: run.tenantId,
            stepKey: step,
            recordType: item.type,
            recordPublicReference: item.reference,
            sourceFactReference: item.source?.reference,
            sourceValueDigestSha256: item.source?.digest,
          }).onConflictDoNothing();
        }
        if (markCompleted) {
          await tx.update(provisioningRunSteps).set({
            status: 'COMPLETED',
            outputReferencesJson: outputs,
            safeMessage: `The ${step.replaceAll('_', ' ').toLowerCase()} step completed.`,
            completedAt: new Date(),
            updatedAt: new Date(),
          }).where(and(eq(provisioningRunSteps.provisioningRunId, run.runId), eq(provisioningRunSteps.stepKey, step)));
        }
        const completed = await tx.select({ key: provisioningRunSteps.stepKey })
          .from(provisioningRunSteps).where(and(
            eq(provisioningRunSteps.provisioningRunId, run.runId),
            inArray(provisioningRunSteps.status, ['COMPLETED', 'WARNING', 'SKIPPED']),
          ));
        await tx.update(provisioningRuns).set({
          completionPercentage: Math.floor((completed.length / PROVISIONING_STEPS.length) * 100),
          updatedAt: new Date(),
        }).where(eq(provisioningRuns.id, run.runId));
        await tx.insert(provisioningActivity).values({
          provisioningRunId: run.runId,
          tenantId: run.tenantId,
          eventType: markCompleted ? 'PROVISIONING_STEP_COMPLETED' : 'PROVISIONING_GENERATION_QUEUED',
          statusTo: runStatus,
          stepKey: step,
          safeMessage: markCompleted
            ? `The ${step.replaceAll('_', ' ').toLowerCase()} step completed.`
            : 'Structured site generation was handed off to the durable generation worker.',
        });
      });
      return outputs;
    } catch (error) {
      const code = error instanceof SiteJobExecutionError ? error.code : 'UNEXPECTED_HANDLER_FAILURE';
      const message = error instanceof Error ? error.message.slice(0, 500) : 'The provisioning step failed.';
      await this.db.transaction(async tx => {
        await tx.update(provisioningRunSteps).set({
          status: 'FAILED', failureCode: code, safeMessage: message,
          completedAt: new Date(), updatedAt: new Date(),
        }).where(and(eq(provisioningRunSteps.provisioningRunId, run.runId), eq(provisioningRunSteps.stepKey, step)));
        await tx.update(provisioningRuns).set({
          status: 'PARTIALLY_FAILED', failureCode: code, failureMessage: message,
          retryable: !String(code).startsWith('TERMINAL_'), failedAt: new Date(), updatedAt: new Date(),
        }).where(eq(provisioningRuns.id, run.runId));
        await tx.insert(provisioningActivity).values({
          provisioningRunId: run.runId, tenantId: run.tenantId,
          eventType: 'PROVISIONING_STEP_FAILED', statusTo: 'PARTIALLY_FAILED', stepKey: step,
          safeMessage: message,
        });
        await tx.insert(platformAuditEvents).values({
          agencyUserId: run.requestedByAgencyUserId,
          tenantId: run.tenantId,
          action: 'WORKSPACE_PROVISIONING_FAILED',
          targetType: 'PROVISIONING_RUN',
          targetId: run.runReference,
          eventCategory: 'ADMINISTRATION',
          sourceComponent: 'site-worker',
          description: 'A workspace provisioning step failed and the durable run remains available for controlled recovery.',
          metadata: { step, failureCode: code, retryable: !String(code).startsWith('TERMINAL_') },
        });
      });
      throw error;
    }
  }

  private async perform(run: ProvisioningContext, facts: ApprovedFact[], step: ProvisioningStepKey): Promise<LinkedRecord[]> {
    switch (step) {
      case 'VALIDATE_DRAFT':
        if (run.briefStatus !== 'LOCKED_FOR_PROVISIONING') throw new SiteJobExecutionError('TERMINAL_PERMISSION_FAILURE', 'The production brief is not locked.');
        return [{ type: 'PRODUCTION_BRIEF', reference: run.briefReference }];
      case 'RESOLVE_PLAN':
        return this.resolvePlan(run);
      case 'CREATE_TENANT':
      case 'CREATE_WORKSPACE':
        return [{ type: step === 'CREATE_TENANT' ? 'TENANT' : 'WORKSPACE', reference: run.tenantReference }];
      case 'CREATE_BUSINESS_PROFILE':
        return this.businessProfile(run, facts);
      case 'CREATE_LOCATIONS':
        return this.createLocations(run, facts);
      case 'CREATE_SERVICES':
        return this.createServices(run, facts);
      case 'CREATE_STAFF':
        return this.createStaff(run, facts);
      case 'CREATE_STAFF_SERVICE_RELATIONSHIPS':
        return this.staffServices(run, facts);
      case 'CREATE_LOCATION_SERVICE_RELATIONSHIPS':
        return this.locationServices(run, facts);
      case 'CREATE_OPENING_HOURS':
        return this.availability(run, facts, 'LOCATION.OPENING_HOURS');
      case 'CREATE_AVAILABILITY':
        return this.availability(run, facts, 'STAFF.AVAILABILITY');
      case 'CREATE_BOOKING_CONFIGURATION':
        return this.bookingConfiguration(run, facts);
      case 'CREATE_FORMS_AND_POLICIES':
        return this.formsAndPolicies(run, facts);
      case 'CREATE_PAYMENT_CONFIGURATION':
        return this.paymentConfiguration(run, facts);
      case 'CREATE_SITE':
        return [{ type: 'SITE', reference: run.siteReference }];
      case 'SELECT_TEMPLATE':
        if (run.templateVersionStatus !== 'APPROVED' || run.templateAnalysisStatus !== 'APPROVED') {
          throw new SiteJobExecutionError('TERMINAL_PERMISSION_FAILURE', 'The pinned template version is not approved.');
        }
        return [{ type: 'TEMPLATE_VERSION', reference: run.templateVersionReference }];
      case 'GENERATE_BLUEPRINT':
        return this.generateBlueprint(run);
      case 'APPROVE_BLUEPRINT':
        return this.approveBlueprint(run);
      default:
        return [];
    }
  }

  private async load(payload: Payload): Promise<ProvisioningContext> {
    const [row] = await this.db.select({
      runId: provisioningRuns.id,
      runReference: provisioningRuns.publicReference,
      runStatus: provisioningRuns.status,
      tenantId: provisioningRuns.tenantId,
      tenantReference: tenants.businessReference,
      tenantName: tenants.name,
      siteId: sites.id,
      siteReference: sites.publicReference,
      draftId: provisioningDrafts.id,
      draftReference: provisioningDrafts.publicReference,
      workspace: provisioningDrafts.workspaceJson,
      pagePlan: provisioningDrafts.pagePlanJson,
      paymentPreference: provisioningDrafts.paymentPreferenceJson,
      briefId: productionBriefs.id,
      briefReference: productionBriefs.publicReference,
      briefStatus: productionBriefs.status,
      briefDigest: productionBriefs.contentDigestSha256,
      factSetDigest: productionBriefs.approvedFactSetDigestSha256,
      assetSetDigest: productionBriefs.approvedAssetSetDigestSha256,
      planVersionId: provisioningRuns.planVersionId,
      planKey: platformPlans.key,
      templateVersionId: templateVersions.id,
      templateVersionReference: templateVersions.publicReference,
      templateVersionStatus: templateVersions.status,
      templateAnalysisStatus: templateVersions.analysisStatus,
      templateSourceId: templateSources.id,
      templateSourceType: templateSources.sourceType,
      requestedByAgencyUserId: provisioningRuns.requestedByAgencyUserId,
      requestedByAgencyUserReference: agencyUsers.publicReference,
    }).from(provisioningRuns)
      .innerJoin(provisioningDrafts, eq(provisioningRuns.provisioningDraftId, provisioningDrafts.id))
      .innerJoin(productionBriefs, eq(provisioningRuns.productionBriefId, productionBriefs.id))
      .innerJoin(tenants, eq(provisioningRuns.tenantId, tenants.id))
      .innerJoin(sites, eq(provisioningRuns.siteId, sites.id))
      .innerJoin(templateVersions, eq(provisioningRuns.templateVersionId, templateVersions.id))
      .innerJoin(templateSources, eq(templateVersions.templateSourceId, templateSources.id))
      .innerJoin(tenantPlanAssignments, and(
        eq(tenantPlanAssignments.tenantId, provisioningRuns.tenantId),
        eq(tenantPlanAssignments.planVersionId, provisioningRuns.planVersionId),
        eq(tenantPlanAssignments.status, 'ACTIVE'),
      ))
      .innerJoin(platformPlans, eq(tenantPlanAssignments.planVersionId, provisioningRuns.planVersionId))
      .innerJoin(agencyUsers, eq(provisioningRuns.requestedByAgencyUserId, agencyUsers.id))
      .where(eq(provisioningRuns.publicReference, payload.provisioningRunReference)).limit(1);
    if (!row) {
      // platform_plans joins through platform_plan_versions, resolved separately below.
      const [fallback] = await this.loadWithPlan(payload.provisioningRunReference);
      if (!fallback) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The pinned provisioning run was not found.');
      return fallback;
    }
    return row;
  }

  private async loadWithPlan(reference: string): Promise<ProvisioningContext[]> {
    const result = await this.db.execute(sql<ProvisioningContext>`
      select pr.id as "runId", pr.public_reference as "runReference", pr.status as "runStatus",
        pr.tenant_id as "tenantId", t.business_reference as "tenantReference", t.name as "tenantName",
        s.id as "siteId", s.public_reference as "siteReference",
        pd.id as "draftId", pd.public_reference as "draftReference", pd.workspace_json as workspace,
        pd.page_plan_json as "pagePlan", pd.payment_preference_json as "paymentPreference",
        pb.id as "briefId", pb.public_reference as "briefReference", pb.status as "briefStatus",
        pb.content_digest_sha256 as "briefDigest", pb.approved_fact_set_digest_sha256 as "factSetDigest",
        pb.approved_asset_set_digest_sha256 as "assetSetDigest", pr.plan_version_id as "planVersionId",
        pp.key as "planKey", tv.id as "templateVersionId", tv.public_reference as "templateVersionReference",
        tv.status as "templateVersionStatus", tv.analysis_status as "templateAnalysisStatus",
        ts.id as "templateSourceId", ts.source_type as "templateSourceType",
        pr.requested_by_agency_user_id as "requestedByAgencyUserId",
        au.public_reference as "requestedByAgencyUserReference"
      from provisioning_runs pr
      join provisioning_drafts pd on pd.id = pr.provisioning_draft_id
      join production_briefs pb on pb.id = pr.production_brief_id
      join tenants t on t.id = pr.tenant_id
      join sites s on s.id = pr.site_id
      join template_versions tv on tv.id = pr.template_version_id
      join template_sources ts on ts.id = tv.template_source_id
      join platform_plan_versions ppv on ppv.id = pr.plan_version_id
      join platform_plans pp on pp.id = ppv.plan_id
      join agency_users au on au.id = pr.requested_by_agency_user_id
      where pr.public_reference = ${reference} limit 1
    `);
    return result.rows as unknown as ProvisioningContext[];
  }

  private async assertPinnedPayload(run: ProvisioningContext, payload: Payload) {
    const factRows = await this.db.select({
      responseReference: factFindingResponses.publicReference,
      valueDigestSha256: productionBriefFacts.valueDigestSha256,
      approvedValue: productionBriefFacts.approvedValueJson,
    }).from(productionBriefFacts)
      .innerJoin(factFindingResponses, eq(productionBriefFacts.sourceResponseId, factFindingResponses.id))
      .where(eq(productionBriefFacts.productionBriefId, run.briefId))
      // buildBrief pins the fact-set digest in response creation order. The
      // snapshot row IDs are generated independently during insertion, so
      // sorting by them cannot reproduce the locked brief's sequence.
      .orderBy(asc(factFindingResponses.createdAt));
    const valuesIntact = factRows.every(row => digest(row.approvedValue) === row.valueDigestSha256);
    const factSetDigest = digest(factRows.map(row => [row.responseReference, row.valueDigestSha256]));
    if (run.runReference !== payload.provisioningRunReference
      || run.draftReference !== payload.provisioningDraftReference
      || run.siteReference !== payload.siteReference
      || run.briefReference !== payload.productionBriefReference
      || run.briefDigest !== payload.productionBriefDigestSha256
      || run.requestedByAgencyUserReference !== payload.requestedByAgencyUserReference
      || run.briefStatus !== 'LOCKED_FOR_PROVISIONING') {
      throw new SiteJobExecutionError('TERMINAL_PERMISSION_FAILURE', 'The provisioning payload does not match its locked server-side run.');
    }
    // The database trigger pins all three locked brief digests. Recompute each
    // approved value and the ordered response snapshot independently here.
    if (!valuesIntact || factSetDigest !== run.factSetDigest) {
      throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The approved fact snapshot no longer matches the locked production brief.');
    }
  }

  private approvedFacts(run: ProvisioningContext): Promise<ApprovedFact[]> {
    return this.db.select({
      reference: productionBriefFacts.publicReference,
      mapping: productionBriefFacts.fieldMapping,
      value: productionBriefFacts.approvedValueJson,
      digest: productionBriefFacts.valueDigestSha256,
    }).from(productionBriefFacts).where(and(
      eq(productionBriefFacts.productionBriefId, run.briefId),
      or(eq(productionBriefFacts.publicUseEligible, true), eq(productionBriefFacts.bookingUseEligible, true), eq(productionBriefFacts.generationUseEligible, true)),
    )).orderBy(asc(productionBriefFacts.fieldMapping), asc(productionBriefFacts.id));
  }

  private async resolvePlan(run: ProvisioningContext): Promise<LinkedRecord[]> {
    const [assignment] = await this.db.select({ id: tenantPlanAssignments.id })
      .from(tenantPlanAssignments).where(and(
        eq(tenantPlanAssignments.tenantId, run.tenantId),
        eq(tenantPlanAssignments.planVersionId, run.planVersionId),
        eq(tenantPlanAssignments.status, 'ACTIVE'),
      )).limit(1);
    if (!assignment || !['CORE', 'GROWTH', 'SCALE'].includes(run.planKey)) {
      throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The active Core, Growth, or Scale plan assignment is missing.');
    }
    return [{ type: 'PLAN_ASSIGNMENT', reference: assignment.id }];
  }

  private async businessProfile(run: ProvisioningContext, facts: ApprovedFact[]): Promise<LinkedRecord[]> {
    const trading = mapped(facts, 'BUSINESS.TRADING_NAME')[0];
    const legal = mapped(facts, 'BUSINESS.LEGAL_NAME')[0];
    const category = mapped(facts, 'BUSINESS.CATEGORY')[0];
    const phone = mapped(facts, 'BUSINESS.PUBLIC_PHONE')[0];
    const email = mapped(facts, 'BUSINESS.PUBLIC_EMAIL')[0];
    const workspace = object(run.workspace);
    await this.db.update(tenants).set({
      name: stringValue(trading?.value) || run.tenantName,
      legalBusinessName: stringValue(legal?.value),
      businessType: stringValue(category?.value),
      operationalPhone: stringValue(phone?.value),
      replyToEmail: stringValue(email?.value),
      timezone: typeof workspace.timezone === 'string' ? workspace.timezone : undefined,
      currency: typeof workspace.currency === 'string' ? workspace.currency : undefined,
      lifecycleStatus: 'ONBOARDING',
      updatedAt: new Date(),
    }).where(eq(tenants.id, run.tenantId));
    return [{ type: 'BUSINESS_PROFILE', reference: run.tenantReference, source: trading?.fact || legal?.fact }];
  }

  private async createLocations(run: ProvisioningContext, facts: ApprovedFact[]): Promise<LinkedRecord[]> {
    const names = mapped(facts, 'LOCATION.NAME');
    const addresses = mapped(facts, 'LOCATION.ADDRESS');
    const phone = mapped(facts, 'BUSINESS.PUBLIC_PHONE')[0];
    const workspace = object(run.workspace);
    const output: LinkedRecord[] = [];
    for (const [index, named] of names.entries()) {
      const name = stringValue(named.value);
      const parts = addressParts(addresses[index]?.value);
      if (!name || !parts.address || !parts.postcode) {
        throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'Every physical location requires an approved name, address, and postcode.');
      }
      const [existing] = await this.db.select({ id: locations.id, reference: locations.publicReference })
        .from(locations).where(and(eq(locations.tenantId, run.tenantId), eq(locations.name, name))).limit(1);
      const row = existing || (await this.db.insert(locations).values({
        tenantId: run.tenantId,
        name,
        address: parts.address,
        postcode: parts.postcode,
        phone: stringValue(phone?.value),
        timezone: typeof workspace.timezone === 'string' ? workspace.timezone : 'Europe/London',
        isPrimary: index === 0,
      }).returning({ id: locations.id, reference: locations.publicReference }))[0];
      output.push({ type: 'LOCATION', reference: row.reference, source: named.fact });
    }
    return output;
  }

  private async createServices(run: ProvisioningContext, facts: ApprovedFact[]): Promise<LinkedRecord[]> {
    const names = mapped(facts, 'SERVICE.NAME');
    const descriptions = mapped(facts, 'SERVICE.DESCRIPTION');
    const durations = mapped(facts, 'SERVICE.DURATION');
    const prices = mapped(facts, 'SERVICE.PRICE');
    const buffers = mapped(facts, 'SERVICE.BUFFER');
    const deposits = mapped(facts, 'SERVICE.DEPOSIT');
    const output: LinkedRecord[] = [];
    for (const [index, named] of names.entries()) {
      const name = stringValue(named.value);
      const duration = integerValue(durations[index]?.value, ['minutes', 'durationMinutes']);
      const price = integerValue(prices[index]?.value, ['amountMinor', 'priceMinor']);
      if (!name || duration === null || duration < 5 || price === null || price < 0) {
        throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'Every bookable service requires an approved name, duration, and minor-unit price.');
      }
      const [existing] = await this.db.select({ id: services.id, reference: services.publicReference })
        .from(services).where(and(eq(services.tenantId, run.tenantId), eq(services.name, name))).limit(1);
      const row = existing || (await this.db.insert(services).values({
        tenantId: run.tenantId,
        name,
        description: stringValue(descriptions[index]?.value),
        duration,
        bufferTime: integerValue(buffers[index]?.value, ['minutes']) || 0,
        price,
        requiresDeposit: booleanValue(deposits[index]?.value, ['required', 'requiresDeposit']) || false,
      }).returning({ id: services.id, reference: services.publicReference }))[0];
      output.push({ type: 'SERVICE', reference: row.reference, source: named.fact });
    }
    return output;
  }

  private async createStaff(run: ProvisioningContext, facts: ApprovedFact[]): Promise<LinkedRecord[]> {
    const names = mapped(facts, 'STAFF.NAME');
    const roles = mapped(facts, 'STAFF.ROLE');
    const bios = mapped(facts, 'STAFF.BIO');
    const output: LinkedRecord[] = [];
    for (const [index, named] of names.entries()) {
      const name = stringValue(named.value);
      if (!name) continue;
      const email = stableEmail(run.runReference, index);
      const [existing] = await this.db.select({ id: users.id, reference: users.publicReference })
        .from(users).where(and(eq(users.tenantId, run.tenantId), eq(users.emailNormalized, email))).limit(1);
      const row = existing || (await this.db.insert(users).values({
        tenantId: run.tenantId,
        email,
        emailNormalized: email,
        name,
        role: index === 0 ? 'owner' : 'staff',
        jobTitle: stringValue(roles[index]?.value),
        bio: stringValue(bios[index]?.value),
        bookingEnabled: true,
      }).returning({ id: users.id, reference: users.publicReference }))[0];
      output.push({ type: 'STAFF', reference: row.reference, source: named.fact });
    }
    return output;
  }

  private async staffServices(run: ProvisioningContext, facts: ApprovedFact[]): Promise<LinkedRecord[]> {
    const staff = await this.db.select({ id: users.id, reference: users.publicReference, name: users.name })
      .from(users).where(and(eq(users.tenantId, run.tenantId), eq(users.bookingEnabled, true)));
    const serviceRows = await this.db.select({ id: services.id, reference: services.publicReference, name: services.name })
      .from(services).where(and(eq(services.tenantId, run.tenantId), eq(services.isActive, true)));
    const eligible = mapped(facts, 'STAFF.ELIGIBLE_SERVICES');
    if (!eligible.length && staff.length * serviceRows.length > 1) {
      throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The locked brief must explicitly map eligible services to staff when more than one relationship is possible.');
    }
    for (const [index, member] of staff.entries()) {
      const names = flatten(eligible[index]?.value).map(stringValue).filter((value): value is string => Boolean(value));
      const selected = names.length ? serviceRows.filter(service => names.includes(service.name)) : serviceRows.slice(0, 1);
      if (names.length && selected.length !== names.length) {
        throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', `One or more approved service names for ${member.name} could not be resolved.`);
      }
      for (const service of selected) {
        await this.db.insert(staffServiceAssignments).values({
          tenantId: run.tenantId, staffUserId: member.id, serviceId: service.id,
        }).onConflictDoNothing();
      }
    }
    const rows = await this.db.select({ reference: users.publicReference }).from(staffServiceAssignments)
      .innerJoin(users, eq(staffServiceAssignments.staffUserId, users.id))
      .where(eq(staffServiceAssignments.tenantId, run.tenantId));
    if (staff.length && !rows.length) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'No approved staff-service relationship could be created.');
    return rows.map(row => ({ type: 'STAFF_SERVICE_ASSIGNMENT', reference: row.reference }));
  }

  private async locationServices(run: ProvisioningContext, facts: ApprovedFact[]): Promise<LinkedRecord[]> {
    const locationRows = await this.db.select({ id: locations.id, reference: locations.publicReference, name: locations.name })
      .from(locations).where(and(eq(locations.tenantId, run.tenantId), eq(locations.isActive, true)));
    const serviceRows = await this.db.select({ id: services.id, reference: services.publicReference, name: services.name })
      .from(services).where(and(eq(services.tenantId, run.tenantId), eq(services.isActive, true)));
    const mappings = mapped(facts, 'SERVICE.AVAILABLE_LOCATIONS');
    if (!mappings.length && serviceRows.length * locationRows.length > 1) {
      throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The locked brief must explicitly map services to locations when more than one relationship is possible.');
    }
    for (const [index, service] of serviceRows.entries()) {
      const names = flatten(mappings[index]?.value).map(stringValue).filter((value): value is string => Boolean(value));
      const selected = names.length ? locationRows.filter(location => names.includes(location.name)) : locationRows.slice(0, 1);
      if (names.length && selected.length !== names.length) {
        throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', `One or more approved locations for ${service.name} could not be resolved.`);
      }
      for (const location of selected) {
        await this.db.insert(serviceLocations).values({ tenantId: run.tenantId, serviceId: service.id, locationId: location.id })
          .onConflictDoNothing();
      }
    }
    return locationRows.map(row => ({ type: 'LOCATION_SERVICE_CONFIGURATION', reference: row.reference }));
  }

  private async availability(run: ProvisioningContext, facts: ApprovedFact[], mapping: string): Promise<LinkedRecord[]> {
    const staff = await this.db.select({ id: users.id, reference: users.publicReference })
      .from(users).where(and(eq(users.tenantId, run.tenantId), eq(users.bookingEnabled, true))).orderBy(asc(users.createdAt));
    const source = mapped(facts, mapping);
    const fallback = source.flatMap(item => schedulesFrom(item.value));
    for (const [index, member] of staff.entries()) {
      const entries = schedulesFrom(source[index]?.value).length ? schedulesFrom(source[index]?.value) : fallback;
      for (const entry of entries) {
        const [existing] = await this.db.select({ id: staffSchedules.id }).from(staffSchedules).where(and(
          eq(staffSchedules.tenantId, run.tenantId), eq(staffSchedules.userId, member.id),
          eq(staffSchedules.dayOfWeek, entry.dayOfWeek), eq(staffSchedules.startTime, entry.startTime), eq(staffSchedules.endTime, entry.endTime),
        )).limit(1);
        if (!existing) await this.db.insert(staffSchedules).values({ tenantId: run.tenantId, userId: member.id, ...entry });
      }
    }
    const rows = await this.db.select({ reference: users.publicReference }).from(staffSchedules)
      .innerJoin(users, eq(staffSchedules.userId, users.id)).where(eq(staffSchedules.tenantId, run.tenantId));
    if (staff.length && !rows.length && mapping === 'STAFF.AVAILABILITY') {
      throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'No approved staff availability could be created.');
    }
    return [...new Set(rows.map(row => row.reference))].map(reference => ({ type: 'AVAILABILITY', reference }));
  }

  private async bookingConfiguration(run: ProvisioningContext, facts: ApprovedFact[]): Promise<LinkedRecord[]> {
    const [serviceRows, locationRows, staffRows] = await Promise.all([
      this.db.select({ id: services.id }).from(services).where(and(eq(services.tenantId, run.tenantId), eq(services.isActive, true))),
      this.db.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, run.tenantId), eq(locations.isActive, true))),
      this.db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, run.tenantId), eq(users.bookingEnabled, true), eq(users.accountStatus, 'ACTIVE'))),
    ]);
    if (!serviceRows.length || !locationRows.length || !staffRows.length) {
      throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'Native booking requires service, location, and eligible staff records.');
    }
    const notice = integerValue(mapped(facts, 'BOOKING.MINIMUM_NOTICE')[0]?.value, ['minutes']) || 0;
    const advance = integerValue(mapped(facts, 'BOOKING.MAXIMUM_ADVANCE')[0]?.value, ['days']) || 365;
    const cancellation = stringValue(mapped(facts, 'BOOKING.CANCELLATION_POLICY')[0]?.value) || '';
    const [existing] = await this.db.select({ id: bookingPages.id, slug: bookingPages.publicSlug })
      .from(bookingPages).where(eq(bookingPages.tenantId, run.tenantId)).limit(1);
    const values = {
      title: `Book with ${run.tenantName}`,
      allowedServiceIds: serviceRows.map(row => row.id),
      allowedLocationIds: locationRows.map(row => row.id),
      allowedStaffIds: staffRows.map(row => row.id),
      defaultLocationId: locationRows[0].id,
      bookingRules: { minimumNoticeMinutes: notice, maximumAdvanceDays: advance },
      cancellationSettings: { policy: cancellation },
      enabled: true,
      updatedAt: new Date(),
    };
    if (existing) await this.db.update(bookingPages).set(values).where(eq(bookingPages.id, existing.id));
    else await this.db.insert(bookingPages).values({
      tenantId: run.tenantId,
      publicSlug: object(run.workspace).subdomain as string,
      description: '',
      ...values,
    });
    return [{ type: 'BOOKING_CONFIGURATION', reference: run.tenantReference }];
  }

  private async formsAndPolicies(run: ProvisioningContext, facts: ApprovedFact[]): Promise<LinkedRecord[]> {
    const requirements = mapped(facts, 'SERVICE.INTAKE_REQUIREMENTS');
    if (!requirements.length) return [];
    const [owner, page, serviceRows] = await Promise.all([
      this.db.select({ id: users.id }).from(users).where(eq(users.tenantId, run.tenantId)).orderBy(asc(users.createdAt)).limit(1).then(rows => rows[0]),
      this.db.select({ id: bookingPages.id }).from(bookingPages).where(eq(bookingPages.tenantId, run.tenantId)).limit(1).then(rows => rows[0]),
      this.db.select({ id: services.id }).from(services).where(eq(services.tenantId, run.tenantId)),
    ]);
    if (!owner || !page) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'A booking owner and booking page are required before forms are created.');
    const output: LinkedRecord[] = [];
    for (const [index, requirement] of requirements.entries()) {
      const label = stringValue(requirement.value) || `Service intake ${index + 1}`;
      const [existing] = await this.db.select({ id: forms.id }).from(forms)
        .where(and(eq(forms.tenantId, run.tenantId), eq(forms.title, label))).limit(1);
      const form = existing || (await this.db.insert(forms).values({
        tenantId: run.tenantId,
        title: label,
        description: '',
        formType: 'INTAKE',
        fieldsJson: [{ key: 'client_notes', type: 'LONG_TEXT', label, required: true }],
        status: 'PUBLISHED',
        createdByUserId: owner.id,
        updatedByUserId: owner.id,
      }).returning({ id: forms.id }))[0];
      const serviceId = serviceRows[index]?.id || null;
      const [existingLink] = await this.db.select({ id: bookingPageForms.id }).from(bookingPageForms).where(and(
        eq(bookingPageForms.tenantId, run.tenantId),
        eq(bookingPageForms.bookingPageId, page.id),
        eq(bookingPageForms.formId, form.id),
        serviceId ? eq(bookingPageForms.serviceId, serviceId) : sql`${bookingPageForms.serviceId} is null`,
      )).limit(1);
      if (!existingLink) await this.db.insert(bookingPageForms).values({
          tenantId: run.tenantId,
          bookingPageId: page.id,
          formId: form.id,
          serviceId,
          required: true,
          displayOrder: index,
        });
      output.push({ type: 'FORM', reference: form.id, source: requirement.fact });
    }
    return output;
  }

  private async paymentConfiguration(run: ProvisioningContext, facts: ApprovedFact[]): Promise<LinkedRecord[]> {
    const preference = object(run.paymentPreference);
    const deposit = mapped(facts, 'SERVICE.DEPOSIT').some(item => booleanValue(item.value, ['required', 'requiresDeposit']) === true);
    await this.db.update(bookingPages).set({
      paymentSettings: {
        allowPayLater: preference.allowPayLater === true,
        onlinePaymentsRequested: preference.onlinePaymentsRequested === true,
        depositCollectionRequested: preference.depositCollectionRequested === true || deposit,
      },
      updatedAt: new Date(),
    }).where(eq(bookingPages.tenantId, run.tenantId));
    return [{ type: 'PAYMENT_CONFIGURATION', reference: run.tenantReference }];
  }

  private async generateBlueprint(run: ProvisioningContext): Promise<LinkedRecord[]> {
    const [existing] = await this.db.select({ id: siteBlueprints.id, reference: siteBlueprints.publicReference })
      .from(siteBlueprints).where(eq(siteBlueprints.provisioningRunId, run.runId)).limit(1);
    if (existing) return [{ type: 'SITE_BLUEPRINT', reference: existing.reference }];
    const [assignment, entitlement, layouts, pageTypes, serviceRows, locationRows, staffRows, business] = await Promise.all([
      this.db.select({ id: tenantPlanAssignments.id }).from(tenantPlanAssignments).where(and(eq(tenantPlanAssignments.tenantId, run.tenantId), eq(tenantPlanAssignments.planVersionId, run.planVersionId), eq(tenantPlanAssignments.status, 'ACTIVE'))).limit(1).then(rows => rows[0]),
      this.db.select({ value: platformPlanEntitlements.valueJson }).from(platformPlanEntitlements).where(and(eq(platformPlanEntitlements.planVersionId, run.planVersionId), eq(platformPlanEntitlements.entitlementKey, 'sites.initial_marketing_pages'))).limit(1).then(rows => rows[0]),
      this.db.select({ id: templateLayouts.id, reference: templateLayouts.publicReference, status: templateLayouts.status, disabledAt: templateLayouts.disabledAt }).from(templateLayouts).where(eq(templateLayouts.templateVersionId, run.templateVersionId)),
      this.db.select({ layoutId: templateLayoutPageTypes.templateLayoutId, pageType: templateLayoutPageTypes.pageType, approvedAt: templateLayoutPageTypes.approvedAt }).from(templateLayoutPageTypes),
      this.db.select({ id: services.id, reference: services.publicReference, name: services.name, description: services.description, duration: services.duration, price: services.price, active: services.isActive, updatedAt: services.updatedAt }).from(services).where(eq(services.tenantId, run.tenantId)),
      this.db.select({ id: locations.id, reference: locations.publicReference, name: locations.name, address: locations.address, postcode: locations.postcode, phone: locations.phone, primary: locations.isPrimary, active: locations.isActive, updatedAt: locations.updatedAt }).from(locations).where(eq(locations.tenantId, run.tenantId)),
      this.db.select({ id: users.id, reference: users.publicReference, name: users.name, active: users.accountStatus, bookingEnabled: users.bookingEnabled, bio: users.bio, role: users.jobTitle, image: users.profileImageUrl, updatedAt: users.updatedAt }).from(users).where(eq(users.tenantId, run.tenantId)),
      this.db.select({ name: tenants.name, businessType: tenants.businessType, phone: tenants.operationalPhone, email: tenants.replyToEmail, primary: tenants.primaryColor, secondary: tenants.secondaryColor, accent: tenants.accentColor }).from(tenants).where(eq(tenants.id, run.tenantId)).limit(1).then(rows => rows[0]),
    ]);
    if (!assignment || !business) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'Blueprint plan inputs are incomplete.');
    const assignmentCounts = await this.db.select({ staffId: staffServiceAssignments.staffUserId }).from(staffServiceAssignments).where(eq(staffServiceAssignments.tenantId, run.tenantId));
    const pagePlan = object(run.pagePlan);
    const requestedTypes = Array.isArray(pagePlan.requestedPageTypes)
      ? pagePlan.requestedPageTypes.flatMap(value => SitePageTypeSchema.safeParse(value).success ? [value as SitePageType] : [])
      : [];
    const request = BlueprintGenerationRequestSchema.parse({
      templateVersionReference: run.templateVersionReference,
      name: `${business.name} provisioned architecture`,
      preferences: {
        prioritisedServiceReferences: serviceRows.map(row => row.reference),
        prioritisedLocationReferences: locationRows.map(row => row.reference),
        prioritisedStaffReferences: staffRows.map(row => row.reference),
        preferredLayoutReferences: object(pagePlan.preferredLayoutReferences),
        includePageTypes: requestedTypes,
      },
    });
    const limit = Number(object(entitlement?.value).limit);
    const plan = generateBlueprintPlan({
      tenantReference: run.tenantReference,
      siteReference: run.siteReference,
      planKey: run.planKey as 'CORE' | 'GROWTH' | 'SCALE',
      planAssignmentReference: assignment.id,
      marketingPageLimit: Number.isInteger(limit) ? limit : 0,
      entitlementOverrideApplied: false,
      template: {
        reference: run.templateVersionReference,
        status: 'APPROVED',
        sourceType: run.templateSourceType as 'ENVATO_HTML' | 'GOOGLE_STITCH' | 'INTERNAL',
        licensedForSite: true,
        layouts: layouts.map(layout => ({
          reference: layout.reference,
          templateVersionReference: run.templateVersionReference,
          approved: layout.status === 'APPROVED',
          enabled: !layout.disabledAt,
          approvedPageTypes: pageTypes.filter(item => item.layoutId === layout.id && item.approvedAt)
            .flatMap(item => SitePageTypeSchema.safeParse(item.pageType).success ? [item.pageType as SitePageType] : []),
        })),
      },
      services: serviceRows.map(service => ({ reference: service.reference, tenantReference: run.tenantReference, name: service.name, description: service.description, durationMinutes: service.duration, priceMinor: service.price, active: service.active, bookingEligible: service.active, updatedAt: service.updatedAt.toISOString() })),
      locations: locationRows.map(location => ({ reference: location.reference, tenantReference: run.tenantReference, name: location.name, active: location.active, primary: location.primary, addressComplete: Boolean(location.address && location.postcode), openingHoursComplete: true, telephonePresent: Boolean(location.phone), updatedAt: location.updatedAt.toISOString() })),
      staff: staffRows.map(staff => ({ reference: staff.reference, tenantReference: run.tenantReference, name: staff.name, active: staff.active === 'ACTIVE', bookingEnabled: staff.bookingEnabled, publicProfileAllowed: true, biographyPresent: Boolean(staff.bio), rolePresent: Boolean(staff.role), imagePresent: Boolean(staff.image), serviceAssignmentCount: assignmentCounts.filter(item => item.staffId === staff.id).length, updatedAt: staff.updatedAt.toISOString() })),
      business: { name: business.name, businessType: business.businessType, profileComplete: Boolean(business.name && business.businessType), contactComplete: Boolean(business.phone || business.email), brandComplete: Boolean(business.primary && business.secondary && business.accent), approvedResultsAssetCount: 0 },
      existingCanonicalPaths: [],
      request,
    });
    const layoutIds = new Map(layouts.map(layout => [layout.reference, layout.id]));
    const serviceIds = new Map(serviceRows.map(service => [service.reference, service.id]));
    const locationIds = new Map(locationRows.map(location => [location.reference, location.id]));
    const staffIds = new Map(staffRows.map(staff => [staff.reference, staff]));
    const [blueprint] = await this.db.insert(siteBlueprints).values({
      tenantId: run.tenantId, siteId: run.siteId, templateVersionId: run.templateVersionId,
      planAssignmentId: assignment.id, provisioningRunId: run.runId, name: request.name!, status: 'REVIEW_REQUIRED',
      revision: 1, sourceDataDigest: plan.sourceDataDigest, engineVersion: plan.engineVersion,
      proposedMarketingPageCount: plan.entitlementUsage.proposedMarketingPageCount,
      entitlementMarketingPageLimit: plan.entitlementUsage.marketingPageLimit,
      functionalPageCount: plan.entitlementUsage.functionalPageCount,
      requiredLegalPageCount: plan.entitlementUsage.requiredLegalPageCount,
      unusedMarketingPageAllowance: plan.entitlementUsage.unusedMarketingPageAllowance,
      entitlementOverrideApplied: plan.entitlementUsage.overrideApplied,
      readinessJson: plan.readiness, generatedAt: new Date(), generatedByAgencyUserId: run.requestedByAgencyUserId,
    }).returning({ id: siteBlueprints.id, reference: siteBlueprints.publicReference });
    const insertedPages = await this.db.insert(siteBlueprintPages).values(plan.pages.map((page, index) => ({
      tenantId: run.tenantId, blueprintId: blueprint.id, pageType: page.pageType,
      conversionRole: page.conversionRole, entitlementKind: page.entitlementKind, allocation: 'INITIAL',
      title: page.titleLabel, proposedSlug: page.plannedSlug,
      templateLayoutId: page.layoutReference ? layoutIds.get(page.layoutReference) || null : null,
      serviceId: page.serviceReference ? serviceIds.get(page.serviceReference) || null : null,
      locationId: page.locationReference ? locationIds.get(page.locationReference) || null : null,
      staffUserId: page.staffReference ? staffIds.get(page.staffReference)?.id || null : null,
      navigationGroup: page.navigationGroup, navigationOrder: page.navigationOrder,
      consumesMarketingEntitlement: page.consumesMarketingEntitlement, generationPriority: page.generationPriority,
      selectionScore: page.selectionScore, selectionReasonsJson: page.selectionReasons,
      bookingRequirementsJson: page.bookingRequirements, layoutSelectionReason: page.layoutSelectionReason,
      agencyNotes: page.agencyNotes || null, sortOrder: index,
      rationale: page.selectionReasons.join(', ').slice(0, 1000),
    }))).returning({ id: siteBlueprintPages.id });
    if (plan.actionItems.length) await this.db.insert(siteBlueprintActionItems).values(plan.actionItems.map(item => ({
      tenantId: run.tenantId, blueprintId: blueprint.id,
      category: item.category, severity: item.severity, code: item.code, message: item.message,
      subjectPublicReference: item.subjectReference, safeMetadataJson: item.safeMetadata,
    })));
    await this.db.update(provisioningRuns).set({ blueprintId: blueprint.id, updatedAt: new Date() }).where(eq(provisioningRuns.id, run.runId));
    if (!insertedPages.length) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The generated blueprint contains no pages.');
    return [{ type: 'SITE_BLUEPRINT', reference: blueprint.reference }];
  }

  private async approveBlueprint(run: ProvisioningContext): Promise<LinkedRecord[]> {
    const [blueprint] = await this.db.select({ id: siteBlueprints.id, reference: siteBlueprints.publicReference, status: siteBlueprints.status, readiness: siteBlueprints.readinessJson })
      .from(siteBlueprints).where(eq(siteBlueprints.provisioningRunId, run.runId)).limit(1);
    if (!blueprint) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The provisioning blueprint is missing.');
    if (blueprint.status !== 'APPROVED') {
      const [blocking] = await this.db.select({ id: siteBlueprintActionItems.id }).from(siteBlueprintActionItems).where(and(
        eq(siteBlueprintActionItems.blueprintId, blueprint.id), eq(siteBlueprintActionItems.status, 'OPEN'), eq(siteBlueprintActionItems.severity, 'BLOCKING'),
      )).limit(1);
      if (blocking) throw new SiteJobExecutionError('TERMINAL_VALIDATION_FAILURE', 'Blocking blueprint findings prevent automatic approval.');
      await this.db.update(siteBlueprints).set({
        status: 'APPROVED', approvedByAgencyUserId: run.requestedByAgencyUserId,
        approvedAt: new Date(), updatedAt: new Date(),
      }).where(eq(siteBlueprints.id, blueprint.id));
      await this.db.insert(platformAuditEvents).values({
        agencyUserId: run.requestedByAgencyUserId, tenantId: run.tenantId,
        action: 'SITE_BLUEPRINT_APPROVED', targetType: 'SITE_BLUEPRINT', targetId: blueprint.reference,
        eventCategory: 'WEBSITE', sourceComponent: 'site-worker',
        description: 'The validated provisioning blueprint was approved through the controlled provisioning workflow.',
        metadata: { provisioningRunReference: run.runReference },
      });
    }
    return [{ type: 'SITE_BLUEPRINT', reference: blueprint.reference }];
  }

  private async queueGeneration(run: ProvisioningContext, _facts: ApprovedFact[]): Promise<LinkedRecord[]> {
    const [blueprint] = await this.db.select({ id: siteBlueprints.id, reference: siteBlueprints.publicReference, revision: siteBlueprints.revision, status: siteBlueprints.status })
      .from(siteBlueprints).where(eq(siteBlueprints.provisioningRunId, run.runId)).limit(1);
    if (!blueprint || blueprint.status !== 'APPROVED') throw new SiteJobExecutionError('TERMINAL_PERMISSION_FAILURE', 'An approved pinned blueprint is required.');
    if (!this.generation.enabled || !this.generation.apiKey || !this.generation.model) {
      await this.db.transaction(async tx => {
        await tx.update(provisioningRunSteps).set({ status: 'ACTION_REQUIRED', safeMessage: 'Configure the server-side structured generation provider, then retry.', updatedAt: new Date() })
          .where(and(eq(provisioningRunSteps.provisioningRunId, run.runId), eq(provisioningRunSteps.stepKey, 'GENERATE_SITE')));
        await tx.update(provisioningRuns).set({ status: 'ACTION_REQUIRED', failureCode: 'GENERATION_PROVIDER_CONFIGURATION_REQUIRED', failureMessage: 'Structured generation requires server-side provider configuration.', retryable: true, updatedAt: new Date() })
          .where(eq(provisioningRuns.id, run.runId));
      });
      return [{ type: 'SITE_BLUEPRINT', reference: blueprint.reference }];
    }
    const packs = await this.db.select({ id: knowledgePacks.id, reference: knowledgePacks.publicReference, semanticVersion: knowledgePacks.semanticVersion })
      .from(knowledgePacks).where(and(eq(knowledgePacks.status, 'ACTIVE'), eq(knowledgePacks.intendedScope, 'PUBLIC_SITE')));
    if (packs.length !== 1) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'Exactly one ACTIVE PUBLIC_SITE knowledge pack is required.');
    const [existing] = await this.db.select({ id: siteGenerationRuns.id, reference: siteGenerationRuns.publicReference })
      .from(siteGenerationRuns).where(eq(siteGenerationRuns.provisioningRunId, run.runId)).limit(1);
    if (existing) return [{ type: 'SITE_GENERATION_RUN', reference: existing.reference }];
    const [business, serviceRows, locationRows, staffRows] = await Promise.all([
      this.db.select({ reference: tenants.businessReference, name: tenants.name, legalName: tenants.legalBusinessName, businessType: tenants.businessType, phone: tenants.operationalPhone, email: tenants.replyToEmail, primaryColour: tenants.primaryColor, secondaryColour: tenants.secondaryColor, accentColour: tenants.accentColor }).from(tenants).where(eq(tenants.id, run.tenantId)).limit(1).then(rows => rows[0]),
      this.db.select({ reference: services.publicReference, name: services.name, description: services.description, duration: services.duration, price: services.price }).from(services).where(and(eq(services.tenantId, run.tenantId), eq(services.isActive, true))),
      this.db.select({ reference: locations.publicReference, name: locations.name, address: locations.address, postcode: locations.postcode, phone: locations.phone }).from(locations).where(and(eq(locations.tenantId, run.tenantId), eq(locations.isActive, true))),
      this.db.select({ reference: users.publicReference, name: users.name, jobTitle: users.jobTitle, biography: users.bio, bookingEnabled: users.bookingEnabled }).from(users).where(and(eq(users.tenantId, run.tenantId), eq(users.accountStatus, 'ACTIVE'))),
    ]);
    if (!business) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'The canonical business profile is missing.');
    const sourceDataDigestSha256 = generationDigest(buildVerifiedBusinessFacts({ business, services: serviceRows, locations: locationRows, staff: staffRows, assetReferences: [] }));
    const idempotencyKey = generationIdempotencyKey({
      tenantReference: run.tenantReference, siteReference: run.siteReference,
      blueprintReference: blueprint.reference, blueprintRevision: blueprint.revision,
      templateVersionReference: run.templateVersionReference, knowledgePackReference: packs[0].reference,
      knowledgePackSemanticVersion: packs[0].semanticVersion, verifiedBusinessDataDigestSha256: sourceDataDigestSha256,
      generatorVersion: this.generation.generatorVersion, generationReason: 'INITIAL_SITE',
    });
    await this.db.transaction(async tx => {
      const [latest] = await tx.select({ value: max(siteVersions.versionNumber) }).from(siteVersions).where(eq(siteVersions.siteId, run.siteId));
      const [version] = await tx.insert(siteVersions).values({
        tenantId: run.tenantId, siteId: run.siteId, versionNumber: Number(latest?.value || 0) + 1,
        status: 'DRAFT', changeSummary: 'Structured generation from the locked provisioning brief.',
        generationStatus: 'INCOMPLETE', createdByAgencyUserId: run.requestedByAgencyUserId,
      }).returning({ id: siteVersions.id, reference: siteVersions.publicReference });
      const [generationRun] = await tx.insert(siteGenerationRuns).values({
        tenantId: run.tenantId, siteId: run.siteId, siteVersionId: version.id,
        blueprintId: blueprint.id, blueprintRevision: blueprint.revision, templateVersionId: run.templateVersionId,
        knowledgePackId: packs[0].id, knowledgePackSemanticVersion: packs[0].semanticVersion,
        provisioningRunId: run.runId, generationReason: 'INITIAL_SITE', generatorVersion: this.generation.generatorVersion,
        providerKey: 'gemini', modelKey: this.generation.model!, idempotencyKey,
        sourceDataDigestSha256, promptTemplateVersion: SITE_GENERATION_PROMPT_TEMPLATE_VERSION,
        pageCountPlanned: (await tx.select({ id: siteBlueprintPages.id }).from(siteBlueprintPages).where(eq(siteBlueprintPages.blueprintId, blueprint.id))).length,
        requestedByAgencyUserId: run.requestedByAgencyUserId,
      }).returning({ id: siteGenerationRuns.id, reference: siteGenerationRuns.publicReference });
      const payload = GenerateSitePayloadSchema.parse({
        jobType: 'GENERATE_SITE', siteReference: run.siteReference, blueprintReference: blueprint.reference,
        knowledgePackReference: packs[0].reference, requestedByAgencyUserReference: run.requestedByAgencyUserReference,
        generationReason: 'INITIAL_SITE',
      });
      const [job] = await tx.insert(siteJobs).values({
        tenantId: run.tenantId, siteId: run.siteId, versionId: version.id, blueprintId: blueprint.id,
        jobType: 'GENERATE_SITE', status: 'PENDING', idempotencyKey: `generation:${idempotencyKey}`,
        sourceReference: generationRun.reference, sourceDigestSha256: sourceDataDigestSha256,
        payloadJson: payload, payloadSchemaVersion: 1, priority: 30, maxAttempts: 5,
        createdByAgencyUserId: run.requestedByAgencyUserId,
      }).returning({ id: siteJobs.id, reference: siteJobs.publicReference });
      await tx.update(siteGenerationRuns).set({ siteJobId: job.id }).where(eq(siteGenerationRuns.id, generationRun.id));
      await tx.update(siteVersions).set({ generationRunId: generationRun.id }).where(eq(siteVersions.id, version.id));
      await tx.update(provisioningRuns).set({ generationRunId: generationRun.id, status: 'GENERATING_SITE', currentStep: 'GENERATE_SITE', updatedAt: new Date() }).where(eq(provisioningRuns.id, run.runId));
      await tx.insert(siteJobEvents).values({ jobId: job.id, tenantId: run.tenantId, eventType: 'JOB_CREATED', statusTo: 'PENDING', createdByAgencyUserId: run.requestedByAgencyUserId, safeMessage: 'Structured site generation was queued by workspace provisioning.' });
      await tx.insert(platformAuditEvents).values({
        agencyUserId: run.requestedByAgencyUserId, tenantId: run.tenantId,
        action: 'SITE_GENERATION_REQUESTED', targetType: 'SITE_GENERATION_RUN', targetId: generationRun.reference,
        eventCategory: 'WEBSITE', sourceComponent: 'site-worker',
        description: 'Locked-brief workspace provisioning queued structured site generation.',
        metadata: { provisioningRunReference: run.runReference, siteReference: run.siteReference },
      });
    });
    const [created] = await this.db.select({ reference: siteGenerationRuns.publicReference }).from(siteGenerationRuns)
      .where(eq(siteGenerationRuns.provisioningRunId, run.runId)).limit(1);
    return created ? [{ type: 'SITE_GENERATION_RUN', reference: created.reference }] : [];
  }
}
