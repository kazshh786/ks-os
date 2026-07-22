import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  externalReviews, getDatabase, locations, reviewInvitations, reviewInvitationRules, reviewOauthStates,
  reviewProviderConnections, reviewProviderLocationMappings,
} from '@ks-os/database';
import {
  GoogleReviewLinkInputSchema, ReputationListQuerySchema, ReviewInvitationRuleCreateSchema,
  ReviewInvitationRuleUpdateSchema, ReviewReplySchema, TrustpilotConnectionInputSchema,
  type ReviewProvider,
} from '@ks-os/contracts';
import {
  decryptProviderCredentials, encryptProviderCredentials, hashPublicToken, reputationError,
  testProviderLink, validateGoogleReviewUrl, validateTrustpilotReviewUrl,
} from './reputation.security.js';
import { GoogleBusinessProfileProvider, TrustpilotProvider } from './reputation.providers.js';

export type ReputationActor = { tenantId: string; userId: string; role: 'owner' | 'staff'; permissions?: readonly string[] };
const db = () => getDatabase();

function requireOwner(actor: ReputationActor) {
  if (actor.role !== 'owner') throw reputationError(403, 'REPUTATION_ACCESS_DENIED', 'Owner access is required.');
}

function requireView(actor: ReputationActor) {
  if (actor.role !== 'owner' && !actor.permissions?.includes('REPUTATION_VIEW')) throw reputationError(403, 'REPUTATION_ACCESS_DENIED', 'Reputation access is denied.');
}

function safeConnection(row: any) {
  const { encryptedCredentialsReference: _secret, encrypted_credentials_reference: _rawSecret, ...safe } = row;
  return {
    ...safe,
    label: row.connectionType === 'MANUAL_LINK' ? (row.provider === 'GOOGLE' ? 'Google review link configured' : 'Trustpilot review link configured') : row.provider === 'GOOGLE' ? 'Google Business Profile connected' : 'Trustpilot API connection',
    capabilities: { sync: row.connectionType !== 'MANUAL_LINK' && row.status === 'CONNECTED', reply: row.connectionType !== 'MANUAL_LINK' && row.status === 'CONNECTED' },
  };
}

export class ReputationService {
  private google = new GoogleBusinessProfileProvider();
  private trustpilot = new TrustpilotProvider();

  private async assertLocation(tenantId: string, locationId?: string | null) {
    if (!locationId) return;
    const [location] = await db().select({ id: locations.id }).from(locations).where(and(eq(locations.id, locationId), eq(locations.tenantId, tenantId), eq(locations.isActive, true))).limit(1);
    if (!location) throw reputationError(400, 'REVIEW_CONNECTION_INVALID', 'Location is not active in this workspace.');
  }

  async listConnections(actor: ReputationActor) {
    requireView(actor);
    const rows = await db().select().from(reviewProviderConnections).where(eq(reviewProviderConnections.tenantId, actor.tenantId)).orderBy(desc(reviewProviderConnections.updatedAt));
    return rows.map(safeConnection);
  }

  async listLocations(actor: ReputationActor) {
    requireOwner(actor);
    return db().select({ id: locations.id, name: locations.name, isPrimary: locations.isPrimary, isActive: locations.isActive })
      .from(locations).where(and(eq(locations.tenantId, actor.tenantId), eq(locations.isActive, true))).orderBy(desc(locations.isPrimary), locations.name);
  }

  private async upsertConnection(actor: ReputationActor, input: any) {
    const scope = input.locationId ? eq(reviewProviderConnections.locationId, input.locationId) : isNull(reviewProviderConnections.locationId);
    const [existing] = await db().select().from(reviewProviderConnections).where(and(
      eq(reviewProviderConnections.tenantId, actor.tenantId), eq(reviewProviderConnections.provider, input.provider),
      eq(reviewProviderConnections.connectionType, input.connectionType), scope,
    )).limit(1);
    const values = { ...input, tenantId: actor.tenantId, connectedByUserId: actor.userId, updatedAt: new Date() };
    const [row] = existing
      ? await db().update(reviewProviderConnections).set(values).where(and(eq(reviewProviderConnections.id, existing.id), eq(reviewProviderConnections.tenantId, actor.tenantId))).returning()
      : await db().insert(reviewProviderConnections).values(values).returning();
    return safeConnection(row);
  }

