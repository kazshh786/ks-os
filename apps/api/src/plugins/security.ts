import { FastifyInstance } from 'fastify';
import cors, { type FastifyCorsOptions } from '@fastify/cors';
import helmet from '@fastify/helmet';
import fp from 'fastify-plugin';
import { and, eq, sql } from 'drizzle-orm';
import { bookingPages, getDatabase, tenants } from '@ks-os/database';
import { env } from '../config/env.js';
import {
  createCorsOriginAuthorizer,
  createCorsOriginPolicy,
  normaliseForwardedHostname,
  splitCorsConfiguration,
} from './cors-origin-policy.js';

async function registerSecurity(fastify: FastifyInstance) {
  // 1. Secure HTTP Headers
  await fastify.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc:["'none'"],frameAncestors:["'none'"],baseUri:["'none'"],formAction:["'none'"] } },
    hsts: env.NODE_ENV==='production'?{maxAge:31536000,includeSubDomains:true,preload:true}:false,
    referrerPolicy:{policy:'no-referrer'},
    crossOriginResourcePolicy:{policy:'same-site'},
  });

  const firstPartyOriginAllowed = createCorsOriginPolicy({
    workspaceOrigins: [env.FRONTEND_ORIGIN, env.PUBLIC_APP_ORIGIN],
    exactOrigins: splitCorsConfiguration(env.WIDGET_ALLOWED_ORIGINS),
    workspaceDomains: splitCorsConfiguration(
      process.env.PUBLIC_WORKSPACE_DOMAINS || process.env.PUBLIC_WORKSPACE_DOMAIN,
    ),
    allowLocalhost: env.NODE_ENV !== 'production',
  });

  const verifiedBookingOriginAllowed = createCorsOriginAuthorizer({
    inferWorkspaceDomains: false,
    verifyCustomDomain: async hostname => {
      const [verified] = await getDatabase()
        .select({ id: bookingPages.id })
        .from(bookingPages)
        .innerJoin(tenants, eq(tenants.id, bookingPages.tenantId))
        .where(and(
          sql`lower(${bookingPages.customDomain}) = ${hostname}`,
          eq(bookingPages.customDomainStatus, 'VERIFIED'),
          eq(bookingPages.enabled, true),
          eq(bookingPages.published, true),
          eq(tenants.isActive, true),
          eq(tenants.lifecycleStatus, 'ACTIVE'),
        ))
        .limit(1);
      return Boolean(verified);
    },
  });

  // Preserve the browser-facing hostname through Vercel or another trusted
  // reverse proxy so the public booking resolver can match verified domains.
  fastify.addHook('onRequest', async request => {
    const forwarded = normaliseForwardedHostname(request.headers['x-forwarded-host']);
    if (forwarded) request.headers.host = forwarded;
  });

  const corsOptions: FastifyCorsOptions = {
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    strictPreflight: true,
    maxAge: 600,
    exposedHeaders: ['x-request-id', 'x-correlation-id', 'retry-after'],
  };

  // 2. First-party and exact widget origins keep their configured access.
  // Verified client domains are intentionally limited to the public API only.
  await fastify.register(cors, {
    ...corsOptions,
    delegator: (request, callback) => {
      const origin = request.headers.origin;
      if (firstPartyOriginAllowed(origin)) {
        callback(null, { ...corsOptions, origin: true });
        return;
      }
      if (!request.raw.url?.startsWith('/api/v1/public/')) {
        callback(null, { ...corsOptions, origin: false });
        return;
      }
      void verifiedBookingOriginAllowed(origin)
        .then(allowed => callback(null, { ...corsOptions, origin: allowed }))
        .catch(error => {
          fastify.log.error({ err: error, origin }, 'Verified booking-domain CORS lookup failed');
          callback(null, { ...corsOptions, origin: false });
        });
    },
  });
}

export default fp(registerSecurity,{name:'security'});
