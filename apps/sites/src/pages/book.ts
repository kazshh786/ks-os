import type { APIRoute } from 'astro';
import { loadSitesRuntimeConfig } from '../lib/config.js';
import { DrizzlePublicSiteRepository } from '../lib/repository.js';
import { handleBookingRequest } from '../lib/runtime.js';

export const prerender = false;

export const GET: APIRoute = ({ request }) =>
  handleBookingRequest({
    request,
    repository: new DrizzlePublicSiteRepository(),
    config: loadSitesRuntimeConfig(),
  });
