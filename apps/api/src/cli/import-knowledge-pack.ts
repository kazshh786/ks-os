import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { closeDatabase } from '@ks-os/database';
import {
  parseKnowledgeCsvBundle,
  validateKnowledgePack,
} from '@ks-os/site-knowledge';
import { AgencyKnowledgePackService } from '../modules/sites/knowledge-pack.service.js';

interface CliOptions {
  name: string;
  semanticVersion: string;
  intendedScope: 'PUBLIC_SITE';
  sources: string;
  platformRules: string;
  expertRules: string;
  playbooks: string;
  rejectedRules: string;
  actorReference?: string;
  validateOnly: boolean;
  approve: boolean;
  activate: boolean;
  reason: string;
  allowRemoteDevelopment: boolean;
}

function valueAfter(arguments_: string[], flag: string) {
  const index = arguments_.indexOf(flag);
  return index === -1 ? undefined : arguments_[index + 1];
}

function requireValue(arguments_: string[], flag: string) {
  const value = valueAfter(arguments_, flag);
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} is required.`);
  }
  return value;
}

function parseArguments(arguments_: string[]): CliOptions {
  const scope = valueAfter(arguments_, '--scope') ?? 'PUBLIC_SITE';
  if (scope !== 'PUBLIC_SITE') {
    throw new Error('Only PUBLIC_SITE knowledge packs are supported.');
  }
  const validateOnly = arguments_.includes('--validate-only');
  const approve = arguments_.includes('--approve');
  const activate = arguments_.includes('--activate');
  if (activate && !approve) {
    throw new Error('--activate requires --approve.');
  }
  const actorReference = valueAfter(arguments_, '--actor-reference');
  if (!validateOnly && !actorReference) {
    throw new Error('--actor-reference is required for database import.');
  }
  const directory = valueAfter(arguments_, '--directory');
  const datasetPath = (flag: string, filename: string) => directory
    ? resolve(process.env.INIT_CWD ?? process.cwd(), directory, filename)
    : requireValue(arguments_, flag);
  return {
    name: requireValue(arguments_, '--name'),
    semanticVersion: requireValue(arguments_, '--version'),
    intendedScope: scope,
    sources: datasetPath('--sources', 'source_provenance_v3.csv'),
    platformRules: datasetPath('--platform-rules', 'platform_rules_v3.csv'),
    expertRules: datasetPath('--expert-rules', 'expert_knowledge_rules_v3.csv'),
    playbooks: datasetPath('--playbooks', 'page_section_playbooks_v3.csv'),
    rejectedRules: datasetPath('--rejected-rules', 'rejected_or_pending_rules_v3.csv'),
    actorReference,
    validateOnly,
    approve,
    activate,
    reason: valueAfter(arguments_, '--reason')
      ?? 'Reviewed knowledge-pack import and governance approval.',
    allowRemoteDevelopment: arguments_.includes('--allow-remote-development'),
  };
}

function databaseHostClass(connectionString: string) {
  const hostname = new URL(connectionString).hostname;
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return 'local';
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
    return 'private';
  }
  return 'remote';
}

function assertSafeDatabase(options: CliOptions) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const hostClass = databaseHostClass(connectionString);
  const applicationEnvironment = (
    process.env.APP_ENV ?? process.env.NODE_ENV ?? ''
  ).toLowerCase();
  if (['production', 'staging'].includes(applicationEnvironment)) {
    throw new Error('Knowledge-pack CLI imports are disabled outside development.');
  }
  if (hostClass === 'remote') {
    const connection = new URL(connectionString);
    const allowedProjectRef = process.env.KNOWLEDGE_IMPORT_ALLOWED_PROJECT_REF;
    const databaseProjectRef = decodeURIComponent(connection.username)
      .match(/\.([a-z0-9]{20})$/i)?.[1]
      ?? connection.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/i)?.[1];
    const explicitlyAllowed = options.allowRemoteDevelopment
      && process.env.NODE_ENV === 'development'
      && applicationEnvironment === 'development'
      && process.env.KNOWLEDGE_IMPORT_ALLOW_REMOTE_DEVELOPMENT === 'true'
      && Boolean(allowedProjectRef)
      && databaseProjectRef === allowedProjectRef
      && (
        connection.hostname.endsWith('.pooler.supabase.com')
        || connection.hostname === `db.${allowedProjectRef}.supabase.co`
      )
      && connection.searchParams.get('sslmode') === 'require';
    if (!explicitlyAllowed) {
      throw new Error(
        'Remote database imports are blocked unless the designated development project and encrypted connection are explicitly confirmed.',
      );
    }
  }
}

async function loadBundle(options: CliOptions) {
  const [
    sourceProvenance,
    platformRules,
    expertKnowledgeRules,
    pageSectionPlaybooks,
    rejectedOrPendingRules,
  ] = await Promise.all([
    readFile(options.sources, 'utf8'),
    readFile(options.platformRules, 'utf8'),
    readFile(options.expertRules, 'utf8'),
    readFile(options.playbooks, 'utf8'),
    readFile(options.rejectedRules, 'utf8'),
  ]);
  return parseKnowledgeCsvBundle({
    name: options.name,
    semanticVersion: options.semanticVersion,
    intendedScope: options.intendedScope,
  }, {
    sourceProvenance,
    platformRules,
    expertKnowledgeRules,
    pageSectionPlaybooks,
    rejectedOrPendingRules,
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const bundle = await loadBundle(options);
  const report = validateKnowledgePack(bundle);
  if (!report.readyForApproval) {
    process.stdout.write(`${JSON.stringify({
      mode: 'VALIDATION_FAILED',
      sourceDigest: bundle.sourceDigest,
      contentDigest: report.contentDigest,
      counts: report.counts,
      findings: report.findings.map(entry => ({
        code: entry.code,
        severity: entry.severity,
        blocksApproval: entry.blocksApproval,
        ruleId: entry.ruleId,
        sourceId: entry.sourceId,
      })),
      conflicts: report.conflicts.map(entry => ({
        conflictType: entry.conflictType,
        severity: entry.severity,
        ruleIds: entry.ruleIds,
      })),
    }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  if (options.validateOnly) {
    process.stdout.write(`${JSON.stringify({
      mode: 'VALIDATED_ONLY',
      sourceDigest: bundle.sourceDigest,
      contentDigest: report.contentDigest,
      counts: report.counts,
      readyForApproval: true,
    }, null, 2)}\n`);
    return;
  }

  assertSafeDatabase(options);
  const service = new AgencyKnowledgePackService();
  const actor = await service.resolveActorByReference(options.actorReference!);
  const existing = (await service.list({
    intendedScope: options.intendedScope,
    limit: 100,
  })).find(pack =>
    pack.semanticVersion === options.semanticVersion
    && pack.name === options.name);
  if (
    existing?.status === 'ACTIVE'
    && existing.sourceDigest === bundle.sourceDigest
  ) {
    process.stdout.write(`${JSON.stringify({
      mode: 'IDEMPOTENT_ACTIVE',
      packReference: existing.reference,
      sourceDigest: existing.sourceDigest,
      activeCount: await service.activeCount(options.intendedScope),
    }, null, 2)}\n`);
    return;
  }
  const pack = existing ?? await service.create(actor, {
    name: options.name,
    semanticVersion: options.semanticVersion,
    intendedScope: options.intendedScope,
  });
  const imported = await service.importBundle(
    actor,
    pack.reference,
    'CSV',
    bundle,
  );
  const governance = await service.validate(actor, pack.reference);
  if (!governance.readyForApproval) {
    throw new Error('Stored-pack governance validation did not pass.');
  }
  let current = await service.get(pack.reference);
  if (options.approve && current.status === 'READY_FOR_APPROVAL') {
    current = await service.approve(actor, pack.reference, options.reason);
  }
  if (options.activate && current.status === 'APPROVED') {
    current = await service.activate(actor, pack.reference, options.reason);
  }
  const activeCount = await service.activeCount(options.intendedScope);
  if (options.activate && activeCount !== 1) {
    throw new Error('Exactly one ACTIVE PUBLIC_SITE knowledge pack is required.');
  }
  process.stdout.write(`${JSON.stringify({
    mode: 'IMPORTED',
    packReference: current.reference,
    status: current.status,
    importReference: imported.importReference,
    idempotentReplay: imported.idempotentReplay,
    sourceDigest: bundle.sourceDigest,
    contentDigest: governance.contentDigest,
    counts: governance.counts,
    activeCount,
  }, null, 2)}\n`);
}

main()
  .catch(error => {
    process.stderr.write(`${JSON.stringify({
      code: (error as { code?: string }).code ?? 'KNOWLEDGE_IMPORT_CLI_FAILED',
      message: (error as Error).message,
    })}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
