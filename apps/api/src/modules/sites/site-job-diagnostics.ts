import { listSiteJobTransitions, SiteJobStatusSchema } from '@ks-os/site-jobs';

export function diagnoseSiteJob(job: {
  status: string; updatedAt: Date | string; availableAt: Date | string;
  leaseExpiresAt: Date | string | null; heartbeatAt: Date | string | null;
  attemptCount: number; maxAttempts: number; failureCode: string | null;
}, now = new Date()) {
  const parsed = SiteJobStatusSchema.safeParse(job.status);
  if (!parsed.success) return {
    checkedAt: now.toISOString(), actualState: 'UNKNOWN', expected: 'A recognised workflow state.',
    reason: 'The recorded state is not recognised by this version.', nextStep: 'Check API and worker release versions.',
    allowedTransitions: [], leaseExpired: null, overdue: null,
  };
  const status = parsed.data;
  const available = new Date(job.availableAt).getTime();
  const leaseExpiry = job.leaseExpiresAt ? new Date(job.leaseExpiresAt).getTime() : NaN;
  const updated = new Date(job.updatedAt).getTime();
  const active = ['LEASED', 'PROCESSING', 'CANCEL_REQUESTED'].includes(status);
  const waiting = ['PENDING', 'SCHEDULED', 'RETRY_DELAY'].includes(status);
  const expectations: Record<typeof status, [string, string, string]> = {
    PENDING: ['A worker leases this job when eligible.', 'The job is queued.', 'Check eligibility time and worker availability.'],
    SCHEDULED: ['A worker leases this job after its availability time.', 'The job is scheduled.', 'Wait until eligible, then check worker availability.'],
    LEASED: ['The lease holder starts processing.', 'A worker has claimed the job.', 'Inspect the latest attempt and worker heartbeat.'],
    PROCESSING: ['The worker reports progress and a terminal outcome.', 'The last recorded state is processing.', 'Inspect the heartbeat and recent events before intervening.'],
    RETRY_DELAY: ['A worker retries after the recorded delay.', 'The retry policy delayed the next attempt.', 'Check the failure code and availability time.'],
    COMPLETED: ['Job output is available to the next workflow step.', 'Completion was recorded; publication or display may require a separate step.', 'Inspect output references and downstream prerequisites.'],
    FAILED: ['An operator investigates the terminal failure.', 'The job recorded a failure.', 'Inspect the failure and reconcile external effects before a manual retry.'],
    DEAD_LETTER: ['An operator investigates before requeueing.', 'Automatic processing has stopped.', 'Inspect attempts and correct the cause before requeueing.'],
    CANCEL_REQUESTED: ['The worker acknowledges cancellation or finishes its current operation.', 'Cancellation is requested but not confirmed.', 'Inspect the lease and latest attempt; do not assume work has stopped.'],
    CANCELLED: ['No further processing is scheduled for this job.', 'Cancellation was recorded.', 'Reconcile external effects from earlier attempts if needed.'],
  };
  const [expected, reason, nextStep] = expectations[status];
  return {
    checkedAt: now.toISOString(), actualState: status, expected, reason, nextStep,
    allowedTransitions: listSiteJobTransitions(status),
    overdue: waiting && Number.isFinite(available) ? now.getTime() > available + 60_000 : null,
    leaseExpired: active && Number.isFinite(leaseExpiry) ? now.getTime() >= leaseExpiry : null,
    heartbeatAt: job.heartbeatAt, availableAt: job.availableAt,
    ageSinceUpdateMs: Number.isFinite(updated) ? Math.max(0, now.getTime() - updated) : null,
    attempts: { used: job.attemptCount, maximum: job.maxAttempts }, failureCode: job.failureCode,
    evidenceLimit: 'State and recent events are separate snapshots. A heartbeat is evidence of past activity, not proof of current worker health or an external outcome.',
  };
}
