import type { APIRoute } from 'astro';
import { maybeHandleBareBeautyBookingRequest } from '../lib/bare-beauty.js';
import { loadSitesRuntimeConfig } from '../lib/config.js';
import { OperationalPublicSiteRepository } from '../lib/operational-repository.js';
import { handleBookingRequest } from '../lib/runtime.js';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const config = loadSitesRuntimeConfig();
  const bareBeauty = await maybeHandleBareBeautyBookingRequest(request, config);
  if (bareBeauty) return bareBeauty;
  return handleBookingRequest({
    request,
    repository: new OperationalPublicSiteRepository(),
    config,
  });
};
