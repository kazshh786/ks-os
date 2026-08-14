import { domainToASCII } from 'node:url';

export const EMAIL_TEMPLATE_KEYS = [
  'booking-confirmed',
  'booking-rescheduled',
  'booking-cancelled',
  'appointment-reminder',
  'payment-confirmed',
  'refund-updated',
  'form-assigned',
  'form-reminder',
  'staff-operational-notification',
  'scheduled-report-ready',
  'review-invitation',
  'customer-portal-claim',
  'account-access-invitation',
  'site-review-invitation',
  'site-review-notification',
  'fact-finding-invitation',
  'fact-finding-notification',
  'business-booking-confirmed',
  'business-payment-received',
] as const;

export type EmailTemplateKey = typeof EMAIL_TEMPLATE_KEYS[number];

const EMAIL_TEMPLATE_KEY_SET = new Set<string>(EMAIL_TEMPLATE_KEYS);
const BLOCKED_PRODUCTION_DOMAINS = new Set([
  'example.com',
  'example.net',
  'example.org',
  'resend.dev',
  'localhost',
  'local',
  'test',
  'invalid',
  'example',
]);
const BLOCKED_PRODUCTION_SUFFIXES = ['.test', '.invalid', '.example', '.localhost', '.local'];
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;
const MAX_TEMPLATE_BYTES = 64_000;
const MAX_TEMPLATE_DEPTH = 8;
const MAX_TEMPLATE_STRING_LENGTH = 20_000;
const APPOINTMENT_TIME_TOLERANCE_MS = 60_000;

export type EmailAddressValidation =
  | { valid: true; email: string; domain: string }
  | { valid: false; reason: 'INVALID_RECIPIENT' | 'PRODUCTION_TEST_RECIPIENT_BLOCKED' };

export type TemplateValidation =
  | { valid: true }
  | { valid: false; errorCode: string; invalidTokens: string[] };

const hasControlOrWhitespace = (value: string) => /[\u0000-\u001f\u007f\s]/u.test(value);

export function isBlockedProductionEmailDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, '');
  if (BLOCKED_PRODUCTION_DOMAINS.has(normalized)) return true;
  if ([...BLOCKED_PRODUCTION_DOMAINS].some(blocked => normalized.endsWith(`.${blocked}`))) return true;
  return BLOCKED_PRODUCTION_SUFFIXES.some(suffix => normalized.endsWith(suffix));
}

export function normalizeAndValidateEmailAddress(value: unknown, production = false): EmailAddressValidation {
  if (typeof value !== 'string') return { valid: false, reason: 'INVALID_RECIPIENT' };
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_EMAIL_LENGTH || hasControlOrWhitespace(candidate)) {
    return { valid: false, reason: 'INVALID_RECIPIENT' };
  }
  if (/[<>(),;:\[\]"]/u.test(candidate)) return { valid: false, reason: 'INVALID_RECIPIENT' };

  const at = candidate.indexOf('@');
  if (at <= 0 || at !== candidate.lastIndexOf('@') || at === candidate.length - 1) {
    return { valid: false, reason: 'INVALID_RECIPIENT' };
  }

  const rawLocal = candidate.slice(0, at);
  const rawDomain = candidate.slice(at + 1);
  if (rawLocal.length > MAX_LOCAL_LENGTH || rawLocal.startsWith('.') || rawLocal.endsWith('.') || rawLocal.includes('..')) {
    return { valid: false, reason: 'INVALID_RECIPIENT' };
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/iu.test(rawLocal)) {
    return { valid: false, reason: 'INVALID_RECIPIENT' };
  }
  if (rawDomain.endsWith('.')) return { valid: false, reason: 'INVALID_RECIPIENT' };

  const asciiDomain = domainToASCII(rawDomain.toLowerCase());
  if (!asciiDomain || asciiDomain.length > 253 || asciiDomain.includes('..')) {
    return { valid: false, reason: 'INVALID_RECIPIENT' };
  }
  const labels = asciiDomain.split('.');
  if (labels.length < 2 || labels.some(label => (
    !label
    || label.length > 63
    || !/^[a-z0-9-]+$/i.test(label)
    || label.startsWith('-')
    || label.endsWith('-')
  ))) {
    return { valid: false, reason: 'INVALID_RECIPIENT' };
  }
  const topLevelLabel = labels.at(-1) || '';
  if (topLevelLabel.length < 2 || /^\d+$/.test(topLevelLabel)) {
    return { valid: false, reason: 'INVALID_RECIPIENT' };
  }

  const domain = asciiDomain.toLowerCase();
  if (production && isBlockedProductionEmailDomain(domain)) {
    return { valid: false, reason: 'PRODUCTION_TEST_RECIPIENT_BLOCKED' };
  }
  return { valid: true, email: `${rawLocal.toLowerCase()}@${domain}`, domain };
}

export function normalizeEmailDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f<>]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return normalized || undefined;
}

