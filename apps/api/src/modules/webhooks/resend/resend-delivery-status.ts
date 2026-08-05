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
  DEAD_LETTER: 70,
});

export const shouldApplyResendOutboxStatus = (currentStatus: string, nextStatus: string) => {
  const nextPriority = STATUS_PRIORITY[nextStatus];
  if (nextPriority === undefined) return false;
  const currentPriority = STATUS_PRIORITY[currentStatus] ?? -1;
  return nextPriority > currentPriority;
};
