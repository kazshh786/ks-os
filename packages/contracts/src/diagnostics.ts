export type RecoveryAction = 'refresh' | 'wait' | 'sign_in' | 'request_access' | 'reconcile' | 'correct_input';

/** Advice only. A transient failure is not proof that a write can be replayed. */
export function recoveryFor(method: string, status: number): RecoveryAction {
  if (status === 401) return 'sign_in';
  if (status === 403) return 'request_access';
  if (status === 409) return 'refresh';
  if (status === 429) return 'wait';
  if (status >= 400 && status < 500) return 'correct_input';
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) ? 'refresh' : 'reconcile';
}

export function isSafeReadRetry(method: string, status: number): boolean {
  return ['GET', 'HEAD'].includes(method.toUpperCase()) && (status === 0 || status === 429 || status >= 500);
}

export type FlowState = 'loading' | 'ready' | 'empty' | 'blocked' | 'failed' | 'stale' | 'unknown';
export interface FlowDiagnosis {
  state: FlowState;
  expected: string;
  actual: string;
  reason: string;
  nextStep: string;
  checkedAt: string | null;
}

/** Derive explanations from the same readiness evidence that controls the UI. */
export function diagnoseResource(input: {
  loading: boolean; error: boolean; enabled: boolean | null;
  total: number; usable: number; checkedAt: string | null; stale?: boolean;
}): FlowDiagnosis {
  const common = { expected: 'Available options are loaded and usable.', checkedAt: input.checkedAt };
  if (input.enabled === false) return { ...common, state: 'blocked', actual: 'The prerequisite is not ready.', reason: 'Configuration does not permit this option.', nextStep: 'Complete the required setup.' };
  if (input.loading) return { ...common, state: 'loading', actual: 'Checking availability.', reason: 'The lookup is still running.', nextStep: 'Wait for the lookup to finish.' };
  if (input.error) return { ...common, state: 'failed', actual: 'Availability could not be confirmed.', reason: 'The latest lookup failed; an empty result has not been established.', nextStep: 'Refresh availability. Do not repeat an in-progress payment.' };
  if (input.enabled === null || !input.checkedAt) return { ...common, state: 'unknown', actual: 'Availability is unknown.', reason: 'No successful lookup is available.', nextStep: 'Load configuration and available options.' };
  if (input.stale) return { ...common, state: 'stale', actual: 'Previously loaded information may be out of date.', reason: 'A fresh lookup is needed.', nextStep: 'Refresh availability before continuing.' };
  if (!input.total) return { ...common, state: 'empty', actual: 'The lookup succeeded and returned no options.', reason: 'No options were returned by the service.', nextStep: 'Check setup, then refresh availability.' };
  if (!input.usable) return { ...common, state: 'blocked', actual: 'Options exist but none are usable.', reason: 'The current readiness checks did not pass.', nextStep: 'Check connection and compatibility, then refresh.' };
  return { ...common, state: 'ready', actual: 'Usable options are available.', reason: 'The lookup and readiness checks passed.', nextStep: 'Continue with an available option.' };
}
