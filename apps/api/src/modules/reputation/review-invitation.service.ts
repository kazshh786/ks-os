import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  appointments, clients, customerClientLinks, getDatabase, reviewInvitations, reviewInvitationRules,
  reviewProviderConnections, reviewProviderLocationMappings, tenants,
} from '@ks-os/database';
import { ReviewClickSchema, type ReviewProvider, type ReviewProviderMode } from '@ks-os/contracts';
import { EmailService } from '../email/email.service.js';
import { SmsService } from '../sms/sms.service.js';
import {
  EmailSettingsService,
  emailBrandingTemplateData,
  renderAutomatedEmailCopy,
} from '../email/email-settings.service.js';
import { TrustpilotProvider } from './reputation.providers.js';
import {
  decryptProviderCredentials, deriveProviderReference, deriveReviewInvitationToken, hashPublicToken,
  reputationError, validateProviderUrl,
} from './reputation.security.js';
import {
  evaluateReviewEligibility, providersForMode, reviewInvitationIdempotencyKey, selectScopedConfiguration,
} from './reputation.policy.js';

type Destination = { provider: ReviewProvider; url?: string; connectionId: string; connectionType: string; connection: any; mapping?: any };

export class ReviewInvitationService {
  private db = getDatabase();
  private trustpilot = new TrustpilotProvider();
  private emailSettings = new EmailSettingsService();

  private async resolveProvider(tenantId: string, locationId: string | null, provider: ReviewProvider, query = this.db): Promise<Destination | null> {
    const connections = await query.select().from(reviewProviderConnections).where(and(
      eq(reviewProviderConnections.tenantId, tenantId), eq(reviewProviderConnections.provider, provider),
      inArray(reviewProviderConnections.status, ['CONFIGURED', 'CONNECTED']),
    ));
    const manual = selectScopedConfiguration(connections.filter((row: any) => row.connectionType === 'MANUAL_LINK'), locationId) as any;
    if (manual?.reviewUrl) return { provider, url: validateProviderUrl(provider, manual.reviewUrl), connectionId: manual.id, connectionType: manual.connectionType, connection: manual };

    const apiConnections = connections.filter((row: any) => row.connectionType !== 'MANUAL_LINK' && row.status === 'CONNECTED');
    for (const connection of apiConnections) {
      if (provider === 'TRUSTPILOT' && connection.providerBusinessId && connection.encryptedCredentialsReference) {
        if (connection.locationId === locationId || connection.locationId === null) return { provider, connectionId: connection.id, connectionType: connection.connectionType, connection };
      }
      if (provider === 'GOOGLE' && locationId && connection.encryptedCredentialsReference) {
        const [mapping] = await query.select().from(reviewProviderLocationMappings).where(and(
          eq(reviewProviderLocationMappings.tenantId, tenantId), eq(reviewProviderLocationMappings.connectionId, connection.id),
          eq(reviewProviderLocationMappings.locationId, locationId),
        )).limit(1);
        if (mapping?.reviewUrl) return { provider, url: validateProviderUrl(provider, mapping.reviewUrl), connectionId: connection.id, connectionType: connection.connectionType, connection, mapping };
      }
    }
    return null;
  }

