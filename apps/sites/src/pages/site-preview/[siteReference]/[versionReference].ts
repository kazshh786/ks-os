import type { APIRoute } from 'astro';
import { loadSitesRuntimeConfig } from '../../../lib/config.js';
import { DrizzlePublicSiteRepository } from '../../../lib/repository.js';
import { handlePreviewRequest } from '../../../lib/runtime.js';

export const prerender = false;

export const GET: APIRoute = ({ request, params }) =>
  handlePreviewRequest({
    request,
    repository: new DrizzlePublicSiteRepository(),
    config: loadSitesRuntimeConfig(),
    siteReference: params.siteReference ?? '',
    versionReference: params.versionReference ?? '',
  });
