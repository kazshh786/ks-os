import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';

async function registerSecurity(fastify: FastifyInstance) {
  // 1. Secure HTTP Headers
  await fastify.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc:["'none'"],frameAncestors:["'none'"],baseUri:["'none'"],formAction:["'none'"] } },
    hsts: env.NODE_ENV==='production'?{maxAge:31536000,includeSubDomains:true,preload:true}:false,
    referrerPolicy:{policy:'no-referrer'},
    crossOriginResourcePolicy:{policy:'same-site'},
  });

  // 2. CORS suitable for local development
  await fastify.register(cors, {
    origin: (origin, cb) => {
      const allowed=new Set([env.FRONTEND_ORIGIN,env.PUBLIC_APP_ORIGIN,env.NODE_ENV!=='production'?'http://localhost:3000':undefined,env.NODE_ENV!=='production'?'http://127.0.0.1:3000':undefined].filter(Boolean));
      if (!origin || allowed.has(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    strictPreflight:true,
    maxAge:600,
  });
}

export default fp(registerSecurity,{name:'security'});