  async configureGoogleLink(actor: ReputationActor, value: unknown) {
    requireOwner(actor);
    const input = GoogleReviewLinkInputSchema.parse(value);
    await this.assertLocation(actor.tenantId, input.locationId);
    return this.upsertConnection(actor, {
      provider: 'GOOGLE', connectionType: 'MANUAL_LINK', status: 'CONFIGURED',
      locationId: input.locationId ?? null, reviewUrl: validateGoogleReviewUrl(input.reviewUrl),
      businessDisplayName: input.businessDisplayName, encryptedCredentialsReference: null,
      configuredAt: new Date(), lastErrorCode: null, settingsJson: {},
    });
  }

  async configureTrustpilot(actor: ReputationActor, value: unknown) {
    requireOwner(actor);
    const input = TrustpilotConnectionInputSchema.parse(value);
    await this.assertLocation(actor.tenantId, input.locationId);
    const credentials = input.connectionType === 'API' ? encryptProviderCredentials(input.apiCredentials!) : null;
    return this.upsertConnection(actor, {
      provider: 'TRUSTPILOT', connectionType: input.connectionType,
      status: input.connectionType === 'API' ? 'CONNECTED' : 'CONFIGURED', locationId: input.locationId ?? null,
      reviewUrl: input.reviewUrl ? validateTrustpilotReviewUrl(input.reviewUrl) : null,
      businessDisplayName: input.businessDisplayName, providerBusinessId: input.businessUnitId ?? null,
      providerLocationId: input.providerLocationId ?? null, profileDomain: input.profileDomain ?? null,
      encryptedCredentialsReference: credentials, connectedAt: credentials ? new Date() : null,
      configuredAt: new Date(), lastErrorCode: null,
      settingsJson: { locale: input.locale, invitationTemplateId: input.invitationTemplateId ?? null },
    });
  }

  async testConnectionLink(actor: ReputationActor, connectionId: string) {
    requireOwner(actor);
    const [connection] = await db().select().from(reviewProviderConnections).where(and(eq(reviewProviderConnections.id, connectionId), eq(reviewProviderConnections.tenantId, actor.tenantId))).limit(1);
    if (!connection?.reviewUrl) throw reputationError(404, 'REVIEW_CONNECTION_NOT_FOUND', 'Review link connection was not found.');
    const result = await testProviderLink(connection.provider as ReviewProvider, connection.reviewUrl);
    await db().update(reviewProviderConnections).set({ lastVerifiedAt: new Date(), lastErrorCode: null, updatedAt: new Date() }).where(and(eq(reviewProviderConnections.id, connection.id), eq(reviewProviderConnections.tenantId, actor.tenantId)));
    return result;
  }

  async deleteConnection(actor: ReputationActor, connectionId: string) {
    requireOwner(actor);
    const deleted = await db().delete(reviewProviderConnections).where(and(eq(reviewProviderConnections.id, connectionId), eq(reviewProviderConnections.tenantId, actor.tenantId))).returning({ id: reviewProviderConnections.id });
    if (!deleted.length) throw reputationError(404, 'REVIEW_CONNECTION_NOT_FOUND', 'Review provider connection was not found.');
  }

  async startGoogleOauth(actor: ReputationActor) {
    requireOwner(actor);
    const state = randomBytes(32).toString('base64url');
    await db().insert(reviewOauthStates).values({ tenantId: actor.tenantId, userId: actor.userId, provider: 'GOOGLE', tokenHash: hashPublicToken(state), expiresAt: new Date(Date.now() + 10 * 60_000) });
    return { authorizationUrl: this.google.authorizationUrl(state), expiresInSeconds: 600 };
  }

