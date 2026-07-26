import type { APIRoute } from 'astro';
import { loadSitesRuntimeConfig } from '../lib/config.js';
import { DrizzlePublicSiteRepository } from '../lib/repository.js';
import { handleRobotsRequest } from '../lib/runtime.js';

export const prerender = false;

export const GET: APIRoute = ({ request }) =>
  handleRobotsRequest({
    request,
    repository: new DrizzlePublicSiteRepository(),
    config: loadSitesRuntimeConfig(),
  });