export function validateEmailIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 255
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeTemplateValue(value: unknown, depth: number, seen: WeakSet<object>): boolean {
  if (depth > MAX_TEMPLATE_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= MAX_TEMPLATE_STRING_LENGTH;
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.length <= 100 && value.every(item => isSafeTemplateValue(item, depth + 1, seen));
  }
  if (!isPlainRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > 100) return false;
  return entries.every(([key, child]) => (
    key.length <= 100
    && !DANGEROUS_OBJECT_KEYS.has(key)
    && isSafeTemplateValue(child, depth + 1, seen)
  ));
}

const text = (data: Record<string, unknown>, key: string): string => {
  const value = data[key];
  return typeof value === 'string' ? value.trim() : '';
};
const hasText = (data: Record<string, unknown>, key: string) => Boolean(text(data, key));
const hasAnyText = (data: Record<string, unknown>, keys: string[]) => keys.some(key => hasText(data, key));
const hasAllText = (data: Record<string, unknown>, keys: string[]) => keys.every(key => hasText(data, key));
const hasScalar = (data: Record<string, unknown>, key: string) => {
  const value = data[key];
  return (typeof value === 'string' && value.trim().length > 0) || (typeof value === 'number' && Number.isFinite(value));
};
const isDateValue = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
const isHttpUrl = (value: unknown, production: boolean) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return !production || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export function validateEmailTemplateData(
  templateKey: string,
  data: unknown,
  production = false,
): TemplateValidation {
  const invalidTokens: string[] = [];
  const invalid = (token: string) => {
    if (!invalidTokens.includes(token)) invalidTokens.push(token);
  };

  if (!EMAIL_TEMPLATE_KEY_SET.has(templateKey)) invalid('templateKey');
  if (!isPlainRecord(data)) invalid('templateDataJson');
  if (invalidTokens.length) {
    return {
      valid: false,
      errorCode: `EMAIL_TEMPLATE_VALIDATION_FAILED:${templateKey}:${invalidTokens.join(',')}`.slice(0, 255),
      invalidTokens,
    };
  }

  const payload = data as Record<string, unknown>;
  let serialized = '';
  try {
    serialized = JSON.stringify(payload);
  } catch {
    invalid('templateDataJson');
  }
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_TEMPLATE_BYTES || !isSafeTemplateValue(payload, 0, new WeakSet())) {
    invalid('templateDataJson');
  }

  const requireText = (key: string) => { if (!hasText(payload, key)) invalid(key); };
  const requireAny = (label: string, keys: string[]) => { if (!hasAnyText(payload, keys)) invalid(label); };
  const requireAll = (label: string, keys: string[]) => { if (!hasAllText(payload, keys)) invalid(label); };
  const requireUrl = (key: string) => { if (!isHttpUrl(payload[key], production)) invalid(key); };
  const requireDate = (key: string) => { if (!isDateValue(payload[key])) invalid(key); };
  const requireScalar = (key: string) => { if (!hasScalar(payload, key)) invalid(key); };

  requireText('tenantName');

  switch (templateKey as EmailTemplateKey) {
    case 'booking-confirmed':
      requireAny('customerName|clientName', ['customerName', 'clientName']);
      requireText('serviceName');
      if (!hasText(payload, 'startTime') && !hasAllText(payload, ['bookingDate', 'bookingTime'])) invalid('startTime|bookingDate+bookingTime');
      if (hasText(payload, 'startTime') && !isDateValue(payload.startTime)) invalid('startTime');
      break;
    case 'booking-rescheduled':
      requireAny('customerName|clientName', ['customerName', 'clientName']);
      requireText('serviceName');
      if (!hasText(payload, 'startTime') && !hasText(payload, 'newDateTime') && !hasAllText(payload, ['newBookingDate', 'newBookingTime'])) {
        invalid('startTime|newDateTime|newBookingDate+newBookingTime');
      }
      if (hasText(payload, 'startTime') && !isDateValue(payload.startTime)) invalid('startTime');
      break;
    case 'booking-cancelled':
      requireAny('customerName|clientName', ['customerName', 'clientName']);
      requireText('serviceName');
      if (hasText(payload, 'startTime') && !isDateValue(payload.startTime)) invalid('startTime');
      break;
    case 'appointment-reminder':
      requireAny('customerName|clientName', ['customerName', 'clientName']);
      requireText('serviceName');
      requireAll('bookingDate+bookingTime', ['bookingDate', 'bookingTime']);
      if (hasText(payload, 'appointmentDateTime') && !isDateValue(payload.appointmentDateTime)) invalid('appointmentDateTime');
      break;
    case 'payment-confirmed':
      requireAny('clientName|customerName', ['clientName', 'customerName']);
      requireScalar('amount');
      requireText('currency');
      break;
    case 'refund-updated':
      requireAny('clientName|customerName', ['clientName', 'customerName']);
      requireText('status');
      break;
    case 'form-assigned':
    case 'form-reminder':
      requireAny('customerName|clientName', ['customerName', 'clientName']);
      requireText('formName');
      requireUrl('formLink');
      break;
    case 'staff-operational-notification':
      requireAny('staffName|recipientName', ['staffName', 'recipientName']);
      requireText('message');
      break;
    case 'scheduled-report-ready':
      requireText('reportName');
      requireText('reportType');
      requireUrl('downloadPageUrl');
      requireDate('expiresAt');
      break;
    case 'review-invitation':
      requireAny('customerName|clientName', ['customerName', 'clientName']);
      requireText('message');
      requireText('appointmentDate');
      requireText('reviewInvitationId');
      requireText('reviewProvider');
      break;
    case 'customer-portal-claim':
      requireAny('customerName|clientName', ['customerName', 'clientName']);
      if (!isHttpUrl(payload.claimUrl, production) && !isHttpUrl(payload.bookingManagementUrl, production)) {
        invalid('claimUrl|bookingManagementUrl');
      }
      if (hasText(payload, 'claimUrl') && !isHttpUrl(payload.claimUrl, production)) invalid('claimUrl');
      if (hasText(payload, 'bookingManagementUrl') && !isHttpUrl(payload.bookingManagementUrl, production)) invalid('bookingManagementUrl');
      break;
    case 'account-access-invitation':
      requireText('recipientName');
      requireText('accessLabel');
      requireUrl('invitationUrl');
      break;
    case 'site-review-invitation':
      requireText('participantName');
      requireText('invitationReference');
      requireText('reviewReference');
      if (!Number.isInteger(Number(payload.reviewRevision)) || Number(payload.reviewRevision) < 1) invalid('reviewRevision');
      requireDate('expiresAt');
      break;
    case 'site-review-notification':
      requireText('participantName');
      requireText('heading');
      requireText('message');
      if (hasText(payload, 'invitationReference')) {
        requireText('reviewReference');
        if (!Number.isInteger(Number(payload.reviewRevision)) || Number(payload.reviewRevision) < 1) invalid('reviewRevision');
      }
      break;
    case 'fact-finding-invitation':
      requireText('participantName');
      requireText('invitationReference');
      requireText('questionnaireReference');
      requireText('participantReference');
      requireDate('expiresAt');
      break;
    case 'fact-finding-notification':
      requireText('participantName');
      requireText('heading');
      requireText('message');
      requireText('invitationReference');
      requireText('questionnaireReference');
      requireText('participantReference');
      requireDate('expiresAt');
      break;
    case 'business-booking-confirmed':
      requireText('recipientName');
      requireText('customerName');
      requireText('serviceName');
      requireAll('bookingDate+bookingTime', ['bookingDate', 'bookingTime']);
      requireText('emailBody');
      break;
    case 'business-payment-received':
      requireText('recipientName');
      requireText('customerName');
      requireText('serviceName');
      requireScalar('amount');
      requireText('currency');
      requireText('emailBody');
      break;
  }

  return invalidTokens.length
    ? {
      valid: false,
      errorCode: `EMAIL_TEMPLATE_VALIDATION_FAILED:${templateKey}:${invalidTokens.join(',')}`.slice(0, 255),
      invalidTokens,
    }
    : { valid: true };
}

function formatAppointmentDateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}

export function prepareEmailTemplateData(templateKey: string, data: Record<string, unknown>): Record<string, unknown> {
  const prepared = { ...data };
  if (!hasText(prepared, 'customerName') && hasText(prepared, 'clientName')) prepared.customerName = text(prepared, 'clientName');
  if (!hasText(prepared, 'clientName') && hasText(prepared, 'customerName')) prepared.clientName = text(prepared, 'customerName');

  const timezone = text(prepared, 'timezone') || 'Europe/London';
  const startTime = text(prepared, 'startTime');
  if (startTime && isDateValue(startTime)) {
    if (templateKey === 'booking-rescheduled' && !hasText(prepared, 'newDateTime')) {
      prepared.newDateTime = formatAppointmentDateTime(startTime, timezone);
    }
    if (templateKey === 'booking-cancelled' && !hasText(prepared, 'cancelledDateTime')) {
      prepared.cancelledDateTime = formatAppointmentDateTime(startTime, timezone);
    }
  }
  return prepared;
}

export function isPermanentEmailFailure(code: string): boolean {
  return /EMAIL_(?:TEMPLATE_VALIDATION_FAILED|INVALID_RECIPIENT|PRODUCTION_TEST_RECIPIENT_BLOCKED|INVALID_IDEMPOTENCY_KEY)|VALIDATION|SUPPRESSED|NOT_CONFIGURED/i.test(code);
}

