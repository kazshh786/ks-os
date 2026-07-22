import { FastifyInstance } from 'fastify';
import { execSync } from 'child_process';
import { getDatabase, sql } from '@ks-os/database';

function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return process.env.GIT_COMMIT || '0.1.0';
  }
}

export default async function registerRoutes(fastify: FastifyInstance) {
  // Safe production health endpoint
  const healthHandler = async (request: any, reply: any) => {
    const timestamp = new Date().toISOString();
    const version = getGitCommit();

    let dbStatus = 'reachable';
    let isDbHealthy = true;

    try {
      // Safely ping database with standard query
      const db = getDatabase();
      await db.execute(sql`SELECT 1`);
    } catch (error) {
      fastify.log.error({ err: error }, 'Health check database ping failed');
      dbStatus = 'unreachable';
      isDbHealthy = false;
    }

    const payload = {
      status: isDbHealthy ? ('OK' as const) : ('ERROR' as const),
      service: 'ks-os-api',
      uptime: process.uptime(),
      version,
      database: dbStatus,
      timestamp,
    };

    return reply.status(isDbHealthy ? 200 : 503).send(payload);
  };

  // Mount at GET /health and GET /api/health
  fastify.get('/health', healthHandler);
  fastify.get('/api/health', healthHandler);
}
