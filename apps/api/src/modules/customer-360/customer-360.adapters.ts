import { sql, type SQL } from 'drizzle-orm';
import { canUseProfileModule, type BusinessProfile, type CustomerSource } from '@ks-os/contracts';

export type CustomerActor = { tenantId: string; userId: string; role: 'owner' | 'staff'; permissions: readonly string[]; readOnly?: boolean };
export const can = (a: CustomerActor, permission: string) => a.role === 'owner' || a.permissions.includes(permission);
export type AdapterContext = { actor: CustomerActor; clientId: string; profile: BusinessProfile; now: Date };
export type CustomerAdapter = { source: CustomerSource; current: SQL; timeline: SQL; metrics?: SQL };
const raw = sql.raw;
// Identifiers and expression strings below are code-owned, never request data.
function events(base: SQL, definitions: string): SQL {
  return sql`select b.reference, e.type, e.title, e.occurred_at, e.important,
    b.reference::text || ':' || e.type as event_key, b.route
    from (${base}) b cross join lateral (values ${raw(definitions)}) e(type,title,occurred_at,important)
    where e.occurred_at is not null`;
}
const own = (a: CustomerActor, capability: string, column: string) => can(a, capability) ? sql`true` : sql`${raw(column)} = ${a.userId}::uuid`;

