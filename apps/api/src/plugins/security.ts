import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';
import { createCorsOriginPolicy, splitCorsConfiguration } from './cors-origin-policy.js';

async function registerSecurity(fastify: FastifyInstance) {
  // 1. Secure HTTP Headers
  await fastify.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc:["'none'"],frameAncestors:["'none'"],baseUri:["'none'"],formAction:["'none'"] } },
    hsts: env.NODE_ENV==='production'?{maxAge:31536000,includeSubDomains:true,preload:true}:false,
    referrerPolicy:{policy:'no-referrer'},
    crossOriginResourcePolicy:{policy:'same-site'},
  });

  const originAllowed = createCorsOriginPolicy({
    exactOrigins: [
      env.FRONTEND_ORIGIN,
      env.PUBLIC_APP_ORIGIN,
      ...splitCorsConfiguration(env.WIDGET_ALLOWED_ORIGINS),
    ],
    workspaceDomains: splitCorsConfiguration(
      process.env.PUBLIC_WORKSPACE_DOMAINS || process.env.PUBLIC_WORKSPACE_DOMAIN,
    ),
    allowLocalhost: env.NODE_ENV !== 'production',
  });

  // 2. Allow trusted staff, public-booking and embedded-widget origins.
  // Invalid browser origins are denied without throwing a server error.
  await fastify.register(cors, {
    origin: (origin, cb) => cb(null, originAllowed(origin)),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    strictPreflight:true,
    maxAge:600,
  });
}

export default fp(registerSecurity,{name:'security'});