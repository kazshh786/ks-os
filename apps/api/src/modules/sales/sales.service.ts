import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  clientSalesProfiles,
  clients,
  getDatabase,
  salesOpportunities,
  salesOpportunityActivity,
  salesPipelineStages,
  salesPipelines,
  salesQuoteAccessTokens,
  salesQuoteItems,
  salesQuotes,
  tenants,
  users,
} from '@ks-os/database';
import {
  defaultSalesStagesForBusinessType,
  type AcceptPublicSalesQuoteInput,
  type ChangeSalesStageInput,
  type CreateSalesOpportunityInput,
  type CreateSalesPipelineInput,
  type CreateSalesQuoteInput,
  type DeclinePublicSalesQuoteInput,
  type SalesOpportunityListQuery,
  type SalesQuoteItemInput,
  type UpdateSalesOpportunityInput,
  type UpdateSalesQuoteInput,
} from '@ks-os/contracts';

export type SalesActor = {
  tenantId: string;
  userId: string;
  role: 'owner' | 'staff';
  permissions: readonly string[];
};

const salesError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const can = (actor: SalesActor, capability: string) => actor.role === 'owner' || actor.permissions.includes(capability);
const canViewAll = (actor: SalesActor) => can(actor, 'SALES_VIEW_ALL');
const canViewOwn = (actor: SalesActor) => can(actor, 'SALES_VIEW_OWN');

function calculateItems(items: SalesQuoteItemInput[]) {
  let subtotal = 0;
  let taxTotal = 0;
  const rows = items.map((item, position) => {
    const lineSubtotal = item.quantity * item.unitAmount;
    const taxAmount = Math.round((lineSubtotal * item.taxRateBasisPoints) / 10_000);
    const total = lineSubtotal + taxAmount;
    if (![lineSubtotal, taxAmount, total].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647)) {
      throw salesError(400, 'QUOTE_AMOUNT_INVALID', 'A quote line exceeds the supported amount range.');
    }
    subtotal += lineSubtotal;
    taxTotal += taxAmount;
    return { ...item, position, subtotal: lineSubtotal, taxAmount, total };
  });
  const total = subtotal + taxTotal;
  if (![subtotal, taxTotal, total].every(value => Number.isSafeInteger(value) && value <= 2_147_483_647)) {
    throw salesError(400, 'QUOTE_TOTAL_INVALID', 'The quote total exceeds the supported amount range.');
  }
  return { rows, subtotal, taxTotal, total };
}

const opportunitySelection = {
  id: salesOpportunities.id,
  reference: salesOpportunities.publicReference,
  tenantId: salesOpportunities.tenantId,
  clientId: salesOpportunities.clientId,
  pipelineId: salesOpportunities.pipelineId,
  stageId: salesOpportunities.stageId,
  title: salesOpportunities.title,
  description: salesOpportunities.description,
  ownerUserId: salesOpportunities.ownerUserId,
  source: salesOpportunities.source,
  estimatedValue: salesOpportunities.estimatedValue,
  currency: salesOpportunities.currency,
  expectedCloseDate: salesOpportunities.expectedCloseDate,
  closedAt: salesOpportunities.closedAt,
  closedReason: salesOpportunities.closedReason,
  createdAt: salesOpportunities.createdAt,
  updatedAt: salesOpportunities.updatedAt,
  clientName: clients.name,
  clientEmail: clients.email,
  clientPhone: clients.phone,
  clientLifecycle: clientSalesProfiles.lifecycle,
  pipelineReference: salesPipelines.publicReference,
  pipelineName: salesPipelines.name,
  stageReference: salesPipelineStages.publicReference,
  stageName: salesPipelineStages.name,
  stagePosition: salesPipelineStages.position,
  stageCategory: salesPipelineStages.category,
  stageProbability: salesPipelineStages.probability,
  stageActive: salesPipelineStages.isActive,
  ownerName: users.name,
};

export class SalesService {
  private db = getDatabase();

  private require(actor: SalesActor, capability: string) {
    if (!can(actor, capability)) throw salesError(403, 'SALES_FORBIDDEN', 'You do not have permission to perform this sales action.');
  }

  private requireView(actor: SalesActor) {
    if (actor.role !== 'owner' && !canViewAll(actor) && !canViewOwn(actor)) this.require(actor, 'SALES_VIEW_OWN');
  }

  private opportunityVisibility(actor: SalesActor) {
    if (actor.role === 'owner' || canViewAll(actor)) return undefined;
    return eq(salesOpportunities.ownerUserId, actor.userId);
  }

  private canUpdate(actor: SalesActor, ownerUserId: string | null) {
    return actor.role === 'owner' || can(actor, 'SALES_UPDATE_ALL') || (can(actor, 'SALES_UPDATE_OWN') && ownerUserId === actor.userId);
  }

  private async ensureOwner(actor: SalesActor, userId: string | null | undefined) {
    if (!userId) return null;
    const [row] = await this.db.select({ id: users.id, name: users.name }).from(users).where(and(
      eq(users.id, userId), eq(users.tenantId, actor.tenantId), eq(users.accountStatus, 'ACTIVE'),
    )).limit(1);
    if (!row) throw salesError(400, 'SALES_OWNER_INVALID', 'The opportunity owner must be an active member of this workspace.');
    return row;
  }

