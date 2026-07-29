import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq, getDatabase, sql } from '@ks-os/database';
import {
  agencyUsers,
  bookingPages,
  platformAuditEvents,
  provisioningActivity,
  provisioningDrafts,
  provisioningRuns,
  provisioningRunSteps,
  services,
  siteBlueprints,
  siteGenerationFindings,
  siteGenerationRuns,
  sitePages,
  siteReviewActivity,
  siteReviewCycles,
  siteReviewItems,
  siteReviewParticipants,
  siteReviewSessions,
  siteSections,
  sites,
  siteVersions,
  staffSchedules,
  staffServiceAssignments,
  locations,
  users,
} from '@ks-os/database';
import type { ProvisioningStepKey } from '@ks-os/workspace-provisioning';
import { applyProvisionedNativeDesign } from './native-design-finalization.js';

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function completeStep(
  tx: Transaction,
  context: { provisioningRunId: string; tenantId: string },
  step: ProvisioningStepKey,
  outputs: string[],
  message: string,
) {
  await tx.update(provisioningRunSteps).set({
    status: 'COMPLETED',
    outputReferencesJson: outputs,
    safeMessage: message,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(provisioningRunSteps.provisioningRunId, context.provisioningRunId),
    eq(provisioningRunSteps.stepKey, step),
  ));
  await tx.insert(provisioningActivity).values({
    provisioningRunId: context.provisioningRunId,
    tenantId: context.tenantId,
    eventType: 'PROVISIONING_STEP_COMPLETED',
    stepKey: step,
    safeMessage: message,
  });
}

function invalidBookingAction(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(invalidBookingAction);
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (typeof row.type === 'string') {
    if (['EXTERNAL_BOOKING', 'EXTERNAL_URL'].includes(row.type)) return true;
    if (row.type === 'KS_OS_BOOKING' && ('url' in row || 'href' in row)) return true;
  }
  return Object.values(row).some(invalidBookingAction);
}

