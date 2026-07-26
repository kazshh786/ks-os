import type {
  SiteJobFailureCode,
  SiteJobRetryPolicy,
} from './contracts.js';

export const DEFAULT_SITE_JOB_RETRY_POLICY: Readonly<SiteJobRetryPolicy> = {
  maxAttempts: 5,
  initialDelayMs: 1_000,
  backoffMultiplier: 2,
  maximumDelayMs: 15 * 60_000,
  jitterRatio: 0.1,
};

const terminalCodes = new Set<SiteJobFailureCode>([
  'TERMINAL_VALIDATION_FAILURE',
  'TERMINAL_PERMISSION_FAILURE',
  'TERMINAL_DATA_MISSING',
  'TERMINAL_HANDLER_NOT_IMPLEMENTED',
  'TERMINAL_SCHEMA_VERSION_INCOMPATIBLE',
  'CANCELLED_BY_USER',
  'LEASE_LOST',
  'WORKER_SHUTDOWN',
]);

export interface SiteJobRetryDecision {
  retry: boolean;
  deadLetter: boolean;
  delayMs: number | null;
}

export function isRetryableFailureCode(code: SiteJobFailureCode): boolean {
  return !terminalCodes.has(code);
}

export function retryDelayMs(
  attemptNumber: number,
  policy: SiteJobRetryPolicy,
  randomValue = Math.random(),
  retryAfterMs?: number,
): number {
  const exponent = Math.max(0, attemptNumber - 1);
  const exponential = policy.initialDelayMs
    * (policy.backoffMultiplier ** exponent);
  const base = Math.min(
    policy.maximumDelayMs,
    Math.max(exponential, retryAfterMs || 0),
  );
  const boundedRandom = Math.min(1, Math.max(0, randomValue));
  const jitter = base * policy.jitterRatio * ((boundedRandom * 2) - 1);
  return Math.max(0, Math.min(
    policy.maximumDelayMs,
    Math.round(base + jitter),
  ));
}

export function decideSiteJobRetry(input: {
  attemptNumber: number;
  failureCode: SiteJobFailureCode;
  policy: SiteJobRetryPolicy;
  randomValue?: number;
  retryAfterMs?: number;
}): SiteJobRetryDecision {
  if (!isRetryableFailureCode(input.failureCode)) {
    return { retry: false, deadLetter: false, delayMs: null };
  }
  if (input.attemptNumber >= input.policy.maxAttempts) {
    return { retry: false, deadLetter: true, delayMs: null };
  }
  return {
    retry: true,
    deadLetter: false,
    delayMs: retryDelayMs(
      input.attemptNumber,
      input.policy,
      input.randomValue,
      input.retryAfterMs,
    ),
  };
}

export function safeFailureMessage(value: unknown): string {
  const fallback = 'The site job could not be completed.';
  if (!(value instanceof Error)) return fallback;
  return value.message
    .replace(
      /(postgres(?:ql)?:\/\/|authorization|bearer|token|secret|password|cookie)[^\s]*/gi,
      '[REDACTED]',
    )
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 500) || fallback;
}

export class SiteJobExecutionError extends Error {
  constructor(
    readonly code: SiteJobFailureCode,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'SiteJobExecutionError';
  }
}