  async finishGoogleOauth(state: string, code: string) {
    const tokenHash = hashPublicToken(state);
    const [oauthState] = await db().update(reviewOauthStates).set({ status: 'USED', usedAt: new Date() }).where(and(
      eq(reviewOauthStates.tokenHash, tokenHash), eq(reviewOauthStates.status, 'PENDING'), gt(reviewOauthStates.expiresAt, new Date()),
    )).returning();
    if (!oauthState) throw reputationError(401, 'REVIEW_PROVIDER_AUTH_FAILED', 'Google authorisation state is invalid or expired.');
    const credentials = await this.google.exchangeCode(code);
    const actor: ReputationActor = { tenantId: oauthState.tenantId, userId: oauthState.userId, role: 'owner' };
    return this.upsertConnection(actor, {
      provider: 'GOOGLE', connectionType: 'OAUTH', status: 'CONNECTED', locationId: null,
      reviewUrl: null, businessDisplayName: 'Google Business Profile',
      encryptedCredentialsReference: encryptProviderCredentials(credentials), connectedAt: new Date(), configuredAt: new Date(), settingsJson: {}, lastErrorCode: null,
    });
  }

  private async connectionWithCredentials(actor: ReputationActor, connectionId: string, provider?: ReviewProvider) {
    const [connection] = await db().select().from(reviewProviderConnections).where(and(
      eq(reviewProviderConnections.id, connectionId), eq(reviewProviderConnections.tenantId, actor.tenantId),
      provider ? eq(reviewProviderConnections.provider, provider) : undefined,
    )).limit(1);
    if (!connection) throw reputationError(404, 'REVIEW_CONNECTION_NOT_FOUND', 'Review provider connection was not found.');
    if (!connection.encryptedCredentialsReference) throw reputationError(409, 'REVIEW_PROVIDER_AUTH_REQUIRED', 'This provider connection has no API credentials.');
    return { connection, credentials: decryptProviderCredentials<any>(connection.encryptedCredentialsReference) };
  }

  async googleAccounts(actor: ReputationActor, connectionId: string) {
    requireOwner(actor);
    const { credentials } = await this.connectionWithCredentials(actor, connectionId, 'GOOGLE');
    return this.google.listAccounts(credentials);
  }

  async googleLocations(actor: ReputationActor, connectionId: string, accountName: string) {
    requireOwner(actor);
    const { credentials } = await this.connectionWithCredentials(actor, connectionId, 'GOOGLE');
    return this.google.listLocations(credentials, accountName);
  }

  async mapProviderLocation(actor: ReputationActor, connectionId: string, value: any) {
    requireOwner(actor);
    const locationId = String(value.locationId ?? '');
    await this.assertLocation(actor.tenantId, locationId);
    const [connection] = await db().select().from(reviewProviderConnections).where(and(eq(reviewProviderConnections.id, connectionId), eq(reviewProviderConnections.tenantId, actor.tenantId))).limit(1);
    if (!connection) throw reputationError(404, 'REVIEW_CONNECTION_NOT_FOUND', 'Review provider connection was not found.');
    const reviewUrl = value.reviewUrl ? (connection.provider === 'GOOGLE' ? validateGoogleReviewUrl(String(value.reviewUrl)) : validateTrustpilotReviewUrl(String(value.reviewUrl))) : null;
    const [existing] = await db().select().from(reviewProviderLocationMappings).where(and(eq(reviewProviderLocationMappings.connectionId, connection.id), eq(reviewProviderLocationMappings.locationId, locationId), eq(reviewProviderLocationMappings.tenantId, actor.tenantId))).limit(1);
    const values = { tenantId: actor.tenantId, connectionId: connection.id, locationId, providerBusinessId: String(value.providerBusinessId ?? '') || null, providerLocationId: String(value.providerLocationId ?? '') || null, reviewUrl, updatedAt: new Date() };
    return existing
      ? (await db().update(reviewProviderLocationMappings).set(values).where(and(eq(reviewProviderLocationMappings.id, existing.id), eq(reviewProviderLocationMappings.tenantId, actor.tenantId))).returning())[0]
      : (await db().insert(reviewProviderLocationMappings).values(values).returning())[0];
  }

