import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resendOutboxStatusesBefore,
  shouldApplyResendOutboxStatus,
} from '../src/modules/webhooks/resend/resend-delivery-status.js';

test('Resend webhook events cannot regress a stronger or locally terminal outbox state', () => {
  assert.equal(shouldApplyResendOutboxStatus('DELIVERED', 'SENT'), false);
  assert.equal(shouldApplyResendOutboxStatus('DELIVERED', 'DELAYED'), false);
  assert.equal(shouldApplyResendOutboxStatus('FAILED', 'DELIVERED'), false);
  assert.equal(shouldApplyResendOutboxStatus('BOUNCED', 'DELIVERED'), false);
  assert.equal(shouldApplyResendOutboxStatus('COMPLAINED', 'BOUNCED'), false);
  assert.equal(shouldApplyResendOutboxStatus('CANCELLED', 'SENT'), false);
  assert.equal(shouldApplyResendOutboxStatus('SUPPRESSED', 'COMPLAINED'), false);
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

test('atomic status updates only accept database states below the incoming event', () => {
  const sentPredecessors = resendOutboxStatusesBefore('SENT');
  assert.ok(sentPredecessors.includes('PENDING'));
  assert.equal(sentPredecessors.includes('SENT'), false);
  assert.equal(sentPredecessors.includes('DELIVERED'), false);
  assert.equal(sentPredecessors.includes('CANCELLED'), false);

  const deliveredPredecessors = resendOutboxStatusesBefore('DELIVERED');
  assert.ok(deliveredPredecessors.includes('SENT'));
  assert.ok(deliveredPredecessors.includes('DELAYED'));
  assert.equal(deliveredPredecessors.includes('FAILED'), false);
});
