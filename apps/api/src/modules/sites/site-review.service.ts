import { createHash, randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  getDatabase,
  inArray,
  isNull,
  max,
  or,
} from '@ks-os/database';
import {
  agencyUsers,
  emailOutbox,
  knowledgePacks,
  locations,
  services,
  siteApprovalDecisions,
  siteApprovals,
  siteChangeRequestEvents,
  siteChangeRequests,
  siteFactVerifications,
  siteGenerationClaims,
  siteGenerationFindings,
  siteGenerationRuns,
  siteJobs,
  sitePages,
  siteRenderSnapshots,
  siteReviewActivity,
  siteReviewComments,
  siteReviewCycles,
  siteReviewInvitations,
  siteReviewItems,
  siteReviewParticipants,
  siteReviewSessions,
  siteSections,
  siteVersions,
  sites,
  templateVersions,
  tenants,
  users,
} from '@ks-os/database';
import {
  AddReviewParticipantSchema,
  AgencyFactDecisionSchema,
  BoundedRegenerationReasonSchema,
  CreateApprovalDecisionSchema,
  CreateChangeRequestSchema,
  CreateCommentSchema,
  CreateReviewCycleSchema,
  FactResponseSchema,
  ResolveChangeRequestSchema,
  ReviewCycleStatusSchema,
  ReviewTransitionActionSchema,
  UpdateChangeRequestSchema,
  UpdateCommentSchema,
  assertParticipantCan,
  assertReadyForApproval,
  assertReviewTransition,
  assertSafeChangeRequest,
  compareStructuredSiteVersions,
  deriveReviewInvitationToken,
  digestReviewToken,
  evaluateReviewReadiness,
  issueReviewToken,
  participantCan,
  reviewTransitionTarget,
  signSitePreviewToken,
  summarizeReviewProgress,
  toClientSafeValue,
  type ReviewCycleStatus,
  type ReviewParticipantRole,
} from '@ks-os/site-review';
import {
  validatePublishedSnapshot,
  type PublishedSiteSnapshot,
} from '@ks-os/site-schema';
import type { z } from 'zod';
import {
  AgencyAuditService,
  type AgencyActor,
} from '../agency/agency.service.js';
import { EmailService } from '../email/email.service.js';
import { AgencySiteGenerationService } from './site-generation.service.js';

type FullDatabase = ReturnType<typeof getDatabase>;
type Database = Omit<FullDatabase, '$client'>;
type CreateCycleInput = z.infer<typeof CreateReviewCycleSchema>;
type AddParticipantInput = z.infer<typeof AddReviewParticipantSchema>;
type CreateCommentInput = z.infer<typeof CreateCommentSchema>;
type CreateChangeRequestInput = z.infer<typeof CreateChangeRequestSchema>;
type UpdateChangeRequestInput = z.infer<typeof UpdateChangeRequestSchema>;
type ResolveChangeRequestInput = z.infer<typeof ResolveChangeRequestSchema>;
type AgencyFactDecision = z.infer<typeof AgencyFactDecisionSchema>;
type ApprovalDecisionInput = z.infer<typeof CreateApprovalDecisionSchema>;
interface ApprovalLifecycleTransition {
  targetStatus: ReviewCycleStatus;
  eventType: string;
  reason?: string;
  notifyParticipants: boolean;
}

const ACTIVE_CYCLE_STATUSES: ReviewCycleStatus[] = [
  'DRAFT',
  'INTERNAL_REVIEW',
  'INTERNAL_CHANGES_REQUIRED',
  'READY_FOR_CLIENT_REVIEW',
  'CLIENT_REVIEW',
  'CLIENT_CHANGES_REQUESTED',
  'CLIENT_APPROVED',
  'AGENCY_FINAL_REVIEW',
];
const CLIENT_ACCESS_STATUSES: ReviewCycleStatus[] = [
  'CLIENT_REVIEW',
  'CLIENT_CHANGES_REQUESTED',
  'CLIENT_APPROVED',
  'AGENCY_FINAL_REVIEW',
];
const OPEN_CHANGE_STATUSES = [
  'SUBMITTED',
  'OPEN',
  'TRIAGED',
  'ACCEPTED',
  'IN_PROGRESS',
  'READY_FOR_REVIEW',
] as const;

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

const normalizedEmail = (value: string) => value.trim().toLowerCase();
const digestValue = (value: unknown) => createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex');

function safePolicyError(error: unknown): never {
  if (error instanceof Error && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    if (code.startsWith('SITE_REVIEW_PARTICIPANT_FORBIDDEN')) {
      throw fail(403, code, error.message);
    }
    throw fail(409, code, error.message);
  }
  throw error;
}

function publicCycle(row: {
  publicReference: string;
  siteReference: string;
  versionReference: string;
  status: string;
  reviewScope: string;
  reviewRevision: number;
  pinnedContentDigestSha256: string;
  clientApprovalRequired: boolean;
  agencyApprovalRequired: boolean;
  openedAt: Date | null;
  clientReviewStartedAt: Date | null;
  clientApprovedAt: Date | null;
  agencyApprovedAt: Date | null;
  rejectedAt: Date | null;
  cancelledAt: Date | null;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    reference: row.publicReference,
    siteReference: row.siteReference,
    versionReference: row.versionReference,
    status: row.status,
    reviewScope: row.reviewScope,
    reviewRevision: row.reviewRevision,
    contentDigestSha256: row.pinnedContentDigestSha256,
    clientApprovalRequired: row.clientApprovalRequired,
    agencyApprovalRequired: row.agencyApprovalRequired,
    openedAt: row.openedAt,
    clientReviewStartedAt: row.clientReviewStartedAt,
    clientApprovedAt: row.clientApprovedAt,
    agencyApprovedAt: row.agencyApprovedAt,
    rejectedAt: row.rejectedAt,
    cancelledAt: row.cancelledAt,
    supersededAt: row.supersededAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function actionObjects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}

function hasExternalBookingAction(actions: unknown): boolean {
  return actionObjects(actions).some((action) =>
    ['EXTERNAL_BOOKING', 'EXTERNAL_URL'].includes(String(action.type))
    || (
      typeof action.url === 'string'
      && /(calendly|fresha|treatwell|booksy|mindbody)/i.test(action.url)
    ));
}

function invalidNativeBookingActionCount(actions: unknown): number {
  return actionObjects(actions).filter((action) =>
    action.type === 'KS_OS_BOOKING'
    && (
      typeof action.label !== 'string'
      || action.label.trim().length === 0
      || 'url' in action
      || 'href' in action
    )).length;
}

function collectTypedObjects(value: unknown, output: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectTypedObjects(child, output);
  } else if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (typeof object.type === 'string') output.push(object);
    for (const child of Object.values(object)) collectTypedObjects(child, output);
  }
  return output;
}

function collectAssetReferences(value: unknown, output = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const child of value) collectAssetReferences(child, output);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/assetReferences?$/i.test(key)) {
        if (typeof child === 'string') output.add(child);
        if (Array.isArray(child)) {
          for (const reference of child) {
            if (typeof reference === 'string') output.add(reference);
          }
        }
      }
      collectAssetReferences(child, output);
    }
  }
  return [...output].sort();
}

function comparableSnapshot(
  snapshot: PublishedSiteSnapshot,
  facts: Array<{
    matchKey: string;
    publicReference: string;
    factType: string;
    value: unknown;
  }> = [],
) {
  return {
    tenantReference: snapshot.booking.tenantReference,
    siteReference: snapshot.siteReference,
    versionReference: snapshot.versionReference,
    pages: snapshot.pages.map((page, pageIndex) => {
      const typedObjects = collectTypedObjects(page.sections);
      const navigation = {
        primary: snapshot.navigation.primary.flatMap((item, index) =>
          item.pageReference === page.publicReference
            ? [{ index, label: item.label, children: item.children }]
            : []),
        footer: snapshot.navigation.footer.flatMap((item, index) =>
          item.pageReference === page.publicReference
            ? [{ index, label: item.label, children: item.children }]
            : []),
      };
      return {
        publicReference: page.publicReference,
        slug: page.path,
        displayOrder: pageIndex,
        metadata: {
          title: page.title,
          pageType: page.pageType,
          conversionRole: page.conversionRole,
          seo: page.seo,
        },
        navigation,
        bookingAction: typedObjects.filter((item) => item.type === 'KS_OS_BOOKING'),
        internalLinks: typedObjects.filter((item) => item.type === 'INTERNAL_PAGE'),
        structuredDataInputs: [],
        assetReferences: collectAssetReferences(page.sections),
        sections: page.sections.map((section, sectionIndex) => ({
          publicReference: section.reference,
          sectionType: section.type,
          displayOrder: sectionIndex,
          content: section,
        })),
      };
    }),
    facts,
  };
}

export interface ClientReviewContext {
  sessionId: string;
  sessionReference: string;
  reviewCycleId: string;
  reviewCycleReference: string;
  reviewRevision: number;
  reviewStatus: ReviewCycleStatus;
  reviewScope: string;
  scopedPageId: string | null;
  scopedSectionId: string | null;
  participantId: string;
  participantReference: string;
  participantType: string;
  participantRole: ReviewParticipantRole;
  tenantId: string;
  siteId: string;
  siteReference: string;
  versionId: string;
  versionReference: string;
  contentDigestSha256: string;
  previewTokenJti: string;
  expiresAt: Date;
}

export class SiteReviewService {
  constructor(
    private readonly database: Database = getDatabase(),
    private readonly audit = new AgencyAuditService(),
    private readonly email = new EmailService(),
    private readonly generation = new AgencySiteGenerationService(
      database as unknown as FullDatabase,
      audit,
    ),
    private readonly environment:
      NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  ) {}

