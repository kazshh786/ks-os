import {
  closeDatabase,
  getDatabase,
  knowledgePacks,
  platformAuditEvents,
} from '@ks-os/database';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { validateKnowledgePack } from '@ks-os/site-knowledge';
import { AgencyKnowledgePackService } from '../modules/sites/knowledge-pack.service.js';

async function main() {
  const database = getDatabase();
  const service = new AgencyKnowledgePackService(database);
  const active = await service.resolveActive('PUBLIC_SITE');
  const playbook = active.bundle.pagePlaybooks.find(entry =>
    entry.pageType === 'SERVICE_DETAIL');
  if (!playbook) throw new Error('SERVICE_DETAIL playbook is missing.');
  const context = await service.prepareGenerationContext({
    pageType: 'SERVICE_DETAIL',
    plannedSections: [
      ...playbook.sections.map(section => section.sectionType),
      'BOOKING_CTA',
    ],
    conversionRole: playbook.conversionRole,
    availableBusinessDataKeys: [],
  });
  const [pack] = await database.select({
    id: knowledgePacks.id,
    reference: knowledgePacks.publicReference,
    semanticVersion: knowledgePacks.semanticVersion,
    status: knowledgePacks.status,
    sourceCount: knowledgePacks.sourceCount,
    ruleCount: knowledgePacks.ruleCount,
    pagePlaybookCount: knowledgePacks.pagePlaybookCount,
    sectionPlaybookCount: knowledgePacks.sectionPlaybookCount,
    contentDigest: knowledgePacks.contentDigestSha256,
  }).from(knowledgePacks).where(eq(
    knowledgePacks.publicReference,
    active.reference,
  )).limit(1);
  if (!pack) throw new Error('Active knowledge pack disappeared.');
  const [counts] = await database.select({
    totalPacks: sql<number>`(select count(*)::int from knowledge_packs)`,
    approvedPacks: sql<number>`(select count(*)::int from knowledge_packs where status = 'APPROVED')`,
    activePublicSitePacks: sql<number>`(select count(*)::int from knowledge_packs where intended_scope = 'PUBLIC_SITE' and status = 'ACTIVE')`,
    platformRules: sql<number>`(select count(*)::int from knowledge_rules where knowledge_pack_id = ${pack.id} and enforcement_authority = 'PLATFORM')`,
    expertRules: sql<number>`(select count(*)::int from knowledge_rules where knowledge_pack_id = ${pack.id} and enforcement_authority <> 'PLATFORM')`,
    rejectedRules: sql<number>`(select count(*)::int from knowledge_rejected_rules where knowledge_pack_id = ${pack.id})`,
    conflicts: sql<number>`(select count(*)::int from knowledge_conflicts where knowledge_pack_id = ${pack.id} and current = true)`,
    unresolvedCriticalConflicts: sql<number>`(select count(*)::int from knowledge_conflicts where knowledge_pack_id = ${pack.id} and current = true and status = 'OPEN' and severity = 'CRITICAL')`,
  }).from(knowledgePacks).limit(1);
  const auditRows = await database.select({
    action: platformAuditEvents.action,
    occurrences: count(platformAuditEvents.id),
  }).from(platformAuditEvents).where(and(
    eq(platformAuditEvents.targetType, 'KNOWLEDGE_PACK'),
    eq(platformAuditEvents.targetId, active.reference),
    inArray(platformAuditEvents.action, [
      'KNOWLEDGE_PACK_CREATED',
      'KNOWLEDGE_PACK_IMPORT_STARTED',
      'KNOWLEDGE_PACK_IMPORT_COMPLETED',
      'KNOWLEDGE_PACK_VALIDATED',
      'KNOWLEDGE_PACK_APPROVED',
      'KNOWLEDGE_PACK_ACTIVATED',
    ]),
  )).groupBy(platformAuditEvents.action);
  const validation = validateKnowledgePack(active.bundle);
  const rejectedIds = new Set(active.bundle.rejectedRules.map(rule => rule.ruleId));
  const selectedRejectedRules = context.applicableRuleIds
    .filter(ruleId => rejectedIds.has(ruleId));
  const nativeBookingRuleIds = context.applicableRuleIds
    .filter(ruleId => ruleId.includes('NATIVE_BOOKING'));
  const sourceReferenceShapeSafe = context.sourceReferences.every(source =>
    Object.keys(source).every(key => [
      'sourceId',
      'sourceTitle',
      'author',
      'editionOrVersion',
    ].includes(key)));

  process.stdout.write(`${JSON.stringify({
    activePack: {
      reference: pack.reference,
      semanticVersion: pack.semanticVersion,
      status: pack.status,
      contentDigest: pack.contentDigest,
    },
    counts: {
      ...counts,
      sources: pack.sourceCount,
      rules: pack.ruleCount,
      pagePlaybooks: pack.pagePlaybookCount,
      sectionPlaybooks: pack.sectionPlaybookCount,
    },
    applicationValidation: {
      readyForApproval: validation.readyForApproval,
      findings: validation.findings.length,
      conflicts: validation.conflicts.length,
      contentDigest: validation.contentDigest,
      matchesStoredDigest: validation.contentDigest === pack.contentDigest,
    },
    auditEvents: Object.fromEntries(auditRows.map(row => [
      row.action,
      Number(row.occurrences),
    ])),
    generationContext: {
      packReference: context.packReference,
      semanticVersion: context.semanticVersion,
      pageType: context.pagePlaybook?.pageType,
      conversionRole: context.pagePlaybook?.conversionRole,
      sectionTypes: context.pagePlaybook?.sections.map(section => section.sectionType),
      applicableRuleCount: context.applicableRuleIds.length,
      nativeBookingRuleIds,
      selectedRejectedRules,
      sourceReferenceCount: context.sourceReferences.length,
      sourceReferenceShapeSafe,
      contentDigest: context.contentDigest,
    },
  }, null, 2)}\n`);
}

main()
  .catch(error => {
    process.stderr.write(`${JSON.stringify({
      code: 'ACTIVE_KNOWLEDGE_VERIFICATION_FAILED',
      message: (error as Error).message,
    })}\n`);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
