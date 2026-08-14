import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CreateSitePageSchema,
  CreateSiteSchema,
  CreateSiteVersionSchema,
  UpdateDraftSitePageSchema,
  UpdateSiteSchema,
  type AgencyCapability,
} from '@ks-os/contracts';
import {
  and,
  desc,
  eq,
  getDatabase,
  siteRenderSnapshots,
  siteVersions,
  sites,
} from '@ks-os/database';
import { signSitePreviewToken } from '@ks-os/site-review';
import { z } from 'zod';
import { SiteService } from './site.service.js';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';

const SiteParamsSchema = z.object({
  siteReference: z.string().uuid(),
}).strict();
const VersionParamsSchema = SiteParamsSchema.extend({
  versionReference: z.string().uuid(),
}).strict();
const PageParamsSchema = SiteParamsSchema.extend({
  pageReference: z.string().uuid(),
}).strict();
const PageListQuerySchema = z.object({
  versionReference: z.string().uuid().optional(),
}).strict();

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

function agencyActor(
  request: FastifyRequest,
  capability: AgencyCapability,
): AgencyActor {
  const auth = request.requireAgency(capability);
  return {
    agencyUserId: auth.agencyUserId,
    role: auth.role,
    requestId: request.id,
    ipHash: createHash('sha256')
      .update(`${process.env.AUDIT_IP_HASH_SECRET || 'local-development'}:${request.ip}`)
      .digest('hex'),
    sessionId: request.authIdentity?.authSessionId || undefined,
    userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || undefined,
  };
}

export async function agencySiteRoutes(app: FastifyInstance) {
  let service: SiteService | undefined;
  const siteService = () => {
    service ||= new SiteService();
    return service;
  };

  app.get('/', async (request) => {
    agencyActor(request, 'sites.read');
    return { data: await siteService().list() };
  });

  app.post('/', async (request, reply) => {
    const input = CreateSiteSchema.parse(request.body);
    const data = await siteService().create(
      agencyActor(request, 'sites.manage'),
      input,
    );
    return reply.code(201).send({ data });
  });

  app.get('/:siteReference', async (request) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    agencyActor(request, 'sites.read');
    return { data: await siteService().get(siteReference) };
  });

  app.patch('/:siteReference', async (request) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    const input = UpdateSiteSchema.parse(request.body);
    return {
      data: await siteService().update(
        agencyActor(request, 'sites.manage'),
        siteReference,
        input,
      ),
    };
  });

  app.get('/:siteReference/entitlements', async (request) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    agencyActor(request, 'sites.read');
    return { data: await siteService().entitlementSummary(siteReference) };
  });

  app.post('/:siteReference/preview-link', async (request, reply) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    const actor = agencyActor(request, 'sites.read');
    const database = getDatabase();
    const [preview] = await database.select({
      tenantId: sites.tenantId,
      snapshotReference: siteRenderSnapshots.publicReference,
      versionReference: siteVersions.publicReference,
      versionNumber: siteVersions.versionNumber,
      versionStatus: siteVersions.status,
      generationStatus: siteVersions.generationStatus,
      createdAt: siteRenderSnapshots.createdAt,
    }).from(siteRenderSnapshots)
      .innerJoin(siteVersions, and(
        eq(siteRenderSnapshots.siteVersionId, siteVersions.id),
        eq(siteRenderSnapshots.siteId, siteVersions.siteId),
        eq(siteRenderSnapshots.tenantId, siteVersions.tenantId),
      ))
      .innerJoin(sites, and(
        eq(siteRenderSnapshots.siteId, sites.id),
        eq(siteRenderSnapshots.tenantId, sites.tenantId),
      ))
      .where(and(
        eq(sites.publicReference, siteReference),
        eq(siteRenderSnapshots.snapshotKind, 'PREVIEW'),
      ))
      .orderBy(desc(siteRenderSnapshots.createdAt), desc(siteRenderSnapshots.revision))
      .limit(1);

    if (!preview) {
      throw fail(
        409,
        'SITE_PREVIEW_NOT_READY',
        'No generated website preview is available yet. Generate the site first, then preview it without publishing.',
      );
    }

    const secret = process.env.SITE_PREVIEW_TOKEN_SECRET;
    const origin = process.env.PUBLIC_SITES_PREVIEW_ORIGIN;
    if (!secret || secret.length < 32 || !origin) {
      throw fail(
        503,
        'SITE_PREVIEW_UNAVAILABLE',
        'Secure website preview is not configured for this environment.',
      );
    }

    const ttlSeconds = 3_600;
    const token = signSitePreviewToken({
      siteReference,
      versionReference: preview.versionReference,
      purpose: 'AGENCY_REVIEW',
      secret,
      ttlSeconds,
    });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1_000);
    const previewUrl = `${origin.replace(/\/$/, '')}/site-preview/${siteReference}/${preview.versionReference}?token=${encodeURIComponent(token)}`;

    await new AgencyAuditService().write(
      actor,
      'SITE_GENERATED_PREVIEW_OPENED',
      'SITE_VERSION',
      preview.versionReference,
      {
        tenantId: preview.tenantId,
        category: 'WEBSITE',
        metadata: {
          siteReference,
          snapshotReference: preview.snapshotReference,
          versionNumber: preview.versionNumber,
          versionStatus: preview.versionStatus,
          generationStatus: preview.generationStatus,
          expiresAt: expiresAt.toISOString(),
        },
      },
    );

    return reply
      .header('Cache-Control', 'private, no-store, max-age=0')
      .header('X-Robots-Tag', 'noindex, nofollow, noarchive')
      .code(201)
      .send({
        data: {
          siteReference,
          snapshotReference: preview.snapshotReference,
          versionReference: preview.versionReference,
          versionNumber: preview.versionNumber,
          versionStatus: preview.versionStatus,
          generationStatus: preview.generationStatus,
          previewUrl,
          expiresAt,
        },
      });
  });

  app.get('/:siteReference/versions', async (request) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    agencyActor(request, 'sites.read');
    return { data: await siteService().listVersions(siteReference) };
  });

  app.post('/:siteReference/versions', async (request, reply) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    const input = CreateSiteVersionSchema.parse(request.body);
    const data = await siteService().createVersion(
      agencyActor(request, 'sites.manage'),
      siteReference,
      input,
    );
    return reply.code(201).send({ data });
  });

  app.get('/:siteReference/versions/:versionReference', async (request) => {
    const { siteReference, versionReference } = VersionParamsSchema.parse(
      request.params,
    );
    agencyActor(request, 'sites.read');
    return {
      data: await siteService().getVersion(siteReference, versionReference),
    };
  });

  app.get('/:siteReference/pages', async (request) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    const query = PageListQuerySchema.parse(request.query);
    agencyActor(request, 'sites.read');
    return {
      data: await siteService().listPages(siteReference, query.versionReference),
    };
  });

  app.post('/:siteReference/pages', async (request, reply) => {
    const { siteReference } = SiteParamsSchema.parse(request.params);
    const input = CreateSitePageSchema.parse(request.body);
    const data = await siteService().createPage(
      agencyActor(request, 'sites.manage'),
      siteReference,
      input,
    );
    return reply.code(201).send({ data });
  });

  app.patch('/:siteReference/pages/:pageReference', async (request) => {
    const { siteReference, pageReference } = PageParamsSchema.parse(
      request.params,
    );
    const input = UpdateDraftSitePageSchema.parse(request.body);
    return {
      data: await siteService().updatePage(
        agencyActor(request, 'sites.manage'),
        siteReference,
        pageReference,
        input,
      ),
    };
  });
}