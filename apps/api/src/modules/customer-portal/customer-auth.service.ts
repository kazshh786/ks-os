import type { FastifyRequest } from 'fastify';
import { customerAccounts, getDatabase } from '@ks-os/database';
import { eq } from 'drizzle-orm';
import { customerError } from './customer-portal.errors.js';
import { getSupabaseAdmin } from '../../lib/supabase-admin.js';
import { normalizeAndValidateEmailAddress } from '../email/email-safety.js';

export type CustomerIdentity = {
  authUserId: string;
  email: string;
};

export type CustomerAuthContext = CustomerIdentity & {
  customerAccountId: string;
  displayName: string;
  phone: string | null;
};

export function normalizeCustomerEmail(email: string) {
  const result = normalizeAndValidateEmailAddress(email);
  if (!result.valid) throw customerError(401, 'CUSTOMER_AUTH_REQUIRED', 'A verified email address is required.');
  return result.email;
}

export async function verifyCustomerEmail(identity: CustomerIdentity) {
  const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(identity.authUserId);
  if (error || !data.user?.email || !data.user.email_confirmed_at || data.user.is_anonymous || normalizeCustomerEmail(data.user.email) !== normalizeCustomerEmail(identity.email)) {
    throw customerError(403, 'CUSTOMER_ACCESS_DENIED', 'Sign in with the verified email address that received this invitation.');
  }
}

export class CustomerAuthService {
  requireIdentity(request: FastifyRequest): CustomerIdentity {
    // The same verified identity may hold explicit memberships in several
    // contexts, but a customer request never inherits staff or agency authority.
    if (request.auth || request.agencyAuth || request.applicationContext !== 'CUSTOMER') {
      throw customerError(403, 'CUSTOMER_ACCESS_DENIED', 'This session cannot access the customer portal.');
    }

    const identity = request.authIdentity;
    if (!identity?.authUserId || !identity.email || !identity.authSessionId || !identity.issuedAt || !identity.expiresAt || !request.customerSessionValidated || !Number.isFinite(Date.parse(identity.issuedAt)) || !Number.isFinite(Date.parse(identity.expiresAt)) || Date.parse(identity.expiresAt) <= Date.now()) {
      throw customerError(401, 'CUSTOMER_AUTH_REQUIRED', 'Sign in is required to continue.');
    }

    return { authUserId: identity.authUserId, email: normalizeCustomerEmail(identity.email) };
  }

  async requireCustomer(request: FastifyRequest, createIfMissing = false): Promise<CustomerAuthContext> {
    const identity = this.requireIdentity(request);
    const db = getDatabase();
    let [account] = await db.select().from(customerAccounts)
      .where(eq(customerAccounts.authUserId, identity.authUserId)).limit(1);

    if (!account && createIfMissing) {
      const displayName = identity.email.split('@')[0].slice(0, 255) || 'Customer';
      await db.insert(customerAccounts).values({
        authUserId: identity.authUserId,
        emailNormalized: identity.email,
        displayName,
      }).onConflictDoNothing({ target: customerAccounts.authUserId });
      [account] = await db.select().from(customerAccounts)
        .where(eq(customerAccounts.authUserId, identity.authUserId)).limit(1);
    }

    if (!account) {
      throw customerError(401, 'CUSTOMER_AUTH_REQUIRED', 'Sign in is required to continue.');
    }
    if (account.status !== 'ACTIVE') {
      throw customerError(403, 'CUSTOMER_ACCOUNT_SUSPENDED', 'This customer account is unavailable.');
    }

    await db.update(customerAccounts).set({
      emailNormalized: identity.email,
      lastSignedInAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(customerAccounts.id, account.id));

    return {
      ...identity,
      customerAccountId: account.id,
      displayName: account.displayName,
      phone: account.phoneE164,
    };
  }
}
