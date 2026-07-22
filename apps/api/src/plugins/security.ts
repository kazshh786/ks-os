import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';

export default async function registerSecurity(fastify: FastifyInstance) {
  // 1. Secure HTTP Headers
  await fastify.register(helmet, {
    contentSecurityPolicy: false // Disable CSP for API only setups
  });

  // 2. CORS suitable for local development
  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Allow localhost:3000 and same-origin requests
      if (!origin || /https?:\/\/localhost:3000/.test(origin) || /https?:\/\/127\.0\.0\.1:3000/.test(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
  });
}
