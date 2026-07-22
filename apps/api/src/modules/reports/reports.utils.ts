import type { AnalyticsPeriod } from '../analytics/analytics.period.js';

export const reportNumber = (value: unknown) => Number(value ?? 0);
export const reportIso = (value: unknown) => value == null ? null : new Date(value as string | Date).toISOString();

export function encodeReportCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, offset }), 'utf8').toString('base64url');
}

export function decodeReportCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { v?: unknown; offset?: unknown };
    if (parsed.v !== 1 || !Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0 || Number(parsed.offset) > 1_000_000) throw new Error('invalid');
    return Number(parsed.offset);
  } catch {
    throw Object.assign(new Error('The pagination cursor is invalid.'), { code: 'REPORT_INVALID_FILTER', statusCode: 400 });
  }
}

export function reportPagination<T>(rows: T[], limit: number, offset: number) {
  const hasMore = rows.length > limit;
  return {
    rows: rows.slice(0, limit),
    pagination: { limit, hasMore, nextCursor: hasMore ? encodeReportCursor(offset + limit) : null },
  };
}

export function reportPeriodMeta(period: AnalyticsPeriod) {
  return {
    period: period.preset,
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    timezone: period.timezone,
    localFrom: period.localFrom,
    localTo: period.localTo,
  };
}

export function mapReportPaymentSource(method: string, purpose: string) {
  if (method === 'CARD' && purpose === 'booking_payment') return 'STRIPE_ONLINE' as const;
  if (method === 'CASH') return 'MANUAL_CASH' as const;
  if (method === 'SPLIT') return 'MANUAL_SPLIT' as const;
  return 'EXTERNAL_TERMINAL' as const;
}

export function deriveReportPaymentState(status: string, refundedAmount: number, grossAmount: number) {
  if (status === 'REFUNDED' || (status === 'SUCCEEDED' && refundedAmount >= grossAmount && grossAmount > 0)) return 'REFUNDED' as const;
  if (status === 'FAILED') return 'FAILED' as const;
  if (status === 'PENDING') return 'PENDING' as const;
  if (status === 'SUCCEEDED' && refundedAmount > 0) return 'PARTIALLY_REFUNDED' as const;
  return 'SUCCEEDED' as const;
}

export function maskReportEmail(value: string) {
  const [local = '', domain = 'invalid'] = value.split('@');
  return `${local.slice(0, 1) || '*'}***@${domain}`;
}

export function maskReportPhone(value: string) {
  return `***${value.replace(/\D/g, '').slice(-4)}`;
}
