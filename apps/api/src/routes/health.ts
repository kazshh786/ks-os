import { FastifyInstance } from 'fastify';
import { 
  HealthResponseSchema, 
  SessionResponseSchema, 
  ApiErrorSchema 
} from '@ks-os/contracts';
import { env } from '../config/env.js';

export default async function registerRoutes(fastify: FastifyInstance) {
  // 1. Health check endpoint
  fastify.get('/api/health', async (request, reply) => {
    const health = {
      status: 'OK' as const,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: '0.1.0'
    };
    
    // Parse using Zod contract schema for verification
    const parsed = HealthResponseSchema.parse(health);
    return reply.status(200).send(parsed);
  });


}