  private async ensureDefaultPipeline(tenantId: string) {
    const [existing] = await this.db.select().from(salesPipelines).where(and(
      eq(salesPipelines.tenantId, tenantId), eq(salesPipelines.purpose, 'SALES'), eq(salesPipelines.isDefault, true), eq(salesPipelines.isActive, true),
    )).limit(1);
    if (existing) return existing;

    const [tenant] = await this.db.select({ businessType: tenants.businessType }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw salesError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    const defaults = defaultSalesStagesForBusinessType(tenant.businessType);

    return this.db.transaction(async tx => {
      const [created] = await tx.insert(salesPipelines).values({ tenantId, name: 'Sales Pipeline', purpose: 'SALES', isDefault: true, isActive: true }).onConflictDoNothing().returning();
      if (!created) {
        const [winner] = await tx.select().from(salesPipelines).where(and(
          eq(salesPipelines.tenantId, tenantId), eq(salesPipelines.purpose, 'SALES'), eq(salesPipelines.isDefault, true), eq(salesPipelines.isActive, true),
        )).limit(1);
        if (!winner) throw salesError(409, 'SALES_PIPELINE_CONFLICT', 'The default pipeline could not be initialised.');
        return winner;
      }
      await tx.insert(salesPipelineStages).values(defaults.map((stage, position) => ({
        tenantId, pipelineId: created.id, name: stage.name, position, category: stage.category, probability: stage.probability, isActive: true,
      })));
      return created;
    });
  }

  async listPipelines(actor: SalesActor) {
    this.requireView(actor);
    await this.ensureDefaultPipeline(actor.tenantId);
    const pipelines = await this.db.select().from(salesPipelines).where(and(eq(salesPipelines.tenantId, actor.tenantId), eq(salesPipelines.purpose, 'SALES'))).orderBy(desc(salesPipelines.isDefault), asc(salesPipelines.createdAt));
    const stages = await this.db.select().from(salesPipelineStages).where(eq(salesPipelineStages.tenantId, actor.tenantId)).orderBy(asc(salesPipelineStages.position));
    return pipelines.map(pipeline => ({
      reference: pipeline.publicReference,
      name: pipeline.name,
      purpose: 'SALES' as const,
      isDefault: pipeline.isDefault,
      isActive: pipeline.isActive,
      stages: stages.filter(stage => stage.pipelineId === pipeline.id).map(stage => ({
        reference: stage.publicReference, name: stage.name, position: stage.position,
        category: stage.category as 'OPEN' | 'WON' | 'LOST', probability: stage.probability, isActive: stage.isActive,
      })),
    }));
  }

  async createPipeline(actor: SalesActor, input: CreateSalesPipelineInput) {
    this.require(actor, 'PIPELINES_MANAGE');
    const created = await this.db.transaction(async tx => {
      const [pipeline] = await tx.insert(salesPipelines).values({ tenantId: actor.tenantId, name: input.name, purpose: 'SALES', isDefault: false, isActive: true }).returning();
      await tx.insert(salesPipelineStages).values(input.stages.map((stage, position) => ({ tenantId: actor.tenantId, pipelineId: pipeline.id, name: stage.name, position, category: stage.category, probability: stage.probability, isActive: true })));
      return pipeline;
    });
    const pipelines = await this.listPipelines({ ...actor, permissions: [...new Set([...actor.permissions, 'SALES_VIEW_ALL'])] });
    return pipelines.find(pipeline => pipeline.reference === created.publicReference)!;
  }

  private async pipelineAndStage(actor: SalesActor, pipelineReference?: string, stageReference?: string) {
    const pipeline = pipelineReference
      ? (await this.db.select().from(salesPipelines).where(and(eq(salesPipelines.tenantId, actor.tenantId), eq(salesPipelines.publicReference, pipelineReference), eq(salesPipelines.isActive, true))).limit(1))[0]
      : await this.ensureDefaultPipeline(actor.tenantId);
    if (!pipeline) throw salesError(400, 'SALES_PIPELINE_INVALID', 'The selected pipeline is unavailable in this workspace.');
    const stage = stageReference
      ? (await this.db.select().from(salesPipelineStages).where(and(eq(salesPipelineStages.tenantId, actor.tenantId), eq(salesPipelineStages.pipelineId, pipeline.id), eq(salesPipelineStages.publicReference, stageReference), eq(salesPipelineStages.isActive, true))).limit(1))[0]
      : (await this.db.select().from(salesPipelineStages).where(and(eq(salesPipelineStages.tenantId, actor.tenantId), eq(salesPipelineStages.pipelineId, pipeline.id), eq(salesPipelineStages.category, 'OPEN'), eq(salesPipelineStages.isActive, true))).orderBy(asc(salesPipelineStages.position)).limit(1))[0];
    if (!stage) throw salesError(400, 'SALES_STAGE_INVALID', 'The selected pipeline stage is unavailable in this workspace.');
    return { pipeline, stage };
  }

  private async resolveClient(actor: SalesActor, input: CreateSalesOpportunityInput) {
    if (input.clientId) {
      const [client] = await this.db.select().from(clients).where(and(eq(clients.id, input.clientId), eq(clients.tenantId, actor.tenantId))).limit(1);
      if (!client) throw salesError(400, 'SALES_CLIENT_INVALID', 'The selected customer does not belong to this workspace.');
      return client;
    }
    const lead = input.lead!;
    let existing: typeof clients.$inferSelect | undefined;
    if (lead.email) {
      [existing] = await this.db.select().from(clients).where(and(eq(clients.tenantId, actor.tenantId), sql`lower(${clients.email}) = lower(${lead.email})`)).limit(1);
    }
    if (!existing && lead.phone) {
      [existing] = await this.db.select().from(clients).where(and(eq(clients.tenantId, actor.tenantId), eq(clients.phone, lead.phone))).limit(1);
    }
    if (existing) return existing;
    const [created] = await this.db.insert(clients).values({ tenantId: actor.tenantId, name: lead.name, email: lead.email ?? null, phone: lead.phone ?? null }).returning();
    await this.db.insert(clientSalesProfiles).values({ tenantId: actor.tenantId, clientId: created.id, lifecycle: 'LEAD', source: input.source ?? null, ownerUserId: input.ownerUserId ?? actor.userId }).onConflictDoNothing();
    return created;
  }

  private baseOpportunityQuery(actor: SalesActor, reference?: string) {
    const conditions = [eq(salesOpportunities.tenantId, actor.tenantId)];
    if (reference) conditions.push(eq(salesOpportunities.publicReference, reference));
    const visibility = this.opportunityVisibility(actor);
    if (visibility) conditions.push(visibility);
    return this.db.select(opportunitySelection).from(salesOpportunities)
      .innerJoin(clients, and(eq(clients.id, salesOpportunities.clientId), eq(clients.tenantId, actor.tenantId)))
      .innerJoin(salesPipelines, and(eq(salesPipelines.id, salesOpportunities.pipelineId), eq(salesPipelines.tenantId, actor.tenantId)))
      .innerJoin(salesPipelineStages, and(eq(salesPipelineStages.id, salesOpportunities.stageId), eq(salesPipelineStages.tenantId, actor.tenantId)))
      .leftJoin(clientSalesProfiles, and(eq(clientSalesProfiles.clientId, clients.id), eq(clientSalesProfiles.tenantId, actor.tenantId)))
      .leftJoin(users, and(eq(users.id, salesOpportunities.ownerUserId), eq(users.tenantId, actor.tenantId)))
      .where(and(...conditions));
  }

  private serializeOpportunity(row: any) {
    return {
      reference: row.reference,
      title: row.title,
      description: row.description ?? null,
      client: { id: row.clientId, name: row.clientName, email: row.clientEmail ?? null, phone: row.clientPhone ?? null, lifecycle: row.clientLifecycle ?? 'CUSTOMER' },
      pipeline: { reference: row.pipelineReference, name: row.pipelineName },
      stage: { reference: row.stageReference, name: row.stageName, position: row.stagePosition, category: row.stageCategory, probability: row.stageProbability, isActive: row.stageActive },
      owner: row.ownerUserId ? { id: row.ownerUserId, name: row.ownerName ?? 'Team member' } : null,
      source: row.source ?? null,
      estimatedValue: row.estimatedValue ?? null,
      currency: row.currency,
      expectedCloseDate: iso(row.expectedCloseDate),
      closedAt: iso(row.closedAt),
      closedReason: row.closedReason ?? null,
      createdAt: iso(row.createdAt)!,
      updatedAt: iso(row.updatedAt)!,
    };
  }

  private async opportunityRow(actor: SalesActor, reference: string) {
    this.requireView(actor);
    const [row] = await this.baseOpportunityQuery(actor, reference).limit(1);
    if (!row) throw salesError(404, 'SALES_OPPORTUNITY_NOT_FOUND', 'Opportunity not found.');
    return row;
  }

  async listOpportunities(actor: SalesActor, query: SalesOpportunityListQuery) {
    this.requireView(actor);
    const conditions: any[] = [eq(salesOpportunities.tenantId, actor.tenantId)];
    const visibility = this.opportunityVisibility(actor);
    if (visibility) conditions.push(visibility);
    if (query.stageReference) conditions.push(eq(salesPipelineStages.publicReference, query.stageReference));
    if (query.ownerUserId) conditions.push(eq(salesOpportunities.ownerUserId, query.ownerUserId));
    if (query.state) conditions.push(eq(salesPipelineStages.category, query.state));
    if (query.search) conditions.push(or(ilike(salesOpportunities.title, `%${query.search.replace(/[%_]/g, '\\$&')}%`), ilike(clients.name, `%${query.search.replace(/[%_]/g, '\\$&')}%`))!);
    const rows = await this.db.select(opportunitySelection).from(salesOpportunities)
      .innerJoin(clients, and(eq(clients.id, salesOpportunities.clientId), eq(clients.tenantId, actor.tenantId)))
      .innerJoin(salesPipelines, and(eq(salesPipelines.id, salesOpportunities.pipelineId), eq(salesPipelines.tenantId, actor.tenantId)))
      .innerJoin(salesPipelineStages, and(eq(salesPipelineStages.id, salesOpportunities.stageId), eq(salesPipelineStages.tenantId, actor.tenantId)))
      .leftJoin(clientSalesProfiles, and(eq(clientSalesProfiles.clientId, clients.id), eq(clientSalesProfiles.tenantId, actor.tenantId)))
      .leftJoin(users, and(eq(users.id, salesOpportunities.ownerUserId), eq(users.tenantId, actor.tenantId)))
      .where(and(...conditions)).orderBy(desc(salesOpportunities.updatedAt)).limit(query.limit);
    return rows.map(row => this.serializeOpportunity(row));
  }

  async summary(actor: SalesActor) {
    this.requireView(actor);
    const conditions: any[] = [eq(salesOpportunities.tenantId, actor.tenantId)];
    const visibility = this.opportunityVisibility(actor);
    if (visibility) conditions.push(visibility);
    const [totals] = await this.db.select({
      openCount: sql<number>`count(*) filter (where ${salesPipelineStages.category} = 'OPEN')::int`,
      openValue: sql<number>`coalesce(sum(${salesOpportunities.estimatedValue}) filter (where ${salesPipelineStages.category} = 'OPEN'), 0)::int`,
      wonCount: sql<number>`count(*) filter (where ${salesPipelineStages.category} = 'WON')::int`,
      wonValue: sql<number>`coalesce(sum(${salesOpportunities.estimatedValue}) filter (where ${salesPipelineStages.category} = 'WON'), 0)::int`,
    }).from(salesOpportunities).innerJoin(salesPipelineStages, and(eq(salesPipelineStages.id, salesOpportunities.stageId), eq(salesPipelineStages.tenantId, actor.tenantId))).where(and(...conditions));
    const quoteConditions: any[] = [eq(salesQuotes.tenantId, actor.tenantId), eq(salesQuotes.status, 'SENT')];
    if (visibility) quoteConditions.push(visibility);
    const [quoteCount] = await this.db.select({ count: sql<number>`count(*)::int` }).from(salesQuotes).innerJoin(salesOpportunities, and(eq(salesOpportunities.id, salesQuotes.opportunityId), eq(salesOpportunities.tenantId, actor.tenantId))).where(and(...quoteConditions));
    const [tenant] = await this.db.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
    return { openCount: totals?.openCount ?? 0, openValue: totals?.openValue ?? 0, wonCount: totals?.wonCount ?? 0, wonValue: totals?.wonValue ?? 0, quotesAwaitingDecision: quoteCount?.count ?? 0, currency: tenant?.currency ?? 'GBP' };
  }

  async getOpportunity(actor: SalesActor, reference: string) {
    const row = await this.opportunityRow(actor, reference);
    const activity = await this.db.select().from(salesOpportunityActivity).where(and(eq(salesOpportunityActivity.tenantId, actor.tenantId), eq(salesOpportunityActivity.opportunityId, row.id))).orderBy(desc(salesOpportunityActivity.createdAt));
    const quotes = await this.db.select({ reference: salesQuotes.publicReference, quoteNumber: salesQuotes.quoteNumber, title: salesQuotes.title, status: salesQuotes.status, total: salesQuotes.total, currency: salesQuotes.currency, validUntil: salesQuotes.validUntil, updatedAt: salesQuotes.updatedAt }).from(salesQuotes).where(and(eq(salesQuotes.tenantId, actor.tenantId), eq(salesQuotes.opportunityId, row.id))).orderBy(desc(salesQuotes.createdAt));
    return {
      opportunity: this.serializeOpportunity(row),
      activity: activity.map(item => ({ reference: item.publicReference, type: item.activityType, actorUserId: item.actorUserId ?? null, fromValue: item.fromValue ?? null, toValue: item.toValue ?? null, metadata: (item.metadata ?? {}) as Record<string, unknown>, createdAt: item.createdAt.toISOString() })),
      quotes: quotes.map(item => ({ ...item, validUntil: iso(item.validUntil), updatedAt: iso(item.updatedAt) })),
    };
  }

  async createOpportunity(actor: SalesActor, input: CreateSalesOpportunityInput) {
    this.require(actor, 'SALES_CREATE');
    const ownerUserId = input.ownerUserId ?? actor.userId;
    await this.ensureOwner(actor, ownerUserId);
    const client = await this.resolveClient(actor, input);
    const { pipeline, stage } = await this.pipelineAndStage(actor, input.pipelineReference, input.stageReference);
    const [tenant] = await this.db.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
    const [created] = await this.db.transaction(async tx => {
      const [row] = await tx.insert(salesOpportunities).values({
        tenantId: actor.tenantId, clientId: client.id, pipelineId: pipeline.id, stageId: stage.id,
        title: input.title, description: input.description ?? null, ownerUserId, source: input.source ?? null,
        estimatedValue: input.estimatedValue ?? null, currency: tenant?.currency ?? 'GBP', expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
        createdByUserId: actor.userId,
      }).returning();
      await tx.insert(salesOpportunityActivity).values({ tenantId: actor.tenantId, opportunityId: row.id, activityType: 'CREATED', actorUserId: actor.userId });
      await tx.insert(clientSalesProfiles).values({ tenantId: actor.tenantId, clientId: client.id, lifecycle: input.lead ? 'LEAD' : 'CUSTOMER', source: input.source ?? null, ownerUserId }).onConflictDoUpdate({ target: clientSalesProfiles.clientId, set: { source: input.source ?? undefined, ownerUserId, updatedAt: new Date() } });
      return [row];
    });
    return this.getOpportunity({ ...actor, permissions: [...new Set([...actor.permissions, 'SALES_VIEW_ALL'])] }, created.publicReference);
  }

  async updateOpportunity(actor: SalesActor, reference: string, input: UpdateSalesOpportunityInput) {
    const current = await this.opportunityRow(actor, reference);
    if (!this.canUpdate(actor, current.ownerUserId)) throw salesError(403, 'SALES_FORBIDDEN', 'You cannot update this opportunity.');
    if (input.ownerUserId !== undefined && input.ownerUserId !== null) await this.ensureOwner(actor, input.ownerUserId);
    await this.db.transaction(async tx => {
      await tx.update(salesOpportunities).set({
        title: input.title,
        description: input.description,
        ownerUserId: input.ownerUserId,
        source: input.source,
        estimatedValue: input.estimatedValue,
        expectedCloseDate: input.expectedCloseDate === undefined ? undefined : input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
        updatedAt: new Date(),
      }).where(and(eq(salesOpportunities.id, current.id), eq(salesOpportunities.tenantId, actor.tenantId)));
      const events: any[] = [];
      if (input.ownerUserId !== undefined && input.ownerUserId !== current.ownerUserId) events.push({ activityType: 'OWNER_CHANGED', fromValue: current.ownerUserId, toValue: input.ownerUserId });
      if (input.estimatedValue !== undefined && input.estimatedValue !== current.estimatedValue) events.push({ activityType: 'VALUE_CHANGED', fromValue: current.estimatedValue == null ? null : String(current.estimatedValue), toValue: input.estimatedValue == null ? null : String(input.estimatedValue) });
      if (events.length) await tx.insert(salesOpportunityActivity).values(events.map(event => ({ ...event, tenantId: actor.tenantId, opportunityId: current.id, actorUserId: actor.userId })));
      if (input.ownerUserId !== undefined) await tx.update(clientSalesProfiles).set({ ownerUserId: input.ownerUserId, updatedAt: new Date() }).where(and(eq(clientSalesProfiles.tenantId, actor.tenantId), eq(clientSalesProfiles.clientId, current.clientId)));
    });
    return this.getOpportunity(actor, reference);
  }

  async changeStage(actor: SalesActor, reference: string, input: ChangeSalesStageInput) {
    const current = await this.opportunityRow(actor, reference);
    if (!this.canUpdate(actor, current.ownerUserId)) throw salesError(403, 'SALES_FORBIDDEN', 'You cannot move this opportunity.');
    const [target] = await this.db.select().from(salesPipelineStages).where(and(
      eq(salesPipelineStages.tenantId, actor.tenantId), eq(salesPipelineStages.pipelineId, current.pipelineId), eq(salesPipelineStages.publicReference, input.stageReference), eq(salesPipelineStages.isActive, true),
    )).limit(1);
    if (!target) throw salesError(400, 'SALES_STAGE_INVALID', 'The selected stage does not belong to this opportunity pipeline.');
    if (target.category === 'LOST' && !input.reason?.trim()) throw salesError(400, 'SALES_LOSS_REASON_REQUIRED', 'Add a reason before marking an opportunity as lost.');
    if (target.id === current.stageId) return this.getOpportunity(actor, reference);
    const now = new Date();
    await this.db.transaction(async tx => {
      await tx.update(salesOpportunities).set({ stageId: target.id, closedAt: target.category === 'OPEN' ? null : now, closedReason: target.category === 'LOST' ? input.reason!.trim() : null, updatedAt: now }).where(and(eq(salesOpportunities.id, current.id), eq(salesOpportunities.tenantId, actor.tenantId)));
      await tx.insert(salesOpportunityActivity).values({ tenantId: actor.tenantId, opportunityId: current.id, activityType: 'STAGE_CHANGED', actorUserId: actor.userId, fromValue: current.stageName, toValue: target.name, metadata: { fromCategory: current.stageCategory, toCategory: target.category } });
      if (target.category === 'WON') {
        await tx.insert(salesOpportunityActivity).values({ tenantId: actor.tenantId, opportunityId: current.id, activityType: 'WON', actorUserId: actor.userId, toValue: target.name });
        await tx.insert(clientSalesProfiles).values({ tenantId: actor.tenantId, clientId: current.clientId, lifecycle: 'CUSTOMER', ownerUserId: current.ownerUserId }).onConflictDoUpdate({ target: clientSalesProfiles.clientId, set: { lifecycle: 'CUSTOMER', updatedAt: now } });
      }
      if (target.category === 'LOST') await tx.insert(salesOpportunityActivity).values({ tenantId: actor.tenantId, opportunityId: current.id, activityType: 'LOST', actorUserId: actor.userId, toValue: input.reason!.trim() });
    });
    return this.getOpportunity(actor, reference);
  }

  private async quoteInternal(tenantId: string, quoteReference: string) {
    const [quote] = await this.db.select().from(salesQuotes).where(and(eq(salesQuotes.tenantId, tenantId), eq(salesQuotes.publicReference, quoteReference))).limit(1);
    if (!quote) throw salesError(404, 'SALES_QUOTE_NOT_FOUND', 'Quote not found.');
    const items = await this.db.select().from(salesQuoteItems).where(and(eq(salesQuoteItems.tenantId, tenantId), eq(salesQuoteItems.quoteId, quote.id))).orderBy(asc(salesQuoteItems.position));
    return { quote, items };
  }

  private serializeQuote(quote: any, items: any[]) {
    return {
      reference: quote.publicReference,
      opportunityReference: quote.opportunityReference,
      clientId: quote.clientId,
      status: quote.status,
      quoteNumber: quote.quoteNumber,
      version: quote.version,
      title: quote.title,
      introduction: quote.introduction ?? null,
      terms: quote.terms ?? null,
      currency: quote.currency,
      subtotal: quote.subtotal,
      taxTotal: quote.taxTotal,
      total: quote.total,
      validUntil: iso(quote.validUntil),
      sentAt: iso(quote.sentAt),
      acceptedAt: iso(quote.acceptedAt),
      acceptedByName: quote.acceptedByName ?? null,
      acceptedByEmail: quote.acceptedByEmail ?? null,
      declinedAt: iso(quote.declinedAt),
      declinedReason: quote.declinedReason ?? null,
      voidedAt: iso(quote.voidedAt),
      createdAt: iso(quote.createdAt)!,
      updatedAt: iso(quote.updatedAt)!,
      items: items.map(item => ({ reference: item.publicReference, description: item.description, quantity: item.quantity, unitAmount: item.unitAmount, taxRateBasisPoints: item.taxRateBasisPoints, subtotal: item.subtotal, taxAmount: item.taxAmount, total: item.total, position: item.position })),
    };
  }

  async getQuote(actor: SalesActor, quoteReference: string) {
    this.require(actor, 'QUOTES_VIEW');
    const [row] = await this.db.select({ quote: salesQuotes, opportunityReference: salesOpportunities.publicReference, ownerUserId: salesOpportunities.ownerUserId }).from(salesQuotes).innerJoin(salesOpportunities, and(eq(salesOpportunities.id, salesQuotes.opportunityId), eq(salesOpportunities.tenantId, actor.tenantId))).where(and(eq(salesQuotes.tenantId, actor.tenantId), eq(salesQuotes.publicReference, quoteReference))).limit(1);
    if (!row || (actor.role !== 'owner' && !canViewAll(actor) && row.ownerUserId !== actor.userId)) throw salesError(404, 'SALES_QUOTE_NOT_FOUND', 'Quote not found.');
    const items = await this.db.select().from(salesQuoteItems).where(and(eq(salesQuoteItems.tenantId, actor.tenantId), eq(salesQuoteItems.quoteId, row.quote.id))).orderBy(asc(salesQuoteItems.position));
    return this.serializeQuote({ ...row.quote, opportunityReference: row.opportunityReference }, items);
  }

  async createQuote(actor: SalesActor, opportunityReference: string, input: CreateSalesQuoteInput) {
    this.require(actor, 'QUOTES_MANAGE');
    const opportunity = await this.opportunityRow(actor, opportunityReference);
    if (!this.canUpdate(actor, opportunity.ownerUserId) && actor.role !== 'owner') throw salesError(403, 'SALES_FORBIDDEN', 'You cannot create a quote for this opportunity.');
    const amounts = calculateItems(input.items);
    const publicReference = randomUUID();
    const quoteNumber = `Q-${new Date().getUTCFullYear()}-${publicReference.slice(0, 8).toUpperCase()}`;
    const [quote] = await this.db.transaction(async tx => {
      const [created] = await tx.insert(salesQuotes).values({
        publicReference, tenantId: actor.tenantId, opportunityId: opportunity.id, clientId: opportunity.clientId,
        status: 'DRAFT', quoteNumber, version: 1, title: input.title, introduction: input.introduction ?? null,
        terms: input.terms ?? null, currency: opportunity.currency, subtotal: amounts.subtotal, taxTotal: amounts.taxTotal, total: amounts.total,
        validUntil: input.validUntil ? new Date(input.validUntil) : null, createdByUserId: actor.userId,
      }).returning();
      await tx.insert(salesQuoteItems).values(amounts.rows.map(item => ({ tenantId: actor.tenantId, quoteId: created.id, ...item })));
      await tx.insert(salesOpportunityActivity).values({ tenantId: actor.tenantId, opportunityId: opportunity.id, activityType: 'QUOTE_CREATED', actorUserId: actor.userId, toValue: quoteNumber, metadata: { quoteReference: publicReference } });
      return [created];
    });
    return this.getQuote(actor, quote.publicReference);
  }

  async updateQuote(actor: SalesActor, quoteReference: string, input: UpdateSalesQuoteInput) {
    this.require(actor, 'QUOTES_MANAGE');
    const current = await this.getQuote(actor, quoteReference);
    if (current.status !== 'DRAFT') throw salesError(409, 'QUOTE_IMMUTABLE', 'Only draft quotes can be edited. Duplicate or create a revision instead.');
    const { quote } = await this.quoteInternal(actor.tenantId, quoteReference);
    const amounts = input.items ? calculateItems(input.items) : null;
    await this.db.transaction(async tx => {
      await tx.update(salesQuotes).set({
        title: input.title, introduction: input.introduction, terms: input.terms,
        validUntil: input.validUntil === undefined ? undefined : input.validUntil ? new Date(input.validUntil) : null,
        subtotal: amounts?.subtotal, taxTotal: amounts?.taxTotal, total: amounts?.total, updatedAt: new Date(),
      }).where(and(eq(salesQuotes.id, quote.id), eq(salesQuotes.tenantId, actor.tenantId), eq(salesQuotes.status, 'DRAFT')));
      if (amounts) {
        await tx.delete(salesQuoteItems).where(and(eq(salesQuoteItems.tenantId, actor.tenantId), eq(salesQuoteItems.quoteId, quote.id)));
        await tx.insert(salesQuoteItems).values(amounts.rows.map(item => ({ tenantId: actor.tenantId, quoteId: quote.id, ...item })));
      }
    });
    return this.getQuote(actor, quoteReference);
  }

  async shareQuote(actor: SalesActor, quoteReference: string) {
    this.require(actor, 'QUOTES_MANAGE');
    const current = await this.getQuote(actor, quoteReference);
    if (!['DRAFT', 'SENT'].includes(current.status)) throw salesError(409, 'QUOTE_NOT_SHAREABLE', 'Only draft or sent quotes can be shared.');
    const { quote } = await this.quoteInternal(actor.tenantId, quoteReference);
    const now = new Date();
    const validity = quote.validUntil && quote.validUntil > now ? quote.validUntil : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (quote.validUntil && quote.validUntil <= now) throw salesError(409, 'QUOTE_EXPIRED', 'Update the quote validity before sharing it.');
    const token = randomBytes(32).toString('base64url');
    await this.db.transaction(async tx => {
      if (quote.status === 'DRAFT') await tx.update(salesQuotes).set({ status: 'SENT', sentAt: now, updatedAt: now }).where(and(eq(salesQuotes.id, quote.id), eq(salesQuotes.tenantId, actor.tenantId), eq(salesQuotes.status, 'DRAFT')));
      await tx.insert(salesQuoteAccessTokens).values({ tenantId: actor.tenantId, quoteId: quote.id, tokenHash: hashToken(token), expiresAt: validity });
      await tx.insert(salesOpportunityActivity).values({ tenantId: actor.tenantId, opportunityId: quote.opportunityId, activityType: 'QUOTE_SENT', actorUserId: actor.userId, toValue: quote.quoteNumber, metadata: { quoteReference } });
    });
    return { quote: await this.getQuote(actor, quoteReference), publicPath: `/quote/${token}`, expiresAt: validity.toISOString() };
  }

  async voidQuote(actor: SalesActor, quoteReference: string) {
    this.require(actor, 'QUOTES_MANAGE');
    const current = await this.getQuote(actor, quoteReference);
    if (!['DRAFT', 'SENT'].includes(current.status)) throw salesError(409, 'QUOTE_NOT_VOIDABLE', 'Only draft or sent quotes can be voided.');
    const { quote } = await this.quoteInternal(actor.tenantId, quoteReference);
    const now = new Date();
    await this.db.transaction(async tx => {
      await tx.update(salesQuotes).set({ status: 'VOID', voidedAt: now, updatedAt: now }).where(and(eq(salesQuotes.id, quote.id), eq(salesQuotes.tenantId, actor.tenantId)));
      await tx.update(salesQuoteAccessTokens).set({ revokedAt: now }).where(and(eq(salesQuoteAccessTokens.tenantId, actor.tenantId), eq(salesQuoteAccessTokens.quoteId, quote.id), isNull(salesQuoteAccessTokens.revokedAt)));
    });
    return this.getQuote(actor, quoteReference);
  }

  private async publicQuoteToken(token: string) {
    const tokenHash = hashToken(token);
    const [record] = await this.db.select({ token: salesQuoteAccessTokens, quote: salesQuotes, opportunityReference: salesOpportunities.publicReference, pipelineId: salesOpportunities.pipelineId, opportunityId: salesOpportunities.id, client: clients, business: tenants }).from(salesQuoteAccessTokens)
      .innerJoin(salesQuotes, eq(salesQuotes.id, salesQuoteAccessTokens.quoteId))
      .innerJoin(salesOpportunities, eq(salesOpportunities.id, salesQuotes.opportunityId))
      .innerJoin(clients, eq(clients.id, salesQuotes.clientId))
      .innerJoin(tenants, eq(tenants.id, salesQuoteAccessTokens.tenantId))
      .where(and(eq(salesQuoteAccessTokens.tokenHash, tokenHash), isNull(salesQuoteAccessTokens.revokedAt), gt(salesQuoteAccessTokens.expiresAt, new Date()))).limit(1);
    if (!record) throw salesError(404, 'PUBLIC_QUOTE_NOT_FOUND', 'This quote link is invalid or has expired.');
    return record;
  }

  private async publicPayload(record: any) {
    const items = await this.db.select().from(salesQuoteItems).where(and(eq(salesQuoteItems.tenantId, record.quote.tenantId), eq(salesQuoteItems.quoteId, record.quote.id))).orderBy(asc(salesQuoteItems.position));
    return {
      business: { name: record.business.name, primaryColor: record.business.primaryColor, secondaryColor: record.business.secondaryColor, accentColor: record.business.accentColor },
      customer: { name: record.client.name, email: record.client.email ?? null },
      quote: this.serializeQuote({ ...record.quote, opportunityReference: record.opportunityReference }, items),
    };
  }

  async getPublicQuote(token: string) {
    const record = await this.publicQuoteToken(token);
    const now = new Date();
    if (record.quote.status === 'SENT' && record.quote.validUntil && record.quote.validUntil <= now) {
      await this.db.update(salesQuotes).set({ status: 'EXPIRED', updatedAt: now }).where(and(eq(salesQuotes.id, record.quote.id), eq(salesQuotes.status, 'SENT')));
      record.quote.status = 'EXPIRED';
      record.quote.updatedAt = now;
    }
    await this.db.update(salesQuoteAccessTokens).set({ lastViewedAt: now }).where(eq(salesQuoteAccessTokens.id, record.token.id));
    return this.publicPayload(record);
  }

  async acceptPublicQuote(token: string, input: AcceptPublicSalesQuoteInput) {
    const record = await this.publicQuoteToken(token);
    if (record.quote.status === 'ACCEPTED') return this.publicPayload(record);
    const now = new Date();
    if (record.quote.status !== 'SENT') throw salesError(409, 'QUOTE_NOT_ACCEPTABLE', 'This quote can no longer be accepted.');
    if (record.quote.validUntil && record.quote.validUntil <= now) {
      await this.db.update(salesQuotes).set({ status: 'EXPIRED', updatedAt: now }).where(eq(salesQuotes.id, record.quote.id));
      throw salesError(409, 'QUOTE_EXPIRED', 'This quote has expired.');
    }
    await this.db.transaction(async tx => {
      const [accepted] = await tx.update(salesQuotes).set({ status: 'ACCEPTED', acceptedAt: now, acceptedByName: input.name, acceptedByEmail: input.email ?? record.client.email ?? null, updatedAt: now }).where(and(eq(salesQuotes.id, record.quote.id), eq(salesQuotes.status, 'SENT'))).returning({ id: salesQuotes.id });
      if (!accepted) return;
      await tx.insert(clientSalesProfiles).values({ tenantId: record.quote.tenantId, clientId: record.quote.clientId, lifecycle: 'CUSTOMER' }).onConflictDoUpdate({ target: clientSalesProfiles.clientId, set: { lifecycle: 'CUSTOMER', updatedAt: now } });
      const [wonStage] = await tx.select().from(salesPipelineStages).where(and(eq(salesPipelineStages.tenantId, record.quote.tenantId), eq(salesPipelineStages.pipelineId, record.pipelineId), eq(salesPipelineStages.category, 'WON'), eq(salesPipelineStages.isActive, true))).orderBy(asc(salesPipelineStages.position)).limit(1);
      if (wonStage) await tx.update(salesOpportunities).set({ stageId: wonStage.id, closedAt: now, closedReason: null, updatedAt: now }).where(and(eq(salesOpportunities.id, record.opportunityId), eq(salesOpportunities.tenantId, record.quote.tenantId)));
      await tx.insert(salesOpportunityActivity).values([
        { tenantId: record.quote.tenantId, opportunityId: record.opportunityId, activityType: 'QUOTE_ACCEPTED', actorUserId: null, toValue: record.quote.quoteNumber, metadata: { quoteReference: record.quote.publicReference, acceptedByName: input.name } },
        ...(wonStage ? [{ tenantId: record.quote.tenantId, opportunityId: record.opportunityId, activityType: 'WON', actorUserId: null, toValue: wonStage.name, metadata: { source: 'QUOTE_ACCEPTED', quoteReference: record.quote.publicReference } }] : []),
      ] as any);
    });
    const refreshed = await this.publicQuoteToken(token);
    return this.publicPayload(refreshed);
  }

  async declinePublicQuote(token: string, input: DeclinePublicSalesQuoteInput) {
    const record = await this.publicQuoteToken(token);
    if (record.quote.status === 'DECLINED') return this.publicPayload(record);
    if (record.quote.status !== 'SENT') throw salesError(409, 'QUOTE_NOT_DECLINABLE', 'This quote can no longer be declined.');
    const now = new Date();
    await this.db.transaction(async tx => {
      const [declined] = await tx.update(salesQuotes).set({ status: 'DECLINED', declinedAt: now, declinedReason: input.reason ?? null, updatedAt: now }).where(and(eq(salesQuotes.id, record.quote.id), eq(salesQuotes.status, 'SENT'))).returning({ id: salesQuotes.id });
      if (declined) await tx.insert(salesOpportunityActivity).values({ tenantId: record.quote.tenantId, opportunityId: record.opportunityId, activityType: 'QUOTE_DECLINED', actorUserId: null, toValue: input.reason ?? null, metadata: { quoteReference: record.quote.publicReference } });
    });
    const refreshed = await this.publicQuoteToken(token);
    return this.publicPayload(refreshed);
  }
}
