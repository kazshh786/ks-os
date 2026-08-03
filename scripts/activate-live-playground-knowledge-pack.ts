import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { and, asc, eq } from 'drizzle-orm';
import { agencyUsers, closeDatabase, getDatabase } from '@ks-os/database';
import { parseKnowledgeCsvBundle, validateKnowledgePack } from '@ks-os/site-knowledge';
import { AgencyKnowledgePackService } from '../apps/api/src/modules/sites/knowledge-pack.service.js';
import type { AgencyActor } from '../apps/api/src/modules/agency/agency.service.js';

dotenv.config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const TARGET_VERSION = '1.0.2';
const DEFAULT_DIRECTORY = '/srv/ks-os/.local/knowledge-pack-v3';

function csvRow(values: Array<string | number>) {
  return values.map(value => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',');
}

function appendRows(csv: string, rows: Array<Array<string | number>>) {
  return `${csv.trimEnd()}\n${rows.map(csvRow).join('\n')}\n`;
}

const additionalPlatformRules: Array<Array<string | number>> = [[
  'RUL_SERVICE_HUB_CANONICAL_CATALOGUE',
  'Canonical Service Catalogue',
  'PUBLIC_SITE',
  'CONVERSION',
  'Service Discovery',
  'The services hub must render only active canonical KS OS services.',
  'Bind the service grid to active tenant services and preserve native booking destinations.',
  'SERVICE_HUB',
  'SERVICE_GRID',
  'SERVICE_CONVERSION',
  'CRITICAL',
  'DETERMINISTIC',
  'BLOCK',
  'PLATFORM',
  'service_name|service_availability',
  'Inventing services or rendering inactive catalogue records.',
  'Compare every rendered service reference with the active tenant catalogue.',
  'SRC_KS_OS_PLATFORM',
  'SRC_KS_OS_PLATFORM',
  'STABLE',
  '',
  '',
  '1.0',
  'Required by the native service-hub generation path.',
]];

