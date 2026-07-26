import { createServer, type Server } from 'node:http';
import type { SiteJobHandlerRegistry } from '@ks-os/site-jobs';
import type {
  SiteJobRepository,
  SiteJobRepositoryHealth,
} from './repository.types.js';

export interface SiteWorkerHealthSnapshot {
  service: 'site-worker';
  status: 'OK' | 'DEGRADED';
  ready: boolean;
  draining: boolean;
  pollLoopAlive: boolean;
  databaseAvailable: boolean;
  schemaCompatible: boolean;
  registryLoaded: boolean;
  registeredHandlerCount: number;
  activeJobCount: number;
  startedAt: string;
  lastPollAt: string | null;
}

export class SiteWorkerHealth {
  private readonly startedAt = new Date();
  private lastPollAt: Date | null = null;
  private draining = false;
  private activeJobCount = 0;

  constructor(
    private readonly repository: SiteJobRepository,
    private readonly registry: SiteJobHandlerRegistry,
  ) {}

  markPoll(): void {
    this.lastPollAt = new Date();
  }

  markDraining(): void {
    this.draining = true;
  }

  setActiveJobCount(count: number): void {
    this.activeJobCount = Math.max(0, count);
  }

  async snapshot(): Promise<SiteWorkerHealthSnapshot> {
    let repositoryHealth: SiteJobRepositoryHealth;
    try {
      repositoryHealth = await this.repository.health();
    } catch {
      repositoryHealth = {
        databaseAvailable: false,
        schemaCompatible: false,
      };
    }
    const pollLoopAlive = this.lastPollAt !== null;
    const registryLoaded = Array.isArray(this.registry.list());
    const ready = repositoryHealth.databaseAvailable
      && repositoryHealth.schemaCompatible
      && registryLoaded
      && !this.draining;
    return {
      service: 'site-worker',
      status: ready || (pollLoopAlive && !this.draining) ? 'OK' : 'DEGRADED',
      ready,
      draining: this.draining,
      pollLoopAlive,
      databaseAvailable: repositoryHealth.databaseAvailable,
      schemaCompatible: repositoryHealth.schemaCompatible,
      registryLoaded,
      registeredHandlerCount: this.registry.list().length,
      activeJobCount: this.activeJobCount,
      startedAt: this.startedAt.toISOString(),
      lastPollAt: this.lastPollAt?.toISOString() || null,
    };
  }
}

export class SiteWorkerHealthServer {
  private server: Server | null = null;

  constructor(
    private readonly health: SiteWorkerHealth,
    private readonly host: string,
    private readonly port: number,
  ) {}

  async start(): Promise<number> {
    if (this.server) throw new Error('Health server is already running.');
    this.server = createServer(async (request, response) => {
      if (request.method !== 'GET'
        || (request.url !== '/health' && request.url !== '/ready')) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'NOT_FOUND' }));
        return;
      }
      const snapshot = await this.health.snapshot();
      const status = request.url === '/ready' && !snapshot.ready ? 503 : 200;
      response.writeHead(status, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify(snapshot));
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.port, this.host, () => resolve());
    });
    const address = this.server.address();
    return address && typeof address === 'object' ? address.port : this.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}
