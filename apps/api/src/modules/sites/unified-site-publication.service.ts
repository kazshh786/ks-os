import { createHash, randomUUID } from 'node:crypto';
import { getDatabase, sql } from '@ks-os/database';
import { normalizeCustomHostname } from '@ks-os/site-publishing';
import type { AgencyActor } from '../agency/agency.service.js';
import { AgencyAuditService } from '../agency/agency.service.js';
import { SitePublicationService } from './site-publication.service.js';

type Database = ReturnType<typeof getDatabase>;

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

function rowsOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return ((value as { rows?: unknown[] })?.rows || []) as T[];
}

function safeText(value: unknown, maximum = 2_000) {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

type VercelDomainResponse = {
  name?: string;
  verified?: boolean;
  verification?: Array<{ type?: string; domain?: string; value?: string; reason?: string }>;
};

type VercelConfigResponse = {
  misconfigured?: boolean;
  recommendedCNAME?: Array<{ value?: string; rank?: number }>;
  recommendedIPv4?: Array<{ value?: string; rank?: number }>;
};

export class UnifiedSitePublicationService extends SitePublicationService {
  private readonly audit = new AgencyAuditService();

  constructor(
    private readonly database: Database = getDatabase(),
    private readonly environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  ) {
    super(database);
  }

  private providerConfig() {
    const token = this.environment.VERCEL_AUTH_TOKEN;
    const projectId = this.environment.VERCEL_PROJECT_ID;
    if (!token || !projectId) {
      throw fail(503, 'CUSTOM_DOMAIN_PROVIDER_UNAVAILABLE', 'Vercel domain integration is not configured on the API server.');
    }
    return { token, projectId, teamId: this.environment.VERCEL_TEAM_ID || '' };
  }

  private async vercel(path: string, init: RequestInit = {}) {
    const { token, teamId } = this.providerConfig();
    const query = teamId ? `${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(teamId)}` : '';
    const response = await fetch(`https://api.vercel.com${path}${query}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = object(object(payload).error);
      const message = safeText(error.message) || 'Vercel rejected the custom domain request.';
      throw fail(response.status, `VERCEL_${safeText(error.code, 80).toUpperCase() || 'DOMAIN_ERROR'}`, message);
    }
    return payload;
  }

  private async siteContext(siteReference: string) {
    const result = await this.database.execute(sql<{
      site_id: string;
      tenant_id: string;
      tenant_reference: string;
    }>`
      select site.id as site_id, site.tenant_id, tenant.business_reference as tenant_reference
      from sites site
      join tenants tenant on tenant.id = site.tenant_id
      where site.public_reference = ${siteReference}::uuid
      limit 1
    `);
    const row = rowsOf<{ site_id: string; tenant_id: string; tenant_reference: string }>(result)[0];
    if (!row) throw fail(404, 'SITE_NOT_FOUND', 'The managed website could not be found.');
    return row;
  }

  async createManagedCustom(actor: AgencyActor, siteReference: string, hostnameInput: string) {
    const hostname = normalizeCustomHostname(hostnameInput);
    const context = await this.siteContext(siteReference);
    const existing = rowsOf<{ public_reference: string; site_id: string; status: string }>(
      await this.database.execute(sql`
        select public_reference, site_id, status from site_domains
        where hostname = ${hostname} and status <> 'REMOVED'
        limit 1
      `),
    )[0];
    if (existing) {
      if (existing.site_id !== context.site_id) {
        throw fail(409, 'HOSTNAME_ALREADY_ASSIGNED', 'This hostname is already assigned to another managed website.');
      }
      return this.domainDetails(siteReference, existing.public_reference);
    }

    const { projectId } = this.providerConfig();
    const added = await this.vercel(`/v9/projects/${encodeURIComponent(projectId)}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: hostname }),
    }) as VercelDomainResponse;
    const config = await this.vercel(`/v6/domains/${encodeURIComponent(hostname)}/config`) as VercelConfigResponse;
    const routing = this.routingRecord(hostname, config);
    const verification = Array.isArray(added.verification) ? added.verification : [];
    const discoveryDigest = createHash('sha256').update(JSON.stringify({ hostname, routing, verification })).digest('hex');

    const domainReference = randomUUID();
    const planReference = randomUUID();
    await this.database.transaction(async tx => {
      await tx.execute(sql`
        insert into site_domains (
          public_reference, tenant_id, site_id, hostname, domain_type, domain_role,
          provider_key, provider_safe_reference, status, ownership_status,
          ssl_status, canonical_preference, is_primary, created_at, updated_at
        ) values (
          ${domainReference}::uuid, ${context.tenant_id}::uuid, ${context.site_id}::uuid,
          ${hostname}, 'CUSTOM', 'ALIAS', 'VERCEL', ${hostname},
          'DNS_REVIEW_REQUIRED',
          ${added.verified ? 'VERIFIED' : 'CHALLENGE_PENDING'},
          'PENDING', 'NONE', false, now(), now()
        )
      `);
      await tx.execute(sql`
        insert into site_domain_dns_plans (
          public_reference, tenant_id, site_id, domain_id, status,
          discovery_digest_sha256, created_at, updated_at
        ) select ${planReference}::uuid, ${context.tenant_id}::uuid, ${context.site_id}::uuid,
          id, 'REVIEW_REQUIRED', ${discoveryDigest}, now(), now()
        from site_domains where public_reference = ${domainReference}::uuid
      `);
      const records = [
        routing,
        ...verification.flatMap(item => {
          const type = safeText(item.type, 10).toUpperCase();
          const value = safeText(item.value);
          if (!['TXT', 'CNAME', 'A'].includes(type) || !value) return [];
          return [{
            type,
            name: safeText(item.domain, 253) || hostname,
            value,
            classification: type === 'TXT' ? 'SECURITY' : 'WEBSITE',
          }];
        }),
      ];
      for (const record of records) {
        await tx.execute(sql`
          insert into site_domain_dns_records (
            tenant_id, site_id, domain_id, dns_plan_id, record_type,
            record_name, record_content, ttl, classification, protected,
            managed_by_ks_os, proxied, review_decision
          ) select ${context.tenant_id}::uuid, ${context.site_id}::uuid,
            domain.id, plan.id, ${record.type}, ${record.name.toLowerCase()},
            ${record.value}, 300, ${record.classification}, true, false, false, 'PRESERVE'
          from site_domains domain
          join site_domain_dns_plans plan on plan.domain_id = domain.id
          where domain.public_reference = ${domainReference}::uuid
            and plan.public_reference = ${planReference}::uuid
        `);
      }
    });
    await this.audit.write(actor, 'CUSTOM_DOMAIN_ADDED_TO_PROVIDER', 'SITE_DOMAIN', domainReference, {
      tenantId: context.tenant_id,
      category: 'WEBSITE',
      metadata: { siteReference, hostname, provider: 'VERCEL', dnsRecordCount: 1 + verification.length },
    });
    return this.domainDetails(siteReference, domainReference);
  }

  async verifyAndPromoteCustom(actor: AgencyActor, siteReference: string, domainReference: string) {
    const context = await this.siteContext(siteReference);
    const domain = rowsOf<{ hostname: string; domain_type: string }>(
      await this.database.execute(sql`
        select hostname, domain_type from site_domains
        where public_reference = ${domainReference}::uuid
          and site_id = ${context.site_id}::uuid
          and tenant_id = ${context.tenant_id}::uuid
          and status <> 'REMOVED'
        limit 1
      `),
    )[0];
    if (!domain || domain.domain_type !== 'CUSTOM') {
      throw fail(404, 'CUSTOM_DOMAIN_NOT_FOUND', 'The custom hostname could not be found for this website.');
    }
    const { projectId } = this.providerConfig();
    const verified = await this.vercel(
      `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain.hostname)}/verify`,
      { method: 'POST', body: '{}' },
    ) as VercelDomainResponse;
    const config = await this.vercel(`/v6/domains/${encodeURIComponent(domain.hostname)}/config`) as VercelConfigResponse;
    const ready = verified.verified === true && config.misconfigured === false;
    if (!ready) {
      await this.database.execute(sql`
        update site_domains set
          status = 'DNS_REVIEW_REQUIRED',
          ownership_status = ${verified.verified ? 'VERIFIED' : 'CHALLENGE_PENDING'},
          ssl_status = 'PENDING',
          updated_at = now()
        where public_reference = ${domainReference}::uuid
      `);
      return { ...(await this.domainDetails(siteReference, domainReference)), ready: false };
    }

    await this.database.transaction(async tx => {
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
          last_healthy_at = now(), updated_at = now()
        where public_reference = ${domainReference}::uuid
      `);
    });
    await this.audit.write(actor, 'CUSTOM_DOMAIN_PROMOTED_CANONICAL', 'SITE_DOMAIN', domainReference, {
      tenantId: context.tenant_id,
      category: 'WEBSITE',
      metadata: { siteReference, hostname: domain.hostname, provider: 'VERCEL' },
    });
    return { ...(await this.domainDetails(siteReference, domainReference)), ready: true };
  }

  async domainDetails(siteReference: string, domainReference: string) {
    const context = await this.siteContext(siteReference);
    const domain = rowsOf<Record<string, unknown>>(
      await this.database.execute(sql`
        select
          domain.public_reference as reference,
          domain.hostname,
          domain.domain_type as "domainType",
          domain.domain_role as "domainRole",
          domain.status,
          domain.ownership_status as "ownershipStatus",
          domain.ssl_status as "sslStatus",
          domain.is_primary as "primary",
          domain.updated_at as "updatedAt"
        from site_domains domain
        where domain.public_reference = ${domainReference}::uuid
          and domain.site_id = ${context.site_id}::uuid
        limit 1
      `),
    )[0];
    if (!domain) throw fail(404, 'SITE_DOMAIN_NOT_FOUND', 'The hostname could not be found.');
    const records = rowsOf<Record<string, unknown>>(
      await this.database.execute(sql`
        select
          record_type as "type",
          record_name as "name",
          record_content as "value",
          classification,
          review_decision as "reviewDecision"
        from site_domain_dns_records record
        join site_domains domain on domain.id = record.domain_id
        where domain.public_reference = ${domainReference}::uuid
        order by case record.classification when 'WEBSITE' then 0 else 1 end, record.id
      `),
    );
    return { ...domain, dnsRecords: records };
  }

  private routingRecord(hostname: string, config: VercelConfigResponse) {
    const cname = [...(config.recommendedCNAME || [])]
      .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0))
      .find(item => safeText(item.value));
    if (cname?.value) {
      return { type: 'CNAME', name: hostname, value: safeText(cname.value), classification: 'WEBSITE' };
    }
    const ipv4 = [...(config.recommendedIPv4 || [])]
      .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0))
      .find(item => safeText(item.value));
    return {
      type: 'A',
      name: hostname,
      value: safeText(ipv4?.value) || '76.76.21.21',
      classification: 'WEBSITE',
    };
  }
}