const additionalPlaybooks: Array<Array<string | number>> = [
  [
    'SERVICE_HUB', 'SERVICE_CONVERSION', 'SERVICE_GRID', 1, 4, 'REQUIRED',
    'Compare available services.', 'Move visitors from discovery to a relevant booking choice.',
    'Render the verified active service catalogue.', 'service_name|service_availability',
    'Use concise verified service names and summaries.', 'Use one indexable services heading.',
    'Do not imply unavailable treatments.', 'Route each service action into native KS OS booking.',
    'Use a single-column card flow at narrow widths.', 'Use semantic headings and descriptive action labels.',
    'KS_OS_BOOKING', 'INTERNAL_PAGE', 'No active canonical services are available.',
    'Invented or inactive services.', 'RUL_SERVICE_HUB_CANONICAL_CATALOGUE|RUL_NATIVE_BOOKING_DESTINATION',
    'SRC_KS_OS_PLATFORM', '1.0', 'Canonical catalogue coverage for structured site generation.',
  ],
  [
    'ABOUT', 'TRUST_BUILDING', 'INTRODUCTION', 1, 5, 'REQUIRED',
    'Understand the studio and its approach.', 'Build confidence with verified business context.',
    'Introduce the business without unsupported claims.', 'brand_name|business_description',
    'Use warm, specific language grounded in approved facts.', 'Use a clear About-page heading structure.',
    'Include only verified differentiators.', 'Keep booking available as a restrained next step.',
    'Keep paragraphs short and scannable.', 'Use sequential headings and readable landmarks.',
    'KS_OS_BOOKING', 'INTERNAL_PAGE', 'The approved business description is missing.',
    'Invented awards, history, or credentials.', 'RUL_NO_FABRICATED_BUSINESS_DATA',
    'SRC_KS_OS_PLATFORM', '1.0', 'Governed About-page coverage for the acceptance fixture.',
  ],
  [
    'TEAM_HUB', 'TRUST_BUILDING', 'TEAM', 1, 5, 'REQUIRED',
    'Choose an appropriate team member.', 'Humanise the studio and support service selection.',
    'Present verified public staff profiles.', 'ks_os_staff_id',
    'Use verified names, roles, and biographies only.', 'Use one descriptive team heading.',
    'Never invent qualifications or experience.', 'Allow native booking with an eligible member.',
    'Stack profiles cleanly on narrow screens.', 'Provide meaningful image alternatives and link labels.',
    'KS_OS_BOOKING', 'INTERNAL_PAGE', 'No verified public staff profiles are available.',
    'Placeholder people or fabricated credentials.', 'RUL_NO_FABRICATED_BUSINESS_DATA',
    'SRC_KS_OS_PLATFORM', '1.0', 'Governed team-hub coverage for the acceptance fixture.',
  ],
  [
    'CONTACT', 'TRUST_BUILDING', 'CONTACT', 1, 6, 'REQUIRED',
    'Find a reliable way to contact or visit the studio.', 'Resolve practical questions without displacing booking.',
    'Show verified contact details and native lead routes.', 'physical_address|phone_number|native_crm_enabled',
    'State verified contact details plainly.', 'Keep NAP details consistent with canonical records.',
    'Do not add unverified channels or opening claims.', 'Keep native booking primary and contact methods secondary.',
    'Make telephone and email actions easy to tap.', 'Use semantic address markup and descriptive labels.',
    'KS_OS_BOOKING', 'PHONE|EMAIL|GET_DIRECTIONS', 'Verified contact data is missing.',
    'External forms or inconsistent NAP data.', 'RUL_CRM_LEAD_CAPTURE|RUL_LOCAL_BUSINESS_SCHEMA_NO_SELF_REVIEW',
    'SRC_KS_OS_PLATFORM|SRC_GOOGLE_REVIEW_SNIPPET_STRUCTURED_DATA', '1.0',
    'Governed contact-page coverage for the acceptance fixture.',
  ],
  [
    'NEW_CLIENT_GUIDE', 'OBJECTION_HANDLING', 'RICH_TEXT', 1, 6, 'REQUIRED',
    'Prepare confidently for a first visit.', 'Remove first-visit uncertainty and support booking.',
    'Explain the verified booking and arrival process.', 'booking_enabled|physical_address',
    'Use concise practical steps and avoid treatment guarantees.', 'Use descriptive sequential headings.',
    'Distinguish verified instructions from general guidance.', 'Finish with the native KS OS booking action.',
    'Use short sections and comfortable reading widths.', 'Use real lists and sequential headings.',
    'KS_OS_BOOKING', 'INTERNAL_PAGE', 'The native booking journey is unavailable.',
    'Dense prose or unverified preparation instructions.', 'RUL_HEADING_HIERARCHY_STRUCTURE',
    'SRC_W3C_WCAG_22', '1.0', 'Governed new-client guide coverage for the acceptance fixture.',
  ],
];

async function loadBundle(directory: string, name: string) {
  const [sourceProvenance, platformRules, expertKnowledgeRules, pageSectionPlaybooks, rejectedOrPendingRules] = await Promise.all([
    readFile(resolve(directory, 'source_provenance_v3.csv'), 'utf8'),
    readFile(resolve(directory, 'platform_rules_v3.csv'), 'utf8'),
    readFile(resolve(directory, 'expert_knowledge_rules_v3.csv'), 'utf8'),
    readFile(resolve(directory, 'page_section_playbooks_v3.csv'), 'utf8'),
    readFile(resolve(directory, 'rejected_or_pending_rules_v3.csv'), 'utf8'),
  ]);
  return parseKnowledgeCsvBundle({
    name,
    semanticVersion: TARGET_VERSION,
    intendedScope: 'PUBLIC_SITE',
  }, {
    sourceProvenance,
    platformRules: appendRows(platformRules, additionalPlatformRules),
    expertKnowledgeRules,
    pageSectionPlaybooks: appendRows(pageSectionPlaybooks, additionalPlaybooks),
    rejectedOrPendingRules,
  });
}

