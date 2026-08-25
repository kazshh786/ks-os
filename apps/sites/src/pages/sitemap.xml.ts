import type { APIRoute } from 'astro';
import { maybeHandleBareBeautySitemapRequest } from '../lib/bare-beauty.js';
import { maybeHandleBareBeautyProductionDomain } from '../lib/bare-beauty-domain.js';
import { loadSitesRuntimeConfig } from '../lib/config.js';
import { DrizzlePublicSiteRepository } from '../lib/repository.js';
import { handleSitemapRequest } from '../lib/runtime.js';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const config = loadSitesRuntimeConfig();
  const productionDomain = await maybeHandleBareBeautyProductionDomain(
    request,
    remappedRequest => maybeHandleBareBeautySitemapRequest(remappedRequest, config),
  );
  if (productionDomain) return productionDomain;

  const bareBeauty = await maybeHandleBareBeautySitemapRequest(request, config);
  if (bareBeauty) return bareBeauty;
  return handleSitemapRequest({
    request,
    repository: new DrizzlePublicSiteRepository(),
    config,
  });
};
