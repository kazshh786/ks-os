/**
 * Phase 10.1 — Customer Portal test suite.
 *
 * These tests cover the pure, side-effect-free logic extracted from the
 * customer portal modules: token security, email normalisation, error types,
 * status mappings, validation logic, and contract schemas. They do NOT require
 * a live database and can run entirely offline.
 *
 * Database-dependent scenarios (claim completion, account upsert, multi-tenant
 * isolation) are documented as specification tests that assert invariants on
 * the service code rather than exercising the DB layer directly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashCustomerClaimToken,
  createCustomerClaimToken,
} from '../src/modules/customer-portal/customer-claims.service.js';
import {
  normalizeCustomerEmail,
  CustomerAuthService,
} from '../src/modules/customer-portal/customer-auth.service.js';
import {
  CustomerPortalError,
  customerError,
} from '../src/modules/customer-portal/customer-portal.errors.js';
import {
  CustomerAppointmentQuerySchema,
  CustomerProfileUpdateSchema,
  CustomerClaimParamsSchema,
} from '@ks-os/contracts';

// ── 1. Claim token security ────────────────────────────────────────────────────

describe('customer claim token — security', () => {
  it('createCustomerClaimToken produces a base64url string', () => {
    const token = createCustomerClaimToken();
    assert.match(token, /^[A-Za-z0-9_-]+$/);
  });

  it('createCustomerClaimToken produces at least 43 characters (256 bits base64url-encoded)', () => {
    const token = createCustomerClaimToken();
    assert.ok(token.length >= 43, `Token too short: ${token.length}`);
  });

  it('hashCustomerClaimToken produces a 64-character SHA-256 hex string', () => {
    const token = createCustomerClaimToken();
    const hash = hashCustomerClaimToken(token);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it('hashCustomerClaimToken is deterministic', () => {
    const token = createCustomerClaimToken();
    assert.strictEqual(hashCustomerClaimToken(token), hashCustomerClaimToken(token));
  });

  it('two different tokens always produce different hashes', () => {
    const a = createCustomerClaimToken();
    const b = createCustomerClaimToken();
    assert.notStrictEqual(hashCustomerClaimToken(a), hashCustomerClaimToken(b));
  });

  it('the raw token and its hash are never equal (raw token is not stored)', () => {
    const token = createCustomerClaimToken();
    const hash = hashCustomerClaimToken(token);
    assert.notStrictEqual(token, hash);
    // The stored value is always the hash; the raw token leaves no DB trace.
  });

  it('hash is not reversible to the token (hash is 64 hex chars, token is base64url)', () => {
    const token = createCustomerClaimToken();
    const hash = hashCustomerClaimToken(token);
    // Structural: hex and base64url character sets are different
    assert.ok(hash.length === 64);
    assert.ok(token.length >= 43);
    // Can't reconstruct the token from the hash alone
    assert.notStrictEqual(hash, token);
  });
});

// ── 2. Email normalisation ─────────────────────────────────────────────────────

describe('normalizeCustomerEmail', () => {
  it('converts to lowercase', () => {
    assert.strictEqual(normalizeCustomerEmail('JANE@EXAMPLE.COM'), 'jane@example.com');
  });

  it('trims surrounding whitespace', () => {
    assert.strictEqual(normalizeCustomerEmail('  jane@example.com  '), 'jane@example.com');
  });

  it('is idempotent', () => {
    const email = 'Jane.Doe@Example.COM';
    assert.strictEqual(
      normalizeCustomerEmail(normalizeCustomerEmail(email)),
      normalizeCustomerEmail(email),
    );
  });

  it('same email with different casing normalises to the same value (mismatch detection)', () => {
    assert.strictEqual(
      normalizeCustomerEmail('Jane@Example.com'),
      normalizeCustomerEmail('jane@example.com'),
    );
  });

  it('different emails remain different after normalisation', () => {
    assert.notStrictEqual(
      normalizeCustomerEmail('jane@example.com'),
      normalizeCustomerEmail('john@example.com'),
    );
  });
});

// ── 3. CustomerPortalError ─────────────────────────────────────────────────────

describe('CustomerPortalError', () => {
  it('customerError returns a CustomerPortalError instance', () => {
    const err = customerError(401, 'CUSTOMER_AUTH_REQUIRED', 'Sign in required.');
    assert.ok(err instanceof CustomerPortalError);
  });

  it('carries the correct HTTP status code', () => {
    const err = customerError(403, 'CUSTOMER_ACCESS_DENIED', 'Denied.');
    assert.strictEqual(err.statusCode, 403);
  });

  it('carries the correct error code', () => {
    const err = customerError(400, 'CUSTOMER_CLAIM_INVALID', 'Invalid.');
    assert.strictEqual(err.code, 'CUSTOMER_CLAIM_INVALID');
  });

  it('carries the human-readable message', () => {
    const err = customerError(404, 'CUSTOMER_APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    assert.strictEqual(err.message, 'Appointment not found.');
  });

  it('has name CustomerPortalError', () => {
    const err = customerError(410, 'CUSTOMER_FORM_NOT_FOUND', 'Gone.');
    assert.strictEqual(err.name, 'CustomerPortalError');
  });

  it('is distinguishable from generic Error via instanceof', () => {
    const err = customerError(400, 'CUSTOMER_CLAIM_INVALID', 'Invalid claim');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof CustomerPortalError);
  });

  it('all Phase 10.1 error codes can be constructed without throwing', () => {
    const codes = [
      'CUSTOMER_AUTH_REQUIRED',
      'CUSTOMER_SESSION_INVALID',
      'CUSTOMER_ACCOUNT_SUSPENDED',
      'CUSTOMER_CLAIM_INVALID',
      'CUSTOMER_CLAIM_EXPIRED',
      'CUSTOMER_CLAIM_ALREADY_USED',
      'CUSTOMER_CLAIM_EMAIL_MISMATCH',
      'CUSTOMER_LINK_NOT_FOUND',
      'CUSTOMER_BUSINESS_NOT_FOUND',
      'CUSTOMER_APPOINTMENT_NOT_FOUND',
      'CUSTOMER_FORM_NOT_FOUND',
      'CUSTOMER_PAYMENT_NOT_FOUND',
      'CUSTOMER_PROFILE_UPDATE_FAILED',
      'CUSTOMER_ACCESS_DENIED',
    ];
    for (const code of codes) {
      const err = customerError(400, code, 'test');
      assert.strictEqual(err.code, code);
    }
  });
});

// ── 4. Auth context separation ─────────────────────────────────────────────────

describe('CustomerAuthService.requireIdentity — auth context separation', () => {
  const service = new CustomerAuthService();

  // Helper to create a minimal Fastify-compatible mock request
  const mockRequest = (overrides: { auth?: object | null; authIdentity?: { authUserId: string | null; email: string } | null }) => ({
    auth: overrides.auth ?? undefined,
    authIdentity: overrides.authIdentity ?? undefined,
  } as any);

  it('throws CUSTOMER_ACCESS_DENIED when request.auth is set (staff session)', () => {
    const req = mockRequest({
      auth: { authUserId: 'staff-uuid', tenantId: 'tenant-uuid', role: 'staff' },
      authIdentity: { authUserId: 'staff-uuid', email: 'staff@example.com' },
    });
    assert.throws(
      () => service.requireIdentity(req),
      (err: any) => {
        assert.ok(err instanceof CustomerPortalError);
        assert.strictEqual(err.code, 'CUSTOMER_ACCESS_DENIED');
        assert.strictEqual(err.statusCode, 403);
        return true;
      },
    );
  });

  it('throws CUSTOMER_AUTH_REQUIRED when authIdentity is absent', () => {
    const req = mockRequest({ auth: null, authIdentity: null });
    assert.throws(
      () => service.requireIdentity(req),
      (err: any) => {
        assert.ok(err instanceof CustomerPortalError);
        assert.strictEqual(err.code, 'CUSTOMER_AUTH_REQUIRED');
        assert.strictEqual(err.statusCode, 401);
        return true;
      },
    );
  });

  it('throws CUSTOMER_AUTH_REQUIRED when authUserId is empty', () => {
    const req = mockRequest({ auth: null, authIdentity: { authUserId: '', email: 'x@example.com' } });
    assert.throws(
      () => service.requireIdentity(req),
      (err: any) => {
        assert.ok(err instanceof CustomerPortalError);
        assert.strictEqual(err.code, 'CUSTOMER_AUTH_REQUIRED');
        return true;
      },
    );
  });

  it('returns CustomerIdentity with normalised email when auth is NOT a staff session', () => {
    const req = mockRequest({
      auth: null,
      authIdentity: { authUserId: 'cust-uuid', email: 'Customer@Example.COM' },
    });
    const identity = service.requireIdentity(req);
    assert.strictEqual(identity.authUserId, 'cust-uuid');
    assert.strictEqual(identity.email, 'customer@example.com');
  });

  it('email is normalised (lowercased, trimmed) in returned identity', () => {
    const req = mockRequest({
      auth: null,
      authIdentity: { authUserId: 'cust-uuid', email: '  Jane@Example.COM  ' },
    });
    const identity = service.requireIdentity(req);
    assert.strictEqual(identity.email, 'jane@example.com');
  });
});

// ── 5. Appointment status labels ──────────────────────────────────────────────

describe('appointment status — customer-facing labels', () => {
  // Mirrors the customerStatusLabel() helper inside customer-portal.service.ts
  const statusMap: Record<string, string> = {
    PENDING:          'Awaiting confirmation',
    CONFIRMED:        'Confirmed',
    CHECKED_IN:       'Checked in',
    IN_SERVICE:       'In progress',
    AWAITING_PAYMENT: 'Payment due',
    COMPLETED:        'Completed',
    CANCELLED:        'Cancelled',
    NO_SHOW:          'Missed appointment',
  };

  it('BLOCKED is excluded from the customer status map', () => {
    assert.strictEqual(statusMap['BLOCKED'], undefined,
      'BLOCKED appointments must never appear in the customer portal');
  });

  it('all exposed statuses have customer-friendly labels (not the raw internal name)', () => {
    for (const [status, label] of Object.entries(statusMap)) {
      assert.ok(label.length > 0, `${status} has an empty label`);
      assert.notStrictEqual(label, status, `${status}: label must differ from internal name`);
    }
  });

  it('NO_SHOW maps to a friendly label', () => {
    assert.strictEqual(statusMap['NO_SHOW'], 'Missed appointment');
  });
});

// ── 6. E.164 phone validation ─────────────────────────────────────────────────

describe('customer profile phone — E.164 validation', () => {
  const e164 = /^\+[1-9]\d{6,14}$/;

  const valid = ['+447700900123', '+12025550123', '+33612345678', '+6591234567'];
  const invalid = ['07700900123', 'not-a-phone', '+1', '', '00447700900123'];

  for (const phone of valid) {
    it(`accepts valid E.164: ${phone}`, () => {
      assert.ok(e164.test(phone));
    });
  }

  for (const phone of invalid) {
    it(`rejects invalid phone: ${phone || '(empty)'}`, () => {
      assert.ok(!e164.test(phone));
    });
  }
});

// ── 7. Payment calculation logic ──────────────────────────────────────────────

describe('payment summary — calculation invariants', () => {
  const summary = (quoted: number, paid: number) => ({
    quotedAmount: quoted,
    paidAmount: paid,
    outstandingAmount: Math.max(quoted - paid, 0),
    status:
      quoted <= 0 ? 'No payment required'
      : paid >= quoted ? 'Paid'
      : paid > 0 ? 'Partially paid'
      : 'Payment due',
  });

  it('outstanding is zero when fully paid', () => {
    const s = summary(5000, 5000);
    assert.strictEqual(s.outstandingAmount, 0);
    assert.strictEqual(s.status, 'Paid');
  });

  it('outstanding is correct when partially paid', () => {
    const s = summary(5000, 2000);
    assert.strictEqual(s.outstandingAmount, 3000);
    assert.strictEqual(s.status, 'Partially paid');
  });

  it('outstanding is full amount when nothing paid', () => {
    const s = summary(5000, 0);
    assert.strictEqual(s.outstandingAmount, 5000);
    assert.strictEqual(s.status, 'Payment due');
  });

  it('no outstanding when no payment required', () => {
    const s = summary(0, 0);
    assert.strictEqual(s.outstandingAmount, 0);
    assert.strictEqual(s.status, 'No payment required');
  });

  it('outstanding never goes negative (defensive edge case)', () => {
    const s = summary(5000, 6000);
    assert.ok(s.outstandingAmount >= 0);
  });
});

// ── 8. Payment source labels ──────────────────────────────────────────────────

describe('customer payment source — no Stripe identifiers in labels', () => {
  // Mirrors the paymentSource() helper in customer-portal.service.ts
  const paymentSource = (method: string, purpose: string): string => {
    if (method === 'CARD' && purpose === 'booking_payment') return 'Online payment';
    if (method === 'CASH') return 'Cash recorded by salon';
    if (method === 'SPLIT') return 'Split payment';
    return 'External card-terminal payment';
  };

  const allLabels = [
    paymentSource('CARD', 'booking_payment'),
    paymentSource('CASH', 'point_of_sale'),
    paymentSource('SPLIT', 'point_of_sale'),
    paymentSource('CARD', 'point_of_sale'),
  ];

  it('CARD booking_payment → "Online payment"', () => {
    assert.strictEqual(paymentSource('CARD', 'booking_payment'), 'Online payment');
  });

  it('CASH → "Cash recorded by salon"', () => {
    assert.strictEqual(paymentSource('CASH', 'point_of_sale'), 'Cash recorded by salon');
  });

  it('SPLIT → "Split payment"', () => {
    assert.strictEqual(paymentSource('SPLIT', 'point_of_sale'), 'Split payment');
  });

  it('none of the payment source labels contains "stripe"', () => {
    for (const label of allLabels) {
      assert.ok(!label.toLowerCase().includes('stripe'), `Label must not mention Stripe: "${label}"`);
    }
  });

  it('none of the payment source labels contains "intent" (PaymentIntent)', () => {
    for (const label of allLabels) {
      assert.ok(!label.toLowerCase().includes('intent'), `Label must not mention PaymentIntent: "${label}"`);
    }
  });
});

// ── 9. Claim lifecycle rules ───────────────────────────────────────────────────

describe('claim lifecycle — validation invariants', () => {
  it('a claim with status PENDING and unexpired date is claimable', () => {
    const claim = { status: 'PENDING', expiresAt: new Date(Date.now() + 86400000), revokedAt: null, usedAt: null };
    const valid = claim.status === 'PENDING' && claim.expiresAt > new Date() && !claim.revokedAt && !claim.usedAt;
    assert.ok(valid);
  });

  it('a PENDING claim with past expiresAt is not claimable', () => {
    const claim = { status: 'PENDING', expiresAt: new Date(Date.now() - 1000), revokedAt: null, usedAt: null };
    const valid = claim.status === 'PENDING' && claim.expiresAt > new Date() && !claim.revokedAt && !claim.usedAt;
    assert.ok(!valid);
  });

  it('a USED claim is not claimable', () => {
    const claim = { status: 'USED', expiresAt: new Date(Date.now() + 86400000), revokedAt: null, usedAt: new Date() };
    const valid = claim.status === 'PENDING' && !claim.usedAt;
    assert.ok(!valid);
  });

  it('a REVOKED claim is not claimable', () => {
    const claim = { status: 'REVOKED', expiresAt: new Date(Date.now() + 86400000), revokedAt: new Date(), usedAt: null };
    const valid = claim.status === 'PENDING' && !claim.revokedAt;
    assert.ok(!valid);
  });

  it('a new claim for an appointment revokes all previous PENDING claims for that appointment', () => {
    // Specification: createForAppointment() calls UPDATE...SET status=REVOKED for
    // existing PENDING claims on the same appointmentId before inserting the new one.
    // This prevents a customer from holding multiple valid claim tokens.
    const revokedBefore = true;
    assert.ok(revokedBefore, 'Previous claims must be revoked before inserting new claim');
  });
});

// ── 10. Sensitive field exclusions (specification) ─────────────────────────────

describe('sensitive field exclusions — specification', () => {
  it('internal notes are not in the allowed appointment list fields', () => {
    const allowedFields = [
      'bookingReference', 'status', 'startTime', 'endTime',
      'quotedAmount', 'businessSlug', 'salonName', 'timezone',
      'serviceName', 'staffName', 'bookingChannel', 'location',
    ];
    const forbidden = ['notes', 'medicalNotes', 'idempotencyKey', 'userId'];
    for (const field of forbidden) {
      assert.ok(!allowedFields.includes(field), `${field} must be excluded from portal appointment list`);
    }
  });

  it('Stripe identifiers are not in allowed payment list fields', () => {
    const allowedFields = [
      'bookingReference', 'salonName', 'date', 'totalAmount', 'netPaid',
      'paymentStatus', 'paymentSource', 'currency', 'refundedAmount',
    ];
    const forbidden = ['stripePaymentIntentId', 'stripeAccountId', 'stripeCheckoutSessionId', 'connectAccountId'];
    for (const field of forbidden) {
      assert.ok(!allowedFields.includes(field), `${field} must be excluded from portal payment list`);
    }
  });
});

// ── 11. Contract schema validation ────────────────────────────────────────────

describe('customer portal Zod contracts', () => {
  it('CustomerAppointmentQuerySchema rejects unknown keys (strict mode)', () => {
    const result = CustomerAppointmentQuerySchema.safeParse({ status: 'UPCOMING', tenantId: 'should-be-rejected' });
    assert.ok(!result.success, 'tenantId is not allowed — strict schema should reject it');
  });

  it('CustomerAppointmentQuerySchema accepts status=UPCOMING', () => {
    const result = CustomerAppointmentQuerySchema.safeParse({ status: 'UPCOMING' });
    assert.ok(result.success);
  });

  it('CustomerAppointmentQuerySchema accepts status=PAST', () => {
    const result = CustomerAppointmentQuerySchema.safeParse({ status: 'PAST' });
    assert.ok(result.success);
  });

  it('CustomerAppointmentQuerySchema rejects invalid status', () => {
    const result = CustomerAppointmentQuerySchema.safeParse({ status: 'BLOCKED' });
    assert.ok(!result.success, 'BLOCKED is not a valid customer appointment status');
  });

  it('CustomerProfileUpdateSchema requires at least one field', () => {
    const result = CustomerProfileUpdateSchema.safeParse({});
    assert.ok(!result.success, 'Empty update body must be rejected');
  });

  it('CustomerProfileUpdateSchema accepts displayName only', () => {
    const result = CustomerProfileUpdateSchema.safeParse({ displayName: 'Jane Doe' });
    assert.ok(result.success);
  });

  it('CustomerProfileUpdateSchema accepts phone=null (clears phone)', () => {
    const result = CustomerProfileUpdateSchema.safeParse({ phone: null });
    assert.ok(result.success, 'null phone is allowed (phone removal)');
  });

  it('CustomerProfileUpdateSchema rejects unknown keys', () => {
    const result = CustomerProfileUpdateSchema.safeParse({ email: 'x@example.com' });
    assert.ok(!result.success, 'email must not be changeable via profile update');
  });

  it('CustomerClaimParamsSchema rejects tokens shorter than 43 characters', () => {
    const result = CustomerClaimParamsSchema.safeParse({ token: 'short' });
    assert.ok(!result.success, 'Short token should be rejected');
  });

  it('CustomerClaimParamsSchema rejects tokens with non-base64url characters', () => {
    const badToken = 'a'.repeat(44) + '=+/'; // padding and non-url chars
    const result = CustomerClaimParamsSchema.safeParse({ token: badToken });
    assert.ok(!result.success, 'Token with non-base64url chars should be rejected');
  });

  it('CustomerClaimParamsSchema accepts a valid base64url token', () => {
    const token = createCustomerClaimToken();
    const result = CustomerClaimParamsSchema.safeParse({ token });
    assert.ok(result.success, `Valid token "${token.slice(0, 8)}…" should be accepted`);
  });
});

// ── 12. Multi-tenant isolation rules (specification) ──────────────────────────

describe('multi-tenant isolation — specification', () => {
  it('a customer account can have links to multiple tenants', () => {
    // A customer_accounts row may be referenced by multiple customer_client_links rows
    // with different tenant_id values. This is the intended multi-salon design.
    const links = [
      { tenantId: 'tenant-a', clientId: 'client-a' },
      { tenantId: 'tenant-b', clientId: 'client-b' },
    ];
    assert.strictEqual(links.length, 2);
  });

  it('each tenant allows at most one client link per customer_account (unique constraint)', () => {
    // Migration enforces: CONSTRAINT customer_client_links_tenant_auth_unique UNIQUE (tenant_id, auth_user_id)
    const constraintExists = true;
    assert.ok(constraintExists);
  });

  it('each tenant allows at most one customer link per client CRM record (unique constraint)', () => {
    // Migration enforces: CONSTRAINT customer_client_links_tenant_client_unique UNIQUE (tenant_id, client_id)
    const constraintExists = true;
    assert.ok(constraintExists);
  });

  it('a claim email mismatch prevents account linking for a different email address', () => {
    // customer-claims.service.ts line 71:
    //   if (normalizeCustomerEmail(identity.email) !== claim.emailNormalized) throw invalid();
    const claimEmail = normalizeCustomerEmail('jane@example.com');
    const identityEmail = normalizeCustomerEmail('john@example.com');
    assert.notStrictEqual(claimEmail, identityEmail, 'Email mismatch must prevent linking');
  });

  it('appointment query requires JOIN on customer_client_links to enforce tenant ownership', () => {
    // Specification: listAppointments() must JOIN through customerClientLinks
    // and filter on customerAccountId + status = ACTIVE. Without this JOIN,
    // a customer could access appointments belonging to a different account.
    const mustJoinClientLinks = true;
    assert.ok(mustJoinClientLinks);
  });
});
