import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { and, desc, eq, gte, ilike, lte, or } from 'drizzle-orm';
import {
  agencyUsers,
  getDatabase,
  platformErrorEvents,
  tenants,
  users,
} from '@ks-os/database';

export type PlatformErrorSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

type ErrorWithStatus = Error & {
  statusCode?: number;
  code?: string;
};

export interface PlatformErrorLogQuery {
  search?: string;
  severity?: PlatformErrorSeverity;
  statusCode?: number;
  tenantId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

const protectedKey = /(password|passcode|token|secret|authorization|cookie|card|cvv|cvc|medical|answer|bank|accountnumber|connection|string)/i;

const textRedactions: Array<[RegExp, string]> = [
  [/(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s]+/gi, '[REDACTED_CONNECTION]'],
  [/\b(?:bearer|basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '[REDACTED_AUTHORIZATION]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_TOKEN]'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]'],
  [/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_PAYMENT_NUMBER]'],
  [/(password|passcode|token|secret|authorization|cookie|api[_-]?key|service[_-]?role)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]'],
  [/(https?:\/\/[^\s?#]+)\?[^\s]*/gi, '$1?[REDACTED_QUERY]'],
];

export function redactErrorText(input: unknown, maximumLength = 8_000): string {
  let value = String(input ?? '');
  for (const [pattern, replacement] of textRedactions) value = value.replace(pattern, replacement);
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, maximumLength);
}

/** Only standard Error cause fields are retained; arbitrary properties are never serialized. */
export function errorCauseChain(error: unknown): Array<{ type: string; message: string }> {
  const causes: Array<{ type: string; message: string }> = [];
  const seen = new Set<unknown>([error]);
  let next = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  while (next !== undefined && next !== null && causes.length < 5 && !seen.has(next)) {
    seen.add(next);
    causes.push({
      type: redactErrorText(next instanceof Error ? next.name : 'UnknownCause', 160),
      message: redactErrorText(next instanceof Error ? next.message : typeof next === 'string' ? next : 'Non-error cause', 1_000),
    });
    next = next instanceof Error ? (next as Error & { cause?: unknown }).cause : undefined;
  }
  return causes;
}

function normaliseOriginFile(value: string): string {
  const normalised = value.replace(/^file:\/\//, '').replace(/\\/g, '/');
  for (const marker of ['/apps/', '/packages/', '/scripts/', '/tests/']) {
    const index = normalised.lastIndexOf(marker);
    if (index >= 0) return normalised.slice(index + 1).slice(0, 500);
  }
  return normalised.replace(`${process.cwd().replace(/\\/g, '/')}/`, '').slice(0, 500);
}

export function deriveErrorOrigin(stack: string | undefined): {
  file: string | null;
  functionName: string | null;
  line: number | null;
  column: number | null;
} {
  if (!stack) return { file: null, functionName: null, line: null, column: null };
  for (const rawLine of stack.split('\n').slice(1)) {
    const line = rawLine.trim();
    if (!line.startsWith('at ') || line.includes('node:internal') || line.replace(/\\/g, '/').includes('/node_modules/')) continue;
    const match = line.match(/^at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    if (!match) continue;
    return {
      functionName: match[1]?.slice(0, 255) || null,
      file: normaliseOriginFile(match[2]),
      line: Number(match[3]),
      column: Number(match[4]),
    };
  }
  return { file: null, functionName: null, line: null, column: null };
}

export function shouldPersistError(request: FastifyRequest, statusCode: number): boolean {
  if (statusCode >= 500) return true;
  if (request.auth || request.agencyAuth) return true;
  return [409, 413, 429].includes(statusCode);
}

function severityFor(statusCode: number): PlatformErrorSeverity {
  if (statusCode >= 500) return statusCode >= 503 ? 'CRITICAL' : 'ERROR';
  if (statusCode === 409 || statusCode === 413 || statusCode === 429) return 'WARNING';
  return 'INFO';
}

function safeObjectKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>)
    .filter(key => !protectedKey.test(key))
    .slice(0, 50);
}

function routeFor(request: FastifyRequest): string {
  const configuredRoute = request.routeOptions?.url;
  if (typeof configuredRoute === 'string' && configuredRoute) return configuredRoute.slice(0, 500);
  // Unmatched URLs can contain customer identifiers or invitation credentials.
  return '/[unmatched-route]';
}

function sourceComponentFor(route: string): string {
  if (route.includes('/internal/')) return 'ks-os-worker-api';
  if (route.includes('/agency/')) return 'ks-os-agency-api';
  if (route.includes('/public/')) return 'ks-os-public-api';
  return 'ks-os-api';
}

function ipHashFor(request: FastifyRequest): string {
  return createHash('sha256')
    .update(`${process.env.AUDIT_IP_HASH_SECRET || 'local-development'}:${request.ip}`)
    .digest('hex');
}

function userAgentFor(request: FastifyRequest): string | null {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value.replace(/[\r\n]/g, ' ').slice(0, 500) : null;
}

function affectedUser(row: { agencyUserName: string | null; tenantUserName: string | null; authUserId: string | null }) {
  if (row.agencyUserName) return { type: 'AGENCY', displayName: row.agencyUserName };
  if (row.tenantUserName) return { type: 'TENANT', displayName: row.tenantUserName };
  if (row.authUserId) return { type: 'AUTHENTICATED', displayName: 'Authenticated user' };
  return { type: 'PUBLIC', displayName: 'Public or unauthenticated request' };
}

export class PlatformErrorLogService {
  async capture(request: FastifyRequest, error: ErrorWithStatus, statusCode: number, errorCode: string, retryable: boolean) {
    // Unit and API tests run before production migrations are applied. Keep them isolated
    // unless a focused persistence test explicitly opts in.
    if (process.env.NODE_TEST_CONTEXT && process.env.ERROR_LOG_TEST_CAPTURE !== '1') return;
    if (!shouldPersistError(request, statusCode)) return;

    const route = routeFor(request);
    const origin = deriveErrorOrigin(error.stack);
    const message = redactErrorText(error.message || error.name || 'Unknown error', 2_000) || 'Unknown error';
    const stack = error.stack ? redactErrorText(error.stack, 8_000) : null;
    const tenantUserId = request.auth && !request.auth.supportMode ? request.auth.tenantUserId : null;
    const agencyUserId = request.agencyAuth?.agencyUserId || request.auth?.agencyUserId || null;
    const authUserId = request.authIdentity?.authUserId || request.agencyAuth?.authUserId || request.auth?.authUserId || null;
    const fingerprint = createHash('sha256').update([
      error.name || 'Error',
      errorCode,
      String(statusCode),
      route,
      origin.file || '',
      origin.functionName || '',
    ].join('|')).digest('hex');

    await getDatabase().insert(platformErrorEvents).values({
      fingerprint,
      severity: severityFor(statusCode),
      statusCode,
      errorCode: redactErrorText(errorCode || 'UNCLASSIFIED_ERROR', 120),
      errorType: redactErrorText(error.name || 'Error', 160),
      message,
      stack,
      originFile: origin.file,
      originFunction: origin.functionName,
      originLine: origin.line,
      originColumn: origin.column,
      requestId: request.id,
      correlationId: request.correlationId || request.id,
      method: request.method.slice(0, 12),
      route,
      sourceComponent: sourceComponentFor(route),
      environment: process.env.NODE_ENV || 'development',
      tenantId: request.auth?.tenantId || request.tenantId || null,
      tenantUserId,
      agencyUserId,
      authUserId,
      supportSessionId: request.auth?.supportSessionId || null,
      applicationContext: request.applicationContext || null,
      sessionId: request.authIdentity?.authSessionId || null,
      ipHash: ipHashFor(request),
      userAgent: userAgentFor(request),
      retryable,
      context: {
        parameterKeys: safeObjectKeys(request.params),
        queryKeys: safeObjectKeys(request.query),
        bodyKeys: safeObjectKeys(request.body),
        supportMode: request.auth?.supportMode === true,
        causes: errorCauseChain(error),
        release: redactErrorText(process.env.GIT_SHA || process.env.COMMIT_SHA || 'unknown', 100),
        expected: ['GET', 'HEAD'].includes(request.method) ? 'Requested information is returned.' : 'The requested action has a confirmed outcome.',
        actual: 'The request failed. A failed response does not establish whether a write took effect.',
        recovery: ['GET', 'HEAD'].includes(request.method) ? 'Refresh the information.' : 'Reconcile the current state before repeating the action.',
      },
    });
  }

  async list(input: PlatformErrorLogQuery = {}) {
    const conditions: any[] = [];
    if (input.severity) conditions.push(eq(platformErrorEvents.severity, input.severity));
    if (input.statusCode) conditions.push(eq(platformErrorEvents.statusCode, input.statusCode));
    if (input.tenantId) conditions.push(eq(platformErrorEvents.tenantId, input.tenantId));
    if (input.from) conditions.push(gte(platformErrorEvents.occurredAt, input.from));
    if (input.to) conditions.push(lte(platformErrorEvents.occurredAt, input.to));
    if (input.search) {
      const pattern = `%${input.search.replace(/[%_]/g, '\\$&')}%`;
      conditions.push(or(
        ilike(platformErrorEvents.errorCode, pattern),
        ilike(platformErrorEvents.message, pattern),
        ilike(platformErrorEvents.route, pattern),
        ilike(platformErrorEvents.requestId, pattern),
        ilike(platformErrorEvents.correlationId, pattern),
        ilike(platformErrorEvents.fingerprint, pattern),
      ));
    }

    const rows = await getDatabase().select({
      id: platformErrorEvents.id,
      fingerprint: platformErrorEvents.fingerprint,
      severity: platformErrorEvents.severity,
      statusCode: platformErrorEvents.statusCode,
      errorCode: platformErrorEvents.errorCode,
      errorType: platformErrorEvents.errorType,
      message: platformErrorEvents.message,
      originFile: platformErrorEvents.originFile,
      originFunction: platformErrorEvents.originFunction,
      originLine: platformErrorEvents.originLine,
      originColumn: platformErrorEvents.originColumn,
      requestId: platformErrorEvents.requestId,
      correlationId: platformErrorEvents.correlationId,
      method: platformErrorEvents.method,
      route: platformErrorEvents.route,
      sourceComponent: platformErrorEvents.sourceComponent,
      environment: platformErrorEvents.environment,
      tenantId: platformErrorEvents.tenantId,
      tenantName: tenants.name,
      tenantUserName: users.name,
      agencyUserName: agencyUsers.displayName,
      authUserId: platformErrorEvents.authUserId,
      retryable: platformErrorEvents.retryable,
      occurredAt: platformErrorEvents.occurredAt,
    }).from(platformErrorEvents)
      .leftJoin(tenants, eq(platformErrorEvents.tenantId, tenants.id))
      .leftJoin(users, eq(platformErrorEvents.tenantUserId, users.id))
      .leftJoin(agencyUsers, eq(platformErrorEvents.agencyUserId, agencyUsers.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(platformErrorEvents.occurredAt))
      .limit(Math.min(Math.max(input.limit || 100, 1), 200));

    return rows.map(row => ({
      ...row,
      affectedUser: affectedUser(row),
    }));
  }

  async get(id: string) {
    const [row] = await getDatabase().select({
      error: platformErrorEvents,
      tenantName: tenants.name,
      tenantUserName: users.name,
      agencyUserName: agencyUsers.displayName,
    }).from(platformErrorEvents)
      .leftJoin(tenants, eq(platformErrorEvents.tenantId, tenants.id))
      .leftJoin(users, eq(platformErrorEvents.tenantUserId, users.id))
      .leftJoin(agencyUsers, eq(platformErrorEvents.agencyUserId, agencyUsers.id))
      .where(eq(platformErrorEvents.id, id))
      .limit(1);

    if (!row) throw Object.assign(new Error('Error log entry not found.'), { statusCode: 404, code: 'ERROR_LOG_NOT_FOUND' });
    return {
      ...row.error,
      tenantName: row.tenantName,
      affectedUser: affectedUser({
        agencyUserName: row.agencyUserName,
        tenantUserName: row.tenantUserName,
        authUserId: row.error.authUserId,
      }),
    };
  }
}
