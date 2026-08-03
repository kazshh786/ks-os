import { createHash, randomUUID } from 'node:crypto';
import { getDatabase, sql } from '@ks-os/database';
import { normalizeCustomHostname } from '@ks-os/site-publishing';
import type { AgencyActor } from '../agency/agency.service.js';
import { AgencyAuditService } from '../agency/agency.service.js';
import { CloudflareSiteDomainProvider } from './domain-providers/cloudflare-site-domain-provider.js';
import { DisabledSiteDomainProvider } from './domain-providers/disabled-site-domain-provider.js';
import {
  SiteDomainProviderError,
  type PreparedSiteDomain,
  type SiteDomainProvider,
  type SiteDomainProviderKey,
} from './domain-providers/site-domain-provider.js';
import { VercelSiteDomainProvider } from './domain-providers/vercel-site-domain-provider.js';
import { SitePublicationService } from './site-publication.service.js';

type Database = ReturnType<typeof getDatabase>;

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

function rowsOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return ((value as { rows?: unknown[] })?.rows || []) as T[];
}

function safeText(value: unknown, maximum = 500) {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

type SiteContext = {
  site_id: string;
  tenant_id: string;
  tenant_reference: string;
};

type DomainContext = {
  id: string;
  public_reference: string;
  hostname: string;
  domain_type: string;
  provider_key: SiteDomainProviderKey | null;
  provider_safe_reference: string | null;
  status: string;
};

export class UnifiedSitePublicationService extends SitePublicationService {
  private readonly audit = new AgencyAuditService();
  private readonly managedDb: Database;

  constructor(
    database: Database = getDatabase(),
    private readonly environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
    private readonly publicRequest: typeof fetch = fetch,
  ) {
    super(database);
    this.managedDb = database;
  }

  private providerForNewDomain(): SiteDomainProvider {
    const selected = this.environment.SITE_DOMAIN_PROVIDER?.trim().toLowerCase() || 'disabled';
    if (selected === 'cloudflare') return new CloudflareSiteDomainProvider(this.environment, this.publicRequest);
    if (selected === 'vercel') return new VercelSiteDomainProvider(this.environment, this.publicRequest);
    if (selected === 'disabled') return new DisabledSiteDomainProvider();
    throw fail(503, 'SITE_DOMAIN_PROVIDER_INVALID', 'SITE_DOMAIN_PROVIDER must be cloudflare, vercel or disabled.');
  }

  private providerForStoredDomain(providerKey: SiteDomainProviderKey | null): SiteDomainProvider {
    if (providerKey === 'CLOUDFLARE') return new CloudflareSiteDomainProvider(this.environment, this.publicRequest);
    if (providerKey === 'VERCEL') return new VercelSiteDomainProvider(this.environment, this.publicRequest);
    return new DisabledSiteDomainProvider();
  }

  private async siteContext(siteReference: string): Promise<SiteContext> {
    const result = await this.managedDb.execute(sql<SiteContext>`
      select site.id as site_id, site.tenant_id,
        tenant.business_reference as tenant_reference
      from sites site
      join tenants tenant on tenant.id = site.tenant_id
      where site.public_reference = ${siteReference}::uuid
      limit 1
    `);
    const row = rowsOf<SiteContext>(result)[0];
    if (!row) throw fail(404, 'SITE_NOT_FOUND', 'The managed website could not be found.');
    return row;
  }

  private async beginProviderOperation(input: {
    context: SiteContext;
    domainId: string;
    providerKey: SiteDomainProviderKey;
    operationType: 'PREPARE_SITE_DOMAIN' | 'VERIFY_SITE_DOMAIN';
    hostname: string;
  }) {
    const idempotencyKey = digest({
      provider: input.providerKey,
      operation: input.operationType,
      hostname: input.hostname,
      version: 1,
    });
    await this.managedDb.execute(sql`
      insert into site_domain_provider_operations (
        tenant_id, site_id, domain_id, provider_key, operation_type,
        idempotency_key, status, attempt_count, safe_request_json,
        started_at, updated_at
      ) values (
        ${input.context.tenant_id}::uuid, ${input.context.site_id}::uuid,
        ${input.domainId}::uuid, ${input.providerKey}, ${input.operationType},
        ${idempotencyKey}, 'RUNNING', 1,
        ${JSON.stringify({ hostname: input.hostname })}::jsonb, now(), now()
      )
      on conflict (idempotency_key) do update set
        status = 'RUNNING',
        attempt_count = site_domain_provider_operations.attempt_count + 1,
        failure_code = null,
        safe_failure_message = null,
        started_at = now(),
        updated_at = now()
    `);
    return idempotencyKey;
  }

  private async completeProviderOperation(input: {
    idempotencyKey: string;
    providerSafeReference: string;
    result: Record<string, unknown>;
  }) {
    await this.managedDb.execute(sql`
      update site_domain_provider_operations set
        status = 'SUCCEEDED',
        provider_safe_reference = ${input.providerSafeReference},
        safe_result_json = ${JSON.stringify(input.result)}::jsonb,
        completed_at = now(),
        updated_at = now()
      where idempotency_key = ${input.idempotencyKey}
    `);
  }

  private async failProviderOperation(
    idempotencyKey: string,
    error: unknown,
  ) {
    const code = safeText((error as { code?: unknown })?.code, 100) || 'SITE_DOMAIN_PROVIDER_FAILED';
    const message = safeText((error as Error)?.message) || 'The site-domain provider operation failed.';
    await this.managedDb.execute(sql`
      update site_domain_provider_operations set
        status = 'FAILED', failure_code = ${code},
        safe_failure_message = ${message}, completed_at = now(), updated_at = now()
      where idempotency_key = ${idempotencyKey}
    `);
  }

  private async persistPreparedDomain(input: {
    actor: AgencyActor;
    context: SiteContext;
    domain: DomainContext;
    prepared: PreparedSiteDomain;
  }) {
    const planReference = randomUUID();
    const discoveryDigest = digest({
      hostname: input.domain.hostname,
      provider: input.prepared.providerKey,
      records: input.prepared.dnsRecords,
    });
    await this.managedDb.transaction(async tx => {
      await tx.execute(sql`
        update site_domain_dns_plans set status = 'SUPERSEDED', updated_at = now()
        where domain_id = ${input.domain.id}::uuid
          and status <> 'SUPERSEDED'
      `);
      await tx.execute(sql`
        insert into site_domain_dns_plans (
          public_reference, tenant_id, site_id, domain_id, status,
          discovery_digest_sha256, reviewed_by_agency_user_id,
          reviewed_at, applied_at, created_at, updated_at
        ) values (
          ${planReference}::uuid, ${input.context.tenant_id}::uuid,
          ${input.context.site_id}::uuid, ${input.domain.id}::uuid,
          'APPLIED', ${discoveryDigest}, ${input.actor.agencyUserId}::uuid,
          now(), now(), now(), now()
        )
      `);
      for (const record of input.prepared.dnsRecords) {
        await tx.execute(sql`
          insert into site_domain_dns_records (
            tenant_id, site_id, domain_id, dns_plan_id,
            provider_safe_reference, record_type, record_name,
            record_content, ttl, classification, protected,
            managed_by_ks_os, proxied, review_decision
          ) select
            ${input.context.tenant_id}::uuid, ${input.context.site_id}::uuid,
            ${input.domain.id}::uuid, plan.id,
            ${record.providerSafeReference || null}, ${record.type},
            ${record.name.toLowerCase()}, ${record.value}, ${record.ttl},
            ${record.classification}, ${record.protected},
            ${record.managedByKsOs}, ${record.proxied}, ${record.reviewDecision}
          from site_domain_dns_plans plan
          where plan.public_reference = ${planReference}::uuid
        `);
      }
      await tx.execute(sql`
        update site_domains set
          provider_key = ${input.prepared.providerKey},
          provider_safe_reference = ${input.prepared.providerSafeReference},
          status = 'DNS_REVIEW_REQUIRED',
          ownership_status = ${input.prepared.ownershipStatus},
          ssl_status = ${input.prepared.sslStatus},
          updated_at = now()
        where id = ${input.domain.id}::uuid
      `);
    });
  }

  async createManagedCustom(
    actor: AgencyActor,
    siteReference: string,
    hostnameInput: string,
  ) {
    const hostname = normalizeCustomHostname(hostnameInput);
    const context = await this.siteContext(siteReference);
    let existing = rowsOf<DomainContext>(await this.managedDb.execute(sql`
      select id, public_reference, hostname, domain_type, provider_key,
        provider_safe_reference, status
      from site_domains
      where hostname = ${hostname} and status <> 'REMOVED'
      limit 1
    `))[0];
    if (existing && existing.id && existing.domain_type !== 'CUSTOM') {
      throw fail(409, 'HOSTNAME_ALREADY_ASSIGNED', 'This hostname is already assigned as a managed fallback hostname.');
    }
    if (existing) {
      const owner = rowsOf<{ site_id: string }>(await this.managedDb.execute(sql`
        select site_id from site_domains where id = ${existing.id}::uuid
      `))[0];
      if (owner?.site_id !== context.site_id) {
        throw fail(409, 'HOSTNAME_ALREADY_ASSIGNED', 'This hostname is already assigned to another managed website.');
      }
      if (existing.status === 'ACTIVE') return this.domainDetails(siteReference, existing.public_reference);
    }

    const provider = existing
      ? this.providerForStoredDomain(existing.provider_key)
      : this.providerForNewDomain();
    if (provider instanceof DisabledSiteDomainProvider) {
      await provider.prepare({ hostname });
    }

    if (!existing) {
      const domainReference = randomUUID();
      await this.managedDb.execute(sql`
        insert into site_domains (
          public_reference, tenant_id, site_id, hostname, domain_type,
          domain_role, provider_key, status, ownership_status,
          ssl_status, canonical_preference, is_primary, created_at, updated_at
        ) values (
          ${domainReference}::uuid, ${context.tenant_id}::uuid,
          ${context.site_id}::uuid, ${hostname}, 'CUSTOM', 'ALIAS',
          ${provider.key}, 'DNS_DISCOVERY_PENDING', 'UNVERIFIED',
          'NOT_REQUESTED', 'NONE', false, now(), now()
        )
      `);
      existing = rowsOf<DomainContext>(await this.managedDb.execute(sql`
        select id, public_reference, hostname, domain_type, provider_key,
          provider_safe_reference, status
        from site_domains where public_reference = ${domainReference}::uuid
      `))[0];
    }
    if (!existing) throw fail(500, 'SITE_DOMAIN_CREATE_FAILED', 'The managed hostname record could not be created.');

    const operationKey = await this.beginProviderOperation({
      context,
      domainId: existing.id,
      providerKey: provider.key,
      operationType: 'PREPARE_SITE_DOMAIN',
      hostname,
    });
    try {
      const prepared = await provider.prepare({
        hostname,
        existingProviderSafeReference: existing.provider_safe_reference,
      });
      await this.persistPreparedDomain({ actor, context, domain: existing, prepared });
      await this.completeProviderOperation({
        idempotencyKey: operationKey,
        providerSafeReference: prepared.providerSafeReference,
        result: { hostname, recordCount: prepared.dnsRecords.length, prepared: true },
      });
      await this.audit.write(actor, 'CUSTOM_DOMAIN_PREPARED', 'SITE_DOMAIN', existing.public_reference, {
        tenantId: context.tenant_id,
        category: 'WEBSITE',
        metadata: {
          siteReference,
          hostname,
          provider: prepared.providerKey,
          dnsRecordCount: prepared.dnsRecords.length,
        },
      });
      return this.domainDetails(siteReference, existing.public_reference);
    } catch (error) {
      await this.failProviderOperation(operationKey, error);
      await this.managedDb.execute(sql`
        update site_domains set status = 'FAILED', updated_at = now()
        where id = ${existing.id}::uuid
      `);
      if (error instanceof SiteDomainProviderError) throw error;
      throw fail(502, 'SITE_DOMAIN_PROVIDER_FAILED', 'The managed domain provider operation failed.');
    }
  }

  private async publicHealth(hostname: string, expectedSiteReference: string) {
    try {
      const response = await this.publicRequest(`https://${hostname}/health`, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return false;
      const body = await response.text();
      if (body.length > 16_384) return false;
      const payload = JSON.parse(body) as { siteReference?: unknown };
      return payload.siteReference === expectedSiteReference;
    } catch {
      return false;
    }
  }

  async verifyAndPromoteCustom(
    actor: AgencyActor,
    siteReference: string,
    domainReference: string,
  ) {
    const context = await this.siteContext(siteReference);
    const domain = rowsOf<DomainContext>(await this.managedDb.execute(sql`
      select id, public_reference, hostname, domain_type, provider_key,
        provider_safe_reference, status
      from site_domains
      where public_reference = ${domainReference}::uuid
        and site_id = ${context.site_id}::uuid
        and tenant_id = ${context.tenant_id}::uuid
        and status <> 'REMOVED'
      limit 1
    `))[0];
    if (!domain || domain.domain_type !== 'CUSTOM') {
      throw fail(404, 'CUSTOM_DOMAIN_NOT_FOUND', 'The custom hostname could not be found for this website.');
    }
    if (!domain.provider_safe_reference) {
      throw fail(409, 'CUSTOM_DOMAIN_NOT_PREPARED', 'Prepare the domain before verification.');
    }
    const provider = this.providerForStoredDomain(domain.provider_key);
    if (provider instanceof DisabledSiteDomainProvider) {
      await provider.verify({ hostname: domain.hostname, providerSafeReference: domain.provider_safe_reference });
    }
    const operationKey = await this.beginProviderOperation({
      context,
      domainId: domain.id,
      providerKey: provider.key,
      operationType: 'VERIFY_SITE_DOMAIN',
      hostname: domain.hostname,
    });
    try {
      const providerResult = await provider.verify({
        hostname: domain.hostname,
        providerSafeReference: domain.provider_safe_reference,
      });
      const httpsMatchesSite = providerResult.dnsActive
        && await this.publicHealth(domain.hostname, siteReference);
      if (!providerResult.dnsActive || !httpsMatchesSite) {
        const failureCode = providerResult.dnsActive
          ? 'DOMAIN_HTTPS_SITE_MISMATCH'
          : 'DOMAIN_DNS_NOT_ACTIVE';
        await this.managedDb.execute(sql`
          update site_domains set
            status = 'VERIFYING',
            ownership_status = ${providerResult.dnsActive ? 'VERIFIED' : 'CHALLENGE_PENDING'},
            ssl_status = 'PENDING', last_checked_at = now(), updated_at = now()
          where id = ${domain.id}::uuid
        `);
        await this.failProviderOperation(operationKey, {
          code: failureCode,
          message: 'DNS and HTTPS verification have not yet reached the exact managed website.',
        });
        return {
          ...(await this.domainDetails(siteReference, domainReference)),
          ready: false,
          failureCode,
        };
      }

      await this.managedDb.transaction(async tx => {
        await tx.execute(sql`
          update site_domains set domain_role = 'ALIAS', is_primary = false, updated_at = now()
          where site_id = ${context.site_id}::uuid
            and domain_type = 'CUSTOM'
            and domain_role = 'CANONICAL'
            and public_reference <> ${domainReference}::uuid
        `);
        await tx.execute(sql`
          update site_domains set
            domain_role = 'CANONICAL', is_primary = true, status = 'ACTIVE',
            ownership_status = 'VERIFIED', ssl_status = 'ACTIVE',
            verified_at = coalesce(verified_at, now()), last_checked_at = now(),
            last_healthy_at = now(), updated_at = now()
          where id = ${domain.id}::uuid
        `);
        await tx.execute(sql`
          insert into site_domain_verifications (
            tenant_id, site_id, domain_id, verification_type, status,
            provider_safe_reference, safe_evidence_json, verified_at
          ) values (
            ${context.tenant_id}::uuid, ${context.site_id}::uuid,
            ${domain.id}::uuid, 'HTTP_CHALLENGE', 'VERIFIED',
            ${providerResult.providerSafeReference},
            ${JSON.stringify({ hostname: domain.hostname, siteReference, https: true })}::jsonb,
            now()
          )
        `);
      });
      await this.completeProviderOperation({
        idempotencyKey: operationKey,
        providerSafeReference: providerResult.providerSafeReference,
        result: { hostname: domain.hostname, dnsActive: true, httpsMatchesSite: true },
      });
      await this.audit.write(actor, 'CUSTOM_DOMAIN_PROMOTED_CANONICAL', 'SITE_DOMAIN', domainReference, {
        tenantId: context.tenant_id,
        category: 'WEBSITE',
        metadata: { siteReference, hostname: domain.hostname, provider: providerResult.providerKey },
      });
      return { ...(await this.domainDetails(siteReference, domainReference)), ready: true };
    } catch (error) {
      await this.failProviderOperation(operationKey, error);
      if (error instanceof SiteDomainProviderError) throw error;
      throw fail(502, 'SITE_DOMAIN_VERIFICATION_FAILED', 'The domain could not be verified safely.');
    }
  }

  async domainDetails(siteReference: string, domainReference: string) {
    const context = await this.siteContext(siteReference);
    const domain = rowsOf<Record<string, unknown>>(await this.managedDb.execute(sql`
      select
        domain.public_reference as reference,
        domain.hostname,
        domain.domain_type as "domainType",
        domain.domain_role as "domainRole",
        domain.provider_key as "providerKey",
        domain.status,
        domain.ownership_status as "ownershipStatus",
        domain.ssl_status as "sslStatus",
        domain.is_primary as "primary",
        domain.updated_at as "updatedAt"
      from site_domains domain
      where domain.public_reference = ${domainReference}::uuid
        and domain.site_id = ${context.site_id}::uuid
      limit 1
    `))[0];
    if (!domain) throw fail(404, 'SITE_DOMAIN_NOT_FOUND', 'The hostname could not be found.');
    const records = rowsOf<Record<string, unknown>>(await this.managedDb.execute(sql`
      select
        record.record_type as "type",
        record.record_name as "name",
        record.record_content as "value",
        record.classification,
        record.proxied,
        record.review_decision as "reviewDecision"
      from site_domain_dns_records record
      join site_domain_dns_plans plan on plan.id = record.dns_plan_id
      join site_domains domain on domain.id = record.domain_id
      where domain.public_reference = ${domainReference}::uuid
        and plan.id = (
          select latest.id from site_domain_dns_plans latest
          where latest.domain_id = domain.id
          order by latest.created_at desc limit 1
        )
      order by case record.classification when 'WEBSITE' then 0 else 1 end,
        record.id
    `));
    return { ...domain, dnsRecords: records };
  }
}
