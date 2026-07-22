import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDatabase, tenantActivationMilestones, tenantBillingAccounts, tenantSetupPayments, tenantSubscriptionEvents, tenantSubscriptions } from '@ks-os/database';

type Json = Record<string, any>;

export class GoCardlessClient {
  private readonly baseUrl = process.env.GOCARDLESS_ENVIRONMENT === 'live'
    ? 'https://api.gocardless.com' : 'https://api-sandbox.gocardless.com';

  async request<T extends Json>(path: string, method: 'POST'|'GET'|'PUT', body?: Json, idempotencyKey?: string): Promise<T> {
    if (!process.env.GOCARDLESS_ACCESS_TOKEN) throw Object.assign(new Error('GoCardless is not configured.'), { statusCode: 503, code: 'GOCARDLESS_UNAVAILABLE' });
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.GOCARDLESS_ACCESS_TOKEN}`,
        'GoCardless-Version': '2015-07-06', 'Content-Type': 'application/json', Accept: 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json() as T;
    if (!response.ok) throw Object.assign(new Error('GoCardless request failed.'), { statusCode: 502, code: 'GOCARDLESS_REQUEST_FAILED', providerStatus: response.status });
    return result;
  }
}

export function verifyGoCardlessSignature(rawBody: string, supplied: string | undefined, secret = process.env.GOCARDLESS_WEBHOOK_SECRET): boolean {
  if (!secret || !supplied) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const left = Buffer.from(expected, 'utf8'); const right = Buffer.from(supplied, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

const subscriptionActionState: Record<string,string> = {
  created: 'PENDING', customer_approval_granted: 'ACTIVE', active: 'ACTIVE', payment_created: 'ACTIVE',
  payment_cancelled: 'PAYMENT_OVERDUE', payment_failed: 'PAYMENT_OVERDUE', paused: 'PAUSED', resumed: 'ACTIVE',
  cancelled: 'CANCELLED', finished: 'CANCELLED',
};
const paymentActionState: Record<string,string> = { confirmed: 'CONFIRMED', paid_out: 'CONFIRMED', failed: 'FAILED', cancelled: 'FAILED', refunded: 'REFUNDED' };

export class GoCardlessWebhookService {
  private db = getDatabase();
  private gc = new GoCardlessClient();

  async handle(rawBody: string, signature: string | undefined) {
    if (!verifyGoCardlessSignature(rawBody, signature)) throw Object.assign(new Error('Invalid GoCardless webhook signature.'), { statusCode: 401, code: 'GOCARDLESS_SIGNATURE_INVALID' });
    const parsed = JSON.parse(rawBody) as { events?: Json[] };
    if (!Array.isArray(parsed.events)) throw Object.assign(new Error('Invalid GoCardless webhook body.'), { statusCode: 400, code: 'GOCARDLESS_WEBHOOK_INVALID' });
    let accepted = 0;
    for (const event of parsed.events) accepted += await this.processEvent(event);
    return { accepted };
  }

  private async processEvent(event: Json) {
    if (typeof event.id !== 'string' || typeof event.resource_type !== 'string' || typeof event.action !== 'string') return 0;
    const subscriptionProviderId = event.links?.subscription as string | undefined;
    const paymentProviderId = event.links?.payment as string | undefined;
    const billingRequestProviderId = event.links?.billing_request as string | undefined;
    const mandateProviderId = event.links?.mandate as string | undefined;
    let subscription: any; let setupPayment: any;
    if (subscriptionProviderId) [subscription] = await this.db.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.providerSubscriptionId, subscriptionProviderId)).limit(1);
    if (paymentProviderId) [setupPayment] = await this.db.select().from(tenantSetupPayments).where(eq(tenantSetupPayments.providerPaymentId, paymentProviderId)).limit(1);
    if (!setupPayment && billingRequestProviderId) [setupPayment] = await this.db.select().from(tenantSetupPayments).where(eq(tenantSetupPayments.providerBillingRequestId, billingRequestProviderId)).limit(1);
    let billingAccount:any;
    if (!subscription && !setupPayment && mandateProviderId) [billingAccount] = await this.db.select().from(tenantBillingAccounts).where(eq(tenantBillingAccounts.providerMandateId, mandateProviderId)).limit(1);
    if (!subscription && !setupPayment && !billingAccount) return 0; // never guess tenant ownership
    const tenantId = subscription?.tenantId || setupPayment?.tenantId || billingAccount?.tenantId;
    const inserted = await this.db.insert(tenantSubscriptionEvents).values({ tenantId, subscriptionId: subscription?.id, setupPaymentId: setupPayment?.id, providerEventId: event.id, resourceType: event.resource_type, action: event.action, payloadJson: event }).onConflictDoNothing({ target: tenantSubscriptionEvents.providerEventId }).returning();
    if (!inserted.length) return 0;
    try {
      if (subscription) {
        const status = subscriptionActionState[event.action];
        if (status) {
          const graceEndsAt = status === 'PAYMENT_OVERDUE' ? new Date(Date.now() + 7 * 86400000) : undefined;
          await this.db.update(tenantSubscriptions).set({ status: status === 'PAYMENT_OVERDUE' ? 'GRACE_PERIOD' : status, graceEndsAt, cancelledAt: status === 'CANCELLED' ? new Date() : undefined, updatedAt: new Date() }).where(eq(tenantSubscriptions.id, subscription.id));
        }
      }
      if (setupPayment) {
        const status = paymentActionState[event.action];
        if (status) { await this.db.update(tenantSetupPayments).set({ status, confirmedAt: status === 'CONFIRMED' ? new Date() : undefined, refundedAt: status === 'REFUNDED' ? new Date() : undefined, updatedAt: new Date() }).where(eq(tenantSetupPayments.id, setupPayment.id)); if(status==='CONFIRMED')await this.db.insert(tenantActivationMilestones).values({tenantId,milestoneKey:'SETUP_FEE_CONFIRMED',sourceType:'GOCARDLESS_PAYMENT',sourceId:setupPayment.id}).onConflictDoNothing({target:[tenantActivationMilestones.tenantId,tenantActivationMilestones.milestoneKey]}); }
      }
      if (setupPayment && event.resource_type === 'billing_requests' && event.action === 'fulfilled' && billingRequestProviderId) {
        const response = await this.gc.request<any>(`/billing_requests/${encodeURIComponent(billingRequestProviderId)}`, 'GET');
        const request = response.billing_requests;
        if (!request?.links?.mandate || !request?.links?.customer) throw new Error('Fulfilled billing request is missing provider links.');
        await this.db.update(tenantBillingAccounts).set({ providerMandateId: request.links.mandate, providerCustomerId: request.links.customer, mandateStatus: 'ACTIVE', updatedAt: new Date() }).where(eq(tenantBillingAccounts.id, setupPayment.billingAccountId));
        await this.db.update(tenantSetupPayments).set({ providerPaymentId: request.links.payment_request || setupPayment.providerPaymentId, updatedAt: new Date() }).where(eq(tenantSetupPayments.id, setupPayment.id));
      }
      if (billingAccount && event.resource_type === 'mandates') {
        const mandateStatus = ['cancelled','failed','expired'].includes(event.action) ? 'INACTIVE' : ['active','created','submitted'].includes(event.action) ? 'ACTIVE' : billingAccount.mandateStatus;
        await this.db.update(tenantBillingAccounts).set({ mandateStatus, updatedAt: new Date() }).where(eq(tenantBillingAccounts.id, billingAccount.id));
      }
      await this.db.update(tenantSubscriptionEvents).set({ processedAt: new Date() }).where(eq(tenantSubscriptionEvents.providerEventId, event.id));
    } catch {
      await this.db.update(tenantSubscriptionEvents).set({ failureCode: 'PROCESSING_FAILED' }).where(eq(tenantSubscriptionEvents.providerEventId, event.id));
      throw Object.assign(new Error('GoCardless webhook processing failed.'), { statusCode: 500, code: 'GOCARDLESS_PROCESSING_FAILED' });
    }
    return 1;
  }
}
