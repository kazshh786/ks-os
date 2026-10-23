import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { enqueueMeetingEmail } from '../src/modules/communications/communications.meeting-delivery.js';
import type { CommunicationsDatabase } from '../src/modules/communications/communications.database.js';
import { validateEmailTemplateData } from '../src/modules/email/email-safety.js';
import { meetingEmailCancellationCode, meetingEmailTemplateData, type MeetingEmailMessage, type MeetingEmailSnapshot } from '../src/modules/email/meeting-email-policy.js';

const meetingId = '11111111-1111-4111-8111-111111111111', invitationId = '22222222-2222-4222-8222-222222222222', tenantId = '33333333-3333-4333-8333-333333333333';
const message: MeetingEmailMessage = { tenantId, meetingId, invitationId, version: 2, kind: 'invite', recipientEmail: 'guest@business.co.uk', derivedInvitationHash: 'a'.repeat(64) };
const snapshot: MeetingEmailSnapshot = { ...message, invitationHash: 'a'.repeat(64), status: 'SCHEDULED', invitationEmail: message.recipientEmail, revokedAt: null, expiresAt: '2030-01-16T12:00:00Z', tenantActive: true, tenantStatus: 'ACTIVE', title: 'Consultation', scheduledStartAt: '2030-01-15T10:00:00Z', scheduledEndAt: '2030-01-15T11:00:00Z', timezone: 'Europe/London', hostName: 'Host' };
const now = new Date('2030-01-01T12:00:00Z');

test('meeting delivery queues only references in the existing transactional outbox', async () => {
  const inserts: { sql: string; params: unknown[] }[] = [], dialect = new PgDialect();
  const tx: CommunicationsDatabase = { query: async statement => { const q = dialect.sqlToQuery(statement); if (q.sql.startsWith('INSERT')) inserts.push(q); return []; }, transaction: work => work(tx) };
  const request = { tenantId, meetingId, invitationId, version: 2, kind: 'invite' as const, to: 'guest@business.co.uk' };
  assert.equal((await enqueueMeetingEmail(request, tx)).queued, true);
  assert.equal((await enqueueMeetingEmail(request, tx)).queued, true);
  assert.equal(inserts.length, 2);
  assert.match(inserts[0].sql, /ON CONFLICT\(idempotency_key\) DO NOTHING/);
  const data = inserts[0].params.find(value => typeof value === 'string' && value.startsWith('{')) as string;
  assert.deepEqual(JSON.parse(data), { meetingId, invitationId, version: 2, kind: 'invite' });
  assert.deepEqual(inserts[0].params.filter(value => typeof value === 'string' && value.startsWith('meeting:')), inserts[1].params.filter(value => typeof value === 'string' && value.startsWith('meeting:')));
  assert.doesNotMatch(data, /token|secret|https|invite=/i);
});

test('queued meeting emails reject usable links or extra payload data', () => {
  const payload = { meetingId, invitationId, version: 2, kind: 'invite' };
  assert.deepEqual(validateEmailTemplateData('meeting-notification', payload, true), { valid: true });
  for (const extra of [{ invitationUrl: 'https://meeting.business.co.uk/meet#invite=secret' }, { token: 'secret' }, { tenantName: 'Untrusted display snapshot' }]) {
    assert.equal(validateEmailTemplateData('meeting-notification', { ...payload, ...extra }, true).valid, false);
  }
});

test('delivery rechecks tenant, recipient, version, state, revocation and expiry', () => {
  assert.equal(meetingEmailCancellationCode(snapshot, message, now), null);
  assert.equal(meetingEmailCancellationCode({ ...snapshot, status: 'CREATED' }, message, now), null);
  assert.equal(meetingEmailCancellationCode(snapshot, { ...message, derivedInvitationHash: 'b'.repeat(64) }, now), 'MEETING_NOTIFICATION_CREDENTIAL_CHANGED');
  assert.equal(meetingEmailCancellationCode(snapshot, { ...message, derivedInvitationHash: undefined }, now), 'MEETING_NOTIFICATION_CREDENTIAL_CHANGED');
  for (const changed of [undefined, { ...snapshot, tenantId: invitationId }, { ...snapshot, meetingId: invitationId }, { ...snapshot, invitationId: meetingId }, { ...snapshot, version: 3 }, { ...snapshot, tenantActive: false }, { ...snapshot, tenantStatus: 'SUSPENDED' }, { ...snapshot, invitationEmail: 'other@business.co.uk' }, { ...snapshot, revokedAt: now }, { ...snapshot, expiresAt: now }, { ...snapshot, status: 'CANCELLED' }]) {
    assert.ok(meetingEmailCancellationCode(changed, message, now));
  }
});

test('cancellation can notify a revoked invitation but never carries a join link', () => {
  const cancelled = { ...snapshot, status: 'CANCELLED', revokedAt: now, expiresAt: now };
  assert.equal(meetingEmailCancellationCode(cancelled, { ...message, kind: 'cancelled' }, now), null);
  assert.ok(meetingEmailCancellationCode(snapshot, { ...message, kind: 'cancelled' }, now));
  const data = meetingEmailTemplateData(cancelled, 'cancelled', 'https://meeting.business.co.uk/meet#invite=secret');
  assert.equal(data.invitationUrl, undefined);
  assert.match(String(data.scheduleLabel), /Europe\/London/);
});
