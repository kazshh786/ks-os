import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import {
  clients,
  getDatabase,
  internalNotifications,
  salesOpportunities,
  salesPipelineStages,
  salesQuotes,
  taskActivity,
  tasks,
  tenants,
  users,
  workItemActivity,
  workItems,
  workTaskLinks,
} from '@ks-os/database';
import {
  defaultWorkTypeForBusinessType,
  type AssignWorkItemInput,
  type ChangeWorkStatusInput,
  type CreateWorkFromOpportunityInput,
  type CreateWorkItemInput,
  type CreateWorkTaskInput,
  type UpdateWorkItemInput,
  type WorkListQuery,
  type WorkStatus,
} from '@ks-os/contracts';

export type WorkActor = {
  tenantId: string;
  userId: string;
  role: 'owner' | 'staff';
  permissions: readonly string[];
};

const workError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const can = (actor: WorkActor, capability: string) => actor.role === 'owner' || actor.permissions.includes(capability);
const canViewAll = (actor: WorkActor) => can(actor, 'WORK_VIEW_ALL');
const canViewOwn = (actor: WorkActor) => can(actor, 'WORK_VIEW_OWN');
const terminal = (status: string) => status === 'COMPLETED' || status === 'CANCELLED';
const isOverdue = (status: string, dueAt: Date | string | null | undefined) => !terminal(status) && Boolean(dueAt && new Date(dueAt).getTime() < Date.now());

const allowedTransitions: Record<WorkStatus, readonly WorkStatus[]> = {
  DRAFT: ['READY', 'CANCELLED'],
  READY: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'COMPLETED', 'CANCELLED'],
  BLOCKED: ['READY', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['READY'],
  CANCELLED: ['READY'],
};

const selection = {
  id: workItems.id,
  reference: workItems.publicReference,
  tenantId: workItems.tenantId,
  referenceNumber: workItems.referenceNumber,
  clientId: workItems.clientId,
  workType: workItems.workType,
  status: workItems.status,
  priority: workItems.priority,
  title: workItems.title,
  description: workItems.description,
  assignedUserId: workItems.assignedUserId,
  sourceOpportunityId: workItems.sourceOpportunityId,
  sourceQuoteId: workItems.sourceQuoteId,
  scheduledStartAt: workItems.scheduledStartAt,
  scheduledEndAt: workItems.scheduledEndAt,
  dueAt: workItems.dueAt,
  locationLabel: workItems.locationLabel,
  startedAt: workItems.startedAt,
  completedAt: workItems.completedAt,
  cancelledAt: workItems.cancelledAt,
  blockedReason: workItems.blockedReason,
  createdAt: workItems.createdAt,
  updatedAt: workItems.updatedAt,
  clientName: clients.name,
  clientEmail: clients.email,
  clientPhone: clients.phone,
  assignedUserName: users.name,
  sourceOpportunityReference: salesOpportunities.publicReference,
  sourceQuoteReference: salesQuotes.publicReference,
};

export class WorkService {
  private db = getDatabase();

  private require(actor: WorkActor, capability: string) {
    if (!can(actor, capability)) throw workError(403, 'WORK_FORBIDDEN', 'You do not have permission to perform this work action.');
  }

  private requireView(actor: WorkActor) {
    if (actor.role !== 'owner' && !canViewAll(actor) && !canViewOwn(actor)) this.require(actor, 'WORK_VIEW_OWN');
  }

  private visibility(actor: WorkActor) {
    if (actor.role === 'owner' || canViewAll(actor)) return undefined;
    return eq(workItems.assignedUserId, actor.userId);
  }

  private canUpdate(actor: WorkActor, assignedUserId: string | null) {
    return actor.role === 'owner' || can(actor, 'WORK_UPDATE_ALL') || (can(actor, 'WORK_UPDATE_OWN') && assignedUserId === actor.userId);
  }

  private canComplete(actor: WorkActor, assignedUserId: string | null) {
    return actor.role === 'owner' || can(actor, 'WORK_COMPLETE_ALL') || (can(actor, 'WORK_COMPLETE_OWN') && assignedUserId === actor.userId);
  }