async function main() {
  const directory = process.env.LIVE_PLAYGROUND_KNOWLEDGE_DIRECTORY || DEFAULT_DIRECTORY;
  const validateOnly = process.argv.includes('--validate-only');
  const requestedName = process.env.LIVE_PLAYGROUND_KNOWLEDGE_PACK_NAME || 'KS OS Public Site Knowledge';
  if (validateOnly) {
    const bundle = await loadBundle(directory, requestedName);
    const report = validateKnowledgePack(bundle);
    process.stdout.write(`${JSON.stringify({
      mode: 'VALIDATED_ONLY',
      sourceDigest: bundle.sourceDigest,
      contentDigest: report.contentDigest,
      counts: report.counts,
      findingCount: report.findings.length,
      conflictCount: report.conflicts.length,
      readyForApproval: report.readyForApproval,
    }, null, 2)}\n`);
    if (!report.readyForApproval) process.exitCode = 1;
    return;
  }
  if (process.env.LIVE_PLAYGROUND_BOOTSTRAP_ENABLED !== 'true') {
    throw new Error('LIVE_PLAYGROUND_BOOTSTRAP_ENABLED must be exactly true.');
  }
  const database = getDatabase();
  try {
    const [owner] = await database.select({ id: agencyUsers.id, role: agencyUsers.role })
      .from(agencyUsers).where(and(
        eq(agencyUsers.status, 'ACTIVE'),
        eq(agencyUsers.role, 'PLATFORM_OWNER'),
      )).orderBy(asc(agencyUsers.createdAt)).limit(1);
    if (!owner) throw new Error('An active platform owner is required.');
    const actor: AgencyActor = {
      agencyUserId: owner.id,
      role: owner.role as AgencyActor['role'],
      requestId: 'live-playground-knowledge-v1.0.2',
    };
    const service = new AgencyKnowledgePackService(database);
    const packs = await service.list({ intendedScope: 'PUBLIC_SITE', limit: 100 });
    const active = packs.find(pack => pack.status === 'ACTIVE');
    if (!active) throw new Error('An active PUBLIC_SITE knowledge pack is required for revision.');
    const bundle = await loadBundle(directory, active.name);
    const report = validateKnowledgePack(bundle);
    if (!report.readyForApproval) throw new Error('The live-playground knowledge revision did not pass validation.');
    const alreadyActive = packs.find(pack =>
      pack.status === 'ACTIVE'
      && pack.semanticVersion === TARGET_VERSION
      && pack.sourceDigest === bundle.sourceDigest);
    if (alreadyActive) {
      process.stdout.write(`${JSON.stringify({
        mode: 'IDEMPOTENT_ACTIVE',
        packReference: alreadyActive.reference,
        sourceDigest: bundle.sourceDigest,
        contentDigest: report.contentDigest,
      })}\n`);
      return;
    }
    const existing = packs.find(pack =>
      pack.semanticVersion === TARGET_VERSION && pack.name === active.name);
    const revision = existing || await service.revise(actor, active.reference, {
      semanticVersion: TARGET_VERSION,
      reason: 'Add governed playbooks for every page required by the exact live-playground acceptance fixture.',
    });
    let current = await service.get(revision.reference);
    if (['DRAFT', 'REVIEW_REQUIRED'].includes(current.status) && current.sourceDigest !== bundle.sourceDigest) {
      await service.importBundle(actor, revision.reference, 'CSV', bundle);
      current = await service.get(revision.reference);
    }
    if (['REVIEW_REQUIRED', 'DRAFT'].includes(current.status)) {
      const storedReport = await service.validate(actor, revision.reference);
      if (!storedReport.readyForApproval) throw new Error('Stored-pack governance validation did not pass.');
      current = await service.get(revision.reference);
    }
    if (current.status === 'READY_FOR_APPROVAL') {
      current = await service.approve(
        actor,
        revision.reference,
        'Validated complete page-playbook coverage for the fictional Leeds live playground.',
      );
    }
    if (current.status === 'APPROVED') {
      current = await service.activate(
        actor,
        revision.reference,
        'Activate the validated complete playbook revision before structured playground generation.',
      );
    }
    if (current.status !== 'ACTIVE' || await service.activeCount('PUBLIC_SITE') !== 1) {
      throw new Error('Exactly one ACTIVE PUBLIC_SITE knowledge pack is required.');
    }
    process.stdout.write(`${JSON.stringify({
      mode: 'ACTIVATED',
      packReference: current.reference,
      status: current.status,
      sourceDigest: bundle.sourceDigest,
      contentDigest: report.contentDigest,
      counts: report.counts,
    })}\n`);
  } finally {
    await closeDatabase();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Knowledge activation failed.'}\n`);
  process.exitCode = 1;
});
