import type { FastifyRequest } from 'fastify';
import { customerAccounts, getDatabase } from '@ks-os/database';
import { eq } from 'drizzle-orm';
import { customerError } from './customer-portal.errors.js';

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
  return email.trim().toLocaleLowerCase('en-US');
}

export class CustomerAuthService {
  requireIdentity(request: FastifyRequest): CustomerIdentity {
    // A staff identity never doubles as a customer context. A deliberately
    // provisioned customer identity must use a distinct Supabase Auth user.
    if (request.auth) {
      throw customerError(403, 'CUSTOMER_ACCESS_DENIED', 'This session cannot access the customer portal.');
    }

    const identity = request.authIdentity;
    if (!identity?.authUserId || !identity.email) {
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
