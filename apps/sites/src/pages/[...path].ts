import type { APIRoute } from 'astro';
import { maybeHandleBareBeautyPageRequest } from '../lib/bare-beauty.js';
import { maybeHandleBareBeautyProductionDomain } from '../lib/bare-beauty-domain.js';
import { loadSitesRuntimeConfig } from '../lib/config.js';
import { OperationalPublicSiteRepository } from '../lib/operational-repository.js';
import { handlePublicPageRequest } from '../lib/runtime.js';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const config = loadSitesRuntimeConfig();
  const productionDomain = await maybeHandleBareBeautyProductionDomain(
    request,
    remappedRequest => maybeHandleBareBeautyPageRequest(remappedRequest, config),
  );
  if (productionDomain) return productionDomain;

  const bareBeauty = await maybeHandleBareBeautyPageRequest(request, config);
  if (bareBeauty) return bareBeauty;
  return handlePublicPageRequest({
    request,
    repository: new OperationalPublicSiteRepository(),
    config,
  });
};
