import { sql } from "drizzle-orm";
import { canUseProfileModule } from "@ks-os/contracts";
import {
  can,
  type AdapterContext,
  type CustomerAdapter,
} from "./customer-360.adapters.js";
export function invoiceCustomerAdapter({
  actor: a,
  clientId,
  profile,
  now,
}: AdapterContext): CustomerAdapter[] {
  if (!can(a, "INVOICES_VIEW") || !canUseProfileModule(profile, "invoices", a))
    return [];
  const base = sql`select i.*,i.public_reference as reference,'/app/invoices/'||i.public_reference as route from invoice_balances i where i.tenant_id=${a.tenantId}::uuid and i.client_id=${clientId}::uuid`;
  return [
    {
      source: "invoices",
      current: sql`select reference,'INVOICE' as type,invoice_number||' · '||left(title,190) as title,
   case when due_at<${now.toISOString()}::timestamptz then 'OVERDUE' when paid_minor>0 then 'PARTIALLY_PAID' else 'ISSUED' end as status,
   issued_at as occurred_at,due_at,null::text as owner,due_minor as amount,currency,route,${can(a, "INVOICES_RECORD_PAYMENT")} as can_update,null::uuid as conversion_reference
   from (${base}) i where status='ISSUED' and due_minor>0`,
      timeline: sql`select i.reference,h.activity_type as type,
   case h.activity_type when 'CREATED' then 'Invoice created' when 'DRAFT_UPDATED' then 'Invoice draft updated' when 'ISSUED' then 'Invoice issued' when 'VOID' then 'Invoice voided' when 'PAYMENT_ALLOCATED' then 'Payment allocated to invoice' when 'PAID' then 'Invoice paid' when 'PARTIALLY_PAID' then 'Invoice partially paid' when 'REFUND' then 'Refund affecting invoice' else 'Invoice updated' end as title,
   h.created_at as occurred_at,h.activity_type in ('ISSUED','PAID','VOID','REFUND') as important,h.public_reference::text as event_key,i.route
   from invoice_activity h join (${base}) i on i.id=h.invoice_id and i.tenant_id=h.tenant_id
   union all select i.reference,'REFUND','Refund affecting invoice',coalesce(r.completed_at,r.created_at),true,r.public_reference::text,i.route
   from stripe_refunds r join invoice_payment_allocations b on b.payment_id=r.checkout_transaction_id and b.tenant_id=r.tenant_id join (${base}) i on i.id=b.invoice_id and i.tenant_id=b.tenant_id where r.status='SUCCEEDED'`,
      metrics: sql`select 'invoice-'||m.key||'-'||i.currency as key,m.label,sum(m.value)::text as value,i.currency from (${base}) i
   cross join lateral (values ('total','Invoiced (issued invoices)',i.total_minor),('paid','Paid against invoices',i.paid_minor),('due','Money owed on invoices',i.due_minor),('overdue','Overdue on invoices',case when i.due_at<${now.toISOString()}::timestamptz then i.due_minor else 0 end)) m(key,label,value)
   where i.status='ISSUED' group by m.key,m.label,i.currency order by i.currency,m.key limit 20`,
    },
  ];
}
