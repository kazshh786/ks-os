import type { z } from 'zod';
import type {
  RegisteredSiteJobType,
  SiteJobProgress,
  SiteJobRetryPolicy,
} from './contracts.js';

export interface SiteJobLeaseContext {
  workerId: string;
  jobReference: string;
  tenantReference: string;
  siteReference: string;
  attemptNumber: number;
  signal: AbortSignal;
  updateProgress(progress: SiteJobProgress): Promise<void>;
  isCancellationRequested(): Promise<boolean>;
}

export interface SiteJobHandler {
  readonly jobType: RegisteredSiteJobType;
  readonly payloadSchemaVersion: number;
  readonly supportsCancellation: boolean;
  readonly defaultRetryPolicy: Readonly<SiteJobRetryPolicy>;
  readonly payloadSchema: z.ZodTypeAny;
  readonly resultSchema: z.ZodTypeAny;
  execute(payload: unknown, context: SiteJobLeaseContext): Promise<unknown>;
}

export interface SiteJobHandlerSummary {
  jobType: RegisteredSiteJobType;
  payloadSchemaVersion: number;
  supportsCancellation: boolean;
}

export class SiteJobHandlerRegistry {
  private readonly handlers = new Map<RegisteredSiteJobType, SiteJobHandler>();

  register(handler: SiteJobHandler): this {
    if (this.handlers.has(handler.jobType)) {
      throw new Error(`A handler is already registered for ${handler.jobType}.`);
    }
    if (!Number.isInteger(handler.payloadSchemaVersion)
      || handler.payloadSchemaVersion < 1) {
      throw new Error('Handler payload schema version must be positive.');
    }
    this.handlers.set(handler.jobType, handler);
    return this;
  }

  get(jobType: RegisteredSiteJobType): SiteJobHandler | undefined {
    return this.handlers.get(jobType);
  }

  has(jobType: RegisteredSiteJobType): boolean {
    return this.handlers.has(jobType);
  }

  list(): readonly SiteJobHandlerSummary[] {
    return [...this.handlers.values()]
      .map(handler => ({
        jobType: handler.jobType,
        payloadSchemaVersion: handler.payloadSchemaVersion,
        supportsCancellation: handler.supportsCancellation,
      }))
      .sort((left, right) => left.jobType.localeCompare(right.jobType));
  }
}