export async function finalizeProvisionedWorkspace(database: Database, generationRunId: string) {
  const [context] = await database.select({
    provisioningRunId: provisioningRuns.id,
    provisioningRunReference: provisioningRuns.publicReference,
    provisioningDraftId: provisioningRuns.provisioningDraftId,
    pagePlan: provisioningDrafts.pagePlanJson,
    tenantId: provisioningRuns.tenantId,
    siteId: provisioningRuns.siteId,
    siteReference: sites.publicReference,
    versionId: siteGenerationRuns.siteVersionId,
    versionReference: siteVersions.publicReference,
    generationRunId: siteGenerationRuns.id,
    generationRunReference: siteGenerationRuns.publicReference,
    generationStatus: siteGenerationRuns.status,
    generationDigest: siteGenerationRuns.outputContentDigestSha256,
    blueprintId: siteGenerationRuns.blueprintId,
    blueprintReference: siteBlueprints.publicReference,
    blueprintRevision: siteGenerationRuns.blueprintRevision,
    templateVersionId: siteGenerationRuns.templateVersionId,
    knowledgePackId: siteGenerationRuns.knowledgePackId,
    knowledgePackSemanticVersion: siteGenerationRuns.knowledgePackSemanticVersion,
    agencyUserId: provisioningRuns.requestedByAgencyUserId,
    agencyUserReference: agencyUsers.publicReference,
    agencyDisplayName: agencyUsers.displayName,
    agencyEmail: agencyUsers.emailNormalized,
  }).from(siteGenerationRuns)
    .innerJoin(provisioningRuns, eq(siteGenerationRuns.provisioningRunId, provisioningRuns.id))
    .innerJoin(provisioningDrafts, eq(provisioningRuns.provisioningDraftId, provisioningDrafts.id))
    .innerJoin(sites, eq(siteGenerationRuns.siteId, sites.id))
    .innerJoin(siteVersions, eq(siteGenerationRuns.siteVersionId, siteVersions.id))
    .innerJoin(siteBlueprints, eq(siteGenerationRuns.blueprintId, siteBlueprints.id))
    .innerJoin(agencyUsers, eq(provisioningRuns.requestedByAgencyUserId, agencyUsers.id))
    .where(eq(siteGenerationRuns.id, generationRunId)).limit(1);
  if (!context || !context.versionId || !context.generationDigest) return null;
  if (context.generationStatus !== 'READY_FOR_REVIEW') return null;
  if (!context.siteId) return null;
  const versionId = context.versionId;
  const siteId = context.siteId;
  const generationDigest = context.generationDigest;

  return database.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`provisioning-finalize:${context.provisioningRunId}`}::text, 0))`);
    const [alreadyReady] = await tx.select({ status: provisioningRuns.status })
      .from(provisioningRuns).where(eq(provisioningRuns.id, context.provisioningRunId)).limit(1);
    if (alreadyReady?.status === 'READY') return { ready: true, idempotentReplay: true };

    await completeStep(tx, context, 'GENERATE_SITE', [context.generationRunReference], 'The structured site draft was generated and validated.');

    const [serviceRows, locationRows, staffRows, scheduleRows, assignmentRows, booking, actions] = await Promise.all([
      tx.select({ id: services.id }).from(services).where(and(eq(services.tenantId, context.tenantId), eq(services.isActive, true))),
      tx.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, context.tenantId), eq(locations.isActive, true))),
      tx.select({ id: users.id }).from(users).where(and(eq(users.tenantId, context.tenantId), eq(users.accountStatus, 'ACTIVE'), eq(users.bookingEnabled, true))),
      tx.select({ id: staffSchedules.id }).from(staffSchedules).where(eq(staffSchedules.tenantId, context.tenantId)),
      tx.select({ id: staffServiceAssignments.id }).from(staffServiceAssignments).where(and(eq(staffServiceAssignments.tenantId, context.tenantId), eq(staffServiceAssignments.isActive, true))),
      tx.select({ id: bookingPages.id, enabled: bookingPages.enabled }).from(bookingPages).where(eq(bookingPages.tenantId, context.tenantId)).limit(1),
      tx.select({ actions: siteSections.actionsJson }).from(siteSections).where(eq(siteSections.versionId, versionId)),
    ]);
    if (!serviceRows.length || !locationRows.length || !staffRows.length || !scheduleRows.length
      || !assignmentRows.length || !booking[0]?.enabled || actions.some(row => invalidBookingAction(row.actions))) {
      throw new Error('Native booking validation failed after structured site generation.');
    }
    await completeStep(tx, context, 'VALIDATE_NATIVE_BOOKING', [context.siteReference], 'Canonical native booking records and structured booking actions were validated.');

    const nativeDesign = await applyProvisionedNativeDesign(tx, {
      tenantId: context.tenantId,
      siteId,
      siteReference: context.siteReference,
      versionId,
      agencyUserId: context.agencyUserId,
      pagePlan: context.pagePlan,
    });
    const reviewDigest = nativeDesign?.contentDigest ?? generationDigest;

    let [cycle] = await tx.select({ id: siteReviewCycles.id, reference: siteReviewCycles.publicReference })
      .from(siteReviewCycles).where(eq(siteReviewCycles.provisioningRunId, context.provisioningRunId)).limit(1);
    if (!cycle) {
      [cycle] = await tx.insert(siteReviewCycles).values({
        tenantId: context.tenantId,
        siteId,
        siteVersionId: versionId,
        generationRunId: context.generationRunId,
        blueprintId: context.blueprintId,
        blueprintRevision: context.blueprintRevision,
        templateVersionId: context.templateVersionId,
        knowledgePackId: context.knowledgePackId,
        knowledgePackSemanticVersion: context.knowledgePackSemanticVersion,
        provisioningRunId: context.provisioningRunId,
        pinnedContentDigestSha256: reviewDigest,
        status: 'INTERNAL_REVIEW',
        reviewScope: 'FULL_SITE',
        reviewRevision: 1,
        agencyOwnerUserId: context.agencyUserId,
        clientApprovalRequired: true,
        agencyApprovalRequired: true,
        openedAt: new Date(),
        createdByAgencyUserId: context.agencyUserId,
      }).returning({ id: siteReviewCycles.id, reference: siteReviewCycles.publicReference });
    }
    let [participant] = await tx.select({ id: siteReviewParticipants.id, reference: siteReviewParticipants.publicReference })
      .from(siteReviewParticipants).where(and(
        eq(siteReviewParticipants.reviewCycleId, cycle.id),
        eq(siteReviewParticipants.agencyUserId, context.agencyUserId),
      )).limit(1);
    if (!participant) {
      [participant] = await tx.insert(siteReviewParticipants).values({
        reviewCycleId: cycle.id,
        participantType: 'AGENCY_USER',
        agencyUserId: context.agencyUserId,
        displayName: context.agencyDisplayName,
        emailNormalized: context.agencyEmail,
        role: 'AGENCY_REVIEWER',
        status: 'ACTIVE',
        acceptedAt: new Date(),
      }).returning({ id: siteReviewParticipants.id, reference: siteReviewParticipants.publicReference });
    }
    const existingItems = await tx.select({ id: siteReviewItems.id }).from(siteReviewItems)
      .where(eq(siteReviewItems.reviewCycleId, cycle.id)).limit(1);
    if (!existingItems.length) {
      const [pages, sections, findings] = await Promise.all([
        tx.select({ id: sitePages.id, sortOrder: sitePages.sortOrder }).from(sitePages)
          .where(eq(sitePages.versionId, versionId)).orderBy(asc(sitePages.sortOrder)),
        tx.select({ id: siteSections.id, pageId: siteSections.pageId, sortOrder: siteSections.sortOrder }).from(siteSections)
          .where(eq(siteSections.versionId, versionId)).orderBy(asc(siteSections.sortOrder)),
        tx.select({ id: siteGenerationFindings.id, severity: siteGenerationFindings.severity }).from(siteGenerationFindings)
          .where(and(eq(siteGenerationFindings.generationRunId, context.generationRunId), eq(siteGenerationFindings.current, true))),
      ]);
      if (pages.length) await tx.insert(siteReviewItems).values(pages.map(page => ({
        reviewCycleId: cycle.id, targetType: 'PAGE', pageId: page.id, status: 'PENDING',
        requiredReviewerType: 'AGENCY', displayOrder: page.sortOrder,
      })));
      if (sections.length) await tx.insert(siteReviewItems).values(sections.map((section, index) => ({
        reviewCycleId: cycle.id, targetType: 'SECTION', pageId: section.pageId, sectionId: section.id,
        status: 'PENDING', requiredReviewerType: 'AGENCY', displayOrder: 10_000 + (section.sortOrder * 100) + index,
      })));
      if (findings.length) await tx.insert(siteReviewItems).values(findings.map((finding, index) => ({
        reviewCycleId: cycle.id, targetType: 'GENERATION_FINDING', generationFindingId: finding.id,
        status: 'PENDING', requiredReviewerType: 'AGENCY', blocking: finding.severity === 'ERROR',
        clientVisible: false, displayOrder: 100_000 + index,
      })));
    }
    await tx.insert(siteReviewActivity).values({
      reviewCycleId: cycle.id,
      eventType: 'SITE_REVIEW_CYCLE_CREATED',
      actorType: 'SYSTEM',
      targetType: 'SITE_REVIEW_CYCLE',
      targetPublicReference: cycle.reference,
      safeMetadataJson: {
        provisioningRunReference: context.provisioningRunReference,
        nativeDesignPreset: nativeDesign?.presetKey ?? null,
      },
    });
    await completeStep(tx, context, 'CREATE_INTERNAL_REVIEW', [cycle.reference], 'An internal agency review cycle was created for the generated and styled draft.');

    let [session] = await tx.select({ id: siteReviewSessions.id, reference: siteReviewSessions.publicReference })
      .from(siteReviewSessions).where(and(
        eq(siteReviewSessions.reviewCycleId, cycle.id),
        eq(siteReviewSessions.participantId, participant.id),
        eq(siteReviewSessions.purpose, 'INTERNAL_PREVIEW'),
      )).limit(1);
    if (!session) {
      const raw = randomBytes(32).toString('base64url');
      [session] = await tx.insert(siteReviewSessions).values({
        reviewCycleId: cycle.id,
        participantId: participant.id,
        siteId,
        siteVersionId: versionId,
        tokenDigestSha256: createHash('sha256').update(raw).digest('hex'),
        previewTokenJti: randomUUID(),
        purpose: 'INTERNAL_PREVIEW',
        allowedScope: 'AGENCY_INTERNAL',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
      }).returning({ id: siteReviewSessions.id, reference: siteReviewSessions.publicReference });
    }
    await completeStep(tx, context, 'CREATE_PREVIEW', [session.reference], 'A private agency preview session was created; no raw token was stored.');

    await tx.update(provisioningRuns).set({
      reviewCycleId: cycle.id,
      previewSessionId: session.id,
      status: 'READY',
      currentStep: 'MARK_READY',
      completionPercentage: 100,
      failureCode: null,
      failureMessage: null,
      retryable: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(provisioningRuns.id, context.provisioningRunId));
    await tx.update(provisioningDrafts).set({ status: 'COMPLETED', updatedAt: new Date() })
      .where(eq(provisioningDrafts.id, context.provisioningDraftId));
    await tx.update(sites).set({ status: 'INTERNAL_REVIEW', updatedAt: new Date() })
      .where(eq(sites.id, siteId));
    await tx.update(siteVersions).set({ status: 'INTERNAL_REVIEW', updatedAt: new Date() })
      .where(eq(siteVersions.id, versionId));
    await completeStep(tx, context, 'MARK_READY', [context.siteReference], 'The provisioned workspace and native-designed website draft are ready for internal agency review.');

    await tx.insert(platformAuditEvents).values({
      agencyUserId: context.agencyUserId,
      tenantId: context.tenantId,
      action: 'WORKSPACE_PROVISIONING_COMPLETED',
      targetType: 'PROVISIONING_RUN',
      targetId: context.provisioningRunReference,
      eventCategory: 'ADMINISTRATION',
      sourceComponent: 'site-worker',
      description: 'The locked-brief workspace provisioning workflow completed and entered internal review.',
      metadata: {
        siteReference: context.siteReference,
        generationRunReference: context.generationRunReference,
        reviewReference: cycle.reference,
        nativeDesignPreset: nativeDesign?.presetKey ?? null,
        published: false,
      },
    });
    await completeStep(tx, context, 'RECORD_AUDIT', [context.provisioningRunReference], 'The provisioning completion audit event was recorded.');
    return { ready: true, idempotentReplay: false, reviewReference: cycle.reference, previewSessionReference: session.reference };
  });
}

export async function failProvisionedWorkspace(
  database: Database,
  generationRunId: string,
  failure: { code: string; message: string },
) {
  const [context] = await database.select({
    provisioningRunId: provisioningRuns.id,
    provisioningRunReference: provisioningRuns.publicReference,
    tenantId: provisioningRuns.tenantId,
    agencyUserId: provisioningRuns.requestedByAgencyUserId,
  }).from(siteGenerationRuns)
    .innerJoin(provisioningRuns, eq(siteGenerationRuns.provisioningRunId, provisioningRuns.id))
    .where(eq(siteGenerationRuns.id, generationRunId)).limit(1);
  if (!context) return;
  await database.transaction(async tx => {
    await tx.update(provisioningRunSteps).set({
      status: 'FAILED', failureCode: failure.code.slice(0, 100), safeMessage: failure.message.slice(0, 500),
      completedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(provisioningRunSteps.provisioningRunId, context.provisioningRunId), eq(provisioningRunSteps.stepKey, 'GENERATE_SITE')));
    await tx.update(provisioningRuns).set({
      status: 'PARTIALLY_FAILED', currentStep: 'GENERATE_SITE', failureCode: failure.code.slice(0, 100),
      failureMessage: failure.message.slice(0, 500), retryable: true, failedAt: new Date(), updatedAt: new Date(),
    }).where(eq(provisioningRuns.id, context.provisioningRunId));
    await tx.insert(provisioningActivity).values({
      provisioningRunId: context.provisioningRunId, tenantId: context.tenantId,
      eventType: 'SITE_GENERATION_FAILED', statusTo: 'PARTIALLY_FAILED', stepKey: 'GENERATE_SITE',
      safeMessage: failure.message.slice(0, 500),
    });
    await tx.insert(platformAuditEvents).values({
      agencyUserId: context.agencyUserId,
      tenantId: context.tenantId,
      action: 'WORKSPACE_PROVISIONING_FAILED',
      targetType: 'PROVISIONING_RUN',
      targetId: context.provisioningRunReference,
      eventCategory: 'ADMINISTRATION',
      sourceComponent: 'site-worker',
      description: 'Structured site generation failed during workspace provisioning; the workspace was not marked ready.',
      metadata: { step: 'GENERATE_SITE', failureCode: failure.code.slice(0, 100), retryable: true },
    });
  });
}