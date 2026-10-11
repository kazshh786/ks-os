import type { CustomerAction, CustomerAttentionItem, CustomerNowItem } from '@ks-os/contracts';

export type CurrentRow = {
  related_sale?: CustomerNowItem['relatedSale']; has_quote?: boolean; sales_can_update?: boolean;
  reference: string; type: string; title: string; status: string; occurred_at: Date | string; due_at: Date | string | null;
  owner: string | null; amount: number | null; currency: string | null; route: string | null; can_update: boolean; conversion_reference: string | null;
};
export function attentionFor(item: CustomerNowItem, row: CurrentRow, now: Date): CustomerAttentionItem | null {
  let code: CustomerAttentionItem['code'] | undefined;
  let reason = '';
  let severity: CustomerAttentionItem['severity'] = 'ATTENTION';
  let action: CustomerAction | null = row.can_update ? item.action : null;
  const overdue = item.dueAt !== null && Date.parse(item.dueAt) < now.getTime();
  if (item.relatedSale?.state === 'OPEN' && ['CANCELLED','NO_SHOW','COMPLETED'].includes(item.status)) {
    if (item.status === 'COMPLETED' && row.has_quote) return null;
    code = item.status === 'COMPLETED' ? 'SALES_BOOKING_COMPLETED' : 'SALES_BOOKING_CANCELLED';
    reason = item.status === 'COMPLETED' ? 'This appointment is completed and the related sale has no active quote. Review the next step.' : 'This appointment was cancelled or missed while the related sale remains open. Arrange another appointment or contact the customer.';
    action = row.sales_can_update ? { key: 'review-' + item.relatedSale.reference, label: 'Review next step', kind: 'LINK', route: '/app/sales/' + item.relatedSale.reference, source: 'sales', reference: item.relatedSale.reference, reason } : null;
  }
  else if (item.source === 'invoices' && overdue && (item.amount ?? 0)>0) { code='INVOICE_OVERDUE'; reason='This invoice has money remaining and its due date has passed.'; severity='IMPORTANT'; action=item.action; }
  else if (item.source === 'invoices' && item.dueAt && Date.parse(item.dueAt)<=now.getTime()+3*86400000 && (item.amount??0)>0) { code='INVOICE_DUE_SOON'; reason='This invoice has money remaining and is due within three days.'; action=item.action; }
  else if (item.source === 'work' && item.status === 'BLOCKED') { code = 'WORK_BLOCKED'; reason = 'This work is blocked and needs a team member to review it.'; severity = 'IMPORTANT'; }
  else if (item.source === 'work' && overdue) { code = 'WORK_OVERDUE'; reason = 'The due date has passed and this work is still active.'; severity = 'IMPORTANT'; }
  else if (item.source === 'tasks' && overdue) { code = 'TASK_OVERDUE'; reason = 'The due date has passed and this task is still open.'; severity = 'IMPORTANT'; }
  else if (item.source === 'sales' && row.conversion_reference) {
    code = 'SALE_WITHOUT_WORK'; reason = item.type === 'QUOTE' ? 'This quote was accepted, its opportunity is won, and no work has been created from it.' : 'This opportunity is won and no work has been created from it.';
    action = { key: `convert-${row.conversion_reference}`, label: 'Create work from sale', kind: 'CONVERT_WORK', route: null, source: 'sales', reference: row.conversion_reference, reason };
  }
  else if (item.type === 'QUOTE' && item.status === 'SENT' && Date.parse(item.occurredAt) < now.getTime() - 7 * 86400000) { code = 'QUOTE_WAITING'; reason = 'This quote was sent more than seven days ago and is awaiting a response.'; }
  else if (item.source === 'forms') { code = 'FORM_PENDING'; reason = 'An assigned form is awaiting completion.'; }
  else if (item.source === 'payments' && item.status === 'FAILED') { code = 'PAYMENT_FAILED'; reason = 'A payment record reports failure. Check the payment before taking further action.'; severity = 'IMPORTANT'; }
  else if (item.source === 'bookings' && item.dueAt && Date.parse(item.dueAt) <= now.getTime() + 86400000) { code = 'UPCOMING_BOOKING'; reason = 'An appointment is scheduled within the next 24 hours.'; severity = 'INFO'; }
  else if (item.type === 'CONVERSATION') { code = 'UNREAD_CONVERSATION'; reason = 'There are unread messages in a customer conversation.'; }
  if (!code) return null;
  return { key: `${item.key}:${code}`, code, severity, title: item.title, reason, source: item.source, reference: item.reference, dueAt: item.dueAt, action };
}