  async trustpilotTemplates(actor: ReputationActor, connectionId: string) {
    requireOwner(actor);
    const { connection, credentials } = await this.connectionWithCredentials(actor, connectionId, 'TRUSTPILOT');
    if (!connection.providerBusinessId) throw reputationError(409, 'REVIEW_CONNECTION_INVALID', 'Trustpilot business unit is not configured.');
    return this.trustpilot.listTemplates(credentials, connection.providerBusinessId);
  }

  async listRules(actor: ReputationActor) {
    requireOwner(actor);
    return db().select().from(reviewInvitationRules).where(eq(reviewInvitationRules.tenantId, actor.tenantId)).orderBy(desc(reviewInvitationRules.updatedAt));
  }

  async createRule(actor: ReputationActor, value: unknown) {
    requireOwner(actor);
    const input = ReviewInvitationRuleCreateSchema.parse(value);
    await this.assertLocation(actor.tenantId, input.locationId);
    return db().transaction(async (tx) => {
      const scope = input.locationId ? eq(reviewInvitationRules.locationId, input.locationId) : isNull(reviewInvitationRules.locationId);
      await tx.update(reviewInvitationRules).set({ status: 'PAUSED', updatedAt: new Date(), updatedByUserId: actor.userId }).where(and(eq(reviewInvitationRules.tenantId, actor.tenantId), eq(reviewInvitationRules.status, 'ACTIVE'), scope));
      const [row] = await tx.insert(reviewInvitationRules).values({ ...input, locationId: input.locationId ?? null, tenantId: actor.tenantId, status: 'ACTIVE', createdByUserId: actor.userId, updatedByUserId: actor.userId }).returning();
      return row;
    });
  }

  async updateRule(actor: ReputationActor, ruleId: string, value: unknown) {
    requireOwner(actor);
    const input = ReviewInvitationRuleUpdateSchema.parse(value);
    if ('locationId' in input) await this.assertLocation(actor.tenantId, input.locationId);
    const [row] = await db().update(reviewInvitationRules).set({ ...input, updatedByUserId: actor.userId, updatedAt: new Date(), ruleVersion: sql`${reviewInvitationRules.ruleVersion} + 1` }).where(and(eq(reviewInvitationRules.id, ruleId), eq(reviewInvitationRules.tenantId, actor.tenantId))).returning();
    if (!row) throw reputationError(404, 'REVIEW_INVITATION_NOT_FOUND', 'Review invitation rule was not found.');
    return row;
  }

  async setRuleStatus(actor: ReputationActor, ruleId: string, status: 'ACTIVE' | 'PAUSED') {
    requireOwner(actor);
    return db().transaction(async (tx) => {
      const [current] = await tx.select().from(reviewInvitationRules).where(and(eq(reviewInvitationRules.id, ruleId), eq(reviewInvitationRules.tenantId, actor.tenantId))).limit(1);
      if (!current) throw reputationError(404, 'REVIEW_INVITATION_NOT_FOUND', 'Review invitation rule was not found.');
      if (status === 'ACTIVE') {
        const scope = current.locationId ? eq(reviewInvitationRules.locationId, current.locationId) : isNull(reviewInvitationRules.locationId);
        await tx.update(reviewInvitationRules).set({ status: 'PAUSED', updatedAt: new Date(), updatedByUserId: actor.userId }).where(and(eq(reviewInvitationRules.tenantId, actor.tenantId), eq(reviewInvitationRules.status, 'ACTIVE'), scope, ne(reviewInvitationRules.id, ruleId)));
      }
      const [row] = await tx.update(reviewInvitationRules).set({ status, updatedByUserId: actor.userId, updatedAt: new Date() }).where(and(eq(reviewInvitationRules.id, ruleId), eq(reviewInvitationRules.tenantId, actor.tenantId))).returning();
      return row;
    });
  }

