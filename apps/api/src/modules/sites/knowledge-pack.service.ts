import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lt,
  ne,
  sql,
} from 'drizzle-orm';
import {
  agencyUsers,
  getDatabase,
  knowledgeConflicts,
  knowledgeImportFindings,
  knowledgeImportRuns,
  knowledgePacks,
  knowledgePagePlaybooks,
  knowledgeRejectedRules,
  knowledgeRuleConversionRoles,
  knowledgeRulePageTypes,
  knowledgeRuleSectionTypes,
  knowledgeRules,
  knowledgeRuleSources,
  knowledgeSectionPlaybooks,
  knowledgeSources,
} from '@ks-os/database';
import {
  CreateKnowledgePackSchema,
  KnowledgeConflictSchema,
  KnowledgeImportBundleSchema,
  KnowledgeImportFormatSchema,
  KnowledgePackListQuerySchema,
  KnowledgePackStatusSchema,
  KnowledgeRuleSchema,
  prepareSiteGenerationKnowledgeContext,
  ReviseKnowledgePackSchema,
  UpdateKnowledgePackSchema,
  UpdateKnowledgeRuleSchema,
  assertKnowledgePackContentMutable,
  compareKnowledgePacks,
  contentDigest,
  validateKnowledgePack,
  type KnowledgeConflict,
  type KnowledgeImportBundle,
  type KnowledgePackStatus,
  type KnowledgeRule,
  type PrepareSiteGenerationKnowledgeContextInput,
  type SelectableKnowledgePack,
} from '@ks-os/site-knowledge';
import type { z } from 'zod';
import {
  AgencyAuditService,
  type AgencyActor,
} from '../agency/agency.service.js';

type Database = ReturnType<typeof getDatabase>;
type ImportFormat = z.infer<typeof KnowledgeImportFormatSchema>;

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function assertStatus(value: string): KnowledgePackStatus {
  return KnowledgePackStatusSchema.parse(value);
}

export class AgencyKnowledgePackService {
  constructor(
    private readonly database: Database = getDatabase(),
    private readonly audit = new AgencyAuditService(),
  ) {}

  async create(
    actor: AgencyActor,
    input: z.input<typeof CreateKnowledgePackSchema>,
  ) {
    const parsed = CreateKnowledgePackSchema.parse(input);
    const [pack] = await this.database.insert(knowledgePacks).values({
      ...parsed,
      schemaVersion: 1,
      createdByAgencyUserId: actor.agencyUserId,
    }).returning();
    await this.audit.write(
      actor,
      'KNOWLEDGE_PACK_CREATED',
      'KNOWLEDGE_PACK',
      pack.publicReference,
      {
        category: 'WEBSITE',
        metadata: {
          semanticVersion: pack.semanticVersion,
          intendedScope: pack.intendedScope,
        },
      },
    );
    return this.safePack(pack);
  }

