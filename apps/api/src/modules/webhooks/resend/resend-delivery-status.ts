const STATUS_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  PENDING: 0,
  PROCESSING: 0,
  RETRY: 0,
  QUEUED: 0,
  SENT: 10,
  DELAYED: 20,
  DELIVERED: 30,
  FAILED: 40,
  BOUNCED: 50,
  COMPLAINED: 60,
  CANCELLED: 100,
  SUPPRESSED: 100,
  DEAD_LETTER: 100,
});

export const resendOutboxStatusesBefore = (nextStatus: string) => {
  const nextPriority = STATUS_PRIORITY[nextStatus];
  if (nextPriority === undefined) return [];
  return Object.entries(STATUS_PRIORITY)
    .filter(([, priority]) => priority < nextPriority)
    .map(([status]) => status);
};

export const shouldApplyResendOutboxStatus = (currentStatus: string, nextStatus: string) => (
  resendOutboxStatusesBefore(nextStatus).includes(currentStatus)
);
