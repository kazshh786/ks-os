import type { APIRoute } from 'astro';
import { maybeHandleBareBeautyRobotsRequest } from '../lib/bare-beauty.js';
import { loadSitesRuntimeConfig } from '../lib/config.js';
import { DrizzlePublicSiteRepository } from '../lib/repository.js';
import { handleRobotsRequest } from '../lib/runtime.js';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const config = loadSitesRuntimeConfig();
  const bareBeauty = await maybeHandleBareBeautyRobotsRequest(request, config);
  if (bareBeauty) return bareBeauty;
  return handleRobotsRequest({
    request,
    repository: new DrizzlePublicSiteRepository(),
    config,
  });
};