export function customerAdapters(c: AdapterContext): CustomerAdapter[] {
  const { actor: a, clientId, profile, now } = c;
  const enabled = (source: CustomerSource) => canUseProfileModule(profile, source === 'crm' ? 'crm' : source, a);
  const scoped = (alias: string) => sql`${raw(alias + '.tenant_id')} = ${a.tenantId}::uuid and ${raw(alias + '.client_id')} = ${clientId}::uuid`;
  const adapters: CustomerAdapter[] = [];
  if (enabled('sales')) {
    const base = sql`select o.id, o.public_reference as reference, o.title, s.category as status, o.created_at, o.updated_at,
      o.expected_close_date as due_at, u.name as owner, o.estimated_value as amount, o.currency,
      '/app/sales/' || o.public_reference as route,
      ${can(a, 'SALES_UPDATE_ALL')} or (${can(a, 'SALES_UPDATE_OWN')} and o.owner_user_id = ${a.userId}::uuid) as can_update,
      ${!a.readOnly && enabled('work') && can(a, 'WORK_CREATE') && can(a, 'WORK_VIEW_ALL')} and s.category='WON'
        and not exists(select 1 from work_items w where w.tenant_id=${a.tenantId}::uuid and w.source_opportunity_id=o.id) as convertible
      from sales_opportunities o join sales_pipeline_stages s on s.id=o.stage_id and s.tenant_id=${a.tenantId}::uuid
      left join users u on u.id=o.owner_user_id and u.tenant_id=${a.tenantId}::uuid
      where ${scoped('o')} and ${own(a, 'SALES_VIEW_ALL', 'o.owner_user_id')}`;
    const quotes = sql`select q.public_reference as reference, q.title, q.status, q.created_at, q.sent_at, q.accepted_at, q.declined_at,
      q.valid_until as due_at, b.owner, q.total as amount, q.currency, b.route, b.can_update,
      b.convertible, b.reference as conversion_reference
      from sales_quotes q join (${base}) b on b.id=q.opportunity_id
      where ${scoped('q')} and ${can(a, 'QUOTES_VIEW')}`;
    const history = sql`select b.reference, h.activity_type as type,
      case h.activity_type when 'CREATED' then 'Opportunity created' when 'STAGE_CHANGED' then 'Sales stage moved'
        when 'OWNER_CHANGED' then 'Sales owner changed' when 'WON' then 'Opportunity won' when 'LOST' then 'Opportunity lost' end as title,
      h.created_at as occurred_at, h.activity_type in ('WON','LOST') as important,
      h.public_reference::text as event_key, b.route
      from sales_opportunity_activity h join (${base}) b on b.id=h.opportunity_id
      where h.tenant_id=${a.tenantId}::uuid and h.activity_type in ('CREATED','STAGE_CHANGED','OWNER_CHANGED','WON','LOST')`;
    adapters.push({ source: 'sales',
      current: sql`select reference, 'OPPORTUNITY' as type, title, status, updated_at as occurred_at, due_at, owner, amount, currency, route, can_update,
        case when convertible then reference else null end as conversion_reference
        from (${base}) b where status='OPEN' or convertible
        union all select reference, 'QUOTE', title, status, coalesce(sent_at,created_at), due_at, owner, amount, currency, route, can_update,
        case when convertible then conversion_reference else null end from (${quotes}) q where status='SENT' or (status='ACCEPTED' and convertible)`,
      timeline: sql`${history} union all ${events(quotes, "('QUOTE_CREATED','Quote created',b.created_at,false),('QUOTE_SENT','Quote sent',b.sent_at,false),('QUOTE_ACCEPTED','Quote accepted',b.accepted_at,true),('QUOTE_DECLINED','Quote declined',b.declined_at,true)")}`,
      metrics: sql`select 'open-sales-' || currency as key, 'Open Sales value' as label, coalesce(sum(amount),0)::text as value, currency from (${base}) b where status='OPEN' and amount is not null group by currency`,
    });
  }
  if (enabled('work')) {
    const base = sql`select w.id, w.public_reference as reference, w.title, w.status, w.work_type as type, w.created_at, w.updated_at,
      w.due_at, u.name as owner, '/app/work/' || w.public_reference as route,
      ${can(a, 'WORK_UPDATE_ALL')} or (${can(a, 'WORK_UPDATE_OWN')} and w.assigned_user_id=${a.userId}::uuid) as can_update
      from work_items w left join users u on u.id=w.assigned_user_id and u.tenant_id=${a.tenantId}::uuid
      where ${scoped('w')} and ${own(a, 'WORK_VIEW_ALL', 'w.assigned_user_id')}`;
    adapters.push({ source: 'work',
      current: sql`select reference,type,title,status,updated_at as occurred_at,due_at,owner,null::int as amount,null::text as currency,route,can_update,null::uuid as conversion_reference from (${base}) b where status not in ('COMPLETED','CANCELLED')`,
      timeline: sql`select b.reference, h.activity_type as type,
        case h.activity_type when 'CREATED' then 'Work created' when 'ASSIGNED' then 'Work assigned' when 'REASSIGNED' then 'Work reassigned'
          when 'STARTED' then 'Work started' when 'BLOCKED' then 'Work blocked' when 'COMPLETED' then 'Work completed' when 'REOPENED' then 'Work reopened'
          when 'STATUS_CHANGED' then case h.to_value when 'IN_PROGRESS' then 'Work started' when 'BLOCKED' then 'Work blocked' when 'COMPLETED' then 'Work completed' when 'CANCELLED' then 'Work cancelled' else 'Work status changed' end
          else 'Work cancelled' end as title,
        h.created_at as occurred_at, h.activity_type in ('BLOCKED','COMPLETED','REOPENED') or (h.activity_type='STATUS_CHANGED' and h.to_value in ('BLOCKED','COMPLETED')) as important,
        h.public_reference::text as event_key,b.route from work_item_activity h join (${base}) b on b.id=h.work_item_id
        where h.tenant_id=${a.tenantId}::uuid and h.activity_type in ('CREATED','ASSIGNED','REASSIGNED','STARTED','BLOCKED','COMPLETED','REOPENED','CANCELLED','STATUS_CHANGED')`,
      metrics: sql`select 'active-work' as key,'Active work' as label,count(*) filter(where status not in ('COMPLETED','CANCELLED'))::text as value,null::text as currency from (${base}) b
        union all select 'completed-work','Completed work',count(*) filter(where status='COMPLETED')::text,null from (${base}) b`,
    });
  }
  if (enabled('tasks')) {
    const base = sql`select t.id,t.public_reference as reference,t.title,t.status,t.created_at,t.updated_at,t.due_at,u.name as owner,
      '/app/tasks/' || t.public_reference as route,
      ${can(a, 'TASKS_UPDATE_ALL')} or (${can(a, 'TASKS_UPDATE_OWN')} and t.assigned_user_id=${a.userId}::uuid) as can_update
      from tasks t left join users u on u.id=t.assigned_user_id and u.tenant_id=${a.tenantId}::uuid
      where ${scoped('t')} and ${own(a, 'TASKS_VIEW_ALL', 't.assigned_user_id')}
      and (${can(a, 'FINANCE_VIEW')} or (t.source_type not in ('PAYMENT','REFUND')
        and not exists(select 1 from operations_issues issue where issue.tenant_id=${a.tenantId}::uuid and issue.category in ('PAYMENT','REFUND')
          and (issue.id=t.operations_issue_id or (t.source_type='OPERATIONS_ISSUE' and issue.id=t.source_id)))))`;
    adapters.push({ source: 'tasks',
      current: sql`select reference,'TASK' as type,title,status,updated_at as occurred_at,due_at,owner,null::int as amount,null::text as currency,route,can_update,null::uuid as conversion_reference from (${base}) b where status in ('OPEN','IN_PROGRESS')`,
      timeline: sql`select b.reference,h.activity_type as type,
        case h.activity_type when 'CREATED' then 'Task created' when 'ASSIGNED' then 'Task assigned' when 'REASSIGNED' then 'Task reassigned' when 'COMPLETED' then 'Task completed' when 'STARTED' then 'Task started' else 'Task reopened' end as title,
        h.created_at as occurred_at,h.activity_type='COMPLETED' as important,h.public_reference::text as event_key,b.route
        from task_activity h join (${base}) b on b.id=h.task_id where h.tenant_id=${a.tenantId}::uuid and h.activity_type in ('CREATED','ASSIGNED','REASSIGNED','COMPLETED','STARTED','REOPENED')`,
    });
  }
  if (enabled('bookings')) {
    const base = sql`select b.public_reference as reference,'Appointment'::text as title,b.status,b.created_at,b.cancelled_at,b.start_time as due_at,
      u.name as owner,'/app/bookings?reference=' || b.public_reference || '&search=' || b.public_reference || '&view=day&date=' || to_char(b.start_time at time zone coalesce(t.timezone,'Europe/London'),'YYYY-MM-DD') as route,
      ${can(a, 'BOOKINGS_UPDATE_ALL')} or (${can(a, 'BOOKINGS_UPDATE_OWN')} and b.user_id=${a.userId}::uuid) as can_update
      from appointments b join tenants t on t.id=b.tenant_id left join users u on u.id=b.user_id and u.tenant_id=${a.tenantId}::uuid
      where ${scoped('b')} and ${own(a, 'BOOKINGS_VIEW_ALL', 'b.user_id')} and not b.is_internal and not b.is_test`;
    adapters.push({ source: 'bookings',
      current: sql`select reference,'APPOINTMENT' as type,title,status,created_at as occurred_at,due_at,owner,null::int as amount,null::text as currency,route,can_update,null::uuid as conversion_reference from (${base}) b where status in ('PENDING','CONFIRMED','CHECKED_IN','IN_SERVICE','AWAITING_PAYMENT') and due_at>=${now.toISOString()}::timestamptz`,
      timeline: events(base, "('BOOKING_CREATED','Booking created',b.created_at,false),('BOOKING_CANCELLED','Booking cancelled',b.cancelled_at,true)"),
      metrics: sql`select 'upcoming-bookings' as key,'Upcoming appointments' as label,count(*)::text as value,null::text as currency from (${base}) b where due_at>=${now.toISOString()}::timestamptz and status in ('PENDING','CONFIRMED','CHECKED_IN')`,
    });
  }
  if (enabled('forms')) {
    const base = sql`select f.public_reference as reference,'Customer form'::text as title,f.status,f.created_at,f.opened_at,f.submitted_at,f.expires_at as due_at,
      '/app/forms'::text as route from form_assignments f
      left join appointments b on b.id=f.appointment_id and b.tenant_id=${a.tenantId}::uuid
      where ${scoped('f')} and (${a.role === 'owner'} or b.user_id=${a.userId}::uuid)`;
    adapters.push({ source: 'forms',
      current: sql`select reference,'FORM' as type,title,status,created_at as occurred_at,due_at,null::text as owner,null::int as amount,null::text as currency,route,false as can_update,null::uuid as conversion_reference from (${base}) b where status in ('PENDING','OPENED') and due_at>${now.toISOString()}::timestamptz`,
      timeline: events(base, "('FORM_ASSIGNED','Form assigned',b.created_at,false),('FORM_OPENED','Form opened',b.opened_at,false),('FORM_SUBMITTED','Form submitted',b.submitted_at,true)"),
    });
  }
  if (enabled('payments')) {
    // No body, provider identifier, card detail or inferred balance is selected.
    const base = sql`select p.public_reference as reference,'Payment'::text as title,p.payment_status as status,p.created_at,
      '/app/payments'::text as route from checkout_transactions p
      join appointments b on b.id=p.appointment_id and b.tenant_id=${a.tenantId}::uuid
      where p.tenant_id=${a.tenantId}::uuid and b.client_id=${clientId}::uuid and not b.is_test`;
    const attempts = sql`select p.public_reference as reference,'Online payment'::text as title,p.status,p.created_at,p.updated_at,p.completed_at,
      p.amount,upper(p.currency) as currency,'/app/payments'::text as route,p.appointment_id
      from stripe_payment_attempts p join appointments b on b.id=p.appointment_id and b.tenant_id=${a.tenantId}::uuid
      where p.tenant_id=${a.tenantId}::uuid and b.client_id=${clientId}::uuid and not b.is_test`;
    const refunds = sql`select r.public_reference as reference,r.created_at,r.completed_at,r.status,'/app/payments'::text as route
      from stripe_refunds r join checkout_transactions p on p.id=r.checkout_transaction_id and p.tenant_id=${a.tenantId}::uuid
      join appointments b on b.id=p.appointment_id and b.tenant_id=${a.tenantId}::uuid
      where r.tenant_id=${a.tenantId}::uuid and b.client_id=${clientId}::uuid and not b.is_test`;
    adapters.push({ source: 'payments',
      current: sql`select reference,'PAYMENT' as type,title,status,created_at as occurred_at,null::timestamptz as due_at,null::text as owner,null::int as amount,null::text as currency,route,true as can_update,null::uuid as conversion_reference from (${base}) b where status='FAILED'
        union all select reference,'PAYMENT',title,status,updated_at,null,null,amount,currency,route,true,null from (${attempts}) p where status='FAILED'
        and not exists(select 1 from stripe_payment_attempts newer where newer.tenant_id=${a.tenantId}::uuid and newer.appointment_id=p.appointment_id and newer.created_at>p.created_at)`,
      timeline: sql`${events(base, "('PAYMENT_RECORDED','Payment recorded',b.created_at,true)")}
        union all ${events(attempts, "('PAYMENT_SUCCEEDED','Online payment succeeded',case when b.status='SUCCEEDED' then b.completed_at end,true)")}
        union all ${events(refunds, "('REFUND_REQUESTED','Refund requested',b.created_at,true),('REFUND_SUCCEEDED','Refund completed',case when b.status='SUCCEEDED' then b.completed_at end,true)")}`,
    });
  }
  if (enabled('communications')) {
    const sms = sql`select s.public_reference as reference,s.created_at,s.sent_at,s.delivered_at,s.failed_at,'/app/settings/communications'::text as route from sms_outbox s where ${scoped('s')}`;
    // Match canonical links only; shared/reused email addresses are not customer identity.
    const email = sql`select e.public_reference as reference,e.created_at,e.sent_at,e.delivered_at,e.failed_at,'/app/settings/communications'::text as route from email_outbox e
      where e.tenant_id=${a.tenantId}::uuid and (
        (e.related_entity_type='client' and e.related_entity_id=${clientId}::uuid)
        or (e.related_entity_type='appointment' and exists(select 1 from appointments b where b.tenant_id=${a.tenantId}::uuid and b.id=e.related_entity_id and b.client_id=${clientId}::uuid))
        or (e.related_entity_type='form_assignment' and exists(select 1 from form_assignments f where f.tenant_id=${a.tenantId}::uuid and f.id=e.related_entity_id and f.client_id=${clientId}::uuid)))`;
    adapters.push({ source: 'communications',
      current: sql`select c.public_reference as reference,'CONVERSATION' as type,'Unread conversation'::text as title,c.status,c.last_message_at as occurred_at,
        null::timestamptz as due_at,null::text as owner,null::int as amount,null::text as currency,'/app/operations'::text as route,false as can_update,null::uuid as conversion_reference
        from conversations c where ${scoped('c')} and c.unread_count>0 and c.status='OPEN'`,
      timeline: sql`${events(sms, "('SMS_SENT','SMS sent',b.sent_at,false),('SMS_DELIVERED','SMS delivered',b.delivered_at,false),('SMS_FAILED','SMS delivery failed',b.failed_at,true)")} union all ${events(email, "('EMAIL_SENT','Email sent',b.sent_at,false),('EMAIL_DELIVERED','Email delivered',b.delivered_at,false),('EMAIL_FAILED','Email delivery failed',b.failed_at,true)")}`,
    });
  }
  if (enabled('reputation')) {
    const base = sql`select r.public_reference as reference,r.status,r.created_at,r.sent_at,r.confirmed_review_at,r.scheduled_for as due_at,'/app/reputation'::text as route from review_invitations r where ${scoped('r')}`;
    adapters.push({ source: 'reputation',
      current: sql`select reference,'REVIEW' as type,'Review request'::text as title,status,created_at as occurred_at,due_at,null::text as owner,null::int as amount,null::text as currency,route,false as can_update,null::uuid as conversion_reference from (${base}) b where status in ('SCHEDULED','QUEUED','SENT','DELIVERED') and confirmed_review_at is null`,
      timeline: events(base, "('REVIEW_REQUEST_SENT','Review request sent',b.sent_at,false),('REVIEW_RECEIVED','Review confirmed',b.confirmed_review_at,true)"),
    });
  }
  if (enabled('operations')) {
    const base = sql`select o.public_reference as reference,'Operational issue'::text as title,o.status,o.occurred_at,o.resolved_at,o.action_deadline as due_at,'/app/operations'::text as route
      from operations_issues o join appointments b on b.id=o.related_appointment_id and b.tenant_id=${a.tenantId}::uuid
      where o.tenant_id=${a.tenantId}::uuid and b.client_id=${clientId}::uuid
      and ${own(a, 'OPERATIONS_VIEW_ALL', 'o.assigned_to_user_id')} and (${can(a, 'FINANCE_VIEW')} or o.category not in ('PAYMENT','REFUND'))`;
    adapters.push({ source: 'operations',
      current: sql`select reference,'ISSUE' as type,title,status,occurred_at,due_at,null::text as owner,null::int as amount,null::text as currency,route,false as can_update,null::uuid as conversion_reference from (${base}) b where status in ('OPEN','ACKNOWLEDGED')`,
      timeline: events(base, "('ISSUE_OPENED','Operational issue opened',b.occurred_at,true),('ISSUE_RESOLVED','Operational issue resolved',b.resolved_at,true)"),
    });
  }
  return adapters;
}
