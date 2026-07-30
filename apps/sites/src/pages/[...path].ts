import type { APIRoute } from 'astro';
import { loadSitesRuntimeConfig } from '../lib/config.js';
import { OperationalPublicSiteRepository } from '../lib/operational-repository.js';
import { handlePublicPageRequest } from '../lib/runtime.js';

export const prerender = false;

export const GET: APIRoute = ({ request }) =>
  handlePublicPageRequest({
    request,
    repository: new OperationalPublicSiteRepository(),
    config: loadSitesRuntimeConfig(),
  });