  async listInvitations(actor: ReputationActor, value: unknown) {
    requireView(actor);
    const query = ReputationListQuerySchema.parse(value);
    return db().select().from(reviewInvitations).where(and(
      eq(reviewInvitations.tenantId, actor.tenantId), query.provider ? eq(reviewInvitations.provider, query.provider) : undefined,
      query.status ? eq(reviewInvitations.status, query.status) : undefined, query.locationId ? eq(reviewInvitations.locationId, query.locationId) : undefined,
      query.cursor ? lt(reviewInvitations.createdAt, new Date(query.cursor)) : undefined,
    )).orderBy(desc(reviewInvitations.createdAt)).limit(query.limit);
  }

  async listReviews(actor: ReputationActor, value: unknown) {
    requireView(actor);
    const query = ReputationListQuerySchema.parse(value);
    return db().select().from(externalReviews).where(and(
      eq(externalReviews.tenantId, actor.tenantId), query.provider ? eq(externalReviews.provider, query.provider) : undefined,
      query.locationId ? eq(externalReviews.locationId, query.locationId) : undefined,
      query.cursor ? lt(externalReviews.reviewCreatedAt, new Date(query.cursor)) : undefined,
    )).orderBy(desc(externalReviews.reviewCreatedAt)).limit(query.limit);
  }

  async overview(actor: ReputationActor) {
    requireView(actor);
    const connections = await this.listConnections(actor);
    const invitationStats = await db().execute(sql`SELECT provider, status, count(*)::int AS count FROM review_invitations WHERE tenant_id=${actor.tenantId} GROUP BY provider,status`);
    const reviewStats = await db().execute(sql`SELECT provider, count(*)::int AS review_count, avg(rating)::numeric(4,2) AS average_rating FROM external_reviews WHERE tenant_id=${actor.tenantId} GROUP BY provider`);
    return { connections, invitationStats: invitationStats.rows, providerReviewMetrics: reviewStats.rows };
  }