  async list(input: z.input<typeof KnowledgePackListQuerySchema>) {
    const query = KnowledgePackListQuerySchema.parse(input);
    const conditions = [];
    if (query.status) conditions.push(eq(knowledgePacks.status, query.status));
    if (query.intendedScope) {
      conditions.push(eq(knowledgePacks.intendedScope, query.intendedScope));
    }
    if (query.before) conditions.push(lt(knowledgePacks.createdAt, query.before));
    const rows = await this.database.select()
      .from(knowledgePacks)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(knowledgePacks.createdAt), desc(knowledgePacks.publicReference))
      .limit(query.limit);
    return rows.map(row => this.safePack(row));
  }

  async get(packReference: string) {
    return this.safePack(await this.pack(packReference));
  }

  async update(
    actor: AgencyActor,
    packReference: string,
    input: z.input<typeof UpdateKnowledgePackSchema>,
  ) {
    const parsed = UpdateKnowledgePackSchema.parse(input);
    const current = await this.pack(packReference);
    assertKnowledgePackContentMutable(assertStatus(current.status));
    const status = current.status === 'READY_FOR_APPROVAL'
      ? 'REVIEW_REQUIRED'
      : current.status;
    const [updated] = await this.database.update(knowledgePacks).set({
      name: parsed.name,
      description: parsed.description,
      status,
      updatedAt: new Date(),
    }).where(eq(knowledgePacks.id, current.id)).returning();
    return this.safePack(updated);
  }

  async importBundle(
    actor: AgencyActor,
    packReference: string,
    importFormat: ImportFormat,
    input: KnowledgeImportBundle,
  ) {
    const bundle = KnowledgeImportBundleSchema.parse(input);
    try {
      return await this.database.transaction(async transaction => {
        await transaction.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${`knowledge-import:${packReference}:${bundle.sourceDigest}`}::text,
              0
            )
          )
        `);
        const lockResult = await transaction.execute(sql`
          SELECT *
          FROM knowledge_packs
          WHERE public_reference = ${packReference}::uuid
          FOR UPDATE
        `);
        const pack = lockResult.rows[0] as {
          id?: string;
          name?: string;
          semantic_version?: string;
          intended_scope?: string;
          status?: string;
          source_digest_sha256?: string | null;
        } | undefined;
        if (!pack?.id || !pack.status) {
          throw fail(404, 'KNOWLEDGE_PACK_NOT_FOUND', 'Knowledge pack not found.');
        }
        assertKnowledgePackContentMutable(assertStatus(pack.status));
        if (
          pack.name !== bundle.pack.name
          || pack.semantic_version !== bundle.pack.semanticVersion
          || pack.intended_scope !== bundle.pack.intendedScope
        ) {
          throw fail(
            409,
            'KNOWLEDGE_IMPORT_PACK_METADATA_MISMATCH',
            'Import metadata does not match the target draft pack.',
          );
        }
        const [existing] = await transaction.select({
          reference: knowledgeImportRuns.publicReference,
          status: knowledgeImportRuns.status,
        }).from(knowledgeImportRuns).where(and(
          eq(knowledgeImportRuns.knowledgePackId, pack.id),
          eq(knowledgeImportRuns.sourceDigestSha256, bundle.sourceDigest),
        )).limit(1);
        if (existing?.status === 'COMPLETED') {
          return {
            importReference: existing.reference,
            status: 'COMPLETED' as const,
            idempotentReplay: true,
          };
        }
        if (
          pack.source_digest_sha256
          && pack.source_digest_sha256 !== bundle.sourceDigest
        ) {
          throw fail(
            409,
            'KNOWLEDGE_PACK_REVISION_REQUIRED',
            'Changed source data must be imported into a new draft revision.',
          );
        }

        await transaction.update(knowledgePacks).set({
          status: 'IMPORTING',
          updatedAt: new Date(),
        }).where(eq(knowledgePacks.id, pack.id));
        const [run] = await transaction.insert(knowledgeImportRuns).values({
          knowledgePackId: pack.id,
          importFormat,
          sourceDigestSha256: bundle.sourceDigest,
          requestedByAgencyUserId: actor.agencyUserId,
        }).returning();
        await this.audit.write(
          actor,
          'KNOWLEDGE_PACK_IMPORT_STARTED',
          'KNOWLEDGE_PACK',
          packReference,
          {
            category: 'WEBSITE',
            metadata: {
              importReference: run.publicReference,
              importFormat,
              sourceDigest: bundle.sourceDigest,
            },
            tx: transaction,
          },
        );

        const insertedSources = bundle.sources.length
          ? await transaction.insert(knowledgeSources).values(
            bundle.sources.map(source => ({
              knowledgePackId: pack.id!,
              sourceId: source.sourceId,
              sourceTitle: source.sourceTitle,
              author: source.author,
              editionOrVersion: source.editionOrVersion,
              sourceType: source.sourceType,
              topicDomainsJson: source.topicDomains,
              evidenceAuthority: source.evidenceAuthority,
              supportCapability: source.supportCapability,
              strengthOfSupport: source.strengthOfSupport,
              temporalClass: source.temporalClass,
              citationLocationsJson: source.citationLocations,
              copyrightNotes: source.copyrightNotes,
              verifiedAt: source.verifiedAt,
              reviewDueAt: source.reviewDueAt,
              reviewNotes: source.reviewNotes,
              contentDigestSha256: source.contentDigest,
            })),
          ).returning()
          : [];
        const sourceByIdentifier = new Map(
          insertedSources.map(source => [source.sourceId, source]),
        );
        const insertedRules = bundle.rules.length
          ? await transaction.insert(knowledgeRules).values(
            bundle.rules.map(rule => ({
              knowledgePackId: pack.id!,
              ruleId: rule.ruleId,
              ruleName: rule.ruleName,
              ruleScope: rule.ruleScope,
              domain: rule.domain,
              subcategory: rule.subcategory,
              principle: rule.principle,
              whyItMatters: rule.whyItMatters,
              implementationInstruction: rule.implementationInstruction,
              priority: rule.priority,
              validationType: rule.validationType,
              publicationEffect: rule.publicationEffect,
              enforcementAuthority: rule.enforcementAuthority,
              requiredBusinessDataJson: rule.requiredBusinessData,
              prohibitedBehaviour: rule.prohibitedBehaviour,
              antiPattern: rule.antiPattern,
              deterministicTestDescription: rule.deterministicTestDescription,
              aiReviewInstruction: rule.aiReviewInstruction,
              humanReviewInstruction: rule.humanReviewInstruction,
              supportType: rule.supportType,
              temporalClass: rule.temporalClass,
              verificationSourceIdsJson: rule.verificationSourceIds,
              verifiedAt: rule.verifiedAt,
              reviewDueAt: rule.reviewDueAt,
              confidence: String(rule.confidence),
              notes: rule.notes,
              status: rule.status,
              contentDigestSha256: rule.contentDigest,
            })),
          ).returning()
          : [];
        const ruleByIdentifier = new Map(
          insertedRules.map(rule => [rule.ruleId, rule]),
        );

        const pageApplicability = bundle.rules.flatMap(rule => {
          const row = ruleByIdentifier.get(rule.ruleId)!;
          return rule.applicablePageTypes.map(pageType => ({
            knowledgePackId: pack.id!,
            knowledgeRuleId: row.id,
            pageType,
          }));
        });
        if (pageApplicability.length) {
          await transaction.insert(knowledgeRulePageTypes)
            .values(pageApplicability);
        }
        const sectionApplicability = bundle.rules.flatMap(rule => {
          const row = ruleByIdentifier.get(rule.ruleId)!;
          return rule.applicableSectionTypes.map(sectionType => ({
            knowledgePackId: pack.id!,
            knowledgeRuleId: row.id,
            sectionType,
          }));
        });
        if (sectionApplicability.length) {
          await transaction.insert(knowledgeRuleSectionTypes)
            .values(sectionApplicability);
        }
        const conversionApplicability = bundle.rules.flatMap(rule => {
          const row = ruleByIdentifier.get(rule.ruleId)!;
          return rule.conversionRoles.map(conversionRole => ({
            knowledgePackId: pack.id!,
            knowledgeRuleId: row.id,
            conversionRole,
          }));
        });
        if (conversionApplicability.length) {
          await transaction.insert(knowledgeRuleConversionRoles)
            .values(conversionApplicability);
        }
        const ruleSources = bundle.rules.flatMap(rule => {
          const ruleRow = ruleByIdentifier.get(rule.ruleId)!;
          const support = rule.sourceIds.flatMap(sourceId => {
            const source = sourceByIdentifier.get(sourceId);
            return source ? [{
              knowledgePackId: pack.id!,
              knowledgeRuleId: ruleRow.id,
              knowledgeSourceId: source.id,
              relationshipType: 'SUPPORT' as const,
            }] : [];
          });
          const verification = rule.verificationSourceIds
            .filter(sourceId => !rule.sourceIds.includes(sourceId))
            .flatMap(sourceId => {
              const source = sourceByIdentifier.get(sourceId);
              return source ? [{
                knowledgePackId: pack.id!,
                knowledgeRuleId: ruleRow.id,
                knowledgeSourceId: source.id,
                relationshipType: 'VERIFICATION' as const,
              }] : [];
            });
          return [...support, ...verification];
        });
        if (ruleSources.length) {
          await transaction.insert(knowledgeRuleSources).values(ruleSources);
        }

        let sectionPlaybookCount = 0;
        for (const page of bundle.pagePlaybooks) {
          const [pageRow] = await transaction.insert(knowledgePagePlaybooks)
            .values({
              knowledgePackId: pack.id,
              pageType: page.pageType,
              conversionRole: page.conversionRole,
              contentDigestSha256: page.contentDigest,
            }).returning();
          await transaction.insert(knowledgeSectionPlaybooks).values(
            page.sections.map(section => ({
              knowledgePackId: pack.id!,
              pagePlaybookId: pageRow.id,
              sectionType: section.sectionType,
              sectionOrderMin: section.sectionOrderMin,
              sectionOrderMax: section.sectionOrderMax,
              requirement: section.requirement,
              userIntent: section.userIntent,
              businessObjective: section.businessObjective,
              sectionPurpose: section.sectionPurpose,
              requiredBusinessDataJson: section.requiredBusinessData,
              copyInstruction: section.copyInstruction,
              seoInstruction: section.seoInstruction,
              trustInstruction: section.trustInstruction,
              bookingInstruction: section.bookingInstruction,
              mobileInstruction: section.mobileInstruction,
              accessibilityInstruction: section.accessibilityInstruction,
              allowedPrimaryCtaTypesJson: section.allowedPrimaryCtaTypes,
              allowedSecondaryCtaTypesJson: section.allowedSecondaryCtaTypes,
              blockingConditionsJson: section.blockingConditions,
              commonAntiPatternsJson: section.commonAntiPatterns,
              ruleIdsJson: section.ruleIds,
              sourceIdsJson: section.sourceIds,
              confidence: String(section.confidence),
              notes: section.notes,
              contentDigestSha256: section.contentDigest,
            })),
          );
          sectionPlaybookCount += page.sections.length;
        }
        if (bundle.rejectedRules.length) {
          await transaction.insert(knowledgeRejectedRules).values(
            bundle.rejectedRules.map(rule => ({
              knowledgePackId: pack.id!,
              ruleId: rule.ruleId,
              ruleName: rule.ruleName,
              rejectionReason: rule.rejectionReason,
            })),
          );
        }
        const report = validateKnowledgePack(bundle);
        if (report.findings.length) {
          await transaction.insert(knowledgeImportFindings).values(
            report.findings.map(entry => ({
              knowledgePackId: pack.id!,
              importRunId: run.id,
              severity: entry.severity,
              category: entry.category,
              code: entry.code,
              message: entry.message,
              blocksApproval: entry.blocksApproval,
              ruleId: entry.ruleId,
              sourceId: entry.sourceId,
              pageType: entry.pageType,
              sectionType: entry.sectionType,
            })),
          );
        }
        if (report.conflicts.length) {
          await transaction.insert(knowledgeConflicts).values(
            report.conflicts.map(entry => ({
              knowledgePackId: pack.id!,
              importRunId: run.id,
              conflictType: entry.conflictType,
              severity: entry.severity,
              summary: entry.summary,
              ruleIdsJson: entry.ruleIds,
              pageType: entry.pageType,
              sectionType: entry.sectionType,
            })),
          );
        }
        await transaction.update(knowledgeImportRuns).set({
          status: 'COMPLETED',
          sourceCount: bundle.sources.length,
          ruleCount: bundle.rules.length,
          pagePlaybookCount: bundle.pagePlaybooks.length,
          sectionPlaybookCount,
          rejectedRuleCount: bundle.rejectedRules.length,
          findingCount: report.findings.length,
          conflictCount: report.conflicts.length,
          completedAt: new Date(),
        }).where(eq(knowledgeImportRuns.id, run.id));
        await transaction.update(knowledgePacks).set({
          status: 'REVIEW_REQUIRED',
          sourceDigestSha256: bundle.sourceDigest,
          contentDigestSha256: report.contentDigest,
          sourceCount: bundle.sources.length,
          ruleCount: bundle.rules.length,
          pagePlaybookCount: bundle.pagePlaybooks.length,
          sectionPlaybookCount,
          findingCount: report.findings.length,
          conflictCount: report.conflicts.length,
          updatedAt: new Date(),
        }).where(eq(knowledgePacks.id, pack.id));
        await this.audit.write(
          actor,
          'KNOWLEDGE_PACK_IMPORT_COMPLETED',
          'KNOWLEDGE_PACK',
          packReference,
          {
            category: 'WEBSITE',
            metadata: {
              importReference: run.publicReference,
              sourceCount: bundle.sources.length,
              ruleCount: bundle.rules.length,
              pagePlaybookCount: bundle.pagePlaybooks.length,
              sectionPlaybookCount,
              findingCount: report.findings.length,
              conflictCount: report.conflicts.length,
            },
            tx: transaction,
          },
        );
        return {
          importReference: run.publicReference,
          status: 'COMPLETED' as const,
          idempotentReplay: false,
          validation: report,
        };
      });
    } catch (error) {
      await this.audit.write(
        actor,
        'KNOWLEDGE_PACK_IMPORT_FAILED',
        'KNOWLEDGE_PACK',
        packReference,
        {
          category: 'WEBSITE',
          outcome: 'FAILED',
          reason: String(
            (error as { code?: string }).code
            ?? 'KNOWLEDGE_PACK_IMPORT_FAILED',
          ),
        },
      );
      throw error;
    }
  }

  async validate(actor: AgencyActor, packReference: string) {
    const packRow = await this.pack(packReference);
    assertKnowledgePackContentMutable(assertStatus(packRow.status));
    const bundle = await this.loadBundle(packRow.id);
    const report = validateKnowledgePack(bundle);
    await this.database.transaction(async transaction => {
      await transaction.update(knowledgeImportFindings).set({ current: false })
        .where(and(
          eq(knowledgeImportFindings.knowledgePackId, packRow.id),
          eq(knowledgeImportFindings.current, true),
        ));
      await transaction.update(knowledgeConflicts).set({ current: false })
        .where(and(
          eq(knowledgeConflicts.knowledgePackId, packRow.id),
          eq(knowledgeConflicts.current, true),
        ));
      if (report.findings.length) {
        await transaction.insert(knowledgeImportFindings).values(
          report.findings.map(entry => ({
            knowledgePackId: packRow.id,
            severity: entry.severity,
            category: entry.category,
            code: entry.code,
            message: entry.message,
            blocksApproval: entry.blocksApproval,
            ruleId: entry.ruleId,
            sourceId: entry.sourceId,
            pageType: entry.pageType,
            sectionType: entry.sectionType,
          })),
        );
      }
      if (report.conflicts.length) {
        await transaction.insert(knowledgeConflicts).values(
          report.conflicts.map(entry => ({
            knowledgePackId: packRow.id,
            conflictType: entry.conflictType,
            severity: entry.severity,
            summary: entry.summary,
            ruleIdsJson: entry.ruleIds,
            pageType: entry.pageType,
            sectionType: entry.sectionType,
          })),
        );
      }
      await transaction.update(knowledgePacks).set({
        status: report.readyForApproval
          ? 'READY_FOR_APPROVAL'
          : 'REVIEW_REQUIRED',
        contentDigestSha256: report.contentDigest,
        findingCount: report.findings.length,
        conflictCount: report.conflicts.length,
        updatedAt: new Date(),
      }).where(eq(knowledgePacks.id, packRow.id));
      await this.audit.write(
        actor,
        'KNOWLEDGE_PACK_VALIDATED',
        'KNOWLEDGE_PACK',
        packReference,
        {
          category: 'WEBSITE',
          metadata: {
            readyForApproval: report.readyForApproval,
            findingCount: report.findings.length,
            conflictCount: report.conflicts.length,
            contentDigest: report.contentDigest,
          },
          tx: transaction,
        },
      );
    });
    return report;
  }

  async approve(actor: AgencyActor, packReference: string, reason: string) {
    return this.database.transaction(async transaction => {
      const result = await transaction.execute(sql`
        SELECT id, status, finding_count, conflict_count, content_digest_sha256
        FROM knowledge_packs
        WHERE public_reference = ${packReference}::uuid
        FOR UPDATE
      `);
      const pack = result.rows[0] as {
        id?: string;
        status?: string;
        content_digest_sha256?: string | null;
      } | undefined;
      if (!pack?.id) throw fail(404, 'KNOWLEDGE_PACK_NOT_FOUND', 'Knowledge pack not found.');
      if (pack.status !== 'READY_FOR_APPROVAL' || !pack.content_digest_sha256) {
        throw fail(
          409,
          'KNOWLEDGE_PACK_NOT_READY',
          'The pack must pass governance validation before approval.',
        );
      }
      const blockingFindings = await transaction.select({
        id: knowledgeImportFindings.id,
      }).from(knowledgeImportFindings).where(and(
        eq(knowledgeImportFindings.knowledgePackId, pack.id),
        eq(knowledgeImportFindings.current, true),
        eq(knowledgeImportFindings.blocksApproval, true),
      )).limit(1);
      const criticalConflicts = await transaction.select({
        id: knowledgeConflicts.id,
      }).from(knowledgeConflicts).where(and(
        eq(knowledgeConflicts.knowledgePackId, pack.id),
        eq(knowledgeConflicts.current, true),
        eq(knowledgeConflicts.status, 'OPEN'),
        eq(knowledgeConflicts.severity, 'CRITICAL'),
      )).limit(1);
      if (blockingFindings.length || criticalConflicts.length) {
        throw fail(
          409,
          'KNOWLEDGE_PACK_APPROVAL_BLOCKED',
          'Blocking findings or critical conflicts remain unresolved.',
        );
      }
      const [updated] = await transaction.update(knowledgePacks).set({
        status: 'APPROVED',
        approvedByAgencyUserId: actor.agencyUserId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(knowledgePacks.id, pack.id)).returning();
      await this.audit.write(
        actor,
        'KNOWLEDGE_PACK_APPROVED',
        'KNOWLEDGE_PACK',
        packReference,
        { category: 'WEBSITE', reason, tx: transaction },
      );
      return this.safePack(updated);
    });
  }

  async activate(actor: AgencyActor, packReference: string, reason: string) {
    return this.database.transaction(async transaction => {
      const lookup = await transaction.execute(sql`
        SELECT id, status, intended_scope
        FROM knowledge_packs
        WHERE public_reference = ${packReference}::uuid
        FOR UPDATE
      `);
      const pack = lookup.rows[0] as {
        id?: string;
        status?: string;
        intended_scope?: string;
      } | undefined;
      if (!pack?.id || !pack.intended_scope) {
        throw fail(404, 'KNOWLEDGE_PACK_NOT_FOUND', 'Knowledge pack not found.');
      }
      if (pack.status !== 'APPROVED') {
        throw fail(
          409,
          'KNOWLEDGE_PACK_NOT_APPROVED',
          'Only an approved pack can be activated.',
        );
      }
      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`knowledge-active-scope:${pack.intended_scope}`}::text,
            0
          )
        )
      `);
      await transaction.execute(sql`
        SELECT id
        FROM knowledge_packs
        WHERE intended_scope = ${pack.intended_scope}
          AND status = 'ACTIVE'
        FOR UPDATE
      `);
      await transaction.update(knowledgePacks).set({
        status: 'SUPERSEDED',
        supersededByPackId: pack.id,
        updatedAt: new Date(),
      }).where(and(
        eq(knowledgePacks.intendedScope, pack.intended_scope),
        eq(knowledgePacks.status, 'ACTIVE'),
        ne(knowledgePacks.id, pack.id),
      ));
      const [updated] = await transaction.update(knowledgePacks).set({
        status: 'ACTIVE',
        activatedByAgencyUserId: actor.agencyUserId,
        activatedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(knowledgePacks.id, pack.id)).returning();
      const active = await transaction.select({
        id: knowledgePacks.id,
      }).from(knowledgePacks).where(and(
        eq(knowledgePacks.intendedScope, pack.intended_scope),
        eq(knowledgePacks.status, 'ACTIVE'),
      ));
      if (active.length !== 1 || active[0].id !== pack.id) {
        throw fail(
          500,
          'KNOWLEDGE_PACK_ACTIVE_INVARIANT_FAILED',
          'Exactly one active pack must exist for the intended scope.',
        );
      }
      await this.audit.write(
        actor,
        'KNOWLEDGE_PACK_ACTIVATED',
        'KNOWLEDGE_PACK',
        packReference,
        { category: 'WEBSITE', reason, tx: transaction },
      );
      return this.safePack(updated);
    });
  }

  async retire(actor: AgencyActor, packReference: string, reason: string) {
    const pack = await this.pack(packReference);
    if (!['APPROVED', 'ACTIVE'].includes(pack.status)) {
      throw fail(
        409,
        'KNOWLEDGE_PACK_NOT_RETIRABLE',
        'Only approved or active packs can be retired.',
      );
    }
    const [updated] = await this.database.update(knowledgePacks).set({
      status: 'RETIRED',
      retiredByAgencyUserId: actor.agencyUserId,
      retiredAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(knowledgePacks.id, pack.id)).returning();
    await this.audit.write(
      actor,
      'KNOWLEDGE_PACK_RETIRED',
      'KNOWLEDGE_PACK',
      packReference,
      { category: 'WEBSITE', reason },
    );
    return this.safePack(updated);
  }

  async revise(
    actor: AgencyActor,
    packReference: string,
    input: z.input<typeof ReviseKnowledgePackSchema>,
  ) {
    const parsed = ReviseKnowledgePackSchema.parse(input);
    const pack = await this.pack(packReference);
    if (!['APPROVED', 'ACTIVE', 'RETIRED', 'SUPERSEDED'].includes(pack.status)) {
      throw fail(
        409,
        'KNOWLEDGE_PACK_REVISION_NOT_ALLOWED',
        'Only an immutable pack can start a new draft revision.',
      );
    }
    const [revision] = await this.database.insert(knowledgePacks).values({
      name: pack.name,
      description: pack.description,
      semanticVersion: parsed.semanticVersion,
      intendedScope: pack.intendedScope,
      schemaVersion: pack.schemaVersion,
      revisionOfPackId: pack.id,
      createdByAgencyUserId: actor.agencyUserId,
    }).returning();
    await this.audit.write(
      actor,
      'KNOWLEDGE_PACK_REVISION_CREATED',
      'KNOWLEDGE_PACK',
      revision.publicReference,
      {
        category: 'WEBSITE',
        reason: parsed.reason,
        metadata: { revisedPackReference: packReference },
      },
    );
    return this.safePack(revision);
  }

  async rules(packReference: string) {
    const pack = await this.pack(packReference);
    const bundle = await this.loadBundle(pack.id);
    return bundle.rules;
  }

  async rule(packReference: string, ruleId: string) {
    const rules = await this.rules(packReference);
    const rule = rules.find(entry => entry.ruleId === ruleId);
    if (!rule) throw fail(404, 'KNOWLEDGE_RULE_NOT_FOUND', 'Knowledge rule not found.');
    return rule;
  }

  async updateRule(
    actor: AgencyActor,
    packReference: string,
    ruleId: string,
    input: z.input<typeof UpdateKnowledgeRuleSchema>,
  ) {
    const update = UpdateKnowledgeRuleSchema.parse(input);
    const pack = await this.pack(packReference);
    assertKnowledgePackContentMutable(assertStatus(pack.status));
    const current = await this.rule(packReference, ruleId);
    const nextWithoutDigest = { ...current, ...update, ruleId };
    const next = KnowledgeRuleSchema.parse({
      ...nextWithoutDigest,
      contentDigest: contentDigest({
        ...nextWithoutDigest,
        contentDigest: undefined,
      }),
    });
    await this.database.transaction(async transaction => {
      const [row] = await transaction.select({
        id: knowledgeRules.id,
      }).from(knowledgeRules).where(and(
        eq(knowledgeRules.knowledgePackId, pack.id),
        eq(knowledgeRules.ruleId, ruleId),
      )).limit(1);
      if (!row) throw fail(404, 'KNOWLEDGE_RULE_NOT_FOUND', 'Knowledge rule not found.');
      await transaction.update(knowledgeRules).set({
        ruleName: next.ruleName,
        ruleScope: next.ruleScope,
        domain: next.domain,
        subcategory: next.subcategory,
        principle: next.principle,
        whyItMatters: next.whyItMatters,
        implementationInstruction: next.implementationInstruction,
        priority: next.priority,
        validationType: next.validationType,
        publicationEffect: next.publicationEffect,
        enforcementAuthority: next.enforcementAuthority,
        requiredBusinessDataJson: next.requiredBusinessData,
        prohibitedBehaviour: next.prohibitedBehaviour,
        antiPattern: next.antiPattern,
        deterministicTestDescription: next.deterministicTestDescription,
        aiReviewInstruction: next.aiReviewInstruction,
        humanReviewInstruction: next.humanReviewInstruction,
        supportType: next.supportType,
        temporalClass: next.temporalClass,
        verificationSourceIdsJson: next.verificationSourceIds,
        verifiedAt: next.verifiedAt,
        reviewDueAt: next.reviewDueAt,
        confidence: String(next.confidence),
        notes: next.notes,
        status: next.status,
        contentDigestSha256: next.contentDigest,
        updatedAt: new Date(),
      }).where(eq(knowledgeRules.id, row.id));
      await transaction.delete(knowledgeRulePageTypes)
        .where(eq(knowledgeRulePageTypes.knowledgeRuleId, row.id));
      await transaction.delete(knowledgeRuleSectionTypes)
        .where(eq(knowledgeRuleSectionTypes.knowledgeRuleId, row.id));
      await transaction.delete(knowledgeRuleConversionRoles)
        .where(eq(knowledgeRuleConversionRoles.knowledgeRuleId, row.id));
      await transaction.delete(knowledgeRuleSources)
        .where(eq(knowledgeRuleSources.knowledgeRuleId, row.id));
      if (next.applicablePageTypes.length) {
        await transaction.insert(knowledgeRulePageTypes).values(
          next.applicablePageTypes.map(pageType => ({
            knowledgePackId: pack.id,
            knowledgeRuleId: row.id,
            pageType,
          })),
        );
      }
      if (next.applicableSectionTypes.length) {
        await transaction.insert(knowledgeRuleSectionTypes).values(
          next.applicableSectionTypes.map(sectionType => ({
            knowledgePackId: pack.id,
            knowledgeRuleId: row.id,
            sectionType,
          })),
        );
      }
      if (next.conversionRoles.length) {
        await transaction.insert(knowledgeRuleConversionRoles).values(
          next.conversionRoles.map(conversionRole => ({
            knowledgePackId: pack.id,
            knowledgeRuleId: row.id,
            conversionRole,
          })),
        );
      }
      const requestedSourceIds = [
        ...new Set([...next.sourceIds, ...next.verificationSourceIds]),
      ];
      const sourceRows = requestedSourceIds.length
        ? await transaction.select({
          id: knowledgeSources.id,
          sourceId: knowledgeSources.sourceId,
        }).from(knowledgeSources).where(and(
          eq(knowledgeSources.knowledgePackId, pack.id),
          inArray(knowledgeSources.sourceId, requestedSourceIds),
        ))
        : [];
      const sourceByIdentifier = new Map(
        sourceRows.map(source => [source.sourceId, source]),
      );
      const missingSourceIds = requestedSourceIds.filter(
        sourceId => !sourceByIdentifier.has(sourceId),
      );
      if (missingSourceIds.length) {
        throw fail(
          400,
          'KNOWLEDGE_RULE_SOURCE_NOT_FOUND',
          `Knowledge source not found: ${missingSourceIds.join(', ')}.`,
        );
      }
      const sourceLinks = [
        ...next.sourceIds.map(sourceId => ({
          knowledgePackId: pack.id,
          knowledgeRuleId: row.id,
          knowledgeSourceId: sourceByIdentifier.get(sourceId)!.id,
          relationshipType: 'SUPPORT' as const,
        })),
        ...next.verificationSourceIds
          .filter(sourceId => !next.sourceIds.includes(sourceId))
          .map(sourceId => ({
            knowledgePackId: pack.id,
            knowledgeRuleId: row.id,
            knowledgeSourceId: sourceByIdentifier.get(sourceId)!.id,
            relationshipType: 'VERIFICATION' as const,
          })),
      ];
      if (sourceLinks.length) {
        await transaction.insert(knowledgeRuleSources).values(sourceLinks);
      }
      if (pack.status === 'READY_FOR_APPROVAL') {
        await transaction.update(knowledgePacks).set({
          status: 'REVIEW_REQUIRED',
          updatedAt: new Date(),
        }).where(eq(knowledgePacks.id, pack.id));
      }
      await this.audit.write(
        actor,
        'KNOWLEDGE_RULE_UPDATED',
        'KNOWLEDGE_RULE',
        ruleId,
        {
          category: 'WEBSITE',
          metadata: {
            packReference,
            changedFields: Object.keys(update),
          },
          tx: transaction,
        },
      );
    });
    return next;
  }

  async imports(packReference: string) {
    const pack = await this.pack(packReference);
    return this.database.select({
      reference: knowledgeImportRuns.publicReference,
      importFormat: knowledgeImportRuns.importFormat,
      sourceDigest: knowledgeImportRuns.sourceDigestSha256,
      status: knowledgeImportRuns.status,
      sourceCount: knowledgeImportRuns.sourceCount,
      ruleCount: knowledgeImportRuns.ruleCount,
      pagePlaybookCount: knowledgeImportRuns.pagePlaybookCount,
      sectionPlaybookCount: knowledgeImportRuns.sectionPlaybookCount,
      rejectedRuleCount: knowledgeImportRuns.rejectedRuleCount,
      findingCount: knowledgeImportRuns.findingCount,
      conflictCount: knowledgeImportRuns.conflictCount,
      failureCode: knowledgeImportRuns.failureCode,
      startedAt: knowledgeImportRuns.startedAt,
      completedAt: knowledgeImportRuns.completedAt,
    }).from(knowledgeImportRuns)
      .where(eq(knowledgeImportRuns.knowledgePackId, pack.id))
      .orderBy(asc(knowledgeImportRuns.startedAt), asc(knowledgeImportRuns.id));
  }

  async findings(packReference: string) {
    const pack = await this.pack(packReference);
    return this.database.select({
      reference: knowledgeImportFindings.publicReference,
      severity: knowledgeImportFindings.severity,
      category: knowledgeImportFindings.category,
      code: knowledgeImportFindings.code,
      message: knowledgeImportFindings.message,
      blocksApproval: knowledgeImportFindings.blocksApproval,
      ruleId: knowledgeImportFindings.ruleId,
      sourceId: knowledgeImportFindings.sourceId,
      pageType: knowledgeImportFindings.pageType,
      sectionType: knowledgeImportFindings.sectionType,
      createdAt: knowledgeImportFindings.createdAt,
    }).from(knowledgeImportFindings).where(and(
      eq(knowledgeImportFindings.knowledgePackId, pack.id),
      eq(knowledgeImportFindings.current, true),
    )).orderBy(
      desc(knowledgeImportFindings.blocksApproval),
      asc(knowledgeImportFindings.severity),
      asc(knowledgeImportFindings.code),
      asc(knowledgeImportFindings.id),
    );
  }

  async pagePlaybooks(packReference: string) {
    const pack = await this.pack(packReference);
    return (await this.loadBundle(pack.id)).pagePlaybooks;
  }

  async sources(packReference: string) {
    const pack = await this.pack(packReference);
    return (await this.loadBundle(pack.id)).sources;
  }

  async conflicts(packReference: string) {
    const pack = await this.pack(packReference);
    return this.database.select({
      reference: knowledgeConflicts.publicReference,
      conflictType: knowledgeConflicts.conflictType,
      severity: knowledgeConflicts.severity,
      summary: knowledgeConflicts.summary,
      ruleIds: knowledgeConflicts.ruleIdsJson,
      pageType: knowledgeConflicts.pageType,
      sectionType: knowledgeConflicts.sectionType,
      status: knowledgeConflicts.status,
      resolutionReason: knowledgeConflicts.resolutionReason,
      resolvedAt: knowledgeConflicts.resolvedAt,
      createdAt: knowledgeConflicts.createdAt,
    }).from(knowledgeConflicts).where(and(
      eq(knowledgeConflicts.knowledgePackId, pack.id),
      eq(knowledgeConflicts.current, true),
    )).orderBy(
      asc(knowledgeConflicts.status),
      asc(knowledgeConflicts.severity),
      asc(knowledgeConflicts.createdAt),
      asc(knowledgeConflicts.id),
    );
  }

  async resolveConflict(
    actor: AgencyActor,
    packReference: string,
    conflictReference: string,
    resolution: 'RESOLVED' | 'DISMISSED',
    reason: string,
  ) {
    const pack = await this.pack(packReference);
    assertKnowledgePackContentMutable(assertStatus(pack.status));
    const [record] = await this.database.update(knowledgeConflicts).set({
      status: resolution,
      resolutionReason: reason,
      resolvedByAgencyUserId: actor.agencyUserId,
      resolvedAt: new Date(),
    }).where(and(
      eq(knowledgeConflicts.knowledgePackId, pack.id),
      eq(knowledgeConflicts.publicReference, conflictReference),
      eq(knowledgeConflicts.current, true),
      eq(knowledgeConflicts.status, 'OPEN'),
    )).returning();
    if (!record) throw fail(404, 'KNOWLEDGE_CONFLICT_NOT_FOUND', 'Open conflict not found.');
    await this.audit.write(
      actor,
      'KNOWLEDGE_CONFLICT_RESOLVED',
      'KNOWLEDGE_CONFLICT',
      conflictReference,
      {
        category: 'WEBSITE',
        reason,
        metadata: { packReference, resolution },
      },
    );
    return {
      reference: record.publicReference,
      status: record.status,
      resolvedAt: record.resolvedAt,
    };
  }

  async compare(packReference: string, otherPackReference: string) {
    const [left, right] = await Promise.all([
      this.pack(packReference),
      this.pack(otherPackReference),
    ]);
    const [leftBundle, rightBundle, leftConflicts, rightConflicts] = await Promise.all([
      this.loadBundle(left.id),
      this.loadBundle(right.id),
      this.loadConflicts(left.id),
      this.loadConflicts(right.id),
    ]);
    return compareKnowledgePacks(
      leftBundle,
      rightBundle,
      leftConflicts,
      rightConflicts,
    );
  }

  async activeCount(intendedScope: 'PUBLIC_SITE') {
    const rows = await this.database.select({
      id: knowledgePacks.id,
    }).from(knowledgePacks).where(and(
      eq(knowledgePacks.intendedScope, intendedScope),
      eq(knowledgePacks.status, 'ACTIVE'),
    ));
    return rows.length;
  }

  async resolveActive(
    intendedScope: 'PUBLIC_SITE' = 'PUBLIC_SITE',
  ): Promise<SelectableKnowledgePack> {
    const rows = await this.database.select().from(knowledgePacks).where(and(
      eq(knowledgePacks.intendedScope, intendedScope),
      eq(knowledgePacks.status, 'ACTIVE'),
    )).limit(2);
    if (rows.length !== 1) {
      throw fail(
        409,
        'ACTIVE_KNOWLEDGE_PACK_INVARIANT_FAILED',
        'Exactly one active knowledge pack is required for this scope.',
      );
    }
    const pack = rows[0];
    return {
      reference: pack.publicReference,
      semanticVersion: pack.semanticVersion,
      schemaVersion: pack.schemaVersion,
      status: 'ACTIVE',
      bundle: await this.loadBundle(pack.id),
      conflicts: await this.loadConflicts(pack.id),
    };
  }

  async prepareGenerationContext(
    input: Omit<PrepareSiteGenerationKnowledgeContextInput, 'pack'>,
  ) {
    return prepareSiteGenerationKnowledgeContext({
      ...input,
      pack: await this.resolveActive('PUBLIC_SITE'),
    });
  }

  async resolveActorByReference(agencyUserReference: string): Promise<AgencyActor> {
    const [agencyUser] = await this.database.select({
      id: agencyUsers.id,
      role: agencyUsers.role,
    }).from(agencyUsers)
      .where(eq(agencyUsers.publicReference, agencyUserReference))
      .limit(1);
    if (!agencyUser) {
      throw fail(
        404,
        'AGENCY_USER_NOT_FOUND',
        'Agency user reference was not found.',
      );
    }
    if (!['PLATFORM_OWNER', 'AGENCY_ADMINISTRATOR'].includes(agencyUser.role)) {
      throw fail(
        403,
        'KNOWLEDGE_APPROVAL_CAPABILITY_REQUIRED',
        'The import actor cannot approve or activate knowledge packs.',
      );
    }
    return {
      agencyUserId: agencyUser.id,
      role: agencyUser.role as AgencyActor['role'],
    };
  }

  private async pack(packReference: string) {
    const [pack] = await this.database.select().from(knowledgePacks)
      .where(eq(knowledgePacks.publicReference, packReference))
      .limit(1);
    if (!pack) throw fail(404, 'KNOWLEDGE_PACK_NOT_FOUND', 'Knowledge pack not found.');
    return pack;
  }

  private safePack(pack: typeof knowledgePacks.$inferSelect) {
    return {
      reference: pack.publicReference,
      name: pack.name,
      description: pack.description,
      semanticVersion: pack.semanticVersion,
      intendedScope: pack.intendedScope,
      status: pack.status,
      schemaVersion: pack.schemaVersion,
      sourceDigest: pack.sourceDigestSha256,
      contentDigest: pack.contentDigestSha256,
      counts: {
        sources: pack.sourceCount,
        rules: pack.ruleCount,
        pagePlaybooks: pack.pagePlaybookCount,
        sectionPlaybooks: pack.sectionPlaybookCount,
        findings: pack.findingCount,
        conflicts: pack.conflictCount,
      },
      approvedAt: pack.approvedAt,
      activatedAt: pack.activatedAt,
      retiredAt: pack.retiredAt,
      createdAt: pack.createdAt,
      updatedAt: pack.updatedAt,
    };
  }

  private async loadBundle(packId: string): Promise<KnowledgeImportBundle> {
    const [pack] = await this.database.select().from(knowledgePacks)
      .where(eq(knowledgePacks.id, packId))
      .limit(1);
    if (!pack?.sourceDigestSha256) {
      throw fail(
        409,
        'KNOWLEDGE_PACK_NOT_IMPORTED',
        'The knowledge pack has no completed import.',
      );
    }
    const [
      sourceRows,
      ruleRows,
      pageTypeRows,
      sectionTypeRows,
      conversionRoleRows,
      sourceLinkRows,
      pageRows,
      sectionRows,
      rejectedRows,
    ] = await Promise.all([
      this.database.select().from(knowledgeSources)
        .where(eq(knowledgeSources.knowledgePackId, packId))
        .orderBy(asc(knowledgeSources.sourceId)),
      this.database.select().from(knowledgeRules)
        .where(eq(knowledgeRules.knowledgePackId, packId))
        .orderBy(asc(knowledgeRules.ruleId)),
      this.database.select().from(knowledgeRulePageTypes)
        .where(eq(knowledgeRulePageTypes.knowledgePackId, packId)),
      this.database.select().from(knowledgeRuleSectionTypes)
        .where(eq(knowledgeRuleSectionTypes.knowledgePackId, packId)),
      this.database.select().from(knowledgeRuleConversionRoles)
        .where(eq(knowledgeRuleConversionRoles.knowledgePackId, packId)),
      this.database.select({
        ruleId: knowledgeRuleSources.knowledgeRuleId,
        sourceIdentifier: knowledgeSources.sourceId,
        relationshipType: knowledgeRuleSources.relationshipType,
      }).from(knowledgeRuleSources)
        .innerJoin(
          knowledgeSources,
          eq(knowledgeRuleSources.knowledgeSourceId, knowledgeSources.id),
        )
        .where(eq(knowledgeRuleSources.knowledgePackId, packId)),
      this.database.select().from(knowledgePagePlaybooks)
        .where(eq(knowledgePagePlaybooks.knowledgePackId, packId)),
      this.database.select().from(knowledgeSectionPlaybooks)
        .where(eq(knowledgeSectionPlaybooks.knowledgePackId, packId))
        .orderBy(
          asc(knowledgeSectionPlaybooks.sectionOrderMin),
          asc(knowledgeSectionPlaybooks.id),
        ),
      this.database.select().from(knowledgeRejectedRules)
        .where(eq(knowledgeRejectedRules.knowledgePackId, packId))
        .orderBy(asc(knowledgeRejectedRules.ruleId)),
    ]);
    const sources = sourceRows.map(source => ({
      sourceId: source.sourceId,
      sourceTitle: source.sourceTitle,
      author: source.author ?? undefined,
      editionOrVersion: source.editionOrVersion ?? undefined,
      sourceType: source.sourceType,
      topicDomains: asStrings(source.topicDomainsJson),
      evidenceAuthority: source.evidenceAuthority,
      supportCapability: source.supportCapability,
      strengthOfSupport: source.strengthOfSupport ?? undefined,
      temporalClass: source.temporalClass,
      citationLocations: asStrings(source.citationLocationsJson),
      copyrightNotes: source.copyrightNotes ?? undefined,
      verifiedAt: source.verifiedAt ?? undefined,
      reviewDueAt: source.reviewDueAt ?? undefined,
      reviewNotes: source.reviewNotes ?? undefined,
      contentDigest: source.contentDigestSha256,
    }));
    const rules = ruleRows.map(rule => {
      const pageTypes = pageTypeRows
        .filter(row => row.knowledgeRuleId === rule.id)
        .map(row => row.pageType);
      const sectionTypes = sectionTypeRows
        .filter(row => row.knowledgeRuleId === rule.id)
        .map(row => row.sectionType);
      const conversionRoles = conversionRoleRows
        .filter(row => row.knowledgeRuleId === rule.id)
        .map(row => row.conversionRole);
      const sourceIds = sourceLinkRows
        .filter(row =>
          row.ruleId === rule.id && row.relationshipType === 'SUPPORT')
        .map(row => row.sourceIdentifier);
      return {
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
        ruleScope: rule.ruleScope,
        domain: rule.domain,
        subcategory: rule.subcategory,
        principle: rule.principle,
        whyItMatters: rule.whyItMatters ?? undefined,
        implementationInstruction: rule.implementationInstruction,
        applicablePageTypes: pageTypes,
        applicableSectionTypes: sectionTypes,
        conversionRoles,
        priority: rule.priority,
        validationType: rule.validationType,
        publicationEffect: rule.publicationEffect,
        enforcementAuthority: rule.enforcementAuthority,
        requiredBusinessData: asStrings(rule.requiredBusinessDataJson),
        prohibitedBehaviour: rule.prohibitedBehaviour ?? undefined,
        antiPattern: rule.antiPattern ?? undefined,
        deterministicTestDescription:
          rule.deterministicTestDescription ?? undefined,
        aiReviewInstruction: rule.aiReviewInstruction ?? undefined,
        humanReviewInstruction: rule.humanReviewInstruction ?? undefined,
        sourceIds,
        supportType: rule.supportType ?? undefined,
        temporalClass: rule.temporalClass,
        verificationSourceIds: asStrings(rule.verificationSourceIdsJson),
        verifiedAt: rule.verifiedAt ?? undefined,
        reviewDueAt: rule.reviewDueAt ?? undefined,
        confidence: Number(rule.confidence),
        notes: rule.notes ?? undefined,
        status: rule.status,
        contentDigest: rule.contentDigestSha256,
      };
    });
    const pagePlaybooks = pageRows.map(page => ({
      pageType: page.pageType,
      conversionRole: page.conversionRole,
      sections: sectionRows.filter(section =>
        section.pagePlaybookId === page.id).map(section => ({
        sectionType: section.sectionType,
        sectionOrderMin: section.sectionOrderMin,
        sectionOrderMax: section.sectionOrderMax,
        requirement: section.requirement,
        userIntent: section.userIntent,
        businessObjective: section.businessObjective ?? undefined,
        sectionPurpose: section.sectionPurpose,
        requiredBusinessData: asStrings(section.requiredBusinessDataJson),
        copyInstruction: section.copyInstruction ?? undefined,
        seoInstruction: section.seoInstruction ?? undefined,
        trustInstruction: section.trustInstruction ?? undefined,
        bookingInstruction: section.bookingInstruction ?? undefined,
        mobileInstruction: section.mobileInstruction ?? undefined,
        accessibilityInstruction: section.accessibilityInstruction ?? undefined,
        allowedPrimaryCtaTypes: asStrings(section.allowedPrimaryCtaTypesJson),
        allowedSecondaryCtaTypes: asStrings(section.allowedSecondaryCtaTypesJson),
        blockingConditions: asStrings(section.blockingConditionsJson),
        commonAntiPatterns: asStrings(section.commonAntiPatternsJson),
        ruleIds: asStrings(section.ruleIdsJson),
        sourceIds: asStrings(section.sourceIdsJson),
        confidence: Number(section.confidence),
        notes: section.notes ?? undefined,
        contentDigest: section.contentDigestSha256,
      })),
      contentDigest: page.contentDigestSha256,
    }));
    return KnowledgeImportBundleSchema.parse({
      pack: {
        name: pack.name,
        description: pack.description ?? undefined,
        semanticVersion: pack.semanticVersion,
        intendedScope: pack.intendedScope,
        schemaVersion: pack.schemaVersion,
      },
      sources,
      rules,
      pagePlaybooks,
      rejectedRules: rejectedRows.map(rule => ({
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
        rejectionReason: rule.rejectionReason,
      })),
      sourceDigest: pack.sourceDigestSha256,
    });
  }

  private async loadConflicts(packId: string): Promise<KnowledgeConflict[]> {
    const rows = await this.database.select().from(knowledgeConflicts).where(and(
      eq(knowledgeConflicts.knowledgePackId, packId),
      eq(knowledgeConflicts.current, true),
    ));
    return rows.map(row => KnowledgeConflictSchema.parse({
      conflictType: row.conflictType,
      severity: row.severity,
      summary: row.summary,
      ruleIds: asStrings(row.ruleIdsJson),
      pageType: row.pageType ?? undefined,
      sectionType: row.sectionType ?? undefined,
      resolved: row.status !== 'OPEN',
    }));
  }
}
