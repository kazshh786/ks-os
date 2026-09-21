import { sql } from 'drizzle-orm';
import {
  canUseProfileModule, resolveBusinessProfile, CustomerOverviewSchema, CustomerNowItemSchema,
  type CustomerAction, type CustomerOverview, type CustomerTimelineQuery,
} from '@ks-os/contracts';
import { can, customerAdapters, type CustomerActor } from './customer-360.adapters.js';
import { Customer360Repository } from './customer-360.repository.js';
import { attentionFor, type CurrentRow } from './customer-attention.service.js';
import { customerTimeline } from './customer-timeline.service.js';

export const customerError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode, code: statusCode === 404 ? 'CUSTOMER_NOT_FOUND' : 'CUSTOMER_FORBIDDEN' });
const iso = (v: Date | string) => new Date(v).toISOString();
export class Customer360Service {
  constructor(readonly repo = new Customer360Repository(), private readonly report: (source: string) => void = () => {}, private readonly requestId = 'unavailable', private readonly clock = () => new Date()) {}
  async context(actor: CustomerActor, reference: string) {
    if (!can(actor, 'CLIENTS_VIEW_BASIC')) throw customerError(403, 'You cannot view customers.');
    const customer = await this.repo.identity(actor, reference);
    if (!customer) throw customerError(404, 'Customer not found.');
    const profile = resolveBusinessProfile(customer.businessType, customer.businessProfile);
    if (!canUseProfileModule(profile, 'crm', actor)) throw customerError(403, 'Customers are not enabled for this workspace.');
    const now = this.clock();
    return { customer, profile, now, adapters: customerAdapters({ actor, clientId: customer.id, profile, now }) };
  }
  private failure(source: CustomerOverview['sources'][number]) {
    this.report(source);
    return { source, code: 'CUSTOMER_SOURCE_UNAVAILABLE' as const, message: 'This part of the relationship could not be loaded. Please retry.', requestId: this.requestId.slice(0, 100) };
  }
  async timeline(actor: CustomerActor, reference: string, query: CustomerTimelineQuery) {
    const c = await this.context(actor, reference);
    return customerTimeline(this.repo, c.adapters, { reference: c.customer.reference, since: iso(c.customer.since) }, query, c.now, source => this.failure(source));
  }
  async overview(actor: CustomerActor, reference: string): Promise<CustomerOverview> {
    const c = await this.context(actor, reference);
    const diagnostics: CustomerOverview['diagnostics'] = [];
    const partsPromise = Promise.all(c.adapters.map(async adapter => {
      try {
        const [rows, metrics] = await Promise.all([
          this.repo.query<CurrentRow>(sql`select * from (${adapter.current}) n order by
            case when status in ('BLOCKED','FAILED') then 0 when due_at < ${c.now.toISOString()}::timestamptz then 1 else 2 end,
            due_at asc nulls last, occurred_at desc,reference desc limit 21`),
          adapter.metrics ? this.repo.query<{ key: string; label: string; value: string; currency: string | null }>(adapter.metrics) : Promise.resolve([]),
        ]);
        return { source: adapter.source, rows: rows.slice(0, 20), more: rows.length > 20, metrics };
      } catch { diagnostics.push(this.failure(adapter.source)); return { source: adapter.source, rows: [], more: false, metrics: [] }; }
    }));
    const timelinePromise = customerTimeline(this.repo, c.adapters, { reference: c.customer.reference, since: iso(c.customer.since) }, { limit: 20, importantOnly: false }, c.now, source => this.failure(source));
    const salesIdentity = c.adapters.some(a => a.source === 'sales') ? this.repo.salesIdentity(actor, c.customer.id).catch(() => { diagnostics.push(this.failure('sales')); return undefined; }) : Promise.resolve(undefined);
    const [parts, timeline, sales] = await Promise.all([partsPromise, timelinePromise, salesIdentity]);
    const nowItems: CustomerOverview['now'] = [];
    const attention: CustomerOverview['attention'] = [];
    for (const part of parts) for (const row of part.rows) {
      const item = CustomerNowItemSchema.parse({ key: `${part.source}:${row.reference}`, source: part.source, type: row.type, reference: row.reference,
        ...(row.related_sale ? { relatedSale: row.related_sale } : {}),
        title: row.title, subtitle: row.status.toLowerCase().replaceAll('_', ' '), status: row.status, occurredAt: iso(row.occurred_at), dueAt: row.due_at ? iso(row.due_at) : null,
        owner: row.owner, amount: row.amount, currency: row.currency, attentionLevel: 'INFO',
        action: row.route ? { key: `view-${row.reference}`, label: 'View details', kind: 'LINK', route: row.route, source: part.source, reference: row.reference, reason: 'Open the source record.' } : null });
      const signal = attentionFor(item, actor.readOnly ? { ...row, can_update: false, sales_can_update: false, conversion_reference: null } : row, c.now);
      if (signal) { item.attentionLevel = signal.severity; attention.push(signal); }
      nowItems.push(item);
    }
    const rank = { IMPORTANT: 0, ATTENTION: 1, INFO: 2 };
    const appointmentFirst = ['appointments','classes'].includes(c.profile.recommendedOperatingModel);
    nowItems.sort((a,b) => rank[a.attentionLevel]-rank[b.attentionLevel] || Number(appointmentFirst && b.source === 'bookings')-Number(appointmentFirst && a.source === 'bookings') || (a.dueAt ?? 'z').localeCompare(b.dueAt ?? 'z') || a.key.localeCompare(b.key));
    attention.sort((a,b) => rank[a.severity]-rank[b.severity] || a.key.localeCompare(b.key));
    const actions = this.actions(actor, c);
    const uniqueDiagnostics = [...new Map(diagnostics.map(d => [d.source,d])).values()];
    return CustomerOverviewSchema.parse({ customer: { reference: c.customer.reference, name: c.customer.name, email: c.customer.email, phone: c.customer.phone,
      since: iso(c.customer.since), terminology: c.profile.terminology.customer, workLabel: c.profile.terminology.work,
      lifecycle: sales?.lifecycle ?? null, owner: sales?.owner ?? null }, sources: ['crm', ...c.adapters.map(a => a.source)], now: nowItems.slice(0,100),
      attention: [...new Map(attention.map(item => [item.action?.kind === 'CONVERT_WORK' ? item.action.key : item.key, item])).values()].slice(0,100), actions, summary: parts.flatMap(p => p.metrics.map(m => ({ ...m, value: Number(m.value) }))),
      nowHasMore: nowItems.length > 100 || parts.some(p => p.more), diagnostics: uniqueDiagnostics, timeline });
  }
  actions(actor: CustomerActor, c: Awaited<ReturnType<Customer360Service['context']>>): CustomerAction[] {
    if (actor.readOnly) return [];
    const actions: CustomerAction[] = [];
    if (canUseProfileModule(c.profile, 'bookings', actor) && can(actor, 'BOOKINGS_CREATE')) actions.push({ key: 'CREATE_BOOKING', kind: 'LINK', label: 'Create booking', source: 'bookings', reference: c.customer.reference, route: `/app/bookings?create=1&clientReference=${c.customer.reference}`, reason: 'Schedule an appointment with this customer’s details prefilled.' });
    const add = (source: 'tasks' | 'work' | 'sales', capability: string, kind: CustomerAction['kind'], label: string) => {
      if (canUseProfileModule(c.profile, source, actor) && can(actor, capability)) actions.push({ key: kind, kind, label, source, reference: c.customer.reference, route: null, reason: `Create a linked record for ${c.customer.name}.` });
    };
    add('sales', 'SALES_CREATE', 'CREATE_OPPORTUNITY', 'Create opportunity');
    add('work', 'WORK_CREATE', 'CREATE_WORK', `Create ${c.profile.terminology.work.toLowerCase()}`);
    add('tasks', 'TASKS_CREATE', 'ADD_TASK', 'Add task');
    if (actor.role === 'owner') actions.push({ key: 'PROFILE_DETAILS', kind: 'LINK', label: 'View profile details', source: 'crm', reference: c.customer.reference, route: `/app/clients/${c.customer.reference}/details`, reason: 'Open the existing owner profile, including governed salon care details where configured.' });
    return actions;
  }
}
