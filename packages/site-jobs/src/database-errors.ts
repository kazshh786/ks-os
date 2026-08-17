const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
]);

const RETRYABLE_POSTGRES_CODES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
]);

const RETRYABLE_MESSAGE_PATTERNS = [
  /connection terminated unexpectedly/i,
  /connection (?:was )?closed unexpectedly/i,
  /connection reset/i,
  /socket hang up/i,
  /server closed the connection unexpectedly/i,
  /terminating connection due to administrator command/i,
  /the database system is starting up/i,
  /the database system is shutting down/i,
];

const SECRET_PATTERN = /(postgres(?:ql)?:\/\/|authorization|bearer|token|secret|password|cookie)[^\s]*/gi;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function safeText(value: unknown, maximum = 240) {
  return typeof value === 'string'
    ? value.replace(SECRET_PATTERN, '[REDACTED]').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maximum)
    : undefined;
}

function causeChain(error: unknown) {
  const chain: unknown[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current && chain.length < 8 && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = record(current)?.cause;
  }
  return chain;
}

function errorCode(value: unknown) {
  const item = record(value);
  const candidate = item?.code ?? item?.sqlState ?? item?.sqlstate;
  return typeof candidate === 'string' ? candidate.toUpperCase() : undefined;
}

export interface DatabaseErrorDiagnostics {
  transient: boolean;
  code?: string;
  sqlState?: string;
  causeName?: string;
  causeMessage?: string;
  errno?: string | number;
  syscall?: string;
}

/**
 * Conservative classifier for failures where repeating a database operation is
 * safe only because the caller knows the operation itself is retryable.
 */
export function isRetryableDatabaseError(error: unknown): boolean {
  for (const candidate of causeChain(error)) {
    const code = errorCode(candidate);
    if (code && (
      RETRYABLE_NETWORK_CODES.has(code)
      || RETRYABLE_POSTGRES_CODES.has(code)
      || /^08[A-Z0-9]{3}$/.test(code)
    )) return true;
    const message = safeText(record(candidate)?.message);
    if (message && RETRYABLE_MESSAGE_PATTERNS.some(pattern => pattern.test(message))) {
      return true;
    }
  }
  return false;
}

/** Safe structured diagnostics for protected worker logs. */
export function databaseErrorDiagnostics(error: unknown): DatabaseErrorDiagnostics {
  const chain = causeChain(error);
  const root = chain.at(-1);
  const rootRecord = record(root);
  const codes = chain.map(errorCode).filter((value): value is string => Boolean(value));
  const sqlState = codes.find(code => /^[0-9A-Z]{5}$/.test(code));
  const code = [...codes].reverse().find(value => value !== sqlState) ?? sqlState;
  const name = safeText(rootRecord?.name, 80)
    ?? (root instanceof Error ? safeText(root.name, 80) : undefined);
  const message = safeText(rootRecord?.message, 240)
    ?? (root instanceof Error ? safeText(root.message, 240) : undefined);
  const errnoValue = rootRecord?.errno;
  const errno = typeof errnoValue === 'string' || typeof errnoValue === 'number'
    ? errnoValue
    : undefined;
  return {
    transient: isRetryableDatabaseError(error),
    ...(code ? { code } : {}),
    ...(sqlState ? { sqlState } : {}),
    ...(name ? { causeName: name } : {}),
    ...(message ? { causeMessage: message } : {}),
    ...(errno !== undefined ? { errno } : {}),
    ...(typeof rootRecord?.syscall === 'string'
      ? { syscall: safeText(rootRecord.syscall, 80)! }
      : {}),
  };
}
