import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { CustomerTimelineEntrySchema, type CustomerTimelineEntry, type CustomerTimelineQuery, type CustomerTimelinePage } from '@ks-os/contracts';
import type { CustomerAdapter } from './customer-360.adapters.js';
import type { Customer360Repository } from './customer-360.repository.js';

const CursorSchema = z.object({ version: z.literal(1), customer: z.string().uuid(), filter: z.string().max(50), snapshot: z.string().datetime(), at: z.string().datetime(), key: z.string().max(150) }).strict();
const filterKey = (q: CustomerTimelineQuery) => `${q.source ?? 'all'}:${q.importantOnly}`;
export function readCursor(q: CustomerTimelineQuery, customer: string, now: Date) {
  if (!q.cursor) return { version: 1 as const, customer, filter: filterKey(q), snapshot: now.toISOString(), at: now.toISOString(), key: '~' };
  try {
    const cursor = CursorSchema.parse(JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8')));
    if (cursor.customer !== customer || cursor.filter !== filterKey(q) || cursor.at > cursor.snapshot || Date.parse(cursor.snapshot) > now.getTime()) throw new Error();
    return cursor;
  } catch { throw Object.assign(new Error('The timeline cursor is invalid. Refresh the timeline.'), { statusCode: 400, code: 'CUSTOMER_CURSOR_INVALID' }); }
}
export const compareEvents = (a: CustomerTimelineEntry, b: CustomerTimelineEntry) => b.occurredAt.localeCompare(a.occurredAt) || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0);
export async function customerTimeline(repo: Customer360Repository, adapters: CustomerAdapter[], customer: { reference: string; since: string }, q: CustomerTimelineQuery, now: Date,
  onFailure: (source: CustomerAdapter['source']) => CustomerTimelinePage['diagnostics'][number]): Promise<CustomerTimelinePage> {
  const cursor = readCursor(q, customer.reference, now);
  const diagnostics: CustomerTimelinePage['diagnostics'] = [];
  const groups = await Promise.all(adapters.filter(a => !q.source || q.source === a.source).map(async adapter => {
    try {
      const rows = await repo.query<{ reference: string; type: string; title: string; occurred_at: Date; important: boolean; event_key: string; route: string | null }>(sql`
        select * from (select reference,type,title,date_trunc('milliseconds',occurred_at) as occurred_at,important,
          ${adapter.source + ':'} || event_key as event_key,route from (${adapter.timeline}) events) e
        where occurred_at <= ${cursor.snapshot}::timestamptz
          and (occurred_at,event_key collate "C") < (${cursor.at}::timestamptz,${cursor.key} collate "C")
          and (${!q.importantOnly} or important)
        order by occurred_at desc,event_key collate "C" desc limit ${q.limit + 1}`);
      return rows.map(row => CustomerTimelineEntrySchema.parse({ key: row.event_key, source: adapter.source, reference: row.reference, type: row.type, title: row.title, occurredAt: new Date(row.occurred_at).toISOString(), important: row.important, route: row.route }));
    } catch { diagnostics.push(onFailure(adapter.source)); return []; }
  }));
  const created: CustomerTimelineEntry = { key: `crm:${customer.reference}:created`, source: 'crm', reference: customer.reference, type: 'CUSTOMER_CREATED', title: 'Customer relationship started', occurredAt: customer.since, important: true, route: null };
  if ((!q.source || q.source === 'crm') && created.occurredAt <= cursor.snapshot && (created.occurredAt < cursor.at || (created.occurredAt === cursor.at && created.key < cursor.key))) groups.push([created]);
  const merged = groups.flat().sort(compareEvents);
  const entries = merged.slice(0, q.limit);
  const last = entries.at(-1);
  // Never advance past an unavailable source: retry this exact page after recovery.
  return { entries, diagnostics, nextCursor: !diagnostics.length && merged.length > q.limit && last ? Buffer.from(JSON.stringify({ ...cursor, at: last.occurredAt, key: last.key })).toString('base64url') : null };
}