export type AppointmentNotificationSnapshot = {
  exists: boolean;
  status?: string | null;
  startTime?: Date | string | null;
};

export type AppointmentNotificationMessage = {
  templateKey: string;
  idempotencyKey?: string | null;
  templateData: Record<string, unknown>;
};

function parseIntendedAppointmentTime(data: Record<string, unknown>): number | null {
  for (const key of ['startTime', 'appointmentDateTime']) {
    const value = text(data, key);
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function appointmentNotificationCancellationCode(
  snapshot: AppointmentNotificationSnapshot,
  message: AppointmentNotificationMessage,
  now = Date.now(),
): string | null {
  const idempotencyKey = message.idempotencyKey || '';
  const cancellationNotification = message.templateKey === 'booking-cancelled'
    || idempotencyKey.startsWith('business-booking-cancelled:');
  const futureConfirmedNotification = [
    'appointment-reminder',
    'booking-confirmed',
    'booking-rescheduled',
    'business-booking-confirmed',
  ].includes(message.templateKey) || idempotencyKey.startsWith('business-booking-rescheduled:');

  if (!cancellationNotification && !futureConfirmedNotification) return null;
  if (!snapshot.exists || !snapshot.startTime) return 'APPOINTMENT_NOTIFICATION_NO_LONGER_APPLICABLE';
  if (cancellationNotification && snapshot.status !== 'CANCELLED') return 'APPOINTMENT_NOTIFICATION_NO_LONGER_APPLICABLE';
  if (futureConfirmedNotification && snapshot.status !== 'CONFIRMED') return 'APPOINTMENT_NOTIFICATION_NO_LONGER_APPLICABLE';

  const currentStart = new Date(snapshot.startTime).getTime();
  if (!Number.isFinite(currentStart)) return 'APPOINTMENT_NOTIFICATION_NO_LONGER_APPLICABLE';
  if (futureConfirmedNotification && currentStart <= now) return 'APPOINTMENT_NOTIFICATION_NO_LONGER_APPLICABLE';

  const intendedStart = parseIntendedAppointmentTime(message.templateData);
  if (intendedStart !== null && Math.abs(currentStart - intendedStart) > APPOINTMENT_TIME_TOLERANCE_MS) {
    return 'APPOINTMENT_NOTIFICATION_SUPERSEDED';
  }
  return null;
}
