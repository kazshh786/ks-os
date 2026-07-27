export interface OutboxRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maximumDelayMs: number;
  jitterRatio: number;
}

export const DEFAULT_OUTBOX_RETRY_POLICY: Readonly<OutboxRetryPolicy> = {
  maxAttempts: 5,
  initialDelayMs: 5_000,
  backoffMultiplier: 2,
  maximumDelayMs: 3_600_000,
  jitterRatio: 0.1,
};

export function calculateOutboxBackoffDelay(
  attemptNumber: number,
  policy: OutboxRetryPolicy = DEFAULT_OUTBOX_RETRY_POLICY,
  randomValue = Math.random(),
): number {
  const exponent = Math.max(0, attemptNumber - 1);
  const exponential = policy.initialDelayMs * (policy.backoffMultiplier ** exponent);
  const base = Math.min(policy.maximumDelayMs, exponential);
  const boundedRandom = Math.min(1, Math.max(0, randomValue));
  const jitter = base * policy.jitterRatio * ((boundedRandom * 2) - 1);
  return Math.max(0, Math.min(policy.maximumDelayMs, Math.round(base + jitter)));
}

export function decideOutboxRetry(input: {
  attemptNumber: number;
  isTerminalFailure: boolean;
  policy?: OutboxRetryPolicy;
  randomValue?: number;
}): { retry: boolean; deadLetter: boolean; delayMs: number } {
  const policy = input.policy ?? DEFAULT_OUTBOX_RETRY_POLICY;
  if (input.isTerminalFailure) {
    return { retry: false, deadLetter: true, delayMs: 0 };
  }
  if (input.attemptNumber >= policy.maxAttempts) {
    return { retry: false, deadLetter: true, delayMs: 0 };
  }
  const delayMs = calculateOutboxBackoffDelay(input.attemptNumber, policy, input.randomValue);
  return { retry: true, deadLetter: false, delayMs };
}
