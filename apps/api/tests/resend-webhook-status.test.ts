import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldApplyResendOutboxStatus } from '../src/modules/webhooks/resend/resend-delivery-status.js';

test('Resend webhook events cannot regress a stronger outbox state', () => {
  assert.equal(shouldApplyResendOutboxStatus('DELIVERED', 'SENT'), false);
  assert.equal(shouldApplyResendOutboxStatus('DELIVERED', 'DELAYED'), false);
  assert.equal(shouldApplyResendOutboxStatus('FAILED', 'DELIVERED'), false);
  assert.equal(shouldApplyResendOutboxStatus('BOUNCED', 'DELIVERED'), false);
  assert.equal(shouldApplyResendOutboxStatus('COMPLAINED', 'BOUNCED'), false);
  assert.equal(shouldApplyResendOutboxStatus('DEAD_LETTER', 'COMPLAINED'), false);
});

test('Resend webhook events still advance legitimate delivery outcomes', () => {
  assert.equal(shouldApplyResendOutboxStatus('PENDING', 'SENT'), true);
  assert.equal(shouldApplyResendOutboxStatus('SENT', 'DELAYED'), true);
  assert.equal(shouldApplyResendOutboxStatus('SENT', 'DELIVERED'), true);
  assert.equal(shouldApplyResendOutboxStatus('DELIVERED', 'FAILED'), true);
  assert.equal(shouldApplyResendOutboxStatus('DELIVERED', 'BOUNCED'), true);
  assert.equal(shouldApplyResendOutboxStatus('DELIVERED', 'COMPLAINED'), true);
  assert.equal(shouldApplyResendOutboxStatus('BOUNCED', 'COMPLAINED'), true);
  assert.equal(shouldApplyResendOutboxStatus('SENT', 'SENT'), false);
  assert.equal(shouldApplyResendOutboxStatus('SENT', 'UNKNOWN'), false);
});