  private googleRating(value: string) {
    return ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } as Record<string, number>)[value] ?? Number(value);
  }

  private async upsertExternalReview(connection: any, locationId: string | null, review: any) {
    const google = connection.provider === 'GOOGLE';
    const providerReviewId = String(google ? review.name : review.id);
    const reply = google ? review.reviewReply : review.companyReply;
    const rawSourceUrl = google ? null : (review.sourceUrl ?? review.links?.find?.((x: any) => /public|review/i.test(x.rel))?.href ?? null);
    let sourceUrl: string | null = null;
    if (rawSourceUrl) { try { sourceUrl = validateTrustpilotReviewUrl(String(rawSourceUrl)); } catch { sourceUrl = null; } }
    await db().insert(externalReviews).values({
      tenantId: connection.tenantId, provider: connection.provider, providerReviewId,
      providerBusinessId: connection.providerBusinessId!, providerLocationId: connection.providerLocationId,
      locationId, rating: google ? this.googleRating(review.starRating) : Number(review.stars),
      title: google ? null : review.title ?? null, reviewText: google ? review.comment ?? null : review.text ?? null,
      reviewerDisplayName: google ? review.reviewer?.displayName ?? null : review.consumer?.displayName ?? null,
      reviewCreatedAt: new Date(google ? review.createTime : review.createdAt),
      reviewUpdatedAt: new Date(google ? review.updateTime ?? review.createTime : review.updatedAt ?? review.createdAt),
      verificationLevel: google ? null : review.verificationLevel ?? review.reviewVerificationLevel ?? (typeof review.isVerified === 'boolean' ? (review.isVerified ? 'verified' : 'not_verified') : null),
      businessReplyText: reply?.comment ?? reply?.text ?? null,
      businessReplyCreatedAt: reply?.updateTime || reply?.createdAt ? new Date(reply.updateTime ?? reply.createdAt) : null,
      sourceUrl, lastSyncedAt: new Date(), updatedAt: new Date(),
    }).onConflictDoUpdate({ target: [externalReviews.tenantId, externalReviews.provider, externalReviews.providerReviewId], set: {
      rating: google ? this.googleRating(review.starRating) : Number(review.stars), title: google ? null : review.title ?? null,
      reviewText: google ? review.comment ?? null : review.text ?? null, reviewerDisplayName: google ? review.reviewer?.displayName ?? null : review.consumer?.displayName ?? null,
      reviewUpdatedAt: new Date(google ? review.updateTime ?? review.createTime : review.updatedAt ?? review.createdAt),
      verificationLevel: google ? null : review.verificationLevel ?? review.reviewVerificationLevel ?? (typeof review.isVerified === 'boolean' ? (review.isVerified ? 'verified' : 'not_verified') : null),
      businessReplyText: reply?.comment ?? reply?.text ?? null, businessReplyCreatedAt: reply?.updateTime || reply?.createdAt ? new Date(reply.updateTime ?? reply.createdAt) : null,
      sourceUrl, lastSyncedAt: new Date(), updatedAt: new Date(),
    }});
  }

  private async syncConnection(connection: typeof reviewProviderConnections.$inferSelect) {
    let synced = 0;
    if (!connection.encryptedCredentialsReference) throw reputationError(409, 'REVIEW_PROVIDER_AUTH_REQUIRED', 'Review provider connection needs authorisation.');
    try {
      const credentials = decryptProviderCredentials<any>(connection.encryptedCredentialsReference);
      if (connection.provider === 'GOOGLE') {
        const mappings = await db().select().from(reviewProviderLocationMappings).where(and(eq(reviewProviderLocationMappings.tenantId, connection.tenantId), eq(reviewProviderLocationMappings.connectionId, connection.id)));
        for (const mapping of mappings) {
          if (!mapping.providerBusinessId || !mapping.providerLocationId) continue;
          const result = await this.google.listReviews(credentials, mapping.providerBusinessId.replace(/^accounts\//, ''), mapping.providerLocationId.replace(/^locations\//, ''));
          for (const review of result.reviews) { await this.upsertExternalReview({ ...connection, providerBusinessId: mapping.providerBusinessId, providerLocationId: mapping.providerLocationId }, mapping.locationId, review); synced += 1; }
        }
      } else if (connection.providerBusinessId) {
        const result = await this.trustpilot.listReviews(credentials, connection.providerBusinessId, String((connection.settingsJson as any)?.locale ?? 'en-GB'));
        for (const review of result.reviews) { await this.upsertExternalReview(connection, connection.locationId, review); synced += 1; }
      }
      await db().update(reviewProviderConnections).set({ lastSyncAt: new Date(), lastErrorCode: null, updatedAt: new Date() }).where(and(eq(reviewProviderConnections.id, connection.id), eq(reviewProviderConnections.tenantId, connection.tenantId)));
      return synced;
    } catch (error: any) {
      await db().update(reviewProviderConnections).set({ lastErrorCode: error?.code ?? 'REVIEW_SYNC_FAILED', updatedAt: new Date() }).where(and(eq(reviewProviderConnections.id, connection.id), eq(reviewProviderConnections.tenantId, connection.tenantId)));
      throw error?.code ? error : reputationError(502, 'REVIEW_SYNC_FAILED', 'External review sync failed.');
    }
  }

  async sync(actor: ReputationActor) {
    requireOwner(actor);
    const connections = await db().select().from(reviewProviderConnections).where(and(eq(reviewProviderConnections.tenantId, actor.tenantId), eq(reviewProviderConnections.status, 'CONNECTED')));
    let synced = 0;
    for (const connection of connections) synced += await this.syncConnection(connection);
    return { synced };
  }

  async syncDueConnections(limit = 10) {
    const claimed = await db().execute(sql`
      UPDATE review_provider_connections SET updated_at=now()
      WHERE id IN (
        SELECT id FROM review_provider_connections
        WHERE status='CONNECTED' AND (
          (last_error_code IS NULL AND (last_sync_at IS NULL OR last_sync_at<=now()-interval '6 hours'))
          OR (last_error_code IS NOT NULL AND updated_at<=now()-interval '15 minutes')
        )
        ORDER BY COALESCE(last_sync_at,created_at) FOR UPDATE SKIP LOCKED LIMIT ${limit}
      ) RETURNING id
    `);
    let synced = 0; let failed = 0;
    for (const claim of claimed.rows as any[]) {
      const [connection] = await db().select().from(reviewProviderConnections).where(eq(reviewProviderConnections.id, claim.id)).limit(1);
      if (!connection) continue;
      try { synced += await this.syncConnection(connection); } catch { failed += 1; }
    }
    return { claimed: claimed.rows.length, synced, failed };
  }

  async reply(actor: ReputationActor, reviewId: string, value: unknown) {
    requireOwner(actor);
    const { reply } = ReviewReplySchema.parse(value);
    const review = await this.reviewForTenant(actor.tenantId, reviewId);
    const connection = await this.apiConnectionForReview(actor.tenantId, review.provider as ReviewProvider, review.providerBusinessId);
    const credentials = decryptProviderCredentials<any>(connection.encryptedCredentialsReference!);
    if (review.provider === 'GOOGLE') await this.google.reply(credentials, review.providerReviewId, reply);
    else await this.trustpilot.reply(credentials, review.providerReviewId, reply);
    await db().update(externalReviews).set({ businessReplyText: reply, businessReplyCreatedAt: new Date(), updatedAt: new Date() }).where(and(eq(externalReviews.id, review.id), eq(externalReviews.tenantId, actor.tenantId)));
  }

  async deleteReply(actor: ReputationActor, reviewId: string) {
    requireOwner(actor);
    const review = await this.reviewForTenant(actor.tenantId, reviewId);
    const connection = await this.apiConnectionForReview(actor.tenantId, review.provider as ReviewProvider, review.providerBusinessId);
    const credentials = decryptProviderCredentials<any>(connection.encryptedCredentialsReference!);
    if (review.provider === 'GOOGLE') await this.google.deleteReply(credentials, review.providerReviewId);
    else await this.trustpilot.deleteReply(credentials, review.providerReviewId);
    await db().update(externalReviews).set({ businessReplyText: null, businessReplyCreatedAt: null, updatedAt: new Date() }).where(and(eq(externalReviews.id, review.id), eq(externalReviews.tenantId, actor.tenantId)));
  }

  private async reviewForTenant(tenantId: string, reviewId: string) {
    const [review] = await db().select().from(externalReviews).where(and(eq(externalReviews.id, reviewId), eq(externalReviews.tenantId, tenantId))).limit(1);
    if (!review) throw reputationError(404, 'EXTERNAL_REVIEW_NOT_FOUND', 'External review was not found.');
    return review;
  }

  private async apiConnectionForReview(tenantId: string, provider: ReviewProvider, providerBusinessId: string) {
    if (provider === 'GOOGLE') {
      const [mapped] = await db().select({ connection: reviewProviderConnections }).from(reviewProviderConnections)
        .innerJoin(reviewProviderLocationMappings, and(eq(reviewProviderLocationMappings.connectionId, reviewProviderConnections.id), eq(reviewProviderLocationMappings.tenantId, tenantId)))
        .where(and(eq(reviewProviderConnections.tenantId, tenantId), eq(reviewProviderConnections.provider, 'GOOGLE'), eq(reviewProviderConnections.status, 'CONNECTED'), eq(reviewProviderLocationMappings.providerBusinessId, providerBusinessId))).limit(1);
      if (mapped?.connection.encryptedCredentialsReference) return mapped.connection;
    }
    const [connection] = await db().select().from(reviewProviderConnections).where(and(
      eq(reviewProviderConnections.tenantId, tenantId), eq(reviewProviderConnections.provider, provider),
      eq(reviewProviderConnections.status, 'CONNECTED'), eq(reviewProviderConnections.providerBusinessId, providerBusinessId),
    )).limit(1);
    if (!connection?.encryptedCredentialsReference) throw reputationError(409, 'REVIEW_PROVIDER_AUTH_REQUIRED', 'Review provider connection needs authorisation.');
    return connection;
  }
}