  async scheduleFromCompletion(tenantId: string, appointmentId: string, completedAt = new Date(), query: any = this.db) {
    const [context] = await query.select({
      appointment: appointments, client: clients, tenant: tenants,
    }).from(appointments)
      .innerJoin(tenants, and(eq(tenants.id, appointments.tenantId), eq(tenants.id, tenantId)))
      .leftJoin(clients, and(eq(clients.id, appointments.clientId), eq(clients.tenantId, tenantId)))
      .where(and(eq(appointments.id, appointmentId), eq(appointments.tenantId, tenantId))).limit(1);
    if (!context?.appointment || !context.client) return { scheduled: false, reason: 'CLIENT_NOT_FOUND' };
    const emailSettings = await this.emailSettings.get(tenantId, query);

    const rules = await query.select().from(reviewInvitationRules).where(and(
      eq(reviewInvitationRules.tenantId, tenantId), eq(reviewInvitationRules.status, 'ACTIVE'),
      context.appointment.locationId ? or(eq(reviewInvitationRules.locationId, context.appointment.locationId), isNull(reviewInvitationRules.locationId)) : isNull(reviewInvitationRules.locationId),
    )).orderBy(asc(reviewInvitationRules.createdAt));
    const rule = selectScopedConfiguration(rules, context.appointment.locationId) as (typeof rules)[number] | null;
    if (!rule) return { scheduled: false, reason: 'NO_ACTIVE_RULE' };
    if (rule.channel === 'EMAIL' && !emailSettings.automations.customerThankYouEnabled) return { scheduled: false, reason: 'THANK_YOU_EMAIL_DISABLED' };

    const [portalLink] = await query.select({ id: customerClientLinks.id }).from(customerClientLinks).where(and(
      eq(customerClientLinks.tenantId, tenantId), eq(customerClientLinks.clientId, context.client.id), eq(customerClientLinks.status, 'ACTIVE'),
    )).limit(1);
    const eligibility = evaluateReviewEligibility({
      status: context.appointment.status, tenantActive: context.tenant.isActive, hasClient: true,
      isTest: context.appointment.isTest, isInternal: context.appointment.isInternal,
      explicitlyExcluded: context.appointment.reviewInvitationExcluded, channel: rule.channel as any,
      hasEmail: Boolean(context.client.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(context.client.email)),
      hasSms: Boolean(context.client.phoneE164 || context.client.phone), smsMarketingStatus: context.client.smsMarketingStatus,
      smsTransactionalStatus: context.client.smsTransactionalStatus, hasCustomerPortal: Boolean(portalLink),
    });
    if (!eligibility.eligible) return { scheduled: false, reason: eligibility.reason };

    const [history] = await query.select({
      previousCompletedVisits: sql<number>`count(*)::int`,
    }).from(appointments).where(and(
      eq(appointments.tenantId, tenantId),
      eq(appointments.clientId, context.client.id),
      eq(appointments.status, 'COMPLETED'),
      sql`${appointments.id} <> ${appointmentId}::uuid`,
    ));
    const providerMode: ReviewProviderMode = rule.channel === 'EMAIL'
      ? (Number(history?.previousCompletedVisits ?? 0) > 0 ? 'TRUSTPILOT' : 'GOOGLE')
      : rule.providerMode as ReviewProviderMode;
    for (const provider of providersForMode(providerMode)) {
      if (!await this.resolveProvider(tenantId, context.appointment.locationId, provider, query)) {
        return { scheduled: false, reason: 'REVIEW_PROVIDER_NOT_AVAILABLE' };
      }
    }

    const invitationId = randomUUID();
    const token = deriveReviewInvitationToken(invitationId);
    const idempotencyKey = reviewInvitationIdempotencyKey(tenantId, appointmentId, providerMode, rule.ruleVersion);
    const scheduledFor = new Date(completedAt.getTime() + rule.delayMinutes * 60_000);
    const [invitation] = await query.insert(reviewInvitations).values({
      id: invitationId, tenantId, appointmentId, clientId: context.client.id, locationId: context.appointment.locationId,
      ruleId: rule.id, provider: providerMode, channel: rule.channel, status: 'SCHEDULED', tokenHash: hashPublicToken(token),
      providerReferenceId: deriveProviderReference(idempotencyKey), scheduledFor, nextAttemptAt: scheduledFor,
      expiresAt: new Date(scheduledFor.getTime() + 30 * 24 * 60 * 60_000), idempotencyKey,
    }).onConflictDoNothing().returning();
    return invitation ? { scheduled: true, invitationId: invitation.id, scheduledFor } : { scheduled: false, reason: 'ALREADY_SCHEDULED' };
  }

  private async destinationsFor(invitation: any, client: any): Promise<Record<string, string>> {
    const destinations: Record<string, string> = {};
    for (const provider of providersForMode(invitation.provider as ReviewProviderMode)) {
      const destination = await this.resolveProvider(invitation.tenantId, invitation.locationId, provider);
      if (!destination) throw reputationError(409, 'REVIEW_PROVIDER_NOT_AVAILABLE', 'A configured review destination is no longer available.');
      if (destination.url) { destinations[provider] = destination.url; continue; }
      if (provider !== 'TRUSTPILOT' || !client.email) throw reputationError(409, 'REVIEW_PROVIDER_NOT_AVAILABLE', 'Trustpilot API invitations require a customer email address.');
      const settings = destination.connection.settingsJson as any;
      const result = await this.trustpilot.generateInvitationLink(
        decryptProviderCredentials<any>(destination.connection.encryptedCredentialsReference),
        { businessUnitId: destination.connection.providerBusinessId, locationId: destination.connection.providerLocationId, referenceId: invitation.providerReferenceId, email: client.email, name: client.name, locale: settings.locale ?? 'en-GB' },
      );
      destinations.TRUSTPILOT = result.url;
      await this.db.update(reviewInvitations).set({ providerInvitationId: result.id }).where(and(eq(reviewInvitations.id, invitation.id), eq(reviewInvitations.tenantId, invitation.tenantId)));
    }
    return destinations;
  }

