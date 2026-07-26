import type { APIRoute } from 'astro';
import { loadSitesRuntimeConfig } from '../lib/config.js';
import { handleHealthRequest } from '../lib/runtime.js';

export const prerender = false;

export const GET: APIRoute = () =>
  handleHealthRequest(loadSitesRuntimeConfig());
