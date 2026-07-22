import { createHash, randomBytes } from 'node:crypto';
import {
  appointments, clients, customerAccountClaims, customerAccounts,
  customerClientLinks, getDatabase, tenants,
} from '@ks-os/database';
import { and, eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { customerError } from './customer-portal.errors.js';
import { normalizeCustomerEmail, type CustomerIdentity } from './customer-auth.service.js';

export function hashCustomerClaimToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createCustomerClaimToken() {
  return randomBytes(32).toString('base64url');
}

export class CustomerClaimsService {
  async createForAppointment(tenantId: string, appointmentId: string) {
    const db = getDatabase();
    return db.transaction(async (tx) => {
      const [appointment] = await tx.select({
        clientId: appointments.clientId,
        clientEmail: clients.email,
      }).from(appointments)
        .leftJoin(clients, and(eq(clients.id, appointments.clientId), eq(clients.tenantId, appointments.tenantId)))
        .where(and(eq(appointments.id, appointmentId), eq(appointments.tenantId, tenantId)))
        .limit(1);

      const email = appointment?.clientEmail ? normalizeCustomerEmail(appointment.clientEmail) : null;
      if (!appointment?.clientId || !email) return null;

      await tx.update(customerAccountClaims).set({ status: 'REVOKED', revokedAt: new Date() })
        .where(and(
          eq(customerAccountClaims.appointmentId, appointmentId),
          eq(customerAccountClaims.status, 'PENDING'),
        ));

      const token = createCustomerClaimToken();
      const expiresAt = new Date(Date.now() + env.CUSTOMER_CLAIM_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      await tx.insert(customerAccountClaims).values({
        tenantId,
        clientId: appointment.clientId,
        appointmentId,
        emailNormalized: email,
        tokenHash: hashCustomerClaimToken(token),
        expiresAt,
        createdByType: 'PUBLIC_BOOKING',
      });

      // The caller receives the raw token exactly once to place in transactional
      // email. It is never written to a table or a log.
      return { token, expiresAt };
    });
  }

  async complete(token: string, identity: CustomerIdentity) {
    const db = getDatabase();
    return db.transaction(async (tx) => {
      const [claim] = await tx.select().from(customerAccountClaims)
        .where(eq(customerAccountClaims.tokenHash, hashCustomerClaimToken(token)))
        .for('update').limit(1);

      const invalid = () => customerError(400, 'CUSTOMER_CLAIM_INVALID', 'This secure portal link is unavailable.');
      if (!claim || claim.status !== 'PENDING' || claim.revokedAt || claim.usedAt) throw invalid();
      if (claim.expiresAt <= new Date()) {
        await tx.update(customerAccountClaims).set({ status: 'EXPIRED' }).where(eq(customerAccountClaims.id, claim.id));
        throw invalid();
      }
      if (normalizeCustomerEmail(identity.email) !== claim.emailNormalized) throw invalid();

      let [account] = await tx.select().from(customerAccounts)
        .where(eq(customerAccounts.authUserId, identity.authUserId)).limit(1);
      if (!account) {
        const displayName = identity.email.split('@')[0].slice(0, 255) || 'Customer';
        await tx.insert(customerAccounts).values({
          authUserId: identity.authUserId,
          emailNormalized: identity.email,
          displayName,
          lastSignedInAt: new Date(),
        }).onConflictDoNothing({ target: customerAccounts.authUserId });
        [account] = await tx.select().from(customerAccounts)
          .where(eq(customerAccounts.authUserId, identity.authUserId)).limit(1);
      }
      if (!account || account.status !== 'ACTIVE') {
        throw customerError(403, 'CUSTOMER_ACCOUNT_SUSPENDED', 'This customer account is unavailable.');
      }

      const [existingLink] = await tx.select().from(customerClientLinks)
        .where(and(eq(customerClientLinks.tenantId, claim.tenantId), eq(customerClientLinks.authUserId, identity.authUserId)))
        .limit(1);
      if (existingLink && (existingLink.status !== 'ACTIVE' || existingLink.clientId !== claim.clientId)) {
        // A tenant has one canonical client per customer. Do not silently link a
        // duplicate CRM record just because the email matches.
        throw invalid();
      }
      if (!existingLink) {
        await tx.insert(customerClientLinks).values({
          customerAccountId: account.id,
          authUserId: identity.authUserId,
          tenantId: claim.tenantId,
          clientId: claim.clientId,
          linkSource: 'BOOKING_CLAIM',
        });
      }

      await tx.update(customerAccountClaims).set({ status: 'USED', usedAt: new Date() })
        .where(and(eq(customerAccountClaims.id, claim.id), eq(customerAccountClaims.status, 'PENDING')));
      const [tenant] = await tx.select({ subdomain: tenants.subdomain }).from(tenants)
        .where(eq(tenants.id, claim.tenantId)).limit(1);
      return { businessSlug: tenant?.subdomain ?? null };
    });
  }
}