  private async cycleContext(siteReference: string, reviewReference: string) {
    const [row] = await this.database
      .select({
        id: siteReviewCycles.id,
        publicReference: siteReviewCycles.publicReference,
        tenantId: siteReviewCycles.tenantId,
        siteId: siteReviewCycles.siteId,
        siteReference: sites.publicReference,
        siteVersionId: siteReviewCycles.siteVersionId,
        versionReference: siteVersions.publicReference,
        versionStatus: siteVersions.status,
        versionGenerationStatus: siteVersions.generationStatus,
        generationRunId: siteReviewCycles.generationRunId,
        status: siteReviewCycles.status,
        reviewScope: siteReviewCycles.reviewScope,
        scopedPageId: siteReviewCycles.scopedPageId,
        scopedSectionId: siteReviewCycles.scopedSectionId,
        reviewRevision: siteReviewCycles.reviewRevision,
        pinnedContentDigestSha256: siteReviewCycles.pinnedContentDigestSha256,
        agencyOwnerUserId: siteReviewCycles.agencyOwnerUserId,
        clientApprovalRequired: siteReviewCycles.clientApprovalRequired,
        agencyApprovalRequired: siteReviewCycles.agencyApprovalRequired,
        openedAt: siteReviewCycles.openedAt,
        clientReviewStartedAt: siteReviewCycles.clientReviewStartedAt,
        clientApprovedAt: siteReviewCycles.clientApprovedAt,
        agencyApprovedAt: siteReviewCycles.agencyApprovedAt,
        rejectedAt: siteReviewCycles.rejectedAt,
        cancelledAt: siteReviewCycles.cancelledAt,
        supersededAt: siteReviewCycles.supersededAt,
        createdAt: siteReviewCycles.createdAt,
        updatedAt: siteReviewCycles.updatedAt,
      })
      .from(siteReviewCycles)
      .innerJoin(sites, eq(siteReviewCycles.siteId, sites.id))
      .innerJoin(siteVersions, eq(siteReviewCycles.siteVersionId, siteVersions.id))
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(siteReviewCycles.publicReference, reviewReference),
      ))
      .limit(1);
    if (!row) {
      throw fail(404, 'SITE_REVIEW_CYCLE_NOT_FOUND', 'Review cycle not found for this site.');
    }
    return {
      ...row,
      status: ReviewCycleStatusSchema.parse(row.status),
    };
  }

  private async activity(
    tx: Database,
    cycleId: string,
    eventType: string,
    targetType: string,
    targetReference: string | null,
    actor?: AgencyActor,
    participantId?: string,
    safeMetadata: Record<string, unknown> = {},
  ) {
    await tx.insert(siteReviewActivity).values({
      reviewCycleId: cycleId,
      eventType,
      actorType: actor
        ? 'AGENCY_USER'
        : participantId
          ? String(safeMetadata.participantType ?? 'EXTERNAL_REVIEWER')
          : 'SYSTEM',
      agencyUserId: actor?.agencyUserId,
      participantId,
      targetType,
      targetPublicReference: targetReference,
      safeMetadataJson: safeMetadata,
    });
  }

  private async notifyParticipants(
    tx: Database,
    cycle: Awaited<ReturnType<SiteReviewService['cycleContext']>>,
    eventKey: string,
    heading: string,
    message: string,
    targetReference: string,
    excludedParticipantId?: string,
    includeReviewLink = true,
  ) {
    const recipients = await tx.select({
      id: siteReviewParticipants.id,
      reference: siteReviewParticipants.publicReference,
      displayName: siteReviewParticipants.displayName,
      email: siteReviewParticipants.emailNormalized,
    }).from(siteReviewParticipants).where(and(
      eq(siteReviewParticipants.reviewCycleId, cycle.id),
      inArray(siteReviewParticipants.status, ['ACTIVE', 'INVITED']),
    ));
    for (const recipient of recipients) {
      if (recipient.id === excludedParticipantId) continue;
      const [invitation] = await tx.select({
        id: siteReviewInvitations.id,
        reference: siteReviewInvitations.publicReference,
      }).from(siteReviewInvitations).where(and(
        eq(siteReviewInvitations.reviewCycleId, cycle.id),
        eq(siteReviewInvitations.participantId, recipient.id),
        eq(siteReviewInvitations.reviewRevision, cycle.reviewRevision),
        inArray(siteReviewInvitations.status, ['QUEUED', 'SENT', 'OPENED', 'ACCEPTED']),
      )).orderBy(desc(siteReviewInvitations.createdAt)).limit(1);
      const linkedInvitation = includeReviewLink ? invitation : undefined;
      await this.email.enqueueEmail({
        tenantId: cycle.tenantId,
        recipientEmail: recipient.email,
        recipientName: recipient.displayName,
        templateKey: 'site-review-notification',
        templateVersion: '1.0.0',
        templateDataJson: {
          tenantName: 'Your website team',
          participantName: recipient.displayName,
          heading,
          message,
          siteReference: cycle.siteReference,
          reviewReference: cycle.publicReference,
          reviewRevision: cycle.reviewRevision,
          ...(linkedInvitation
            ? { invitationReference: linkedInvitation.reference }
            : {}),
        },
        idempotencyKey:
          `site-review-notify:${cycle.publicReference}:${eventKey}:${targetReference}:${recipient.reference}`,
        relatedEntityType: linkedInvitation
          ? 'site_review_invitation'
          : 'site_review_cycle',
        relatedEntityId: linkedInvitation?.id ?? cycle.id,
      }, tx);
    }
  }

  private assertClientMutationOpen(context: ClientReviewContext) {
    if (!['CLIENT_REVIEW', 'CLIENT_CHANGES_REQUESTED'].includes(context.reviewStatus)) {
      throw fail(
        409,
        'SITE_REVIEW_CLIENT_MUTATION_CLOSED',
        'This review revision is no longer open for client changes.',
      );
    }
  }

  async createCycle(actor: AgencyActor, siteReference: string, input: CreateCycleInput) {
    const [context] = await this.database
      .select({
        tenantId: sites.tenantId,
        siteId: sites.id,
        siteReference: sites.publicReference,
        versionId: siteVersions.id,
        versionReference: siteVersions.publicReference,
        versionStatus: siteVersions.status,
        generationStatus: siteVersions.generationStatus,
        contentDigest: siteVersions.generationContentDigestSha256,
        generationRunId: siteGenerationRuns.id,
        generationRunStatus: siteGenerationRuns.status,
        blueprintId: siteGenerationRuns.blueprintId,
        blueprintRevision: siteGenerationRuns.blueprintRevision,
        templateVersionId: siteGenerationRuns.templateVersionId,
        knowledgePackId: siteGenerationRuns.knowledgePackId,
        knowledgePackSemanticVersion: siteGenerationRuns.knowledgePackSemanticVersion,
      })
      .from(sites)
      .innerJoin(siteVersions, and(
        eq(siteVersions.siteId, sites.id),
        eq(siteVersions.publicReference, input.versionReference),
      ))
      .leftJoin(
        siteGenerationRuns,
        eq(siteVersions.generationRunId, siteGenerationRuns.id),
      )
      .where(eq(sites.publicReference, siteReference))
      .limit(1);
    if (!context) {
      throw fail(404, 'SITE_REVIEW_VERSION_NOT_FOUND', 'Draft version not found for this site.');
    }
    if (context.versionStatus !== 'DRAFT') {
      throw fail(
        409,
        context.versionStatus === 'PUBLISHED'
          ? 'SITE_REVIEW_PUBLISHED_VERSION_FORBIDDEN'
          : 'SITE_REVIEW_VERSION_NOT_DRAFT',
        'Only an exact draft site version can open a new review cycle.',
      );
    }
    if (
      context.generationRunId
      && (
        context.generationStatus !== 'READY_FOR_REVIEW'
        || context.generationRunStatus !== 'READY_FOR_REVIEW'
      )
    ) {
      throw fail(409, 'SITE_REVIEW_GENERATION_INCOMPLETE', 'Generation must complete before review starts.');
    }
    if (!context.contentDigest) {
      throw fail(409, 'SITE_REVIEW_CONTENT_DIGEST_MISSING', 'The draft has no validated content digest.');
    }
    const pinnedContentDigestSha256 = context.contentDigest;

    let scopedPageId: string | null = null;
    let scopedSectionId: string | null = null;
    if (input.pageReference) {
      const [page] = await this.database
        .select({ id: sitePages.id })
        .from(sitePages)
        .where(and(
          eq(sitePages.publicReference, input.pageReference),
          eq(sitePages.tenantId, context.tenantId),
          eq(sitePages.siteId, context.siteId),
          eq(sitePages.versionId, context.versionId),
        ))
        .limit(1);
      if (!page) throw fail(404, 'SITE_REVIEW_PAGE_NOT_FOUND', 'Review page is outside the pinned version.');
      scopedPageId = page.id;
    }
    if (input.sectionReference) {
      const [section] = await this.database
        .select({ id: siteSections.id })
        .from(siteSections)
        .where(and(
          eq(siteSections.publicReference, input.sectionReference),
          eq(siteSections.tenantId, context.tenantId),
          eq(siteSections.siteId, context.siteId),
          eq(siteSections.versionId, context.versionId),
          eq(siteSections.pageId, scopedPageId!),
        ))
        .limit(1);
      if (!section) throw fail(404, 'SITE_REVIEW_SECTION_NOT_FOUND', 'Review section is outside the pinned version.');
      scopedSectionId = section.id;
    }

    const created = await this.database.transaction(async (tx) => {
      const [revision] = await tx
        .select({ value: max(siteReviewCycles.reviewRevision) })
        .from(siteReviewCycles)
        .where(eq(siteReviewCycles.siteVersionId, context.versionId));
      const reviewRevision = (revision?.value ?? 0) + 1;
      await tx.update(siteReviewCycles).set({ status: 'SUPERSEDED' }).where(and(
        eq(siteReviewCycles.siteVersionId, context.versionId),
        inArray(siteReviewCycles.status, ACTIVE_CYCLE_STATUSES),
      ));
      const [cycle] = await tx.insert(siteReviewCycles).values({
        tenantId: context.tenantId,
        siteId: context.siteId,
        siteVersionId: context.versionId,
        generationRunId: context.generationRunId,
        blueprintId: context.blueprintId,
        blueprintRevision: context.blueprintRevision,
        templateVersionId: context.templateVersionId,
        knowledgePackId: context.knowledgePackId,
        knowledgePackSemanticVersion: context.knowledgePackSemanticVersion,
        pinnedContentDigestSha256,
        status: 'DRAFT',
        reviewScope: input.reviewScope,
        scopedPageId,
        scopedSectionId,
        reviewRevision,
        agencyOwnerUserId: actor.agencyUserId,
        clientApprovalRequired: input.clientApprovalRequired,
        agencyApprovalRequired: input.agencyApprovalRequired,
        createdByAgencyUserId: actor.agencyUserId,
      }).returning();
      const [owner] = await tx.select({
        publicReference: agencyUsers.publicReference,
        displayName: agencyUsers.displayName,
        email: agencyUsers.emailNormalized,
      }).from(agencyUsers).where(eq(agencyUsers.id, actor.agencyUserId)).limit(1);
      if (!owner) throw fail(404, 'AGENCY_USER_NOT_FOUND', 'Agency owner was not found.');
      await tx.insert(siteReviewParticipants).values({
        reviewCycleId: cycle.id,
        participantType: 'AGENCY_USER',
        agencyUserId: actor.agencyUserId,
        displayName: owner.displayName,
        emailNormalized: owner.email,
        role: 'AGENCY_OWNER',
        status: 'ACTIVE',
        acceptedAt: new Date(),
      });

      const pages = input.reviewScope === 'FACTS_ONLY' ? [] : await tx.select({
        id: sitePages.id,
        sortOrder: sitePages.sortOrder,
      }).from(sitePages).where(and(
        eq(sitePages.versionId, context.versionId),
        isNull(sitePages.archivedAt),
        ...(scopedPageId ? [eq(sitePages.id, scopedPageId)] : []),
      )).orderBy(asc(sitePages.sortOrder));
      if (pages.length > 0) {
        await tx.insert(siteReviewItems).values(pages.map((page) => ({
          reviewCycleId: cycle.id,
          targetType: 'PAGE',
          pageId: page.id,
          status: 'PENDING',
          requiredReviewerType: 'CLIENT',
          displayOrder: page.sortOrder,
        })));
      }
      const sections = input.reviewScope === 'FACTS_ONLY' ? [] : await tx.select({
        id: siteSections.id,
        pageId: siteSections.pageId,
        sortOrder: siteSections.sortOrder,
      }).from(siteSections).where(and(
        eq(siteSections.versionId, context.versionId),
        ...(scopedPageId ? [eq(siteSections.pageId, scopedPageId)] : []),
        ...(scopedSectionId ? [eq(siteSections.id, scopedSectionId)] : []),
      ));
      if (sections.length > 0) {
        await tx.insert(siteReviewItems).values(sections.map((section, index) => ({
          reviewCycleId: cycle.id,
          targetType: 'SECTION',
          pageId: section.pageId,
          sectionId: section.id,
          status: 'PENDING',
          requiredReviewerType: 'CLIENT',
          displayOrder: (section.sortOrder * 100) + index,
        })));
      }
      if (context.generationRunId) {
        const findings = await tx.select({
          id: siteGenerationFindings.id,
          severity: siteGenerationFindings.severity,
        }).from(siteGenerationFindings).where(and(
          eq(siteGenerationFindings.generationRunId, context.generationRunId),
          eq(siteGenerationFindings.current, true),
        ));
        if (findings.length > 0) {
          await tx.insert(siteReviewItems).values(findings.map((finding, index) => ({
            reviewCycleId: cycle.id,
            targetType: 'GENERATION_FINDING',
            generationFindingId: finding.id,
            status: 'PENDING',
            requiredReviewerType: 'AGENCY',
            blocking: finding.severity === 'ERROR',
            clientVisible: false,
            displayOrder: 100_000 + index,
          })));
        }
      }
      const [tenant] = await tx.select({
        reference: tenants.businessReference,
        name: tenants.name,
        legalBusinessName: tenants.legalBusinessName,
        currency: tenants.currency,
      }).from(tenants).where(eq(tenants.id, context.tenantId)).limit(1);
      const [serviceFacts, locationFacts, staffFacts] = await Promise.all([
        tx.select({
          reference: services.publicReference,
          name: services.name,
          price: services.price,
          duration: services.duration,
        }).from(services).where(and(
          eq(services.tenantId, context.tenantId),
          eq(services.isActive, true),
        )).limit(200),
        tx.select({
          reference: locations.publicReference,
          name: locations.name,
          address: locations.address,
          postcode: locations.postcode,
        }).from(locations).where(and(
          eq(locations.tenantId, context.tenantId),
          eq(locations.isActive, true),
        )).limit(100),
        tx.select({
          reference: users.publicReference,
          name: users.name,
          role: users.jobTitle,
        }).from(users).where(and(
          eq(users.tenantId, context.tenantId),
          eq(users.accountStatus, 'ACTIVE'),
        )).limit(200),
      ]);
      const factSeeds: Array<{
        factType: string;
        sourceEntityType: string;
        sourceEntityReference?: string;
        displayLabel: string;
        value: string;
        required: boolean;
      }> = tenant ? [{
        factType: 'LEGAL_BUSINESS_NAME',
        sourceEntityType: 'TENANT',
        sourceEntityReference: tenant.reference,
        displayLabel: 'Legal business name',
        value: tenant.legalBusinessName || tenant.name,
        required: true,
      }] : [];
      for (const service of serviceFacts) {
        factSeeds.push(
          {
            factType: 'SERVICE_NAME',
            sourceEntityType: 'SERVICE',
            sourceEntityReference: service.reference,
            displayLabel: `Service name: ${service.name}`,
            value: service.name,
            required: true,
          },
          {
            factType: 'SERVICE_PRICE',
            sourceEntityType: 'SERVICE',
            sourceEntityReference: service.reference,
            displayLabel: `Price: ${service.name}`,
            value: `${tenant?.currency ?? 'GBP'} ${service.price}`,
            required: true,
          },
          {
            factType: 'SERVICE_DURATION',
            sourceEntityType: 'SERVICE',
            sourceEntityReference: service.reference,
            displayLabel: `Duration: ${service.name}`,
            value: `${service.duration} minutes`,
            required: true,
          },
        );
      }
      for (const location of locationFacts) {
        factSeeds.push({
          factType: 'LOCATION',
          sourceEntityType: 'LOCATION',
          sourceEntityReference: location.reference,
          displayLabel: `Location: ${location.name}`,
          value: `${location.name}, ${location.address}, ${location.postcode}`,
          required: true,
        });
      }
      for (const staff of staffFacts) {
        factSeeds.push({
          factType: 'STAFF_NAME',
          sourceEntityType: 'STAFF',
          sourceEntityReference: staff.reference,
          displayLabel: `Team member: ${staff.name}`,
          value: staff.role ? `${staff.name} — ${staff.role}` : staff.name,
          required: false,
        });
      }
      for (const [index, seed] of factSeeds.slice(0, 500).entries()) {
        const [item] = await tx.insert(siteReviewItems).values({
          reviewCycleId: cycle.id,
          targetType: 'FACT',
          status: 'PENDING',
          requiredReviewerType: 'FACT_VERIFIER',
          blocking: seed.required,
          clientVisible: true,
          displayOrder: 200_000 + index,
        }).returning({ id: siteReviewItems.id });
        await tx.insert(siteFactVerifications).values({
          reviewCycleId: cycle.id,
          reviewItemId: item.id,
          tenantId: context.tenantId,
          factType: seed.factType,
          sourceEntityType: seed.sourceEntityType,
          sourceEntityReference: seed.sourceEntityReference,
          displayLabel: seed.displayLabel,
          proposedPublicValue: seed.value,
          valueDigestSha256: digestValue(seed.value),
          status: 'PENDING_REVIEW',
          evidenceRequired: false,
        });
      }
      await this.activity(
        tx as Database,
        cycle.id,
        'SITE_REVIEW_CYCLE_CREATED',
        'SITE_REVIEW_CYCLE',
        cycle.publicReference,
        actor,
        undefined,
        {
          siteReference,
          versionReference: context.versionReference,
          reviewRevision,
          reviewScope: input.reviewScope,
        },
      );
      await this.audit.write(actor, 'SITE_REVIEW_CYCLE_CREATED', 'SITE_REVIEW_CYCLE', cycle.publicReference, {
        tenantId: context.tenantId,
        category: 'WEBSITE',
        metadata: {
          siteReference,
          versionReference: context.versionReference,
          reviewRevision,
          reviewScope: input.reviewScope,
        },
        tx,
      });
      return { cycle, context };
    });
    return this.getCycle(siteReference, created.cycle.publicReference);
  }

  async listCycles(siteReference: string) {
    const rows = await this.database
      .select({
        publicReference: siteReviewCycles.publicReference,
        siteReference: sites.publicReference,
        versionReference: siteVersions.publicReference,
        status: siteReviewCycles.status,
        reviewScope: siteReviewCycles.reviewScope,
        reviewRevision: siteReviewCycles.reviewRevision,
        pinnedContentDigestSha256: siteReviewCycles.pinnedContentDigestSha256,
        clientApprovalRequired: siteReviewCycles.clientApprovalRequired,
        agencyApprovalRequired: siteReviewCycles.agencyApprovalRequired,
        openedAt: siteReviewCycles.openedAt,
        clientReviewStartedAt: siteReviewCycles.clientReviewStartedAt,
        clientApprovedAt: siteReviewCycles.clientApprovedAt,
        agencyApprovedAt: siteReviewCycles.agencyApprovedAt,
        rejectedAt: siteReviewCycles.rejectedAt,
        cancelledAt: siteReviewCycles.cancelledAt,
        supersededAt: siteReviewCycles.supersededAt,
        createdAt: siteReviewCycles.createdAt,
        updatedAt: siteReviewCycles.updatedAt,
      })
      .from(siteReviewCycles)
      .innerJoin(sites, eq(siteReviewCycles.siteId, sites.id))
      .innerJoin(siteVersions, eq(siteReviewCycles.siteVersionId, siteVersions.id))
      .where(eq(sites.publicReference, siteReference))
      .orderBy(desc(siteReviewCycles.createdAt));
    return rows.map(publicCycle);
  }

  async getCycle(siteReference: string, reviewReference: string) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    return publicCycle(cycle);
  }

  async updateCycle(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    input: {
      clientApprovalRequired?: boolean;
      agencyApprovalRequired?: boolean;
    },
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    if (cycle.status !== 'DRAFT') {
      throw fail(409, 'SITE_REVIEW_POLICY_LOCKED', 'Approval policy can only change while the cycle is a draft.');
    }
    await this.database.update(siteReviewCycles).set({
      ...input,
      updatedAt: new Date(),
    }).where(eq(siteReviewCycles.id, cycle.id));
    await this.activity(
      this.database,
      cycle.id,
      'SITE_REVIEW_POLICY_UPDATED',
      'SITE_REVIEW_CYCLE',
      cycle.publicReference,
      actor,
    );
    return this.getCycle(siteReference, reviewReference);
  }

  async transition(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    actionInput: unknown,
    reason?: string,
  ) {
    const action = ReviewTransitionActionSchema.parse(actionInput);
    const cycle = await this.cycleContext(siteReference, reviewReference);
    const target = reviewTransitionTarget(action);
    try {
      assertReviewTransition(cycle.status, target);
    } catch (error) {
      safePolicyError(error);
    }
    if (['REJECT', 'REQUEST_INTERNAL_CHANGES'].includes(action) && !reason?.trim()) {
      throw fail(400, 'SITE_REVIEW_REASON_REQUIRED', 'A reason is required for this review decision.');
    }
    if (
      action === 'START_AGENCY_FINAL_REVIEW'
      && cycle.clientApprovalRequired
      && cycle.status !== 'CLIENT_APPROVED'
    ) {
      throw fail(
        409,
        'SITE_REVIEW_CLIENT_APPROVAL_REQUIRED',
        'Client approval is required before agency final review.',
      );
    }
    if (
      [
        'MARK_READY_FOR_CLIENT',
        'START_CLIENT_REVIEW',
        'MARK_CLIENT_APPROVED',
        'START_AGENCY_FINAL_REVIEW',
        'MARK_AGENCY_APPROVED',
      ].includes(action)
    ) {
      const readiness = await this.evaluateReadiness(siteReference, reviewReference, target);
      try {
        assertReadyForApproval(readiness);
      } catch (error) {
        safePolicyError(error);
      }
    }
    const event = {
      OPEN_INTERNAL_REVIEW: 'SITE_REVIEW_INTERNAL_STARTED',
      REQUEST_INTERNAL_CHANGES: 'SITE_REVIEW_INTERNAL_CHANGES_REQUESTED',
      MARK_READY_FOR_CLIENT: 'SITE_REVIEW_READY_FOR_CLIENT',
      START_CLIENT_REVIEW: 'SITE_REVIEW_CLIENT_STARTED',
      REQUEST_CLIENT_CHANGES: 'SITE_REVIEW_CLIENT_CHANGES_REQUESTED',
      MARK_CLIENT_APPROVED: 'SITE_REVIEW_CLIENT_APPROVED',
      START_AGENCY_FINAL_REVIEW: 'SITE_REVIEW_AGENCY_FINAL_STARTED',
      MARK_AGENCY_APPROVED: 'SITE_REVIEW_AGENCY_APPROVED',
      REJECT: 'SITE_REVIEW_REJECTED',
      CANCEL: 'SITE_REVIEW_CANCELLED',
      SUPERSEDE: 'SITE_REVIEW_SUPERSEDED',
    }[action];
    await this.database.transaction(async (tx) => {
      const updated = await tx.update(siteReviewCycles).set({
        status: target,
        updatedAt: new Date(),
      }).where(and(
        eq(siteReviewCycles.id, cycle.id),
        eq(siteReviewCycles.status, cycle.status),
      )).returning({ id: siteReviewCycles.id });
      if (updated.length !== 1) {
        throw fail(409, 'SITE_REVIEW_CONCURRENT_TRANSITION', 'Review status changed; reload before retrying.');
      }
      await this.activity(
        tx as Database,
        cycle.id,
        event,
        'SITE_REVIEW_CYCLE',
        cycle.publicReference,
        actor,
        undefined,
        { fromStatus: cycle.status, toStatus: target },
      );
      await this.audit.write(actor, event, 'SITE_REVIEW_CYCLE', cycle.publicReference, {
        tenantId: cycle.tenantId,
        reason,
        category: 'WEBSITE',
        previousValues: { status: cycle.status },
        newValues: { status: target },
        tx,
      });
      if (target === 'AGENCY_APPROVED') {
        await this.notifyParticipants(
          tx as Database,
          cycle,
          'agency-final-approval',
          'The website review received final agency approval',
          'The current website review revision has completed agency approval.',
          cycle.publicReference,
        );
      }
    });
    return this.getCycle(siteReference, reviewReference);
  }

  async evaluateReadiness(
    siteReference: string,
    reviewReference: string,
    targetStatus?: ReviewCycleStatus,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    const factConfirmationRequired = targetStatus
      ? ['CLIENT_APPROVED', 'AGENCY_FINAL_REVIEW', 'AGENCY_APPROVED'].includes(targetStatus)
      : ['CLIENT_REVIEW', 'CLIENT_CHANGES_REQUESTED', 'CLIENT_APPROVED', 'AGENCY_FINAL_REVIEW']
        .includes(cycle.status);
    const [
      pages,
      sections,
      findings,
      claims,
      participants,
      comments,
      changeRequests,
      facts,
      approvals,
      previews,
    ] = await Promise.all([
      this.database.select({
        id: sitePages.id,
        pageType: sitePages.pageType,
      }).from(sitePages).where(and(
        eq(sitePages.versionId, cycle.siteVersionId),
        isNull(sitePages.archivedAt),
      )),
      this.database.select({
        id: siteSections.id,
        pageId: siteSections.pageId,
        actions: siteSections.actionsJson,
      }).from(siteSections).where(eq(siteSections.versionId, cycle.siteVersionId)),
      cycle.generationRunId
        ? this.database.select({
          severity: siteGenerationFindings.severity,
        }).from(siteGenerationFindings).where(and(
          eq(siteGenerationFindings.generationRunId, cycle.generationRunId),
          eq(siteGenerationFindings.current, true),
          isNull(siteGenerationFindings.resolvedAt),
        ))
        : Promise.resolve([]),
      cycle.generationRunId
        ? this.database.select({
          status: siteGenerationClaims.claimStatus,
        }).from(siteGenerationClaims).where(eq(
          siteGenerationClaims.generationRunId,
          cycle.generationRunId,
        ))
        : Promise.resolve([]),
      this.database.select({
        role: siteReviewParticipants.role,
        status: siteReviewParticipants.status,
      }).from(siteReviewParticipants).where(eq(
        siteReviewParticipants.reviewCycleId,
        cycle.id,
      )),
      this.database.select({ id: siteReviewComments.id }).from(siteReviewComments).where(and(
        eq(siteReviewComments.reviewCycleId, cycle.id),
        eq(siteReviewComments.status, 'OPEN'),
      )),
      this.database.select({ id: siteChangeRequests.id }).from(siteChangeRequests).where(and(
        eq(siteChangeRequests.reviewCycleId, cycle.id),
        inArray(siteChangeRequests.status, [...OPEN_CHANGE_STATUSES]),
      )),
      this.database.select({
        status: siteFactVerifications.status,
        required: siteReviewItems.blocking,
      }).from(siteFactVerifications)
        .innerJoin(siteReviewItems, eq(siteFactVerifications.reviewItemId, siteReviewItems.id))
        .where(eq(siteFactVerifications.reviewCycleId, cycle.id)),
      this.database.select({
        invalidatedAt: siteApprovals.invalidatedAt,
        digest: siteApprovals.contentDigestSha256,
      }).from(siteApprovals).where(eq(siteApprovals.reviewCycleId, cycle.id)),
      this.database.select({ id: siteRenderSnapshots.id }).from(siteRenderSnapshots).where(and(
        eq(siteRenderSnapshots.siteVersionId, cycle.siteVersionId),
        eq(siteRenderSnapshots.snapshotKind, 'PREVIEW'),
        eq(siteRenderSnapshots.sourceContentDigestSha256, cycle.pinnedContentDigestSha256),
      )).limit(1),
    ]);
    const pageIdsWithSection = new Set(sections.map((section) => section.pageId));
    const invalidBooking = sections.reduce(
      (total, section) => total + invalidNativeBookingActionCount(section.actions),
      0,
    );
    const externalBooking = sections.filter((section) =>
      hasExternalBookingAction(section.actions)).length;
    const staleApprovals = approvals.filter((approval) =>
      approval.invalidatedAt
      || approval.digest !== cycle.pinnedContentDigestSha256).length;
    return evaluateReviewReadiness({
      versionComplete:
        cycle.versionStatus === 'DRAFT'
        && (!cycle.generationRunId || cycle.versionGenerationStatus === 'READY_FOR_REVIEW')
        && pages.length > 0
        && sections.length > 0,
      versionSuperseded: cycle.status === 'SUPERSEDED' || cycle.versionStatus === 'SUPERSEDED',
      generationFailed: cycle.versionGenerationStatus === 'FAILED',
      openBlockingFindingCount: findings.filter((finding) => finding.severity === 'ERROR').length,
      prohibitedClaimCount: claims.filter((claim) => claim.status === 'PROHIBITED').length,
      invalidBookingActionCount: invalidBooking,
      externalBookingActionCount: externalBooking,
      missingRequiredPageCount: pages.some((page) => page.pageType === 'HOME') ? 0 : 1,
      missingRequiredSectionCount: pages.filter((page) => !pageIdsWithSection.has(page.id)).length,
      disputedRequiredFactCount: facts.filter((fact) => fact.required && fact.status === 'DISPUTED').length,
      unverifiedRequiredFactCount: factConfirmationRequired
        ? facts.filter((fact) =>
          fact.required
          && ['UNVERIFIED', 'PENDING_REVIEW', 'REQUIRES_EVIDENCE'].includes(fact.status)).length
        : 0,
      openRequiredChangeRequestCount: changeRequests.length,
      staleApprovalCount: staleApprovals,
      clientApproverPresent: participants.some((participant) =>
        participant.role === 'CLIENT_APPROVER'
        && ['INVITED', 'ACTIVE'].includes(participant.status)),
      agencyApproverPresent: participants.some((participant) =>
        participant.role === 'AGENCY_OWNER' && participant.status === 'ACTIVE'),
      previewAvailable: previews.length === 1,
      crossTenantReferenceCount: 0,
      openCommentCount: comments.length,
      openChangeRequestCount: changeRequests.length,
      disputedFactCount: facts.filter((fact) => fact.status === 'DISPUTED').length,
      unresolvedFindingCount: findings.length,
      contentDigest: cycle.pinnedContentDigestSha256,
      clientApprovalRequired: cycle.clientApprovalRequired,
      agencyApprovalRequired: cycle.agencyApprovalRequired,
    });
  }

  async listItems(siteReference: string, reviewReference: string, clientOnly = false) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    const rows = await this.database.select({
      reference: siteReviewItems.publicReference,
      targetType: siteReviewItems.targetType,
      pageReference: sitePages.publicReference,
      sectionReference: siteSections.publicReference,
      fieldPath: siteReviewItems.fieldPath,
      status: siteReviewItems.status,
      requiredReviewerType: siteReviewItems.requiredReviewerType,
      blocking: siteReviewItems.blocking,
      clientVisible: siteReviewItems.clientVisible,
      displayOrder: siteReviewItems.displayOrder,
      createdAt: siteReviewItems.createdAt,
      updatedAt: siteReviewItems.updatedAt,
    }).from(siteReviewItems)
      .leftJoin(sitePages, eq(siteReviewItems.pageId, sitePages.id))
      .leftJoin(siteSections, eq(siteReviewItems.sectionId, siteSections.id))
      .where(and(
        eq(siteReviewItems.reviewCycleId, cycle.id),
        ...(clientOnly ? [eq(siteReviewItems.clientVisible, true)] : []),
      ))
      .orderBy(asc(siteReviewItems.displayOrder));
    return rows;
  }

  private assertTargetWithinCycleScope(
    cycle: Awaited<ReturnType<SiteReviewService['cycleContext']>>,
    pageId: string | null,
    sectionId: string | null,
  ) {
    if (
      cycle.reviewScope === 'FACTS_ONLY'
      && (pageId !== null || sectionId !== null)
    ) {
      throw fail(403, 'SITE_REVIEW_TARGET_OUTSIDE_SCOPE', 'Page and section targets are outside this fact-only review.');
    }
    if (
      cycle.reviewScope === 'PAGE'
      && pageId !== null
      && pageId !== cycle.scopedPageId
    ) {
      throw fail(403, 'SITE_REVIEW_TARGET_OUTSIDE_SCOPE', 'The target is outside the scoped review page.');
    }
    if (
      cycle.reviewScope === 'SECTION'
      && (
        (pageId !== null && pageId !== cycle.scopedPageId)
        || (sectionId !== null && sectionId !== cycle.scopedSectionId)
      )
    ) {
      throw fail(403, 'SITE_REVIEW_TARGET_OUTSIDE_SCOPE', 'The target is outside the scoped review section.');
    }
  }

  private async resolveCommentTargets(cycle: Awaited<ReturnType<SiteReviewService['cycleContext']>>, input: CreateCommentInput) {
    let reviewItemId: string | null = null;
    let pageId: string | null = null;
    let sectionId: string | null = null;
    if (input.reviewItemReference) {
      const [item] = await this.database.select({
        id: siteReviewItems.id,
        pageId: siteReviewItems.pageId,
        sectionId: siteReviewItems.sectionId,
      }).from(siteReviewItems).where(and(
        eq(siteReviewItems.publicReference, input.reviewItemReference),
        eq(siteReviewItems.reviewCycleId, cycle.id),
      )).limit(1);
      if (!item) throw fail(404, 'SITE_REVIEW_ITEM_NOT_FOUND', 'Review item is outside this cycle.');
      reviewItemId = item.id;
      pageId = item.pageId;
      sectionId = item.sectionId;
    }
    if (input.anchor?.pagePublicReference) {
      const [page] = await this.database.select({ id: sitePages.id }).from(sitePages).where(and(
        eq(sitePages.publicReference, input.anchor.pagePublicReference),
        eq(sitePages.versionId, cycle.siteVersionId),
        eq(sitePages.tenantId, cycle.tenantId),
      )).limit(1);
      if (!page) throw fail(404, 'SITE_REVIEW_ANCHOR_PAGE_INVALID', 'Comment anchor page is outside the pinned version.');
      pageId = page.id;
    }
    if (input.anchor?.sectionPublicReference) {
      const [section] = await this.database.select({
        id: siteSections.id,
        pageId: siteSections.pageId,
      }).from(siteSections).where(and(
        eq(siteSections.publicReference, input.anchor.sectionPublicReference),
        eq(siteSections.versionId, cycle.siteVersionId),
        eq(siteSections.tenantId, cycle.tenantId),
      )).limit(1);
      if (!section || (pageId && section.pageId !== pageId)) {
        throw fail(404, 'SITE_REVIEW_ANCHOR_SECTION_INVALID', 'Comment anchor section is outside the pinned page.');
      }
      pageId = section.pageId;
      sectionId = section.id;
    }
    let parentCommentId: string | null = null;
    if (input.parentCommentReference) {
      const [parent] = await this.database.select({ id: siteReviewComments.id }).from(siteReviewComments).where(and(
        eq(siteReviewComments.publicReference, input.parentCommentReference),
        eq(siteReviewComments.reviewCycleId, cycle.id),
      )).limit(1);
      if (!parent) throw fail(404, 'SITE_REVIEW_COMMENT_PARENT_INVALID', 'Reply target is outside this review cycle.');
      parentCommentId = parent.id;
    }
    this.assertTargetWithinCycleScope(cycle, pageId, sectionId);
    return { reviewItemId, pageId, sectionId, parentCommentId };
  }

  async listComments(
    siteReference: string,
    reviewReference: string,
    clientOnly = false,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    const rows = await this.database.select({
      id: siteReviewComments.id,
      reference: siteReviewComments.publicReference,
      reviewItemReference: siteReviewItems.publicReference,
      pageReference: sitePages.publicReference,
      sectionReference: siteSections.publicReference,
      parentCommentId: siteReviewComments.parentCommentId,
      authorType: siteReviewComments.authorType,
      body: siteReviewComments.body,
      visibility: siteReviewComments.visibility,
      status: siteReviewComments.status,
      anchor: siteReviewComments.anchorJson,
      anchorStatus: siteReviewComments.anchorStatus,
      resolvedAt: siteReviewComments.resolvedAt,
      createdAt: siteReviewComments.createdAt,
      updatedAt: siteReviewComments.updatedAt,
    }).from(siteReviewComments)
      .leftJoin(siteReviewItems, eq(siteReviewComments.reviewItemId, siteReviewItems.id))
      .leftJoin(sitePages, eq(siteReviewComments.pageId, sitePages.id))
      .leftJoin(siteSections, eq(siteReviewComments.sectionId, siteSections.id))
      .where(and(
        eq(siteReviewComments.reviewCycleId, cycle.id),
        ...(clientOnly ? [eq(siteReviewComments.visibility, 'CLIENT_VISIBLE')] : []),
        ...(clientOnly && ['PAGE', 'SECTION'].includes(cycle.reviewScope) && cycle.scopedPageId
          ? [or(
            isNull(siteReviewComments.pageId),
            eq(siteReviewComments.pageId, cycle.scopedPageId),
          )]
          : []),
        ...(clientOnly && cycle.reviewScope === 'SECTION' && cycle.scopedSectionId
          ? [or(
            isNull(siteReviewComments.sectionId),
            eq(siteReviewComments.sectionId, cycle.scopedSectionId),
          )]
          : []),
      ))
      .orderBy(asc(siteReviewComments.createdAt));
    const referenceById = new Map(rows.map((row) => [row.id, row.reference]));
    return rows.map(({ id: _id, parentCommentId, ...row }) => ({
      ...row,
      parentCommentReference: parentCommentId
        ? referenceById.get(parentCommentId) ?? null
        : null,
    }));
  }

  async addAgencyComment(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    input: CreateCommentInput,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    if (!ACTIVE_CYCLE_STATUSES.includes(cycle.status)) {
      throw fail(409, 'SITE_REVIEW_CYCLE_CLOSED', 'Comments cannot be added to a closed review cycle.');
    }
    const targets = await this.resolveCommentTargets(cycle, input);
    const [comment] = await this.database.transaction(async (tx) => {
      const created = await tx.insert(siteReviewComments).values({
        reviewCycleId: cycle.id,
        reviewItemId: targets.reviewItemId,
        pageId: targets.pageId,
        sectionId: targets.sectionId,
        fieldPath: input.anchor?.fieldPath,
        authorType: 'AGENCY_USER',
        agencyUserId: actor.agencyUserId,
        body: input.body,
        visibility: input.visibility,
        parentCommentId: targets.parentCommentId,
        anchorJson: input.anchor ?? {},
      }).returning();
      if (targets.reviewItemId) {
        await tx.update(siteReviewItems).set({
          status: 'COMMENTED',
          updatedAt: new Date(),
        }).where(eq(siteReviewItems.id, targets.reviewItemId));
      }
      await this.activity(
        tx as Database,
        cycle.id,
        'SITE_REVIEW_COMMENT_ADDED',
        'SITE_REVIEW_COMMENT',
        created[0].publicReference,
        actor,
      );
      await this.audit.write(actor, 'SITE_REVIEW_COMMENT_ADDED', 'SITE_REVIEW_COMMENT', created[0].publicReference, {
        tenantId: cycle.tenantId,
        category: 'WEBSITE',
        metadata: { reviewCycleReference: reviewReference, visibility: input.visibility },
        tx,
      });
      if (input.visibility === 'CLIENT_VISIBLE') {
        await this.notifyParticipants(
          tx as Database,
          cycle,
          'comment-added',
          'A website review comment was added',
          'There is a new comment in the secure website review.',
          created[0].publicReference,
        );
      }
      return created;
    });
    return { reference: comment.publicReference, status: comment.status };
  }

  async updateAgencyComment(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    commentReference: string,
    input: z.infer<typeof UpdateCommentSchema>,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    const [comment] = await this.database.update(siteReviewComments).set({
      body: input.body,
      updatedAt: new Date(),
    }).where(and(
      eq(siteReviewComments.publicReference, commentReference),
      eq(siteReviewComments.reviewCycleId, cycle.id),
      eq(siteReviewComments.agencyUserId, actor.agencyUserId),
      eq(siteReviewComments.status, 'OPEN'),
    )).returning({ reference: siteReviewComments.publicReference });
    if (!comment) throw fail(404, 'SITE_REVIEW_COMMENT_NOT_EDITABLE', 'Open comment authored by this agency user was not found.');
    return comment;
  }

  async resolveAgencyComment(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    commentReference: string,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    const [comment] = await this.database.transaction(async (tx) => {
      const rows = await tx.update(siteReviewComments).set({
        status: 'RESOLVED',
        resolvedByAgencyUserId: actor.agencyUserId,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(siteReviewComments.publicReference, commentReference),
        eq(siteReviewComments.reviewCycleId, cycle.id),
        eq(siteReviewComments.status, 'OPEN'),
      )).returning({ reference: siteReviewComments.publicReference });
      if (!rows[0]) throw fail(404, 'SITE_REVIEW_COMMENT_NOT_FOUND', 'Open review comment not found.');
      await this.activity(
        tx as Database,
        cycle.id,
        'SITE_REVIEW_COMMENT_RESOLVED',
        'SITE_REVIEW_COMMENT',
        rows[0].reference,
        actor,
      );
      await this.audit.write(actor, 'SITE_REVIEW_COMMENT_RESOLVED', 'SITE_REVIEW_COMMENT', rows[0].reference, {
        tenantId: cycle.tenantId,
        category: 'WEBSITE',
        tx,
      });
      return rows;
    });
    return { reference: comment.reference, status: 'RESOLVED' };
  }

  async listChangeRequests(
    siteReference: string,
    reviewReference: string,
    clientOnly = false,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    return this.database.select({
      reference: siteChangeRequests.publicReference,
      reviewItemReference: siteReviewItems.publicReference,
      pageReference: sitePages.publicReference,
      sectionReference: siteSections.publicReference,
      fieldPath: siteChangeRequests.fieldPath,
      category: siteChangeRequests.category,
      priority: siteChangeRequests.priority,
      title: siteChangeRequests.title,
      description: siteChangeRequests.description,
      requestedOutcome: siteChangeRequests.requestedOutcome,
      status: siteChangeRequests.status,
      resolutionType: siteChangeRequests.resolutionType,
      resolutionNote: siteChangeRequests.resolutionNote,
      createdAt: siteChangeRequests.createdAt,
      updatedAt: siteChangeRequests.updatedAt,
      resolvedAt: siteChangeRequests.resolvedAt,
    }).from(siteChangeRequests)
      .leftJoin(siteReviewItems, eq(siteChangeRequests.reviewItemId, siteReviewItems.id))
      .leftJoin(sitePages, eq(siteChangeRequests.pageId, sitePages.id))
      .leftJoin(siteSections, eq(siteChangeRequests.sectionId, siteSections.id))
      .where(and(
        eq(siteChangeRequests.reviewCycleId, cycle.id),
        ...(clientOnly && ['PAGE', 'SECTION'].includes(cycle.reviewScope) && cycle.scopedPageId
          ? [or(
            isNull(siteChangeRequests.pageId),
            eq(siteChangeRequests.pageId, cycle.scopedPageId),
          )]
          : []),
        ...(clientOnly && cycle.reviewScope === 'SECTION' && cycle.scopedSectionId
          ? [or(
            isNull(siteChangeRequests.sectionId),
            eq(siteChangeRequests.sectionId, cycle.scopedSectionId),
          )]
          : []),
      ))
      .orderBy(desc(siteChangeRequests.createdAt));
  }

  private async resolveChangeRequestTargets(
    cycle: Awaited<ReturnType<SiteReviewService['cycleContext']>>,
    input: CreateChangeRequestInput,
  ) {
    let reviewItemId: string | null = null;
    let pageId: string | null = null;
    let sectionId: string | null = null;
    if (input.reviewItemReference) {
      const [item] = await this.database.select({
        id: siteReviewItems.id,
        pageId: siteReviewItems.pageId,
        sectionId: siteReviewItems.sectionId,
      }).from(siteReviewItems).where(and(
        eq(siteReviewItems.publicReference, input.reviewItemReference),
        eq(siteReviewItems.reviewCycleId, cycle.id),
      )).limit(1);
      if (!item) throw fail(404, 'SITE_REVIEW_ITEM_NOT_FOUND', 'Review item not found in this cycle.');
      reviewItemId = item.id;
      pageId = item.pageId;
      sectionId = item.sectionId;
    }
    if (input.pageReference) {
      const [page] = await this.database.select({ id: sitePages.id }).from(sitePages).where(and(
        eq(sitePages.publicReference, input.pageReference),
        eq(sitePages.versionId, cycle.siteVersionId),
        eq(sitePages.tenantId, cycle.tenantId),
      )).limit(1);
      if (!page) throw fail(404, 'SITE_REVIEW_PAGE_NOT_FOUND', 'Change-request page is outside the pinned version.');
      pageId = page.id;
    }
    if (input.sectionReference) {
      const [section] = await this.database.select({
        id: siteSections.id,
        pageId: siteSections.pageId,
      }).from(siteSections).where(and(
        eq(siteSections.publicReference, input.sectionReference),
        eq(siteSections.versionId, cycle.siteVersionId),
        eq(siteSections.tenantId, cycle.tenantId),
      )).limit(1);
      if (!section || (pageId && pageId !== section.pageId)) {
        throw fail(404, 'SITE_REVIEW_SECTION_NOT_FOUND', 'Change-request section is outside the pinned page.');
      }
      pageId = section.pageId;
      sectionId = section.id;
    }
    this.assertTargetWithinCycleScope(cycle, pageId, sectionId);
    return { reviewItemId, pageId, sectionId };
  }

  private async insertChangeRequest(
    cycle: Awaited<ReturnType<SiteReviewService['cycleContext']>>,
    input: CreateChangeRequestInput,
    actor?: AgencyActor,
    participant?: ClientReviewContext,
  ) {
    try {
      assertSafeChangeRequest(input);
    } catch {
      throw fail(400, 'SITE_REVIEW_CHANGE_REQUEST_UNSAFE', 'The request asks for a prohibited or unsafe outcome.');
    }
    const targets = await this.resolveChangeRequestTargets(cycle, input);
    return this.database.transaction(async (tx) => {
      const [request] = await tx.insert(siteChangeRequests).values({
        tenantId: cycle.tenantId,
        siteId: cycle.siteId,
        versionId: cycle.siteVersionId,
        pageId: targets.pageId,
        reviewCycleId: cycle.id,
        reviewItemId: targets.reviewItemId,
        sectionId: targets.sectionId,
        fieldPath: input.fieldPath,
        category: input.category,
        priority: input.priority,
        title: input.title,
        description: input.description,
        requestedOutcome: input.requestedOutcome,
        submittedByType: actor ? 'AGENCY_USER' : participant?.participantType,
        submittedByAgencyUserId: actor?.agencyUserId,
        submittedByParticipantId: participant?.participantId,
        status: 'OPEN',
      }).returning();
      await tx.insert(siteChangeRequestEvents).values({
        changeRequestId: request.id,
        reviewCycleId: cycle.id,
        eventType: 'CREATED',
        toStatus: 'OPEN',
        actorType: actor ? 'AGENCY_USER' : participant?.participantType ?? 'SYSTEM',
        agencyUserId: actor?.agencyUserId,
        participantId: participant?.participantId,
      });
      if (targets.reviewItemId) {
        await tx.update(siteReviewItems).set({
          status: 'CHANGE_REQUESTED',
          updatedAt: new Date(),
        }).where(eq(siteReviewItems.id, targets.reviewItemId));
      }
      await this.activity(
        tx as Database,
        cycle.id,
        'SITE_CHANGE_REQUEST_CREATED',
        'SITE_CHANGE_REQUEST',
        request.publicReference,
        actor,
        participant?.participantId,
        {
          category: input.category,
          priority: input.priority,
          ...(participant ? { participantType: participant.participantType } : {}),
        },
      );
      if (actor) {
        await this.audit.write(actor, 'SITE_CHANGE_REQUEST_CREATED', 'SITE_CHANGE_REQUEST', request.publicReference, {
          tenantId: cycle.tenantId,
          category: 'WEBSITE',
          metadata: { reviewCycleReference: cycle.publicReference, requestCategory: input.category },
          tx,
        });
      } else if (participant) {
        await this.audit.write(
          null,
          'SITE_CHANGE_REQUEST_CREATED',
          'SITE_CHANGE_REQUEST',
          request.publicReference,
          {
            tenantId: cycle.tenantId,
            category: 'WEBSITE',
            sourceComponent: 'site-review-client-api',
            metadata: {
              reviewCycleReference: cycle.publicReference,
              participantReference: participant.participantReference,
              participantType: participant.participantType,
              requestCategory: input.category,
            },
            tx,
          },
        );
      }
      await this.notifyParticipants(
        tx as Database,
        cycle,
        'change-request-created',
        'A website change request was added',
        'There is a new structured change request in the secure website review.',
        request.publicReference,
        participant?.participantId,
      );
      return { reference: request.publicReference, status: request.status };
    });
  }

  async addAgencyChangeRequest(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    input: CreateChangeRequestInput,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    return this.insertChangeRequest(cycle, input, actor);
  }

  private async changeRequestContext(
    siteReference: string,
    reviewReference: string,
    requestReference: string,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    const [request] = await this.database.select().from(siteChangeRequests).where(and(
      eq(siteChangeRequests.publicReference, requestReference),
      eq(siteChangeRequests.reviewCycleId, cycle.id),
    )).limit(1);
    if (!request) throw fail(404, 'SITE_CHANGE_REQUEST_NOT_FOUND', 'Change request not found in this cycle.');
    return { cycle, request };
  }

  async updateChangeRequest(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    requestReference: string,
    input: UpdateChangeRequestInput,
  ) {
    const { cycle, request } = await this.changeRequestContext(siteReference, reviewReference, requestReference);
    let assignedToAgencyUserId: string | null | undefined;
    if (input.assignedAgencyUserReference !== undefined) {
      if (input.assignedAgencyUserReference === null) {
        assignedToAgencyUserId = null;
      } else {
        const [agencyUser] = await this.database.select({ id: agencyUsers.id }).from(agencyUsers).where(and(
          eq(agencyUsers.publicReference, input.assignedAgencyUserReference),
          eq(agencyUsers.status, 'ACTIVE'),
        )).limit(1);
        if (!agencyUser) throw fail(404, 'AGENCY_USER_NOT_FOUND', 'Active assignee not found.');
        assignedToAgencyUserId = agencyUser.id;
      }
    }
    const nextStatus = request.status === 'OPEN' ? 'TRIAGED' : request.status;
    const eventType = assignedToAgencyUserId !== undefined ? 'ASSIGNED' : 'TRIAGED';
    await this.database.transaction(async (tx) => {
      await tx.update(siteChangeRequests).set({
        priority: input.priority ?? request.priority,
        ...(assignedToAgencyUserId !== undefined ? { assignedToAgencyUserId } : {}),
        ...(input.resolutionNotes ? { resolutionNote: input.resolutionNotes } : {}),
        status: nextStatus,
        updatedAt: new Date(),
      }).where(eq(siteChangeRequests.id, request.id));
      await tx.insert(siteChangeRequestEvents).values({
        changeRequestId: request.id,
        reviewCycleId: cycle.id,
        eventType,
        fromStatus: request.status,
        toStatus: nextStatus,
        actorType: 'AGENCY_USER',
        agencyUserId: actor.agencyUserId,
        safeMetadataJson: {
          priority: input.priority ?? request.priority,
          assigned: assignedToAgencyUserId !== undefined,
        },
      });
      await this.activity(
        tx as Database,
        cycle.id,
        `SITE_CHANGE_REQUEST_${eventType}`,
        'SITE_CHANGE_REQUEST',
        requestReference,
        actor,
      );
      await this.audit.write(
        actor,
        `SITE_CHANGE_REQUEST_${eventType}`,
        'SITE_CHANGE_REQUEST',
        requestReference,
        {
          tenantId: cycle.tenantId,
          category: 'WEBSITE',
          metadata: {
            reviewCycleReference: cycle.publicReference,
            priority: input.priority ?? request.priority,
            assigned: assignedToAgencyUserId !== undefined,
          },
          tx,
        },
      );
    });
    return { reference: requestReference, status: nextStatus };
  }

  async changeRequestAction(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    requestReference: string,
    action: 'ACCEPT' | 'REJECT' | 'RESOLVE',
    resolution?: ResolveChangeRequestInput,
  ) {
    const { cycle, request } = await this.changeRequestContext(siteReference, reviewReference, requestReference);
    const next = action === 'ACCEPT' ? 'ACCEPTED' : action === 'REJECT' ? 'REJECTED' : 'RESOLVED';
    if (action !== 'ACCEPT' && !resolution) {
      throw fail(400, 'SITE_CHANGE_REQUEST_RESOLUTION_REQUIRED', 'A structured resolution is required.');
    }
    const event = action === 'ACCEPT'
      ? 'SITE_CHANGE_REQUEST_ACCEPTED'
      : action === 'REJECT'
        ? 'SITE_CHANGE_REQUEST_REJECTED'
        : 'SITE_CHANGE_REQUEST_RESOLVED';
    let resultingSiteVersionId = request.resultingSiteVersionId;
    let resultingPageId = request.resultingPageId;
    let resultingSectionId = request.resultingSectionId;
    if (resolution?.resultingVersionReference) {
      const [version] = await this.database.select({ id: siteVersions.id })
        .from(siteVersions)
        .where(and(
          eq(siteVersions.publicReference, resolution.resultingVersionReference),
          eq(siteVersions.tenantId, cycle.tenantId),
          eq(siteVersions.siteId, cycle.siteId),
        ))
        .limit(1);
      if (!version) {
        throw fail(404, 'SITE_REVIEW_RESULT_VERSION_INVALID', 'Resulting version is outside this site.');
      }
      resultingSiteVersionId = version.id;
    }
    const resultVersionId = resultingSiteVersionId ?? cycle.siteVersionId;
    if (resolution?.resultingPageReference) {
      const [page] = await this.database.select({ id: sitePages.id })
        .from(sitePages)
        .where(and(
          eq(sitePages.publicReference, resolution.resultingPageReference),
          eq(sitePages.tenantId, cycle.tenantId),
          eq(sitePages.siteId, cycle.siteId),
          eq(sitePages.versionId, resultVersionId),
        ))
        .limit(1);
      if (!page) {
        throw fail(404, 'SITE_REVIEW_RESULT_PAGE_INVALID', 'Resulting page is outside the resulting version.');
      }
      resultingPageId = page.id;
    }
    if (resolution?.resultingSectionReference) {
      const [section] = await this.database.select({
        id: siteSections.id,
        pageId: siteSections.pageId,
      }).from(siteSections).where(and(
        eq(siteSections.publicReference, resolution.resultingSectionReference),
        eq(siteSections.tenantId, cycle.tenantId),
        eq(siteSections.siteId, cycle.siteId),
        eq(siteSections.versionId, resultVersionId),
      )).limit(1);
      if (!section || (resultingPageId && section.pageId !== resultingPageId)) {
        throw fail(404, 'SITE_REVIEW_RESULT_SECTION_INVALID', 'Resulting section is outside the resulting page.');
      }
      resultingPageId = section.pageId;
      resultingSectionId = section.id;
    }
    await this.database.transaction(async (tx) => {
      await tx.update(siteChangeRequests).set({
        status: next,
        resolvedByAgencyUserId: action === 'ACCEPT' ? null : actor.agencyUserId,
        resolutionType: resolution?.resolutionType,
        resolutionNote: resolution?.resolutionNotes,
        resultingSiteVersionId,
        resultingPageId,
        resultingSectionId,
        acceptedAt: action === 'ACCEPT' ? new Date() : request.acceptedAt,
        resolvedAt: action === 'RESOLVE' ? new Date() : request.resolvedAt,
        rejectedAt: action === 'REJECT' ? new Date() : request.rejectedAt,
        updatedAt: new Date(),
      }).where(eq(siteChangeRequests.id, request.id));
      await tx.insert(siteChangeRequestEvents).values({
        changeRequestId: request.id,
        reviewCycleId: cycle.id,
        eventType: action === 'ACCEPT' ? 'ACCEPTED' : action === 'REJECT' ? 'REJECTED' : 'RESOLVED',
        fromStatus: request.status,
        toStatus: next,
        actorType: 'AGENCY_USER',
        agencyUserId: actor.agencyUserId,
        safeMetadataJson: resolution ? {
          resolutionType: resolution.resolutionType,
          resultingVersionReference: resolution.resultingVersionReference,
          resultingPageReference: resolution.resultingPageReference,
          resultingSectionReference: resolution.resultingSectionReference,
        } : {},
      });
      await this.activity(tx as Database, cycle.id, event, 'SITE_CHANGE_REQUEST', requestReference, actor);
      await this.audit.write(actor, event, 'SITE_CHANGE_REQUEST', requestReference, {
        tenantId: cycle.tenantId,
        category: 'WEBSITE',
        metadata: resolution ? {
          resolutionType: resolution.resolutionType,
          resultingVersionReference: resolution.resultingVersionReference,
          resultingPageReference: resolution.resultingPageReference,
          resultingSectionReference: resolution.resultingSectionReference,
        } : {},
        tx,
      });
      await this.notifyParticipants(
        tx as Database,
        cycle,
        `change-request-${action.toLowerCase()}`,
        action === 'ACCEPT'
          ? 'A website change request was accepted'
          : action === 'RESOLVE'
            ? 'A website change request was resolved'
            : 'A website change request was reviewed',
        action === 'ACCEPT'
          ? 'The agency accepted a structured website change request.'
          : action === 'RESOLVE'
            ? 'The agency marked a structured website change request as resolved.'
            : 'The agency completed its review of a structured website change request.',
        requestReference,
      );
    });
    return { reference: requestReference, status: next };
  }

  private async invalidateApprovals(
    tx: Database,
    cycle: Awaited<ReturnType<SiteReviewService['cycleContext']>>,
    actor: AgencyActor,
    reason: string,
    pageId?: string | null,
    itemId?: string | null,
  ) {
    const scope = or(
      inArray(siteApprovals.approvalLevel, ['FULL_SITE', 'CLIENT_FINAL', 'AGENCY_FINAL']),
      ...(pageId ? [and(eq(siteApprovals.approvalLevel, 'PAGE'), eq(siteApprovals.pageId, pageId))] : []),
      ...(itemId ? [and(eq(siteApprovals.approvalLevel, 'ITEM'), eq(siteApprovals.reviewItemId, itemId))] : []),
    );
    const invalidated = await tx.update(siteApprovals).set({
      status: 'WITHDRAWN',
      invalidatedAt: new Date(),
      invalidationReason: reason,
    }).where(and(
      eq(siteApprovals.reviewCycleId, cycle.id),
      isNull(siteApprovals.invalidatedAt),
      scope,
    )).returning({ id: siteApprovals.id, reference: siteApprovals.publicReference });
    for (const approval of invalidated) {
      await tx.update(siteApprovalDecisions).set({
        invalidatedAt: new Date(),
        invalidationReason: reason,
      }).where(and(
        eq(siteApprovalDecisions.approvalId, approval.id),
        isNull(siteApprovalDecisions.invalidatedAt),
      ));
      await this.activity(
        tx,
        cycle.id,
        'SITE_APPROVAL_INVALIDATED',
        'SITE_APPROVAL',
        approval.reference,
        actor,
        undefined,
        { reasonCode: reason },
      );
      await this.audit.write(actor, 'SITE_APPROVAL_INVALIDATED', 'SITE_APPROVAL', approval.reference, {
        tenantId: cycle.tenantId,
        reason,
        category: 'WEBSITE',
        tx,
      });
    }
    return invalidated.length;
  }

  async regenerateForChangeRequest(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    requestReference: string,
    target: 'PAGE' | 'SECTION',
    boundedInput?: z.infer<typeof BoundedRegenerationReasonSchema>,
  ) {
    const { cycle, request } = await this.changeRequestContext(siteReference, reviewReference, requestReference);
    if (!['ACCEPTED', 'IN_PROGRESS'].includes(request.status)) {
      throw fail(409, 'SITE_CHANGE_REQUEST_NOT_ACCEPTED', 'Change request must be accepted before regeneration.');
    }
    if (cycle.versionStatus !== 'DRAFT' || !ACTIVE_CYCLE_STATUSES.includes(cycle.status)) {
      throw fail(409, 'SITE_REVIEW_REGENERATION_FORBIDDEN', 'Only the pinned active draft may be regenerated.');
    }
    if (!request.pageId) throw fail(409, 'SITE_CHANGE_REQUEST_PAGE_REQUIRED', 'Regeneration requires a pinned page.');
    const [page] = await this.database.select({ reference: sitePages.publicReference }).from(sitePages)
      .where(and(eq(sitePages.id, request.pageId), eq(sitePages.versionId, cycle.siteVersionId))).limit(1);
    if (!page) throw fail(404, 'SITE_REVIEW_PAGE_NOT_FOUND', 'Pinned change-request page was not found.');
    let result: { reference: string; status: string; idempotentReplay: boolean };
    if (target === 'SECTION') {
      if (!request.sectionId || !boundedInput) {
        throw fail(400, 'SITE_CHANGE_REQUEST_SECTION_INPUT_REQUIRED', 'Section regeneration requires a pinned section and bounded instruction.');
      }
      const [section] = await this.database.select({ reference: siteSections.publicReference }).from(siteSections)
        .where(and(eq(siteSections.id, request.sectionId), eq(siteSections.versionId, cycle.siteVersionId))).limit(1);
      if (!section) throw fail(404, 'SITE_REVIEW_SECTION_NOT_FOUND', 'Pinned change-request section was not found.');
      result = await this.generation.regenerateSection(
        actor,
        siteReference,
        cycle.versionReference,
        page.reference,
        section.reference,
        `[${boundedInput.reasonCode}] ${boundedInput.instruction}`,
      );
    } else {
      result = await this.generation.regeneratePage(
        actor,
        siteReference,
        cycle.versionReference,
        page.reference,
      );
    }
    const [job] = await this.database.select({ id: siteJobs.id }).from(siteJobs)
      .where(eq(siteJobs.publicReference, result.reference)).limit(1);
    await this.database.transaction(async (tx) => {
      await tx.update(siteChangeRequests).set({
        status: 'IN_PROGRESS',
        resolutionType: target === 'SECTION' ? 'SECTION_REGENERATION' : 'PAGE_REGENERATION',
        regenerationJobId: job?.id,
        updatedAt: new Date(),
      }).where(eq(siteChangeRequests.id, request.id));
      await tx.insert(siteChangeRequestEvents).values({
        changeRequestId: request.id,
        reviewCycleId: cycle.id,
        eventType: 'REGENERATION_QUEUED',
        fromStatus: request.status,
        toStatus: 'IN_PROGRESS',
        actorType: 'AGENCY_USER',
        agencyUserId: actor.agencyUserId,
        safeMetadataJson: { target, jobReference: result.reference },
      });
      await tx.update(siteReviewComments).set({
        anchorStatus: 'OUTDATED',
        updatedAt: new Date(),
      }).where(and(
        eq(siteReviewComments.reviewCycleId, cycle.id),
        target === 'SECTION' && request.sectionId
          ? eq(siteReviewComments.sectionId, request.sectionId)
          : eq(siteReviewComments.pageId, request.pageId!),
      ));
      await this.invalidateApprovals(
        tx as Database,
        cycle,
        actor,
        target === 'SECTION' ? 'SECTION_REGENERATION' : 'PAGE_REGENERATION',
        request.pageId,
        request.reviewItemId,
      );
      await tx.update(siteReviewCycles).set({
        status: cycle.status === 'CLIENT_REVIEW' || cycle.status === 'CLIENT_APPROVED'
          ? 'CLIENT_CHANGES_REQUESTED'
          : cycle.status,
        updatedAt: new Date(),
      }).where(eq(siteReviewCycles.id, cycle.id));
    });
    return { ...result, changeRequestReference: requestReference };
  }

  async listFacts(siteReference: string, reviewReference: string, clientOnly = false) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    const rows = await this.database.select({
      reference: siteFactVerifications.publicReference,
      factType: siteFactVerifications.factType,
      sourceEntityType: siteFactVerifications.sourceEntityType,
      sourceEntityReference: siteFactVerifications.sourceEntityReference,
      displayLabel: siteFactVerifications.displayLabel,
      proposedPublicValue: siteFactVerifications.proposedPublicValue,
      status: siteFactVerifications.status,
      clientResponse: siteFactVerifications.clientResponse,
      evidenceRequired: siteFactVerifications.evidenceRequired,
      evidenceReference: siteFactVerifications.evidenceReference,
      evidencePrivate: siteFactVerifications.evidencePrivate,
      agencyDecision: siteFactVerifications.agencyDecision,
      confirmedAt: siteFactVerifications.confirmedAt,
      disputedAt: siteFactVerifications.disputedAt,
    }).from(siteFactVerifications).where(eq(siteFactVerifications.reviewCycleId, cycle.id))
      .orderBy(asc(siteFactVerifications.createdAt));
    if (!clientOnly) return rows;
    return rows.map((fact) => ({
      reference: fact.reference,
      factType: fact.factType,
      sourceEntityType: fact.sourceEntityType,
      sourceEntityReference: fact.sourceEntityReference,
      displayLabel: fact.displayLabel,
      proposedPublicValue: fact.proposedPublicValue,
      status: fact.status,
      clientResponse: fact.clientResponse,
      evidenceRequired: fact.evidenceRequired,
      confirmedAt: fact.confirmedAt,
      disputedAt: fact.disputedAt,
    }));
  }

  async updateFact(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    factReference: string,
    input: AgencyFactDecision,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    const [fact] = await this.database.update(siteFactVerifications).set({
      status: input.status,
      agencyDecision: input.agencyDecision,
      evidenceReference: input.evidenceReference,
      updatedAt: new Date(),
    }).where(and(
      eq(siteFactVerifications.publicReference, factReference),
      eq(siteFactVerifications.reviewCycleId, cycle.id),
    )).returning({ reference: siteFactVerifications.publicReference, status: siteFactVerifications.status });
    if (!fact) throw fail(404, 'SITE_REVIEW_FACT_NOT_FOUND', 'Fact-verification item not found.');
    await this.audit.write(actor, 'SITE_FACT_AGENCY_DECISION', 'SITE_FACT_VERIFICATION', factReference, {
      tenantId: cycle.tenantId,
      category: 'WEBSITE',
      metadata: { status: input.status },
    });
    return fact;
  }

  async listParticipants(siteReference: string, reviewReference: string) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    return this.database.select({
      reference: siteReviewParticipants.publicReference,
      participantType: siteReviewParticipants.participantType,
      displayName: siteReviewParticipants.displayName,
      email: siteReviewParticipants.emailNormalized,
      role: siteReviewParticipants.role,
      status: siteReviewParticipants.status,
      invitedAt: siteReviewParticipants.invitedAt,
      acceptedAt: siteReviewParticipants.acceptedAt,
      lastAccessedAt: siteReviewParticipants.lastAccessedAt,
      revokedAt: siteReviewParticipants.revokedAt,
      createdAt: siteReviewParticipants.createdAt,
    }).from(siteReviewParticipants).where(eq(siteReviewParticipants.reviewCycleId, cycle.id))
      .orderBy(asc(siteReviewParticipants.createdAt));
  }

  async addParticipant(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    input: AddParticipantInput,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    let agencyUserId: string | null = null;
    let tenantUserId: string | null = null;
    if (input.agencyUserReference) {
      const [agencyUser] = await this.database.select({ id: agencyUsers.id }).from(agencyUsers).where(and(
        eq(agencyUsers.publicReference, input.agencyUserReference),
        eq(agencyUsers.status, 'ACTIVE'),
      )).limit(1);
      if (!agencyUser) throw fail(404, 'AGENCY_USER_NOT_FOUND', 'Active agency user not found.');
      agencyUserId = agencyUser.id;
    }
    if (input.tenantUserReference) {
      const [tenantUser] = await this.database.select({ id: users.id }).from(users).where(and(
        eq(users.publicReference, input.tenantUserReference),
        eq(users.tenantId, cycle.tenantId),
      )).limit(1);
      if (!tenantUser) throw fail(404, 'SITE_REVIEW_TENANT_USER_NOT_FOUND', 'Tenant user is outside this review tenant.');
      tenantUserId = tenantUser.id;
    }
    const [participant] = await this.database.transaction(async (tx) => {
      const rows = await tx.insert(siteReviewParticipants).values({
        reviewCycleId: cycle.id,
        participantType: input.participantType,
        agencyUserId,
        tenantUserId,
        contactReference: input.contactReference,
        displayName: input.displayName,
        emailNormalized: normalizedEmail(input.email),
        role: input.role,
        status: input.participantType === 'AGENCY_USER' ? 'ACTIVE' : 'INVITED',
        acceptedAt: input.participantType === 'AGENCY_USER' ? new Date() : null,
      }).returning();
      await this.activity(
        tx as Database,
        cycle.id,
        'SITE_REVIEW_PARTICIPANT_ADDED',
        'SITE_REVIEW_PARTICIPANT',
        rows[0].publicReference,
        actor,
        undefined,
        { participantType: input.participantType, role: input.role },
      );
      await this.audit.write(actor, 'SITE_REVIEW_PARTICIPANT_ADDED', 'SITE_REVIEW_PARTICIPANT', rows[0].publicReference, {
        tenantId: cycle.tenantId,
        category: 'WEBSITE',
        metadata: { reviewCycleReference: reviewReference, participantType: input.participantType, role: input.role },
        tx,
      });
      return rows;
    });
    return {
      reference: participant.publicReference,
      participantType: participant.participantType,
      role: participant.role,
      status: participant.status,
    };
  }

  private invitationSecret() {
    const secret = this.environment.SITE_REVIEW_INVITATION_SECRET;
    if (!secret || secret.length < 32) {
      throw fail(503, 'SITE_REVIEW_INVITATION_UNAVAILABLE', 'Site-review invitation signing is not configured.');
    }
    return secret;
  }

  async inviteParticipant(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    participantReference: string,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    if (!['CLIENT_REVIEW', 'CLIENT_CHANGES_REQUESTED'].includes(cycle.status)) {
      throw fail(409, 'SITE_REVIEW_INVITATION_STATUS_INVALID', 'This review cycle is not open for client invitations.');
    }
    const [participant] = await this.database.select().from(siteReviewParticipants).where(and(
      eq(siteReviewParticipants.publicReference, participantReference),
      eq(siteReviewParticipants.reviewCycleId, cycle.id),
      inArray(siteReviewParticipants.role, ['CLIENT_APPROVER', 'CLIENT_REVIEWER', 'FACT_VERIFIER', 'VIEW_ONLY']),
      or(eq(siteReviewParticipants.status, 'INVITED'), eq(siteReviewParticipants.status, 'ACTIVE')),
    )).limit(1);
    if (!participant) throw fail(404, 'SITE_REVIEW_PARTICIPANT_NOT_INVITABLE', 'Invitable client participant not found.');
    const invitationReference = randomUUID();
    const invitationToken = deriveReviewInvitationToken({
      invitationReference,
      reviewCycleReference: cycle.publicReference,
      reviewRevision: cycle.reviewRevision,
      secret: this.invitationSecret(),
    });
    const tokenDigestSha256 = digestReviewToken(invitationToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const idempotencyKey = `site-review-invite:${cycle.publicReference}:${participant.publicReference}:${cycle.reviewRevision}`;
    const result = await this.database.transaction(async (tx) => {
      const existing = await tx.select({
        reference: siteReviewInvitations.publicReference,
        status: siteReviewInvitations.status,
        expiresAt: siteReviewInvitations.expiresAt,
      }).from(siteReviewInvitations).where(and(
        eq(siteReviewInvitations.reviewCycleId, cycle.id),
        eq(siteReviewInvitations.participantId, participant.id),
        eq(siteReviewInvitations.reviewRevision, cycle.reviewRevision),
      )).limit(1);
      if (existing[0]) return { ...existing[0], idempotentReplay: true };
      const [invitation] = await tx.insert(siteReviewInvitations).values({
        publicReference: invitationReference,
        reviewCycleId: cycle.id,
        participantId: participant.id,
        reviewRevision: cycle.reviewRevision,
        tokenDigestSha256,
        recipientEmailNormalized: participant.emailNormalized,
        status: 'QUEUED',
        expiresAt,
      }).returning();
      await this.email.enqueueEmail({
        tenantId: cycle.tenantId,
        recipientEmail: participant.emailNormalized,
        recipientName: participant.displayName,
        templateKey: 'site-review-invitation',
        templateVersion: '1.0.0',
        templateDataJson: {
          tenantName: 'Your website team',
          participantName: participant.displayName,
          siteReference,
          reviewReference: cycle.publicReference,
          reviewRevision: cycle.reviewRevision,
          invitationReference,
          expiresAt: expiresAt.toISOString(),
        },
        idempotencyKey,
        relatedEntityType: 'site_review_invitation',
        relatedEntityId: invitation.id,
      }, tx);
      await this.email.enqueueEmail({
        tenantId: cycle.tenantId,
        recipientEmail: participant.emailNormalized,
        recipientName: participant.displayName,
        templateKey: 'site-review-notification',
        templateVersion: '1.0.0',
        templateDataJson: {
          tenantName: 'Your website team',
          participantName: participant.displayName,
          heading: 'Reminder: your website draft is waiting',
          message: 'Your secure website review is still open. Please review it before the invitation expires.',
          siteReference,
          reviewReference: cycle.publicReference,
          reviewRevision: cycle.reviewRevision,
          invitationReference,
          expiresAt: expiresAt.toISOString(),
        },
        idempotencyKey: `${idempotencyKey}:reminder:1`,
        relatedEntityType: 'site_review_invitation',
        relatedEntityId: invitation.id,
        scheduledFor: new Date(Date.now() + 3 * 24 * 60 * 60_000),
      }, tx);
      const [outbox] = await tx.select({ id: emailOutbox.id }).from(emailOutbox)
        .where(eq(emailOutbox.idempotencyKey, idempotencyKey)).limit(1);
      if (outbox) {
        await tx.update(siteReviewInvitations).set({ emailOutboxId: outbox.id })
          .where(eq(siteReviewInvitations.id, invitation.id));
      }
      await tx.update(siteReviewParticipants).set({
        status: 'INVITED',
        invitedAt: new Date(),
      }).where(eq(siteReviewParticipants.id, participant.id));
      await this.activity(
        tx as Database,
        cycle.id,
        'SITE_REVIEW_INVITATION_SENT',
        'SITE_REVIEW_INVITATION',
        invitation.publicReference,
        actor,
        undefined,
        { participantReference, reviewRevision: cycle.reviewRevision },
      );
      await this.audit.write(actor, 'SITE_REVIEW_INVITATION_SENT', 'SITE_REVIEW_INVITATION', invitation.publicReference, {
        tenantId: cycle.tenantId,
        category: 'WEBSITE',
        metadata: { reviewCycleReference: reviewReference, participantReference, reviewRevision: cycle.reviewRevision },
        tx,
      });
      return {
        reference: invitation.publicReference,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        idempotentReplay: false,
      };
    });
    return result;
  }

  async revokeParticipant(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    participantReference: string,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    const [participant] = await this.database.select({ id: siteReviewParticipants.id }).from(siteReviewParticipants).where(and(
      eq(siteReviewParticipants.publicReference, participantReference),
      eq(siteReviewParticipants.reviewCycleId, cycle.id),
    )).limit(1);
    if (!participant) throw fail(404, 'SITE_REVIEW_PARTICIPANT_NOT_FOUND', 'Review participant not found.');
    await this.database.transaction(async (tx) => {
      await tx.update(siteReviewParticipants).set({ status: 'REVOKED', revokedAt: new Date() })
        .where(eq(siteReviewParticipants.id, participant.id));
      await tx.update(siteReviewInvitations).set({ status: 'REVOKED', revokedAt: new Date() })
        .where(and(
          eq(siteReviewInvitations.participantId, participant.id),
          inArray(siteReviewInvitations.status, ['PENDING', 'QUEUED', 'SENT', 'OPENED']),
        ));
      await tx.update(siteReviewSessions).set({ revokedAt: new Date() }).where(and(
        eq(siteReviewSessions.participantId, participant.id),
        isNull(siteReviewSessions.revokedAt),
      ));
      await this.activity(
        tx as Database,
        cycle.id,
        'SITE_REVIEW_INVITATION_REVOKED',
        'SITE_REVIEW_PARTICIPANT',
        participantReference,
        actor,
      );
      await this.audit.write(actor, 'SITE_REVIEW_INVITATION_REVOKED', 'SITE_REVIEW_PARTICIPANT', participantReference, {
        tenantId: cycle.tenantId,
        category: 'WEBSITE',
        metadata: { reviewCycleReference: reviewReference },
        tx,
      });
    });
    return { reference: participantReference, status: 'REVOKED' };
  }

  async createAgencyPreviewSession(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    if (!ACTIVE_CYCLE_STATUSES.includes(cycle.status)) {
      throw fail(
        409,
        'SITE_REVIEW_CYCLE_CLOSED',
        'A preview session cannot be created for a closed review cycle.',
      );
    }
    if (cycle.reviewScope === 'FACTS_ONLY') {
      throw fail(
        409,
        'SITE_REVIEW_PREVIEW_OUTSIDE_SCOPE',
        'A fact-only review does not grant access to rendered pages.',
      );
    }
    const [participant] = await this.database.select({
      id: siteReviewParticipants.id,
      reference: siteReviewParticipants.publicReference,
    }).from(siteReviewParticipants).where(and(
      eq(siteReviewParticipants.reviewCycleId, cycle.id),
      eq(siteReviewParticipants.participantType, 'AGENCY_USER'),
      eq(siteReviewParticipants.agencyUserId, actor.agencyUserId),
      eq(siteReviewParticipants.status, 'ACTIVE'),
    )).limit(1);
    if (!participant) {
      throw fail(
        403,
        'SITE_REVIEW_PARTICIPANT_FORBIDDEN',
        'The agency user must be an active participant in this review cycle.',
      );
    }
    const secret = this.environment.SITE_PREVIEW_TOKEN_SECRET;
    const origin = this.environment.PUBLIC_SITES_PREVIEW_ORIGIN;
    if (!secret || secret.length < 32 || !origin) {
      throw fail(
        503,
        'SITE_REVIEW_PREVIEW_UNAVAILABLE',
        'Secure site preview is not configured.',
      );
    }
    const previewTokenJti = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    const token = signSitePreviewToken({
      siteReference: cycle.siteReference,
      versionReference: cycle.versionReference,
      reviewCycleReference: cycle.publicReference,
      purpose: 'AGENCY_REVIEW',
      secret,
      ttlSeconds: 3_600,
      jti: previewTokenJti,
    });
    const [session] = await this.database.transaction(async (tx) => {
      const rows = await tx.insert(siteReviewSessions).values({
        reviewCycleId: cycle.id,
        participantId: participant.id,
        siteId: cycle.siteId,
        siteVersionId: cycle.siteVersionId,
        tokenDigestSha256: digestReviewToken(token),
        previewTokenJti,
        purpose: 'AGENCY_REVIEW',
        allowedScope: cycle.reviewScope,
        expiresAt,
      }).returning();
      await this.activity(
        tx as Database,
        cycle.id,
        'SITE_REVIEW_SESSION_CREATED',
        'SITE_REVIEW_SESSION',
        rows[0].publicReference,
        actor,
        undefined,
        { purpose: 'AGENCY_REVIEW', participantReference: participant.reference },
      );
      await this.audit.write(
        actor,
        'SITE_REVIEW_SESSION_CREATED',
        'SITE_REVIEW_SESSION',
        rows[0].publicReference,
        {
          tenantId: cycle.tenantId,
          category: 'WEBSITE',
          metadata: {
            reviewCycleReference: cycle.publicReference,
            participantReference: participant.reference,
            purpose: 'AGENCY_REVIEW',
          },
          tx,
        },
      );
      return rows;
    });
    return {
      reference: session.publicReference,
      reviewReference: cycle.publicReference,
      siteReference: cycle.siteReference,
      versionReference: cycle.versionReference,
      scope: cycle.reviewScope,
      previewUrl:
        `${origin.replace(/\/$/, '')}/site-preview/${cycle.siteReference}/${cycle.versionReference}`
        + `?token=${encodeURIComponent(token)}`,
      expiresAt,
    };
  }

  async revokeAgencyPreviewSession(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    sessionReference: string,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    const [session] = await this.database.select({
      id: siteReviewSessions.id,
      reference: siteReviewSessions.publicReference,
    }).from(siteReviewSessions)
      .innerJoin(
        siteReviewParticipants,
        eq(siteReviewSessions.participantId, siteReviewParticipants.id),
      )
      .where(and(
        eq(siteReviewSessions.publicReference, sessionReference),
        eq(siteReviewSessions.reviewCycleId, cycle.id),
        eq(siteReviewParticipants.agencyUserId, actor.agencyUserId),
        eq(siteReviewParticipants.participantType, 'AGENCY_USER'),
        isNull(siteReviewSessions.revokedAt),
      ))
      .limit(1);
    if (!session) {
      throw fail(
        404,
        'SITE_REVIEW_SESSION_NOT_FOUND',
        'Active agency preview session not found.',
      );
    }
    await this.database.transaction(async (tx) => {
      await tx.update(siteReviewSessions).set({
        revokedAt: new Date(),
      }).where(eq(siteReviewSessions.id, session.id));
      await this.activity(
        tx as Database,
        cycle.id,
        'SITE_REVIEW_SESSION_REVOKED',
        'SITE_REVIEW_SESSION',
        session.reference,
        actor,
      );
      await this.audit.write(
        actor,
        'SITE_REVIEW_SESSION_REVOKED',
        'SITE_REVIEW_SESSION',
        session.reference,
        {
          tenantId: cycle.tenantId,
          category: 'WEBSITE',
          metadata: { reviewCycleReference: cycle.publicReference },
          tx,
        },
      );
    });
    return { reference: session.reference, revoked: true };
  }

  async listApprovals(siteReference: string, reviewReference: string) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    return this.database.select({
      reference: siteApprovalDecisions.publicReference,
      decision: siteApprovalDecisions.decision,
      approvalLevel: siteApprovalDecisions.approvalLevel,
      approverType: siteApprovalDecisions.approverType,
      approverRole: siteApprovalDecisions.approverRole,
      contentDigestSha256: siteApprovalDecisions.contentDigestSha256,
      openBlockingItemCount: siteApprovalDecisions.openBlockingItemCount,
      openChangeRequestCount: siteApprovalDecisions.openChangeRequestCount,
      notes: siteApprovalDecisions.notes,
      invalidatedAt: siteApprovalDecisions.invalidatedAt,
      invalidationReason: siteApprovalDecisions.invalidationReason,
      decidedAt: siteApprovalDecisions.decidedAt,
    }).from(siteApprovalDecisions)
      .where(eq(siteApprovalDecisions.reviewCycleId, cycle.id))
      .orderBy(desc(siteApprovalDecisions.decidedAt));
  }

  private async recordApproval(
    cycle: Awaited<ReturnType<SiteReviewService['cycleContext']>>,
    input: ApprovalDecisionInput,
    readiness: Awaited<ReturnType<SiteReviewService['evaluateReadiness']>>,
    actor?: AgencyActor,
    participant?: ClientReviewContext,
    lifecycleTransition?: ApprovalLifecycleTransition,
  ) {
    const status = input.decision === 'APPROVE' || input.decision === 'APPROVE_WITH_NOTES'
      ? 'APPROVED'
      : input.decision === 'REQUEST_CHANGES'
        ? 'CHANGES_REQUESTED'
        : input.decision === 'WITHDRAW_APPROVAL' ? 'WITHDRAWN' : 'REJECTED';
    let pageId: string | null = null;
    let itemId: string | null = null;
    if (input.pageReference) {
      const [page] = await this.database.select({ id: sitePages.id }).from(sitePages).where(and(
        eq(sitePages.publicReference, input.pageReference),
        eq(sitePages.versionId, cycle.siteVersionId),
      )).limit(1);
      if (!page) throw fail(404, 'SITE_REVIEW_PAGE_NOT_FOUND', 'Approval page is outside the pinned version.');
      pageId = page.id;
    }
    if (input.reviewItemReference) {
      const [item] = await this.database.select({ id: siteReviewItems.id }).from(siteReviewItems).where(and(
        eq(siteReviewItems.publicReference, input.reviewItemReference),
        eq(siteReviewItems.reviewCycleId, cycle.id),
      )).limit(1);
      if (!item) throw fail(404, 'SITE_REVIEW_ITEM_NOT_FOUND', 'Approval item is outside this review cycle.');
      itemId = item.id;
    }
    return this.database.transaction(async (tx) => {
      const [approval] = await tx.insert(siteApprovals).values({
        tenantId: cycle.tenantId,
        siteId: cycle.siteId,
        versionId: cycle.siteVersionId,
        status,
        requestedByAgencyUserId: actor?.agencyUserId ?? cycle.agencyOwnerUserId,
        respondedByTenantUserId: participant?.participantType === 'TENANT_USER'
          ? (await tx.select({ id: siteReviewParticipants.tenantUserId })
            .from(siteReviewParticipants)
            .where(eq(siteReviewParticipants.id, participant.participantId))
            .limit(1))[0]?.id
          : null,
        responseNote: input.notes,
        respondedAt: new Date(),
        reviewCycleId: cycle.id,
        reviewRevision: cycle.reviewRevision,
        approvalLevel: input.approvalLevel,
        reviewItemId: itemId,
        pageId,
        contentDigestSha256: cycle.pinnedContentDigestSha256,
      }).returning();
      const [decision] = await tx.insert(siteApprovalDecisions).values({
        approvalId: approval.id,
        reviewCycleId: cycle.id,
        siteVersionId: cycle.siteVersionId,
        reviewRevision: cycle.reviewRevision,
        approverType: actor ? 'AGENCY_USER' : participant!.participantType,
        agencyUserId: actor?.agencyUserId,
        participantId: participant?.participantId,
        approverRole: actor ? 'AGENCY_OWNER' : participant!.participantRole,
        decision: input.decision,
        approvalLevel: input.approvalLevel,
        reviewItemId: itemId,
        pageId,
        contentDigestSha256: cycle.pinnedContentDigestSha256,
        openBlockingItemCount: readiness.openBlockingItemCount,
        openChangeRequestCount: readiness.openChangeRequestCount,
        notes: input.notes,
      }).returning();
      await this.audit.write(
        actor ?? null,
        'SITE_APPROVAL_DECISION_RECORDED',
        'SITE_APPROVAL_DECISION',
        decision.publicReference,
        {
          tenantId: cycle.tenantId,
          category: 'WEBSITE',
          sourceComponent: actor ? 'agency-api' : 'site-review-client-api',
          metadata: {
            reviewCycleReference: cycle.publicReference,
            reviewRevision: cycle.reviewRevision,
            approvalLevel: input.approvalLevel,
            decision: input.decision,
            ...(participant ? {
              participantReference: participant.participantReference,
              participantType: participant.participantType,
            } : {}),
          },
          tx,
        },
      );
      if (lifecycleTransition) {
        const updated = await tx.update(siteReviewCycles).set({
          status: lifecycleTransition.targetStatus,
          updatedAt: new Date(),
        }).where(and(
          eq(siteReviewCycles.id, cycle.id),
          eq(siteReviewCycles.status, cycle.status),
        )).returning({ id: siteReviewCycles.id });
        if (updated.length !== 1) {
          throw fail(
            409,
            'SITE_REVIEW_CONCURRENT_TRANSITION',
            'Review status changed; reload before retrying.',
          );
        }
        await this.activity(
          tx as Database,
          cycle.id,
          lifecycleTransition.eventType,
          'SITE_APPROVAL_DECISION',
          decision.publicReference,
          actor,
          participant?.participantId,
          {
            fromStatus: cycle.status,
            toStatus: lifecycleTransition.targetStatus,
            decision: input.decision,
            approvalLevel: input.approvalLevel,
            ...(participant ? { participantType: participant.participantType } : {}),
          },
        );
        await this.audit.write(
          actor ?? null,
          lifecycleTransition.eventType,
          'SITE_APPROVAL_DECISION',
          decision.publicReference,
          {
            tenantId: cycle.tenantId,
            reason: lifecycleTransition.reason,
            category: 'WEBSITE',
            sourceComponent: actor ? 'agency-api' : 'site-review-client-api',
            previousValues: { status: cycle.status },
            newValues: { status: lifecycleTransition.targetStatus },
            metadata: participant ? {
              reviewCycleReference: cycle.publicReference,
              participantReference: participant.participantReference,
              participantType: participant.participantType,
              decision: input.decision,
              approvalLevel: input.approvalLevel,
            } : {
              reviewCycleReference: cycle.publicReference,
              decision: input.decision,
              approvalLevel: input.approvalLevel,
            },
            tx,
          },
        );
        if (lifecycleTransition.notifyParticipants) {
          const agencyApproved =
            lifecycleTransition.targetStatus === 'AGENCY_APPROVED';
          const notification = agencyApproved
            ? {
              key: 'agency-final-approval',
              heading: 'The website review received final agency approval',
              message: 'The current website review revision has completed agency approval.',
            }
            : lifecycleTransition.targetStatus === 'CLIENT_APPROVED'
              ? {
                key: 'client-approved',
                heading: 'The client approved the website review',
                message: 'The client approved the current secure website review revision.',
              }
              : lifecycleTransition.targetStatus === 'CLIENT_CHANGES_REQUESTED'
                ? {
                  key: 'client-changes-requested',
                  heading: 'The client requested website changes',
                  message: 'The client requested changes to the current secure website review revision.',
                }
                : {
                  key: 'client-rejected',
                  heading: 'The client rejected the website review',
                  message: 'The client rejected the current secure website review revision.',
                };
          await this.notifyParticipants(
            tx as Database,
            cycle,
            notification.key,
            notification.heading,
            notification.message,
            decision.publicReference,
            participant?.participantId,
            lifecycleTransition.targetStatus === 'CLIENT_CHANGES_REQUESTED',
          );
        }
      }
      return decision;
    });
  }

  async agencyFinalApproval(
    actor: AgencyActor,
    siteReference: string,
    reviewReference: string,
    input: ApprovalDecisionInput,
  ) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    if (cycle.status !== 'AGENCY_FINAL_REVIEW' || input.approvalLevel !== 'AGENCY_FINAL') {
      throw fail(409, 'SITE_REVIEW_AGENCY_APPROVAL_INVALID', 'Agency final approval requires agency final-review status and scope.');
    }
    const readiness = await this.evaluateReadiness(siteReference, reviewReference, 'AGENCY_APPROVED');
    if (['APPROVE', 'APPROVE_WITH_NOTES'].includes(input.decision)) {
      try {
        assertReadyForApproval(readiness);
      } catch (error) {
        safePolicyError(error);
      }
    }
    const action = ['APPROVE', 'APPROVE_WITH_NOTES'].includes(input.decision)
      ? 'MARK_AGENCY_APPROVED'
      : input.decision === 'REQUEST_CHANGES' ? 'REQUEST_INTERNAL_CHANGES' : 'REJECT';
    const targetStatus = reviewTransitionTarget(action);
    try {
      assertReviewTransition(cycle.status, targetStatus);
    } catch (error) {
      safePolicyError(error);
    }
    const eventType = action === 'MARK_AGENCY_APPROVED'
      ? 'SITE_REVIEW_AGENCY_APPROVED'
      : action === 'REQUEST_INTERNAL_CHANGES'
        ? 'SITE_REVIEW_INTERNAL_CHANGES_REQUESTED'
        : 'SITE_REVIEW_REJECTED';
    const decision = await this.recordApproval(
      cycle,
      input,
      readiness,
      actor,
      undefined,
      {
        targetStatus,
        eventType,
        reason: input.notes,
        notifyParticipants: targetStatus === 'AGENCY_APPROVED',
      },
    );
    return { reference: decision.publicReference, decision: decision.decision, reviewStatus: targetStatus };
  }

  async activityLog(siteReference: string, reviewReference: string) {
    const cycle = await this.cycleContext(siteReference, reviewReference);
    return this.database.select({
      reference: siteReviewActivity.publicReference,
      eventType: siteReviewActivity.eventType,
      actorType: siteReviewActivity.actorType,
      targetType: siteReviewActivity.targetType,
      targetReference: siteReviewActivity.targetPublicReference,
      metadata: siteReviewActivity.safeMetadataJson,
      occurredAt: siteReviewActivity.occurredAt,
    }).from(siteReviewActivity)
      .where(eq(siteReviewActivity.reviewCycleId, cycle.id))
      .orderBy(desc(siteReviewActivity.occurredAt));
  }

  private async loadComparableVersion(siteReference: string, versionReference: string) {
    const [version] = await this.database.select({
      tenantReference: tenants.businessReference,
      siteReference: sites.publicReference,
      versionReference: siteVersions.publicReference,
      versionId: siteVersions.id,
      generationRunId: siteVersions.generationRunId,
    }).from(siteVersions)
      .innerJoin(sites, eq(siteVersions.siteId, sites.id))
      .innerJoin(tenants, eq(siteVersions.tenantId, tenants.id))
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(siteVersions.publicReference, versionReference),
      )).limit(1);
    if (!version) throw fail(404, 'SITE_REVIEW_VERSION_NOT_FOUND', 'Site version not found.');
    const [pageRows, sectionRows, findingRows] = await Promise.all([
      this.database.select().from(sitePages).where(and(
        eq(sitePages.versionId, version.versionId),
        isNull(sitePages.archivedAt),
      )).orderBy(asc(sitePages.sortOrder)),
      this.database.select().from(siteSections)
        .where(eq(siteSections.versionId, version.versionId))
        .orderBy(asc(siteSections.sortOrder)),
      version.generationRunId
        ? this.database.select({
          publicReference: siteGenerationFindings.publicReference,
          category: siteGenerationFindings.category,
          code: siteGenerationFindings.code,
          severity: siteGenerationFindings.severity,
          safeMetadata: siteGenerationFindings.safeMetadataJson,
        }).from(siteGenerationFindings).where(and(
          eq(siteGenerationFindings.generationRunId, version.generationRunId),
          eq(siteGenerationFindings.current, true),
        )).orderBy(asc(siteGenerationFindings.createdAt))
        : Promise.resolve([]),
    ]);
    return {
      tenantReference: version.tenantReference,
      siteReference: version.siteReference,
      versionReference: version.versionReference,
      pages: pageRows.map((page) => ({
        publicReference: page.publicReference,
        slug: page.slug,
        displayOrder: page.sortOrder,
        metadata: {
          title: page.seoTitle,
          description: page.seoDescription,
          seo: page.seoJson,
        },
        navigation: { label: page.navigationLabel },
        bookingAction: sectionRows
          .filter((section) => section.pageId === page.id)
          .flatMap((section) => actionObjects(section.actionsJson))
          .filter((action) => action.type === 'KS_OS_BOOKING'),
        internalLinks: page.internalLinksJson,
        structuredDataInputs: page.structuredDataInputsJson,
        assetReferences: page.assetRequirementsJson,
        sections: sectionRows.filter((section) => section.pageId === page.id).map((section) => ({
          publicReference: section.publicReference,
          sectionType: section.sectionType,
          displayOrder: section.sortOrder,
          content: { content: section.contentJson, actions: section.actionsJson },
        })),
      })),
      findings: findingRows.map((finding, index) => ({
        matchKey: `${finding.category}:${finding.code}:${index}`,
        publicReference: finding.publicReference,
        code: finding.code,
        value: {
          category: finding.category,
          severity: finding.severity,
          safeMetadata: finding.safeMetadata,
        },
      })),
    };
  }

  async compareVersions(
    siteReference: string,
    versionReference: string,
    otherVersionReference: string,
  ) {
    const [previous, current] = await Promise.all([
      this.loadComparableVersion(siteReference, versionReference),
      this.loadComparableVersion(siteReference, otherVersionReference),
    ]);
    try {
      return compareStructuredSiteVersions(previous, current);
    } catch (error) {
      safePolicyError(error);
    }
  }

  async exchangeInvitation(invitationToken: string) {
    if (invitationToken.length < 40 || invitationToken.length > 1_000) {
      throw fail(401, 'SITE_REVIEW_INVITATION_INVALID', 'Review invitation is invalid or expired.');
    }
    const tokenDigest = digestReviewToken(invitationToken);
    const [row] = await this.database.select({
      invitationId: siteReviewInvitations.id,
      invitationReference: siteReviewInvitations.publicReference,
      invitationStatus: siteReviewInvitations.status,
      invitationExpiry: siteReviewInvitations.expiresAt,
      reviewCycleId: siteReviewCycles.id,
      reviewCycleReference: siteReviewCycles.publicReference,
      reviewRevision: siteReviewCycles.reviewRevision,
      reviewStatus: siteReviewCycles.status,
      reviewScope: siteReviewCycles.reviewScope,
      scopedPageId: siteReviewCycles.scopedPageId,
      scopedSectionId: siteReviewCycles.scopedSectionId,
      participantId: siteReviewParticipants.id,
      participantReference: siteReviewParticipants.publicReference,
      participantType: siteReviewParticipants.participantType,
      participantRole: siteReviewParticipants.role,
      participantStatus: siteReviewParticipants.status,
      tenantId: siteReviewCycles.tenantId,
      siteId: siteReviewCycles.siteId,
      siteReference: sites.publicReference,
      versionId: siteReviewCycles.siteVersionId,
      versionReference: siteVersions.publicReference,
      contentDigest: siteReviewCycles.pinnedContentDigestSha256,
    }).from(siteReviewInvitations)
      .innerJoin(siteReviewCycles, eq(siteReviewInvitations.reviewCycleId, siteReviewCycles.id))
      .innerJoin(siteReviewParticipants, eq(siteReviewInvitations.participantId, siteReviewParticipants.id))
      .innerJoin(sites, eq(siteReviewCycles.siteId, sites.id))
      .innerJoin(siteVersions, eq(siteReviewCycles.siteVersionId, siteVersions.id))
      .where(eq(siteReviewInvitations.tokenDigestSha256, tokenDigest))
      .limit(1);
    if (
      !row
      || !['QUEUED', 'SENT', 'OPENED', 'ACCEPTED'].includes(row.invitationStatus)
      || row.invitationExpiry.getTime() <= Date.now()
      || !['INVITED', 'ACTIVE'].includes(row.participantStatus)
      || !CLIENT_ACCESS_STATUSES.includes(ReviewCycleStatusSchema.parse(row.reviewStatus))
    ) {
      throw fail(401, 'SITE_REVIEW_INVITATION_INVALID', 'Review invitation is invalid, expired, revoked, or no longer current.');
    }
    const issued = issueReviewToken();
    const expiresAt = new Date(Math.min(
      row.invitationExpiry.getTime(),
      Date.now() + 2 * 60 * 60_000,
    ));
    const previewTokenJti = randomUUID();
    const [session] = await this.database.transaction(async (tx) => {
      const sessions = await tx.insert(siteReviewSessions).values({
        reviewCycleId: row.reviewCycleId,
        participantId: row.participantId,
        siteId: row.siteId,
        siteVersionId: row.versionId,
        invitationId: row.invitationId,
        tokenDigestSha256: issued.digestSha256,
        previewTokenJti,
        purpose: row.participantRole === 'FACT_VERIFIER' ? 'FACT_VERIFICATION' : 'CLIENT_REVIEW',
        allowedScope: row.reviewScope,
        expiresAt,
      }).returning();
      await tx.update(siteReviewInvitations).set({
        status: 'ACCEPTED',
        openedAt: new Date(),
        acceptedAt: new Date(),
      }).where(eq(siteReviewInvitations.id, row.invitationId));
      await tx.update(siteReviewParticipants).set({
        status: 'ACTIVE',
        acceptedAt: new Date(),
        lastAccessedAt: new Date(),
      }).where(eq(siteReviewParticipants.id, row.participantId));
      await this.activity(
        tx as Database,
        row.reviewCycleId,
        'SITE_REVIEW_SESSION_CREATED',
        'SITE_REVIEW_SESSION',
        sessions[0].publicReference,
        undefined,
        row.participantId,
        { participantType: row.participantType, purpose: sessions[0].purpose },
      );
      return sessions;
    });
    return {
      sessionToken: issued.token,
      session: {
        reference: session.publicReference,
        reviewReference: row.reviewCycleReference,
        siteReference: row.siteReference,
        versionReference: row.versionReference,
        reviewRevision: row.reviewRevision,
        reviewStatus: row.reviewStatus,
        role: row.participantRole,
        scope: row.reviewScope,
        expiresAt,
      },
    };
  }

  async clientContext(sessionToken: string): Promise<ClientReviewContext> {
    if (!sessionToken || sessionToken.length > 256) {
      throw fail(401, 'SITE_REVIEW_SESSION_INVALID', 'Review session is invalid or expired.');
    }
    const tokenDigest = digestReviewToken(sessionToken);
    const [row] = await this.database.select({
      sessionId: siteReviewSessions.id,
      sessionReference: siteReviewSessions.publicReference,
      reviewCycleId: siteReviewCycles.id,
      reviewCycleReference: siteReviewCycles.publicReference,
      reviewRevision: siteReviewCycles.reviewRevision,
      reviewStatus: siteReviewCycles.status,
      reviewScope: siteReviewCycles.reviewScope,
      scopedPageId: siteReviewCycles.scopedPageId,
      scopedSectionId: siteReviewCycles.scopedSectionId,
      participantId: siteReviewParticipants.id,
      participantReference: siteReviewParticipants.publicReference,
      participantType: siteReviewParticipants.participantType,
      participantRole: siteReviewParticipants.role,
      tenantId: siteReviewCycles.tenantId,
      siteId: siteReviewCycles.siteId,
      siteReference: sites.publicReference,
      versionId: siteReviewCycles.siteVersionId,
      versionReference: siteVersions.publicReference,
      contentDigestSha256: siteReviewCycles.pinnedContentDigestSha256,
      previewTokenJti: siteReviewSessions.previewTokenJti,
      expiresAt: siteReviewSessions.expiresAt,
      revokedAt: siteReviewSessions.revokedAt,
      participantStatus: siteReviewParticipants.status,
    }).from(siteReviewSessions)
      .innerJoin(siteReviewCycles, eq(siteReviewSessions.reviewCycleId, siteReviewCycles.id))
      .innerJoin(siteReviewParticipants, eq(siteReviewSessions.participantId, siteReviewParticipants.id))
      .innerJoin(sites, eq(siteReviewCycles.siteId, sites.id))
      .innerJoin(siteVersions, eq(siteReviewCycles.siteVersionId, siteVersions.id))
      .where(eq(siteReviewSessions.tokenDigestSha256, tokenDigest))
      .limit(1);
    if (
      !row
      || row.revokedAt
      || row.expiresAt.getTime() <= Date.now()
      || row.participantStatus !== 'ACTIVE'
      || !CLIENT_ACCESS_STATUSES.includes(ReviewCycleStatusSchema.parse(row.reviewStatus))
    ) {
      throw fail(401, 'SITE_REVIEW_SESSION_INVALID', 'Review session is invalid, expired, revoked, or outside the active review.');
    }
    await this.database.update(siteReviewSessions).set({ lastAccessedAt: new Date() })
      .where(eq(siteReviewSessions.id, row.sessionId));
    await this.database.update(siteReviewParticipants).set({ lastAccessedAt: new Date() })
      .where(eq(siteReviewParticipants.id, row.participantId));
    return {
      ...row,
      reviewStatus: ReviewCycleStatusSchema.parse(row.reviewStatus),
      participantRole: row.participantRole as ReviewParticipantRole,
    };
  }

  async revokeSession(context: ClientReviewContext) {
    await this.database.update(siteReviewSessions).set({ revokedAt: new Date() })
      .where(eq(siteReviewSessions.id, context.sessionId));
    return { revoked: true };
  }

  private previewUrl(context: ClientReviewContext) {
    if (context.reviewScope === 'FACTS_ONLY') return null;
    const secret = this.environment.SITE_PREVIEW_TOKEN_SECRET;
    const origin = this.environment.PUBLIC_SITES_PREVIEW_ORIGIN;
    if (!secret || secret.length < 32 || !origin) return null;
    const token = signSitePreviewToken({
      siteReference: context.siteReference,
      versionReference: context.versionReference,
      reviewCycleReference: context.reviewCycleReference,
      purpose: 'CLIENT_REVIEW',
      secret,
      ttlSeconds: Math.max(
        60,
        Math.min(
          3_600,
          Math.floor((context.expiresAt.getTime() - Date.now()) / 1_000),
        ),
      ),
      jti: context.previewTokenJti,
    });
    return `${origin.replace(/\/$/, '')}/site-preview/${context.siteReference}/${context.versionReference}?token=${encodeURIComponent(token)}`;
  }

  async clientSessionDto(context: ClientReviewContext) {
    return {
      reference: context.sessionReference,
      reviewReference: context.reviewCycleReference,
      siteReference: context.siteReference,
      versionReference: context.versionReference,
      reviewRevision: context.reviewRevision,
      reviewStatus: context.reviewStatus,
      role: context.participantRole,
      scope: context.reviewScope,
      previewUrl: this.previewUrl(context),
      expiresAt: context.expiresAt,
    };
  }

  async clientSite(context: ClientReviewContext) {
    const [site] = await this.database.select({
      reference: sites.publicReference,
      displayName: sites.displayName,
      status: sites.status,
    }).from(sites).where(eq(sites.id, context.siteId)).limit(1);
    return {
      ...site,
      reviewReference: context.reviewCycleReference,
      versionReference: context.versionReference,
      reviewStatus: context.reviewStatus,
      previewUrl: this.previewUrl(context),
    };
  }

  async clientPages(context: ClientReviewContext, pageReference?: string) {
    if (context.reviewScope === 'FACTS_ONLY') return [];
    const pageRows = await this.database.select({
      id: sitePages.id,
      reference: sitePages.publicReference,
      title: sitePages.title,
      navigationLabel: sitePages.navigationLabel,
      slug: sitePages.slug,
      pageType: sitePages.pageType,
      conversionRole: sitePages.conversionRole,
      sortOrder: sitePages.sortOrder,
      seoTitle: sitePages.seoTitle,
      seoDescription: sitePages.seoDescription,
      internalLinks: sitePages.internalLinksJson,
      structuredDataInputs: sitePages.structuredDataInputsJson,
      assetRequirements: sitePages.assetRequirementsJson,
    }).from(sitePages).where(and(
      eq(sitePages.versionId, context.versionId),
      isNull(sitePages.archivedAt),
      ...(['PAGE', 'SECTION'].includes(context.reviewScope) && context.scopedPageId
        ? [eq(sitePages.id, context.scopedPageId)]
        : []),
      ...(pageReference ? [eq(sitePages.publicReference, pageReference)] : []),
    )).orderBy(asc(sitePages.sortOrder));
    const ids = pageRows.map((page) => page.id);
    const sectionRows = ids.length === 0 ? [] : await this.database.select({
      pageId: siteSections.pageId,
      reference: siteSections.publicReference,
      sectionKey: siteSections.sectionKey,
      sectionType: siteSections.sectionType,
      sortOrder: siteSections.sortOrder,
      content: siteSections.contentJson,
      actions: siteSections.actionsJson,
    }).from(siteSections).where(and(
      eq(siteSections.versionId, context.versionId),
      inArray(siteSections.pageId, ids),
      ...(context.reviewScope === 'SECTION' && context.scopedSectionId
        ? [eq(siteSections.id, context.scopedSectionId)]
        : []),
    )).orderBy(asc(siteSections.sortOrder));
    const safe = pageRows.map(({ id, ...page }) => ({
      ...page,
      path: page.slug === 'home' ? '/' : `/${page.slug}`,
      sections: sectionRows.filter((section) => section.pageId === id).map((section) => {
        const { pageId: _pageId, ...publicSection } = section;
        return publicSection;
      }),
    }));
    return toClientSafeValue(safe);
  }

  async addClientComment(context: ClientReviewContext, input: CreateCommentInput) {
    this.assertClientMutationOpen(context);
    try {
      assertParticipantCan(context.participantRole, 'COMMENT');
    } catch (error) {
      safePolicyError(error);
    }
    const cycle = await this.cycleContext(context.siteReference, context.reviewCycleReference);
    const targets = await this.resolveCommentTargets(cycle, input);
    const [comment] = await this.database.transaction(async (tx) => {
      const rows = await tx.insert(siteReviewComments).values({
        reviewCycleId: cycle.id,
        reviewItemId: targets.reviewItemId,
        pageId: targets.pageId,
        sectionId: targets.sectionId,
        fieldPath: input.anchor?.fieldPath,
        authorType: context.participantType,
        tenantUserId: context.participantType === 'TENANT_USER'
          ? (await tx.select({ id: siteReviewParticipants.tenantUserId })
            .from(siteReviewParticipants)
            .where(eq(siteReviewParticipants.id, context.participantId))
            .limit(1))[0]?.id
          : null,
        participantId: context.participantId,
        body: input.body,
        visibility: 'CLIENT_VISIBLE',
        parentCommentId: targets.parentCommentId,
        anchorJson: input.anchor ?? {},
      }).returning();
      await this.activity(
        tx as Database,
        cycle.id,
        'SITE_REVIEW_COMMENT_ADDED',
        'SITE_REVIEW_COMMENT',
        rows[0].publicReference,
        undefined,
        context.participantId,
        { participantType: context.participantType },
      );
      await this.audit.write(
        null,
        'SITE_REVIEW_COMMENT_ADDED',
        'SITE_REVIEW_COMMENT',
        rows[0].publicReference,
        {
          tenantId: cycle.tenantId,
          category: 'WEBSITE',
          sourceComponent: 'site-review-client-api',
          metadata: {
            reviewCycleReference: cycle.publicReference,
            participantReference: context.participantReference,
            participantType: context.participantType,
          },
          tx,
        },
      );
      await this.notifyParticipants(
        tx as Database,
        cycle,
        'client-comment-added',
        'A website review comment was added',
        'There is a new client comment in the secure website review.',
        rows[0].publicReference,
        context.participantId,
      );
      return rows;
    });
    return { reference: comment.publicReference, status: comment.status };
  }

  async resolveClientComment(context: ClientReviewContext, commentReference: string) {
    this.assertClientMutationOpen(context);
    const [comment] = await this.database.select({
      id: siteReviewComments.id,
      participantId: siteReviewComments.participantId,
    }).from(siteReviewComments).where(and(
      eq(siteReviewComments.publicReference, commentReference),
      eq(siteReviewComments.reviewCycleId, context.reviewCycleId),
      eq(siteReviewComments.status, 'OPEN'),
      eq(siteReviewComments.visibility, 'CLIENT_VISIBLE'),
    )).limit(1);
    if (!comment) throw fail(404, 'SITE_REVIEW_COMMENT_NOT_FOUND', 'Open client-visible comment not found.');
    const canResolveAny = participantCan(context.participantRole, 'RESOLVE');
    const canResolveOwn = participantCan(context.participantRole, 'RESOLVE_OWN')
      && comment.participantId === context.participantId;
    if (!canResolveAny && !canResolveOwn) {
      throw fail(403, 'SITE_REVIEW_PARTICIPANT_FORBIDDEN', 'Participant cannot resolve this comment.');
    }
    await this.database.transaction(async (tx) => {
      await tx.update(siteReviewComments).set({
        status: 'RESOLVED',
        resolvedByParticipantId: context.participantId,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(siteReviewComments.id, comment.id));
      await this.activity(
        tx as Database,
        context.reviewCycleId,
        'SITE_REVIEW_COMMENT_RESOLVED',
        'SITE_REVIEW_COMMENT',
        commentReference,
        undefined,
        context.participantId,
        { participantType: context.participantType },
      );
      await this.audit.write(
        null,
        'SITE_REVIEW_COMMENT_RESOLVED',
        'SITE_REVIEW_COMMENT',
        commentReference,
        {
          tenantId: context.tenantId,
          category: 'WEBSITE',
          sourceComponent: 'site-review-client-api',
          metadata: {
            reviewCycleReference: context.reviewCycleReference,
            participantReference: context.participantReference,
            participantType: context.participantType,
          },
          tx,
        },
      );
    });
    return { reference: commentReference, status: 'RESOLVED' };
  }

  async addClientChangeRequest(context: ClientReviewContext, input: CreateChangeRequestInput) {
    this.assertClientMutationOpen(context);
    try {
      assertParticipantCan(context.participantRole, 'CHANGE_REQUEST');
    } catch (error) {
      safePolicyError(error);
    }
    const cycle = await this.cycleContext(context.siteReference, context.reviewCycleReference);
    return this.insertChangeRequest(cycle, input, undefined, context);
  }

  private async assertFactSource(
    context: ClientReviewContext,
    fact: {
      factType: string;
      sourceEntityType: string;
      sourceEntityReference: string | null;
    },
  ) {
    if (!fact.sourceEntityReference) return;
    if (['SERVICE_NAME', 'SERVICE_DESCRIPTION', 'SERVICE_PRICE', 'SERVICE_DURATION'].includes(fact.factType)) {
      const [service] = await this.database.select({ id: services.id }).from(services).where(and(
        eq(services.publicReference, fact.sourceEntityReference),
        eq(services.tenantId, context.tenantId),
      )).limit(1);
      if (!service) throw fail(409, 'SITE_REVIEW_FACT_SOURCE_INVALID', 'Service fact is not backed by this tenant.');
    } else if (fact.factType.startsWith('STAFF_')) {
      const [staff] = await this.database.select({ id: users.id }).from(users).where(and(
        eq(users.publicReference, fact.sourceEntityReference),
        eq(users.tenantId, context.tenantId),
      )).limit(1);
      if (!staff) throw fail(409, 'SITE_REVIEW_FACT_SOURCE_INVALID', 'Staff fact is not backed by this tenant.');
    } else if (fact.factType === 'LOCATION' || fact.factType === 'ADDRESS') {
      const [location] = await this.database.select({ id: locations.id }).from(locations).where(and(
        eq(locations.publicReference, fact.sourceEntityReference),
        eq(locations.tenantId, context.tenantId),
      )).limit(1);
      if (!location) throw fail(409, 'SITE_REVIEW_FACT_SOURCE_INVALID', 'Location fact is not backed by this tenant.');
    } else if (fact.sourceEntityType === 'GENERATION_CLAIM') {
      const [claim] = await this.database.select({ status: siteGenerationClaims.claimStatus }).from(siteGenerationClaims).where(and(
        eq(siteGenerationClaims.publicReference, fact.sourceEntityReference),
        eq(siteGenerationClaims.tenantId, context.tenantId),
      )).limit(1);
      if (!claim || ['UNSUPPORTED', 'PROHIBITED'].includes(claim.status)) {
        throw fail(409, 'SITE_REVIEW_FACT_GENERATED_CLAIM_INVALID', 'Unsupported or prohibited generated claims cannot be confirmed.');
      }
    }
  }

  async clientFactResponse(
    context: ClientReviewContext,
    factReference: string,
    input: z.infer<typeof FactResponseSchema>,
  ) {
    this.assertClientMutationOpen(context);
    try {
      assertParticipantCan(context.participantRole, 'FACT');
    } catch (error) {
      safePolicyError(error);
    }
    const [fact] = await this.database.select({
      id: siteFactVerifications.id,
      reference: siteFactVerifications.publicReference,
      factType: siteFactVerifications.factType,
      sourceEntityType: siteFactVerifications.sourceEntityType,
      sourceEntityReference: siteFactVerifications.sourceEntityReference,
      status: siteFactVerifications.status,
    }).from(siteFactVerifications).where(and(
      eq(siteFactVerifications.publicReference, factReference),
      eq(siteFactVerifications.reviewCycleId, context.reviewCycleId),
      eq(siteFactVerifications.tenantId, context.tenantId),
    )).limit(1);
    if (!fact) throw fail(404, 'SITE_REVIEW_FACT_NOT_FOUND', 'Fact-verification item not found.');
    await this.assertFactSource(context, fact);
    const status = input.response === 'CONFIRM' ? 'CONFIRMED' : 'DISPUTED';
    await this.database.transaction(async (tx) => {
      await tx.update(siteFactVerifications).set({
        status,
        clientResponse: input.note,
        respondedByParticipantId: context.participantId,
        confirmedAt: status === 'CONFIRMED' ? new Date() : null,
        disputedAt: status === 'DISPUTED' ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(siteFactVerifications.id, fact.id));
      await this.activity(
        tx as Database,
        context.reviewCycleId,
        status === 'CONFIRMED' ? 'SITE_FACT_CONFIRMED' : 'SITE_FACT_DISPUTED',
        'SITE_FACT_VERIFICATION',
        factReference,
        undefined,
        context.participantId,
        { factType: fact.factType, participantType: context.participantType },
      );
      if (status === 'DISPUTED') {
        const inputRequest = CreateChangeRequestSchema.parse({
          category: 'FACT_CORRECTION',
          priority: 'HIGH',
          title: `Fact disputed: ${fact.factType.replaceAll('_', ' ').toLowerCase()}`,
          description: input.note!,
          requestedOutcome: 'Agency verification and correction required.',
        });
        const [request] = await tx.insert(siteChangeRequests).values({
          tenantId: context.tenantId,
          siteId: context.siteId,
          versionId: context.versionId,
          reviewCycleId: context.reviewCycleId,
          category: inputRequest.category,
          priority: inputRequest.priority,
          title: inputRequest.title,
          description: inputRequest.description,
          requestedOutcome: inputRequest.requestedOutcome,
          submittedByType: context.participantType,
          submittedByParticipantId: context.participantId,
          status: 'OPEN',
        }).returning();
        await tx.insert(siteChangeRequestEvents).values({
          changeRequestId: request.id,
          reviewCycleId: context.reviewCycleId,
          eventType: 'CREATED',
          toStatus: 'OPEN',
          actorType: context.participantType,
          participantId: context.participantId,
          safeMetadataJson: { source: 'FACT_DISPUTE', factReference },
        });
      }
      await this.audit.write(
        null,
        status === 'CONFIRMED' ? 'SITE_FACT_CONFIRMED' : 'SITE_FACT_DISPUTED',
        'SITE_FACT_VERIFICATION',
        factReference,
        {
          tenantId: context.tenantId,
          category: 'WEBSITE',
          sourceComponent: 'site-review-client-api',
          metadata: {
            reviewCycleReference: context.reviewCycleReference,
            participantReference: context.participantReference,
            participantType: context.participantType,
            factType: fact.factType,
          },
          tx,
        },
      );
    });
    return { reference: factReference, status };
  }

  async clientSummary(context: ClientReviewContext) {
    const [items, comments, changes, facts, approvals] = await Promise.all([
      this.listItems(context.siteReference, context.reviewCycleReference, true),
      this.listComments(context.siteReference, context.reviewCycleReference, true),
      this.listChangeRequests(context.siteReference, context.reviewCycleReference, true),
      this.listFacts(context.siteReference, context.reviewCycleReference, true),
      this.listApprovals(context.siteReference, context.reviewCycleReference),
    ]);
    return {
      reviewReference: context.reviewCycleReference,
      siteReference: context.siteReference,
      versionReference: context.versionReference,
      status: context.reviewStatus,
      progress: summarizeReviewProgress({
        totalItems: items.length,
        approvedItems: items.filter((item) => item.status === 'APPROVED').length,
        openComments: comments.filter((comment) => comment.status === 'OPEN').length,
        openChangeRequests: changes.filter((change) => OPEN_CHANGE_STATUSES.includes(change.status as typeof OPEN_CHANGE_STATUSES[number])).length,
        disputedFacts: facts.filter((fact) => fact.status === 'DISPUTED').length,
      }),
      approvalStatus: approvals.filter((approval) =>
        !approval.invalidatedAt
        && approval.contentDigestSha256 === context.contentDigestSha256),
    };
  }

  async clientDecision(
    context: ClientReviewContext,
    input: ApprovalDecisionInput,
  ) {
    try {
      assertParticipantCan(context.participantRole, 'CLIENT_APPROVE');
    } catch (error) {
      safePolicyError(error);
    }
    if (input.approvalLevel !== 'CLIENT_FINAL') {
      throw fail(400, 'SITE_REVIEW_CLIENT_APPROVAL_SCOPE_INVALID', 'Client final decisions require CLIENT_FINAL scope.');
    }
    const cycle = await this.cycleContext(context.siteReference, context.reviewCycleReference);
    if (cycle.status !== 'CLIENT_REVIEW') {
      throw fail(409, 'SITE_REVIEW_CLIENT_DECISION_STATUS_INVALID', 'Client decision requires active client review.');
    }
    const readiness = await this.evaluateReadiness(
      context.siteReference,
      context.reviewCycleReference,
      input.decision === 'APPROVE' || input.decision === 'APPROVE_WITH_NOTES'
        ? 'CLIENT_APPROVED'
        : 'CLIENT_CHANGES_REQUESTED',
    );
    if (['APPROVE', 'APPROVE_WITH_NOTES'].includes(input.decision)) {
      try {
        assertReadyForApproval(readiness);
      } catch (error) {
        safePolicyError(error);
      }
    }
    const next = ['APPROVE', 'APPROVE_WITH_NOTES'].includes(input.decision)
      ? 'CLIENT_APPROVED'
      : input.decision === 'REQUEST_CHANGES' ? 'CLIENT_CHANGES_REQUESTED' : 'REJECTED';
    try {
      assertReviewTransition(cycle.status, next);
    } catch (error) {
      safePolicyError(error);
    }
    const event = next === 'CLIENT_APPROVED'
      ? 'SITE_REVIEW_CLIENT_APPROVED'
      : next === 'CLIENT_CHANGES_REQUESTED'
        ? 'SITE_REVIEW_CLIENT_CHANGES_REQUESTED'
        : 'SITE_REVIEW_CLIENT_REJECTED';
    const decision = await this.recordApproval(
      cycle,
      input,
      readiness,
      undefined,
      context,
      {
        targetStatus: next,
        eventType: event,
        reason: input.notes,
        notifyParticipants: true,
      },
    );
    return {
      reference: decision.publicReference,
      decision: decision.decision,
      reviewStatus: next,
    };
  }

  private async comparePreviousReviewRevision(context: ClientReviewContext) {
    if (context.reviewRevision <= 1) return null;
    const [previousCycle] = await this.database.select({
      id: siteReviewCycles.id,
      publicReference: siteReviewCycles.publicReference,
      reviewRevision: siteReviewCycles.reviewRevision,
      contentDigest: siteReviewCycles.pinnedContentDigestSha256,
    }).from(siteReviewCycles).where(and(
      eq(siteReviewCycles.siteVersionId, context.versionId),
      eq(siteReviewCycles.reviewRevision, context.reviewRevision - 1),
    )).limit(1);
    if (!previousCycle) return null;
    const loadSnapshot = async (sourceDigest: string) => {
      const [row] = await this.database.select({
        content: siteRenderSnapshots.contentJson,
      }).from(siteRenderSnapshots).where(and(
        eq(siteRenderSnapshots.tenantId, context.tenantId),
        eq(siteRenderSnapshots.siteId, context.siteId),
        eq(siteRenderSnapshots.siteVersionId, context.versionId),
        eq(siteRenderSnapshots.snapshotKind, 'PREVIEW'),
        eq(siteRenderSnapshots.sourceContentDigestSha256, sourceDigest),
      )).orderBy(desc(siteRenderSnapshots.revision)).limit(1);
      return row ? validatePublishedSnapshot(row.content) : null;
    };
    const loadFacts = async (reviewCycleId: string) => {
      const rows = await this.database.select({
        publicReference: siteFactVerifications.publicReference,
        factType: siteFactVerifications.factType,
        sourceEntityType: siteFactVerifications.sourceEntityType,
        sourceEntityReference: siteFactVerifications.sourceEntityReference,
        displayLabel: siteFactVerifications.displayLabel,
        value: siteFactVerifications.proposedPublicValue,
      }).from(siteFactVerifications).where(eq(
        siteFactVerifications.reviewCycleId,
        reviewCycleId,
      ));
      return rows.map((fact) => ({
        matchKey: [
          fact.factType,
          fact.sourceEntityType,
          fact.sourceEntityReference ?? fact.displayLabel,
        ].join(':'),
        publicReference: fact.publicReference,
        factType: fact.factType,
        value: fact.value,
      }));
    };
    const [previousSnapshot, currentSnapshot, previousFacts, currentFacts] =
      await Promise.all([
        loadSnapshot(previousCycle.contentDigest),
        loadSnapshot(context.contentDigestSha256),
        loadFacts(previousCycle.id),
        loadFacts(context.reviewCycleId),
      ]);
    if (!previousSnapshot || !currentSnapshot) return null;
    const previous = comparableSnapshot(previousSnapshot, previousFacts);
    const current = comparableSnapshot(currentSnapshot, currentFacts);
    if (context.reviewScope === 'FACTS_ONLY') {
      previous.pages = [];
      current.pages = [];
    }
    const comparison = compareStructuredSiteVersions(previous, current);
    return {
      ...comparison,
      fromReviewReference: previousCycle.publicReference,
      fromReviewRevision: previousCycle.reviewRevision,
      toReviewReference: context.reviewCycleReference,
      toReviewRevision: context.reviewRevision,
    };
  }

  private async scopeClientComparison<
    T extends ReturnType<typeof compareStructuredSiteVersions>,
  >(
    context: ClientReviewContext,
    comparison: T,
  ) {
    if (context.reviewScope === 'FACTS_ONLY') {
      const changes = comparison.changes.filter((change) =>
        change.targetType === 'FACT');
      const summary = {
        ADDED: 0,
        REMOVED: 0,
        CHANGED: 0,
        MOVED: 0,
        UNCHANGED: changes.length === 0 ? 1 : 0,
      };
      for (const change of changes) summary[change.changeType] += 1;
      return {
        ...comparison,
        digestSha256: digestValue(changes),
        summary,
        changes,
      };
    }
    const clientVisibleChanges = comparison.changes.filter((change) =>
      change.targetType !== 'GENERATION_FINDING');
    if (!['PAGE', 'SECTION'].includes(context.reviewScope)) {
      const summary = {
        ADDED: 0,
        REMOVED: 0,
        CHANGED: 0,
        MOVED: 0,
        UNCHANGED: clientVisibleChanges.length === 0 ? 1 : 0,
      };
      for (const change of clientVisibleChanges) summary[change.changeType] += 1;
      return {
        ...comparison,
        digestSha256: digestValue(clientVisibleChanges),
        summary,
        changes: clientVisibleChanges,
      };
    }
    const [scopedPage] = context.scopedPageId
      ? await this.database.select({ reference: sitePages.publicReference })
        .from(sitePages)
        .where(eq(sitePages.id, context.scopedPageId))
        .limit(1)
      : [];
    const [scopedSection] = context.scopedSectionId
      ? await this.database.select({ reference: siteSections.publicReference })
        .from(siteSections)
        .where(eq(siteSections.id, context.scopedSectionId))
        .limit(1)
      : [];
    const changes = clientVisibleChanges.filter((change) =>
      change.pageReference === scopedPage?.reference
      && (
        context.reviewScope === 'PAGE'
        || change.sectionReference === scopedSection?.reference
      ));
    const summary = {
      ADDED: 0,
      REMOVED: 0,
      CHANGED: 0,
      MOVED: 0,
      UNCHANGED: changes.length === 0 ? 1 : 0,
    };
    for (const change of changes) summary[change.changeType] += 1;
    return {
      ...comparison,
      digestSha256: digestValue(changes),
      summary,
      changes,
    };
  }

  async clientCompare(context: ClientReviewContext) {
    const reviewRevisionComparison = await this.comparePreviousReviewRevision(context);
    if (reviewRevisionComparison) {
      return this.scopeClientComparison(context, reviewRevisionComparison);
    }
    const [cycle] = await this.database.select({
      previousVersionId: siteVersions.basedOnVersionId,
    }).from(siteReviewCycles)
      .innerJoin(siteVersions, eq(siteReviewCycles.siteVersionId, siteVersions.id))
      .where(eq(siteReviewCycles.id, context.reviewCycleId))
      .limit(1);
    if (!cycle?.previousVersionId) {
      return {
        fromVersionReference: null,
        toVersionReference: context.versionReference,
        digestSha256: digestValue([]),
        truncated: false,
        summary: { ADDED: 0, REMOVED: 0, CHANGED: 0, MOVED: 0, UNCHANGED: 1 },
        changes: [],
      };
    }
    const [previous] = await this.database.select({
      reference: siteVersions.publicReference,
      tenantId: siteVersions.tenantId,
      siteId: siteVersions.siteId,
    }).from(siteVersions).where(eq(siteVersions.id, cycle.previousVersionId)).limit(1);
    if (!previous || previous.tenantId !== context.tenantId || previous.siteId !== context.siteId) {
      throw fail(409, 'SITE_REVIEW_COMPARISON_SCOPE_INVALID', 'Previous version is outside the review site.');
    }
    const comparison = await this.compareVersions(
      context.siteReference,
      previous.reference,
      context.versionReference,
    );
    return this.scopeClientComparison(context, comparison);
  }
}
