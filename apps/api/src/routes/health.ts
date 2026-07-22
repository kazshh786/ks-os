import { FastifyInstance } from 'fastify';
import { getDatabase, sql } from '@ks-os/database';
import { env } from '../config/env.js';

const version=()=>env.RELEASE_VERSION||process.env.GIT_COMMIT||'development';

export default async function registerRoutes(fastify: FastifyInstance) {
  const liveness = async (_request:any,reply:any)=>reply.send({status:'OK',service:'ks-os-api',uptime:process.uptime(),version:version(),timestamp:new Date().toISOString()});
  const readiness = async (_request: any, reply: any) => {
    const timestamp = new Date().toISOString();

    let dbStatus = 'reachable';
    let isDbHealthy = true;

    try {
      // Safely ping database with standard query
      const db = getDatabase();
      await Promise.race([db.execute(sql`SELECT 1`),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Database health timeout')),2000))]);
    } catch (error) {
      fastify.log.error({ err: error }, 'Health check database ping failed');
      dbStatus = 'unreachable';
      isDbHealthy = false;
    }

    const payload = {
      status: isDbHealthy ? ('OK' as const) : ('ERROR' as const),
      service: 'ks-os-api',
      uptime: process.uptime(),
      version:version(),
      database: dbStatus,
      checks:{database:dbStatus},
      timestamp,
    };

    return reply.status(isDbHealthy ? 200 : 503).send(payload);
  };

  // Mount at GET /health and GET /api/health
  fastify.get('/health/live', liveness);
  fastify.get('/health/ready', readiness);
  fastify.get('/health', readiness);
  fastify.get('/api/health', readiness);
}
