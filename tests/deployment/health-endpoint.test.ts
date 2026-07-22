import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';

describe('GET /health Safe Fastify Endpoint', () => {
  it('should return 200 OK when database is reachable', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('OK');
    expect(body.service).toBe('ks-os-api');
    expect(body.database).toBe('reachable');
    expect(body.timestamp).toBeDefined();
    expect(body.version).toBeDefined();
  });

  it('should return 200 OK for /api/health path alias', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('ok');
  });

  it('should never expose sensitive environment variables or connection strings in payload', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const payload = res.payload.toLowerCase();
    expect(payload).not.toContain('postgres://');
    expect(payload).not.toContain('password');
    expect(payload).not.toContain('secret');
  });
});