  private async assignee(actor: WorkActor, userId: string | null | undefined) {
    if (!userId) return null;
    const [row] = await this.db.select({ id: users.id, name: users.name }).from(users).where(and(
      eq(users.id, userId), eq(users.tenantId, actor.tenantId), eq(users.accountStatus, 'ACTIVE'),
    )).limit(1);
    if (!row) throw workError(400, 'WORK_ASSIGNEE_INVALID', 'Assignee must be an active member of this workspace.');
    return row;
  }

  private async client(actor: WorkActor, clientId: string | null | undefined) {
    if (!clientId) return null;
    const [row] = await this.db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.id, clientId), eq(clients.tenantId, actor.tenantId))).limit(1);
    if (!row) throw workError(400, 'WORK_CLIENT_INVALID', 'The selected customer does not belong to this workspace.');
    return row;
  }

  private baseQuery(actor: WorkActor, reference?: string) {
    const conditions: any[] = [eq(workItems.tenantId, actor.tenantId)];
    if (reference) conditions.push(eq(workItems.publicReference, reference));
    const visibility = this.visibility(actor);
    if (visibility) conditions.push(visibility);
    return this.db.select(selection).from(workItems)
      .leftJoin(clients, and(eq(clients.id, workItems.clientId), eq(clients.tenantId, actor.tenantId)))
      .leftJoin(users, and(eq(users.id, workItems.assignedUserId), eq(users.tenantId, actor.tenantId)))
      .leftJoin(salesOpportunities, and(eq(salesOpportunities.id, workItems.sourceOpportunityId), eq(salesOpportunities.tenantId, actor.tenantId)))
      .leftJoin(salesQuotes, and(eq(salesQuotes.id, workItems.sourceQuoteId), eq(salesQuotes.tenantId, actor.tenantId)))
      .where(and(...conditions));
  }

  private serialize(row: any) {
    return {
      reference: row.reference,
      referenceNumber: row.referenceNumber,
      title: row.title,
      description: row.description ?? null,
      workType: row.workType,
      status: row.status,
      priority: row.priority,
      client: row.clientId ? { id: row.clientId, name: row.clientName ?? 'Customer', email: row.clientEmail ?? null, phone: row.clientPhone ?? null } : null,
      assignedUser: row.assignedUserId ? { id: row.assignedUserId, name: row.assignedUserName ?? 'Team member' } : null,
      sourceOpportunityReference: row.sourceOpportunityReference ?? null,
      sourceQuoteReference: row.sourceQuoteReference ?? null,
      scheduledStartAt: iso(row.scheduledStartAt),
      scheduledEndAt: iso(row.scheduledEndAt),
      dueAt: iso(row.dueAt),
      locationLabel: row.locationLabel ?? null,
      startedAt: iso(row.startedAt),
      completedAt: iso(row.completedAt),
      cancelledAt: iso(row.cancelledAt),
      blockedReason: row.blockedReason ?? null,
      overdue: isOverdue(row.status, row.dueAt),
      createdAt: iso(row.createdAt)!,
      updatedAt: iso(row.updatedAt)!,
    };
  }

  private async row(actor: WorkActor, reference: string) {
    this.requireView(actor);
    const [row] = await this.baseQuery(actor, reference).limit(1);
    if (!row) throw workError(404, 'WORK_NOT_FOUND', 'Work item not found.');
    return row;
  }

  async list(actor: WorkActor, query: WorkListQuery) {
    this.requireView(actor);
    const conditions: any[] = [eq(workItems.tenantId, actor.tenantId)];
    const visibility = this.visibility(actor);
    if (visibility) conditions.push(visibility);
    if (query.status) conditions.push(eq(workItems.status, query.status));
    if (query.workType) conditions.push(eq(workItems.workType, query.workType));
    if (query.assignedTo) conditions.push(eq(workItems.assignedUserId, query.assignedTo === 'me' ? actor.userId : query.assignedTo));
    if (query.clientId) conditions.push(eq(workItems.clientId, query.clientId));
    if (query.overdue !== undefined) conditions.push(query.overdue
      ? and(sql`${workItems.status} NOT IN ('COMPLETED','CANCELLED')`, lt(workItems.dueAt, new Date()))
      : or(sql`${workItems.dueAt} IS NULL`, sql`${workItems.dueAt} >= now()`, inArray(workItems.status, ['COMPLETED', 'CANCELLED'])));
    if (query.search) {
      const term = query.search.toLowerCase();
      conditions.push(or(
        sql`strpos(lower(${workItems.title}), ${term}) > 0`,
        sql`strpos(lower(coalesce(${clients.name}, '')), ${term}) > 0`,
        sql`strpos(lower(${workItems.referenceNumber}), ${term}) > 0`,
      ));
    }
    const rows = await this.db.select(selection).from(workItems)
      .leftJoin(clients, and(eq(clients.id, workItems.clientId), eq(clients.tenantId, actor.tenantId)))
      .leftJoin(users, and(eq(users.id, workItems.assignedUserId), eq(users.tenantId, actor.tenantId)))
      .leftJoin(salesOpportunities, and(eq(salesOpportunities.id, workItems.sourceOpportunityId), eq(salesOpportunities.tenantId, actor.tenantId)))
      .leftJoin(salesQuotes, and(eq(salesQuotes.id, workItems.sourceQuoteId), eq(salesQuotes.tenantId, actor.tenantId)))
      .where(and(...conditions)).orderBy(desc(workItems.updatedAt)).limit(query.limit);
    return rows.map(row => this.serialize(row));
  }

  async summary(actor: WorkActor) {
    this.requireView(actor);
    const conditions: any[] = [eq(workItems.tenantId, actor.tenantId)];
    const visibility = this.visibility(actor);
    if (visibility) conditions.push(visibility);
    const [row] = await this.db.select({
      openCount: sql<number>`count(*) filter (where ${workItems.status} not in ('COMPLETED','CANCELLED'))::int`,
      inProgressCount: sql<number>`count(*) filter (where ${workItems.status} = 'IN_PROGRESS')::int`,
      blockedCount: sql<number>`count(*) filter (where ${workItems.status} = 'BLOCKED')::int`,
      overdueCount: sql<number>`count(*) filter (where ${workItems.status} not in ('COMPLETED','CANCELLED') and ${workItems.dueAt} < now())::int`,
      completedCount: sql<number>`count(*) filter (where ${workItems.status} = 'COMPLETED')::int`,
    }).from(workItems).where(and(...conditions));
    return {
      openCount: row?.openCount ?? 0,
      inProgressCount: row?.inProgressCount ?? 0,
      blockedCount: row?.blockedCount ?? 0,
      overdueCount: row?.overdueCount ?? 0,
      completedCount: row?.completedCount ?? 0,
    };
  }

  async get(actor: WorkActor, reference: string) {
    const row = await this.row(actor, reference);
    const activity = await this.db.select().from(workItemActivity).where(and(eq(workItemActivity.tenantId, actor.tenantId), eq(workItemActivity.workItemId, row.id))).orderBy(desc(workItemActivity.createdAt));
    const maySeeAllTasks = actor.role === 'owner' || can(actor, 'TASKS_VIEW_ALL');
    const maySeeOwnTasks = maySeeAllTasks || can(actor, 'TASKS_VIEW_OWN');
    const taskConditions: any[] = [eq(tasks.tenantId, actor.tenantId), eq(tasks.sourceType, 'WORK_ITEM'), eq(tasks.sourceId, row.id)];
    if (!maySeeAllTasks) taskConditions.push(maySeeOwnTasks ? eq(tasks.assignedUserId, actor.userId) : sql`false`);
    const linkedTasks = await this.db.select({
      id: tasks.id, title: tasks.title, status: tasks.status, priority: tasks.priority, dueAt: tasks.dueAt,
      assignedUserId: tasks.assignedUserId, assignedUserName: users.name, createdAt: tasks.createdAt, updatedAt: tasks.updatedAt,
    }).from(tasks).leftJoin(users, and(eq(users.id, tasks.assignedUserId), eq(users.tenantId, actor.tenantId))).where(and(...taskConditions)).orderBy(asc(tasks.dueAt), desc(tasks.createdAt));
    return {
      work: this.serialize(row),
      activity: activity.map(item => ({
        reference: item.publicReference,
        type: item.activityType,
        actorUserId: item.actorUserId ?? null,
        fromValue: item.fromValue ?? null,
        toValue: item.toValue ?? null,
        metadata: (item.metadata ?? {}) as Record<string, unknown>,
        createdAt: item.createdAt.toISOString(),
      })),
      tasks: linkedTasks.map(item => ({
        id: item.id,
        title: item.title,
        status: item.status,
        priority: item.priority,
        assignedUser: item.assignedUserId ? { id: item.assignedUserId, name: item.assignedUserName ?? 'Team member' } : null,
        dueAt: iso(item.dueAt),
        overdue: isOverdue(item.status, item.dueAt),
        createdAt: iso(item.createdAt)!,
        updatedAt: iso(item.updatedAt)!,
      })),
    };
  }

  async create(actor: WorkActor, input: CreateWorkItemInput) {
    this.require(actor, 'WORK_CREATE');
    await this.client(actor, input.clientId);
    let assignedUserId = input.assignedUserId ?? null;
    if (actor.role !== 'owner' && !can(actor, 'WORK_ASSIGN')) assignedUserId = actor.userId;
    if (assignedUserId && assignedUserId !== actor.userId && !can(actor, 'WORK_ASSIGN')) this.require(actor, 'WORK_ASSIGN');
    await this.assignee(actor, assignedUserId);
    const [tenant] = await this.db.select({ businessType: tenants.businessType }).from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
    const publicReference = randomUUID();
    const referenceNumber = `W-${new Date().getUTCFullYear()}-${publicReference.slice(0, 8).toUpperCase()}`;
    const [created] = await this.db.transaction(async tx => {
      const [work] = await tx.insert(workItems).values({
        publicReference,
        tenantId: actor.tenantId,
        referenceNumber,
        clientId: input.clientId ?? null,
        workType: input.workType ?? defaultWorkTypeForBusinessType(tenant?.businessType),
        status: 'DRAFT',
        priority: input.priority,
        title: input.title,
        description: input.description ?? null,
        assignedUserId,
        scheduledStartAt: input.scheduledStartAt ? new Date(input.scheduledStartAt) : null,
        scheduledEndAt: input.scheduledEndAt ? new Date(input.scheduledEndAt) : null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        locationLabel: input.locationLabel ?? null,
        createdByUserId: actor.userId,
      }).returning();
      await tx.insert(workItemActivity).values([
        { tenantId: actor.tenantId, workItemId: work.id, activityType: 'CREATED', actorUserId: actor.userId },
        ...(assignedUserId ? [{ tenantId: actor.tenantId, workItemId: work.id, activityType: 'ASSIGNED', actorUserId: actor.userId, toValue: assignedUserId }] : []),
      ] as any);
      return [work];
    });
    return this.get({ ...actor, permissions: [...new Set([...actor.permissions, 'WORK_VIEW_ALL'])] }, created.publicReference);
  }

  async createFromOpportunity(actor: WorkActor, opportunityReference: string, input: CreateWorkFromOpportunityInput) {
    this.require(actor, 'WORK_CREATE');
    const [opportunity] = await this.db.select({
      id: salesOpportunities.id,
      publicReference: salesOpportunities.publicReference,
      clientId: salesOpportunities.clientId,
      title: salesOpportunities.title,
      description: salesOpportunities.description,
      ownerUserId: salesOpportunities.ownerUserId,
      stageCategory: salesPipelineStages.category,
    }).from(salesOpportunities)
      .innerJoin(salesPipelineStages, and(eq(salesPipelineStages.id, salesOpportunities.stageId), eq(salesPipelineStages.tenantId, actor.tenantId)))
      .where(and(eq(salesOpportunities.tenantId, actor.tenantId), eq(salesOpportunities.publicReference, opportunityReference))).limit(1);
    if (!opportunity) throw workError(404, 'SALES_OPPORTUNITY_NOT_FOUND', 'Opportunity not found.');
    const canSeeSale = actor.role === 'owner' || can(actor, 'SALES_VIEW_ALL') || (can(actor, 'SALES_VIEW_OWN') && opportunity.ownerUserId === actor.userId);
    if (!canSeeSale) throw workError(404, 'SALES_OPPORTUNITY_NOT_FOUND', 'Opportunity not found.');
    if (opportunity.stageCategory !== 'WON') throw workError(409, 'WORK_SALE_NOT_WON', 'Only won opportunities can be converted into work.');

    const [existing] = await this.db.select({ reference: workItems.publicReference, assignedUserId: workItems.assignedUserId }).from(workItems).where(and(eq(workItems.tenantId, actor.tenantId), eq(workItems.sourceOpportunityId, opportunity.id))).limit(1);
    if (existing) {
      if (actor.role === 'owner' || canViewAll(actor) || existing.assignedUserId === actor.userId) return this.get(actor, existing.reference);
      throw workError(409, 'WORK_ALREADY_CREATED', 'This won opportunity has already been converted into work.');
    }

    let assignedUserId = input.assignedUserId === undefined ? opportunity.ownerUserId : input.assignedUserId;
    if (actor.role !== 'owner' && !can(actor, 'WORK_ASSIGN')) assignedUserId = actor.userId;
    if (assignedUserId && assignedUserId !== actor.userId && !can(actor, 'WORK_ASSIGN')) this.require(actor, 'WORK_ASSIGN');
    await this.assignee(actor, assignedUserId);
    const [tenant] = await this.db.select({ businessType: tenants.businessType }).from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
    const [acceptedQuote] = await this.db.select({ id: salesQuotes.id, publicReference: salesQuotes.publicReference }).from(salesQuotes).where(and(
      eq(salesQuotes.tenantId, actor.tenantId), eq(salesQuotes.opportunityId, opportunity.id), eq(salesQuotes.status, 'ACCEPTED'),
    )).orderBy(desc(salesQuotes.acceptedAt)).limit(1);
    const publicReference = randomUUID();
    const referenceNumber = `W-${new Date().getUTCFullYear()}-${publicReference.slice(0, 8).toUpperCase()}`;
    const [created] = await this.db.transaction(async tx => {
      const [work] = await tx.insert(workItems).values({
        publicReference,
        tenantId: actor.tenantId,
        referenceNumber,
        clientId: opportunity.clientId,
        workType: input.workType ?? defaultWorkTypeForBusinessType(tenant?.businessType),
        status: 'READY',
        priority: input.priority,
        title: input.title ?? opportunity.title,
        description: input.description === undefined ? opportunity.description : input.description,
        assignedUserId,
        sourceOpportunityId: opportunity.id,
        sourceQuoteId: acceptedQuote?.id ?? null,
        scheduledStartAt: input.scheduledStartAt ? new Date(input.scheduledStartAt) : null,
        scheduledEndAt: input.scheduledEndAt ? new Date(input.scheduledEndAt) : null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        locationLabel: input.locationLabel ?? null,
        createdByUserId: actor.userId,
      }).returning();
      await tx.insert(workItemActivity).values([
        { tenantId: actor.tenantId, workItemId: work.id, activityType: 'CREATED', actorUserId: actor.userId },
        { tenantId: actor.tenantId, workItemId: work.id, activityType: 'CONVERTED_FROM_SALE', actorUserId: actor.userId, toValue: opportunity.publicReference, metadata: { opportunityReference: opportunity.publicReference, quoteReference: acceptedQuote?.publicReference ?? null } },
        ...(assignedUserId ? [{ tenantId: actor.tenantId, workItemId: work.id, activityType: 'ASSIGNED', actorUserId: actor.userId, toValue: assignedUserId }] : []),
      ] as any);
      return [work];
    });
    return this.get({ ...actor, permissions: [...new Set([...actor.permissions, 'WORK_VIEW_ALL'])] }, created.publicReference);
  }

  async update(actor: WorkActor, reference: string, input: UpdateWorkItemInput) {
    const current = await this.row(actor, reference);
    if (!this.canUpdate(actor, current.assignedUserId)) throw workError(403, 'WORK_FORBIDDEN', 'You cannot update this work item.');
    if (terminal(current.status)) throw workError(409, 'WORK_NOT_EDITABLE', 'Completed or cancelled work must be reopened before editing.');
    const nextStart = input.scheduledStartAt === undefined ? current.scheduledStartAt : input.scheduledStartAt ? new Date(input.scheduledStartAt) : null;
    const nextEnd = input.scheduledEndAt === undefined ? current.scheduledEndAt : input.scheduledEndAt ? new Date(input.scheduledEndAt) : null;
    if (nextStart && nextEnd && nextEnd < nextStart) throw workError(400, 'WORK_SCHEDULE_INVALID', 'Scheduled end must be after scheduled start.');
    await this.db.transaction(async tx => {
      await tx.update(workItems).set({
        title: input.title,
        description: input.description,
        priority: input.priority,
        scheduledStartAt: input.scheduledStartAt === undefined ? undefined : nextStart,
        scheduledEndAt: input.scheduledEndAt === undefined ? undefined : nextEnd,
        dueAt: input.dueAt === undefined ? undefined : input.dueAt ? new Date(input.dueAt) : null,
        locationLabel: input.locationLabel,
        updatedAt: new Date(),
      }).where(and(eq(workItems.id, current.id), eq(workItems.tenantId, actor.tenantId)));
      const events: any[] = [];
      if (input.priority && input.priority !== current.priority) events.push({ activityType: 'PRIORITY_CHANGED', fromValue: current.priority, toValue: input.priority });
      if (input.dueAt !== undefined && input.dueAt !== iso(current.dueAt)) events.push({ activityType: 'DUE_DATE_CHANGED', fromValue: iso(current.dueAt), toValue: input.dueAt });
      if (input.scheduledStartAt !== undefined || input.scheduledEndAt !== undefined) events.push({ activityType: 'SCHEDULE_CHANGED', fromValue: `${iso(current.scheduledStartAt) ?? ''}|${iso(current.scheduledEndAt) ?? ''}`, toValue: `${iso(nextStart) ?? ''}|${iso(nextEnd) ?? ''}` });
      if (events.length) await tx.insert(workItemActivity).values(events.map(event => ({ ...event, tenantId: actor.tenantId, workItemId: current.id, actorUserId: actor.userId })));
    });
    return this.get(actor, reference);
  }

  async assign(actor: WorkActor, reference: string, input: AssignWorkItemInput) {
    this.require(actor, 'WORK_ASSIGN');
    const current = await this.row({ ...actor, permissions: [...new Set([...actor.permissions, 'WORK_VIEW_ALL'])] }, reference);
    if (terminal(current.status)) throw workError(409, 'WORK_NOT_ACTIONABLE', 'Completed or cancelled work cannot be assigned until reopened.');
    await this.assignee(actor, input.assignedUserId);
    if (current.assignedUserId === input.assignedUserId) return this.get(actor, reference);
    await this.db.transaction(async tx => {
      await tx.update(workItems).set({ assignedUserId: input.assignedUserId, updatedAt: new Date() }).where(and(eq(workItems.id, current.id), eq(workItems.tenantId, actor.tenantId)));
      await tx.insert(workItemActivity).values({ tenantId: actor.tenantId, workItemId: current.id, activityType: current.assignedUserId ? 'REASSIGNED' : 'ASSIGNED', actorUserId: actor.userId, fromValue: current.assignedUserId, toValue: input.assignedUserId });
    });
    return this.get({ ...actor, permissions: [...new Set([...actor.permissions, 'WORK_VIEW_ALL'])] }, reference);
  }

  async changeStatus(actor: WorkActor, reference: string, input: ChangeWorkStatusInput) {
    const current = await this.row(actor, reference);
    const completing = input.status === 'COMPLETED' || (current.status === 'COMPLETED' && input.status === 'READY');
    if (completing ? !this.canComplete(actor, current.assignedUserId) : !this.canUpdate(actor, current.assignedUserId)) throw workError(403, 'WORK_FORBIDDEN', 'You cannot change this work status.');
    if (current.status === input.status) return this.get(actor, reference);
    if (!allowedTransitions[current.status as WorkStatus]?.includes(input.status)) throw workError(409, 'WORK_INVALID_TRANSITION', `Work cannot move from ${current.status} to ${input.status}.`);
    if ((input.status === 'BLOCKED' || input.status === 'CANCELLED') && !input.reason?.trim()) throw workError(400, 'WORK_REASON_REQUIRED', 'Add a reason for this status change.');
    const now = new Date();
    const activityType = input.status === 'COMPLETED' ? 'COMPLETED' : input.status === 'CANCELLED' ? 'CANCELLED' : (current.status === 'COMPLETED' || current.status === 'CANCELLED') && input.status === 'READY' ? 'REOPENED' : 'STATUS_CHANGED';
    await this.db.transaction(async tx => {
      const [changed] = await tx.update(workItems).set({
        status: input.status,
        startedAt: input.status === 'IN_PROGRESS' && !current.startedAt ? now : current.startedAt,
        completedAt: input.status === 'COMPLETED' ? now : input.status === 'READY' && current.status === 'COMPLETED' ? null : current.completedAt,
        cancelledAt: input.status === 'CANCELLED' ? now : input.status === 'READY' && current.status === 'CANCELLED' ? null : current.cancelledAt,
        blockedReason: input.status === 'BLOCKED' ? input.reason!.trim() : null,
        updatedAt: now,
      }).where(and(eq(workItems.id, current.id), eq(workItems.tenantId, actor.tenantId), eq(workItems.status, current.status))).returning({ id: workItems.id });
      if (!changed) throw workError(409, 'WORK_CONCURRENT_UPDATE', 'The work item changed while this action was running.');
      await tx.insert(workItemActivity).values({
        tenantId: actor.tenantId, workItemId: current.id, activityType, actorUserId: actor.userId,
        fromValue: current.status, toValue: input.status, metadata: input.reason ? { reason: input.reason.trim() } : {},
      });
    });
    return this.get(actor, reference);
  }

  async createTask(actor: WorkActor, reference: string, input: CreateWorkTaskInput) {
    this.require(actor, 'TASKS_CREATE');
    const current = await this.row(actor, reference);
    if (!this.canUpdate(actor, current.assignedUserId) && actor.role !== 'owner') throw workError(403, 'WORK_FORBIDDEN', 'You cannot add tasks to this work item.');
    let assignedUserId = input.assignedUserId ?? actor.userId;
    if (assignedUserId !== actor.userId && !can(actor, 'TASKS_ASSIGN')) this.require(actor, 'TASKS_ASSIGN');
    await this.assignee(actor, assignedUserId);
    const created = await this.db.transaction(async tx => {
      const [task] = await tx.insert(tasks).values({
        tenantId: actor.tenantId,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        status: 'OPEN',
        assignedUserId,
        createdByUserId: actor.userId,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        sourceType: 'WORK_ITEM',
        sourceId: current.id,
        clientId: current.clientId,
      }).returning();
      await tx.insert(workTaskLinks).values({ tenantId: actor.tenantId, workItemId: current.id, taskId: task.id });
      await tx.insert(taskActivity).values([
        { tenantId: actor.tenantId, taskId: task.id, activityType: 'CREATED', actorUserId: actor.userId },
        ...(assignedUserId ? [{ tenantId: actor.tenantId, taskId: task.id, activityType: 'ASSIGNED', actorUserId: actor.userId, toValue: assignedUserId }] : []),
      ] as any);
      await tx.insert(workItemActivity).values({ tenantId: actor.tenantId, workItemId: current.id, activityType: 'TASK_CREATED', actorUserId: actor.userId, toValue: task.id, metadata: { taskTitle: task.title } });
      if (assignedUserId) await tx.insert(internalNotifications).values({ tenantId: actor.tenantId, recipientUserId: assignedUserId, type: 'TASK_ASSIGNED', title: 'Task assigned', message: task.title, sourceType: 'task', sourceId: task.id });
      return task;
    });
    return { taskId: created.id, work: await this.get(actor, reference) };
  }
}