  async processDue(limit = 20) {
    const claimed = await this.db.execute(sql`
      UPDATE review_invitations SET status='QUEUED', queued_at=COALESCE(queued_at,now()),
        attempt_count=attempt_count+1, updated_at=now()
      WHERE id IN (
        SELECT id FROM review_invitations
        WHERE (status='SCHEDULED' OR (status='QUEUED' AND updated_at<=now()-interval '10 minutes'))
          AND scheduled_for<=now() AND next_attempt_at<=now()
        ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT ${limit}
      ) RETURNING id, attempt_count
    `);
    for (const claim of claimed.rows as any[]) {
      const [row] = await this.db.select({ invitation: reviewInvitations, client: clients, tenant: tenants, rule: reviewInvitationRules, appointment: appointments })
        .from(reviewInvitations).innerJoin(clients, and(eq(clients.id, reviewInvitations.clientId), eq(clients.tenantId, reviewInvitations.tenantId)))
        .innerJoin(tenants, eq(tenants.id, reviewInvitations.tenantId)).innerJoin(reviewInvitationRules, and(eq(reviewInvitationRules.id, reviewInvitations.ruleId), eq(reviewInvitationRules.tenantId, reviewInvitations.tenantId)))
        .innerJoin(appointments, and(eq(appointments.id, reviewInvitations.appointmentId), eq(appointments.tenantId, reviewInvitations.tenantId)))
        .where(eq(reviewInvitations.id, claim.id)).limit(1);
      if (!row) continue;
      try {
        const eligibility = evaluateReviewEligibility({
          status: row.appointment.status, tenantActive: row.tenant.isActive, hasClient: true,
          isTest: row.appointment.isTest, isInternal: row.appointment.isInternal, explicitlyExcluded: row.appointment.reviewInvitationExcluded,
          channel: row.invitation.channel as any, hasEmail: Boolean(row.client.email), hasSms: Boolean(row.client.phoneE164 || row.client.phone),
          smsMarketingStatus: row.client.smsMarketingStatus, smsTransactionalStatus: row.client.smsTransactionalStatus,
          hasCustomerPortal: true,
        });
        if (!eligibility.eligible) {
          await this.db.update(reviewInvitations).set({ status: 'SUPPRESSED', failureCode: eligibility.reason, updatedAt: new Date() }).where(eq(reviewInvitations.id, row.invitation.id));
          continue;
        }
        const emailSettings = await this.emailSettings.get(row.invitation.tenantId);
        if (row.invitation.channel === 'EMAIL' && !emailSettings.automations.customerThankYouEnabled) {
          await this.db.update(reviewInvitations).set({ status: 'SUPPRESSED', failureCode: 'THANK_YOU_EMAIL_DISABLED', updatedAt: new Date() }).where(eq(reviewInvitations.id, row.invitation.id));
          continue;
        }
        const destinations = await this.destinationsFor(row.invitation, row.client);
        const reviewProvider = row.invitation.provider as 'GOOGLE' | 'TRUSTPILOT';
        const [priorGoogleSupport] = reviewProvider === 'TRUSTPILOT'
          ? await this.db.select({ id: reviewInvitations.id }).from(reviewInvitations).where(and(
            eq(reviewInvitations.tenantId, row.invitation.tenantId),
            eq(reviewInvitations.clientId, row.client.id),
            isNotNull(reviewInvitations.googleClickedAt),
          )).limit(1)
          : [];
        const configuredTemplate = reviewProvider === 'TRUSTPILOT'
          ? emailSettings.templates.customerThankYouTrustpilot
          : emailSettings.templates.customerThankYouGoogle;
        const replacements = {
          businessName: emailSettings.branding.businessName,
          customerName: row.client.name,
          appointmentDate: new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: row.tenant.timezone }).format(row.appointment.startTime),
          reviewProvider: reviewProvider === 'GOOGLE' ? 'Google' : 'Trustpilot',
        };
        const renderedCopy = renderAutomatedEmailCopy(configuredTemplate, replacements);
        if (reviewProvider === 'TRUSTPILOT' && priorGoogleSupport) {
          renderedCopy.emailBody = renderedCopy.emailBody + '\n\nThank you as well for supporting us on Google.';
        }
        const common = {
          ...emailBrandingTemplateData(emailSettings.branding),
          tenantPrimaryColor: row.tenant.primaryColor,
          customerName: row.client.name, reviewInvitationId: row.invitation.id,
          message: row.rule.messageTemplate.replaceAll('{{salonName}}', row.tenant.senderDisplayName || row.tenant.name),
          appointmentDate: replacements.appointmentDate,
          reviewProvider,
          ...renderedCopy,
        };
        let queued = true;
        if (row.invitation.channel === 'EMAIL') {
          const result = await new EmailService().enqueueEmail({ tenantId: row.invitation.tenantId, recipientEmail: row.client.email!, recipientName: row.client.name, replyToEmail: row.tenant.replyToEmail ?? undefined, templateKey: 'review-invitation', templateDataJson: common, idempotencyKey: 'review-email:' + row.invitation.id, relatedEntityType: 'review_invitation', relatedEntityId: row.invitation.id });
          queued = result.queued;
        } else if (row.invitation.channel === 'SMS') {
          queued = await new SmsService().enqueue({ tenantId: row.invitation.tenantId, clientId: row.client.id, appointmentId: row.invitation.appointmentId, recipientPhone: row.client.phoneE164 || row.client.phone!, templateKey: 'review-invitation', templateData: common, idempotencyKey: 'review-sms:' + row.invitation.id });
        }
        await this.db.update(reviewInvitations).set({ providerDestinationsJson: destinations, status: queued ? (row.invitation.channel === 'CUSTOMER_PORTAL' ? 'SENT' : 'QUEUED') : 'SUPPRESSED', sentAt: row.invitation.channel === 'CUSTOMER_PORTAL' ? new Date() : null, failureCode: queued ? null : 'REVIEW_INVITATION_SUPPRESSED', updatedAt: new Date() }).where(and(eq(reviewInvitations.id, row.invitation.id), eq(reviewInvitations.tenantId, row.invitation.tenantId)));
      } catch (error: any) {
        const attempts = Number(claim.attempt_count);
        const failed = attempts >= 5 || ['REVIEW_PROVIDER_NOT_AVAILABLE', 'REVIEW_LINK_INVALID'].includes(error?.code);
        await this.db.update(reviewInvitations).set({ status: failed ? 'FAILED' : 'SCHEDULED', failureCode: error?.code ?? 'REVIEW_INVITATION_FAILED', nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000), updatedAt: new Date() }).where(eq(reviewInvitations.id, claim.id));
      }
    }
    return { claimed: claimed.rows.length };
  }

  async getPublicInvitation(rawToken: string) {
    const tokenHash = hashPublicToken(rawToken);
    const [row] = await this.db.select({ invitation: reviewInvitations, tenant: tenants, appointment: appointments, rule: reviewInvitationRules })
      .from(reviewInvitations).innerJoin(tenants, eq(tenants.id, reviewInvitations.tenantId))
      .innerJoin(appointments, and(eq(appointments.id, reviewInvitations.appointmentId), eq(appointments.tenantId, reviewInvitations.tenantId)))
      .innerJoin(reviewInvitationRules, and(eq(reviewInvitationRules.id, reviewInvitations.ruleId), eq(reviewInvitationRules.tenantId, reviewInvitations.tenantId)))
      .where(eq(reviewInvitations.tokenHash, tokenHash)).limit(1);
    if (!row) throw reputationError(404, 'REVIEW_INVITATION_NOT_FOUND', 'Review invitation was not found.');
    if (row.invitation.expiresAt <= new Date() || ['EXPIRED', 'CANCELLED'].includes(row.invitation.status)) {
      await this.db.update(reviewInvitations).set({ status: 'EXPIRED', updatedAt: new Date() }).where(eq(reviewInvitations.id, row.invitation.id));
      throw reputationError(410, 'REVIEW_INVITATION_EXPIRED', 'Review invitation has expired.');
    }
    const destinations = row.invitation.providerDestinationsJson as Record<string, string>;
    const providers = providersForMode(row.invitation.provider as ReviewProviderMode);
    if (providers.some((provider) => !destinations[provider])) throw reputationError(503, 'REVIEW_PROVIDER_NOT_AVAILABLE', 'The review destination is not available.');
    if (!row.invitation.openedAt) await this.db.update(reviewInvitations).set({ openedAt: new Date(), status: row.invitation.status === 'CONFIRMED_REVIEW' ? 'CONFIRMED_REVIEW' : 'OPENED', updatedAt: new Date() }).where(eq(reviewInvitations.id, row.invitation.id));
    const contact = row.rule.privateContactEnabled ? (row.tenant.replyToEmail ? 'mailto:' + row.tenant.replyToEmail : row.tenant.operationalPhone ? 'tel:' + row.tenant.operationalPhone : null) : null;
    return {
      salonName: row.tenant.senderDisplayName || row.tenant.name,
      appointmentDate: row.appointment.startTime.toISOString(),
      message: row.rule.messageTemplate.replaceAll('{{salonName}}', row.tenant.senderDisplayName || row.tenant.name),
      providers: providers.map((provider) => ({ provider, label: provider === 'GOOGLE' ? 'Leave a review on Google' : 'Leave a review on Trustpilot' })),
      privateContactUrl: contact, expiresAt: row.invitation.expiresAt.toISOString(),
    };
  }

  async click(rawToken: string, value: unknown) {
    const { provider } = ReviewClickSchema.parse(value);
    const tokenHash = hashPublicToken(rawToken);
    const [invitation] = await this.db.select().from(reviewInvitations).where(eq(reviewInvitations.tokenHash, tokenHash)).limit(1);
    if (!invitation) throw reputationError(404, 'REVIEW_INVITATION_NOT_FOUND', 'Review invitation was not found.');
    if (invitation.expiresAt <= new Date()) throw reputationError(410, 'REVIEW_INVITATION_EXPIRED', 'Review invitation has expired.');
    if (!providersForMode(invitation.provider as ReviewProviderMode).includes(provider)) throw reputationError(400, 'REVIEW_CONNECTION_INVALID', 'Provider is not available for this invitation.');
    const destination = (invitation.providerDestinationsJson as Record<string, string>)[provider];
    if (!destination) throw reputationError(503, 'REVIEW_PROVIDER_NOT_AVAILABLE', 'The review destination is not available.');
    const now = new Date();
    await this.db.update(reviewInvitations).set({
      status: invitation.status === 'CONFIRMED_REVIEW' ? 'CONFIRMED_REVIEW' : 'PROVIDER_CLICKED', clickedAt: invitation.clickedAt ?? now,
      googleClickedAt: provider === 'GOOGLE' ? now : invitation.googleClickedAt,
      trustpilotClickedAt: provider === 'TRUSTPILOT' ? now : invitation.trustpilotClickedAt, updatedAt: now,
    }).where(eq(reviewInvitations.id, invitation.id));
    return { provider, redirectUrl: validateProviderUrl(provider, destination), reviewSubmitted: false };
  }

  async listForCustomer(authUserId: string) {
    const rows = await this.db.select({ invitation: reviewInvitations, tenant: tenants, appointment: appointments })
      .from(reviewInvitations)
      .innerJoin(customerClientLinks, and(eq(customerClientLinks.tenantId, reviewInvitations.tenantId), eq(customerClientLinks.clientId, reviewInvitations.clientId), eq(customerClientLinks.authUserId, authUserId), eq(customerClientLinks.status, 'ACTIVE')))
      .innerJoin(tenants, eq(tenants.id, reviewInvitations.tenantId))
      .innerJoin(appointments, and(eq(appointments.id, reviewInvitations.appointmentId), eq(appointments.tenantId, reviewInvitations.tenantId)))
      .where(and(eq(reviewInvitations.channel, 'CUSTOMER_PORTAL'), inArray(reviewInvitations.status, ['SENT', 'OPENED', 'PROVIDER_CLICKED']), gt(reviewInvitations.expiresAt, new Date())))
      .orderBy(asc(reviewInvitations.expiresAt));
    return rows.map((row) => ({
      id: row.invitation.id, salonName: row.tenant.senderDisplayName || row.tenant.name,
      appointmentDate: row.appointment.startTime.toISOString(), status: row.invitation.status,
      reviewPath: '/review/' + deriveReviewInvitationToken(row.invitation.id), expiresAt: row.invitation.expiresAt.toISOString(),
    }));
  }
}
