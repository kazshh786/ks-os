from pathlib import Path
import re
from textwrap import dedent


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, value: str) -> None:
    Path(path).write_text(value)


def replace_once(path: str, old: str, new: str) -> None:
    value = read(path)
    if old not in value:
        raise RuntimeError(f'Expected text not found in {path}: {old[:120]!r}')
    write(path, value.replace(old, new, 1))


def sub_once(path: str, pattern: str, replacement: str) -> None:
    value = read(path)
    updated, count = re.subn(pattern, replacement, value, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'Expected one regex match in {path}, got {count}: {pattern}')
    write(path, updated)


# Shared POS contracts.
pos_contract = 'packages/contracts/src/pos.ts'
replace_once(
    pos_contract,
    """export const PaymentComponentMethodSchema = z.enum([\n  'CASH',\n  'BANK_TRANSFER',\n  'EXTERNAL_CARD',\n  'OTHER',\n  'STRIPE_TERMINAL',\n]);""",
    """export const PaymentComponentMethodSchema = z.enum([\n  'CASH',\n  'BANK_TRANSFER',\n  'EXTERNAL_CARD',\n  'OTHER',\n  'STRIPE_TERMINAL',\n  'STRIPE_ONLINE',\n]);""",
)
replace_once(
    pos_contract,
    """export const PosStripePaymentModeSchema = z.enum([\n  'AUTOMATED_TERMINAL',\n  'TAP_TO_PAY_MANUAL',\n  'TERMINAL_MANUAL',\n]);""",
    """export const PosStripePaymentModeSchema = z.enum([\n  'AUTOMATED_TERMINAL',\n  'ONLINE_CHECKOUT',\n  'TAP_TO_PAY_MANUAL',\n  'TERMINAL_MANUAL',\n]);""",
)
replace_once(
    pos_contract,
    """ * AUTOMATED_TERMINAL is verified against Stripe before checkout is finalised.\n * The manual modes are explicit staff confirmations for payments taken directly\n * in Stripe's own mobile app or on a standalone Stripe Terminal device.""",
    """ * AUTOMATED_TERMINAL and ONLINE_CHECKOUT are verified against Stripe before\n * checkout is finalised. The manual modes are explicit staff confirmations for\n * payments taken directly in Stripe's own mobile app or on a standalone reader.""",
)
replace_once(
    pos_contract,
    """  stripe: z.object({\n    connected: z.boolean(),\n    ready: z.boolean(),\n    accountIdMasked: z.string().nullable(),\n  }),""",
    """  stripe: z.object({\n    connected: z.boolean(),\n    ready: z.boolean(),\n    onlinePaymentsReady: z.boolean(),\n    accountIdMasked: z.string().nullable(),\n  }),""",
)
online_contracts = dedent("""
export const PosOnlinePaymentPresentationSchema = z.enum(['EMBEDDED', 'HOSTED']);
export type PosOnlinePaymentPresentation = z.infer<typeof PosOnlinePaymentPresentationSchema>;

export const PosStripeOnlinePaymentSessionSchema = z.object({
  sessionId: z.string().regex(/^cs_[A-Za-z0-9_]+$/),
  presentation: PosOnlinePaymentPresentationSchema,
  clientSecret: z.string().nullable(),
  checkoutUrl: z.string().url().nullable(),
  publishableKey: z.string().min(1),
  stripeAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  amountInCents: z.number().int().positive(),
  currency: z.string().length(3),
  expiresAt: z.string().datetime(),
});
export type PosStripeOnlinePaymentSession = z.infer<typeof PosStripeOnlinePaymentSessionSchema>;

export const PosStripeOnlinePaymentStatusSchema = z.object({
  sessionId: z.string().regex(/^cs_[A-Za-z0-9_]+$/),
  status: z.string(),
  paymentStatus: z.string(),
  paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/).nullable(),
  amountInCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  succeeded: z.boolean(),
  failed: z.boolean(),
  expired: z.boolean(),
  failureMessage: z.string().nullable(),
});
export type PosStripeOnlinePaymentStatus = z.infer<typeof PosStripeOnlinePaymentStatusSchema>;

export const StartPosStripeOnlinePaymentRequestSchema = z.object({
  appointmentId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(255),
  presentation: PosOnlinePaymentPresentationSchema,
  tipAmountInCents: z.number().int().nonnegative().default(0),
  purchasedProducts: z.array(CheckoutBasketItemSchema).default([]),
});
export type StartPosStripeOnlinePaymentRequest = z.infer<typeof StartPosStripeOnlinePaymentRequestSchema>;

""")
replace_once(
    pos_contract,
    "/**\n * Starts an automated server-driven Stripe Terminal payment.",
    online_contracts + "/**\n * Starts an automated server-driven Stripe Terminal payment.",
)

# Retail contracts reuse the same online session presentation and response types.
retail_contract = 'packages/contracts/src/retail-pos.ts'
replace_once(
    retail_contract,
    """  PaymentMethodSchema,\n  PosStripePaymentConfirmationSchema,""",
    """  PaymentMethodSchema,\n  PosOnlinePaymentPresentationSchema,\n  PosStripePaymentConfirmationSchema,""",
)
replace_once(
    retail_contract,
    """export type StartRetailStripePaymentRequest = z.infer<typeof StartRetailStripePaymentRequestSchema>;\n""",
    """export type StartRetailStripePaymentRequest = z.infer<typeof StartRetailStripePaymentRequestSchema>;\n\nexport const StartRetailStripeOnlinePaymentRequestSchema = z.object({\n  idempotencyKey: z.string().min(1).max(255),\n  presentation: PosOnlinePaymentPresentationSchema,\n  tipAmountInCents: z.number().int().nonnegative().default(0),\n  purchasedProducts: z.array(CheckoutBasketItemSchema).min(1).max(100),\n});\nexport type StartRetailStripeOnlinePaymentRequest = z.infer<typeof StartRetailStripeOnlinePaymentRequestSchema>;\n""",
)

# Permit provider-confirmed online Stripe payments in POS calculations.
calculator = 'apps/api/src/modules/pos/pos.calculator.ts'
replace_once(
    calculator,
    """    // Booking-page Stripe payments are never submitted through the staff POS.\n    if ((comp.method as string) === 'STRIPE_ONLINE') {\n      const err = new Error('STRIPE_ONLINE cannot be submitted through the POS');\n      err.name = 'INVALID_PAYMENT_COMPONENT_METHOD';\n      throw err;\n    }\n\n""",
    "",
)
replace_once(
    calculator,
    """  if (method === 'STRIPE_ONLINE') {\n    const err = new Error('STRIPE_ONLINE cannot be submitted through the POS');\n    err.name = 'INVALID_PAYMENT_METHOD';\n    throw err;\n  }\n\n""",
    "",
)
replace_once(
    calculator,
    """    || method === 'OTHER'\n    || method === 'STRIPE_TERMINAL'\n  ) {""",
    """    || method === 'OTHER'\n    || method === 'STRIPE_TERMINAL'\n    || method === 'STRIPE_ONLINE'\n  ) {""",
)
replace_once(
    calculator,
    """    if (method === 'STRIPE_TERMINAL') {\n      comp.externalProvider = 'STRIPE';\n      comp.externalProviderName = 'Stripe';\n    }""",
    """    if (method === 'STRIPE_TERMINAL' || method === 'STRIPE_ONLINE') {\n      comp.externalProvider = 'STRIPE';\n      comp.externalProviderName = 'Stripe';\n    }""",
)

# Surface whether embedded/hosted online payments can be created.
pos_stripe = 'apps/api/src/modules/pos/pos-stripe.service.ts'
replace_once(
    pos_stripe,
    """    return {\n      connected: Boolean(connection),\n      ready: Boolean(connection && connection.connectionStatus === 'READY' && connection.chargesEnabled),\n      accountIdMasked: maskStripeAccountId(connection?.stripeAccountId),\n    };""",
    """    const ready = Boolean(connection && connection.connectionStatus === 'READY' && connection.chargesEnabled);\n    return {\n      connected: Boolean(connection),\n      ready,\n      onlinePaymentsReady: ready && Boolean(process.env.STRIPE_PUBLISHABLE_KEY),\n      accountIdMasked: maskStripeAccountId(connection?.stripeAccountId),\n    };""",
)

# Appointment checkout verifies both terminal and online PaymentIntents.
pos_service = 'apps/api/src/modules/pos/pos.service.ts'
pos_prepare = dedent("""
  private async prepareStripeCheckout(
    tenantId: string,
    payload: CheckoutRequest,
    expectedAmountInCents: number,
  ) {
    const isTerminal = payload.paymentMethod === 'STRIPE_TERMINAL';
    const isOnline = payload.paymentMethod === 'STRIPE_ONLINE';
    if (!isTerminal && !isOnline) {
      return {
        trustedComponents: payload.paymentComponents,
        paymentIntentId: null as string | null,
        verificationSource: 'STAFF_CONFIRMED' as const,
      };
    }

    const confirmation = payload.stripePayment;
    if (!confirmation) throw fail('STRIPE_CONFIRMATION_REQUIRED', 'Stripe payment confirmation is required.');

    const connection = await this.stripe.getConnectionSummary(tenantId);
    if (!connection.ready) throw fail('STRIPE_ACCOUNT_NOT_READY', 'The connected Stripe account is not ready to take payments.');

    if (isOnline && (confirmation.mode !== 'ONLINE_CHECKOUT' || !confirmation.paymentIntentId)) {
      throw fail('STRIPE_PAYMENT_INTENT_REQUIRED', 'The online Stripe payment is missing its confirmed PaymentIntent.');
    }
    if (isTerminal && confirmation.mode === 'ONLINE_CHECKOUT') {
      throw fail('STRIPE_CONFIRMATION_REQUIRED', 'The Stripe confirmation does not match the selected POS payment method.');
    }
    if (isTerminal && confirmation.mode === 'AUTOMATED_TERMINAL' && !confirmation.paymentIntentId) {
      throw fail('STRIPE_PAYMENT_INTENT_REQUIRED', 'The automated terminal payment is missing its Stripe PaymentIntent.');
    }

    let verificationSource: 'PROVIDER_CONFIRMED' | 'STAFF_CONFIRMED' = 'STAFF_CONFIRMED';
    let verifiedPaymentIntentId: string | null = null;
    if (confirmation.paymentIntentId) {
      const paymentIntent = await this.stripe.assertPaymentSucceeded({
        tenantId,
        appointmentId: payload.appointmentId,
        paymentIntentId: confirmation.paymentIntentId,
        expectedAmountInCents,
      });
      verifiedPaymentIntentId = paymentIntent.id;
      verificationSource = 'PROVIDER_CONFIRMED';
    } else if (!confirmation.manuallyConfirmed) {
      throw fail('STRIPE_MANUAL_CONFIRMATION_REQUIRED', 'Confirm that the Stripe payment succeeded before completing the sale.');
    }

    const provider = isOnline
      ? 'STRIPE_ONLINE'
      : confirmation.mode === 'TAP_TO_PAY_MANUAL'
        ? 'STRIPE_TAP_TO_PAY'
        : confirmation.mode === 'TERMINAL_MANUAL'
          ? 'STRIPE_TERMINAL_MANUAL'
          : 'STRIPE_TERMINAL';
    const method = isOnline ? 'STRIPE_ONLINE' as const : 'STRIPE_TERMINAL' as const;

    return {
      trustedComponents: [{
        method,
        amountInCents: expectedAmountInCents,
        externalProvider: provider,
        externalProviderName: 'Stripe',
        externalReference: verifiedPaymentIntentId || confirmation.manualReference || undefined,
      }],
      paymentIntentId: verifiedPaymentIntentId,
      verificationSource,
    };
  }

  async completeCheckout""")
sub_once(
    pos_service,
    r"  private async prepareStripeCheckout\(.*?\n  async completeCheckout",
    pos_prepare,
)
replace_once(
    pos_service,
    "const isStripeComponent = comp.method === 'STRIPE_TERMINAL';",
    "const isStripeComponent = comp.method === 'STRIPE_TERMINAL' || comp.method === 'STRIPE_ONLINE';",
)

# Standalone retail checkout uses the same provider-confirmed online flow.
retail_service = 'apps/api/src/modules/pos/retail-pos.service.ts'
retail_prepare = dedent("""
  private async prepareStripeCheckout(
    tenantId: string,
    payload: RetailSaleCheckoutRequest,
    expectedAmountInCents: number,
  ) {
    const isTerminal = payload.paymentMethod === 'STRIPE_TERMINAL';
    const isOnline = payload.paymentMethod === 'STRIPE_ONLINE';
    if (!isTerminal && !isOnline) {
      return {
        trustedComponents: payload.paymentComponents,
        paymentIntentId: null as string | null,
        verificationSource: 'STAFF_CONFIRMED' as const,
      };
    }

    const confirmation = payload.stripePayment;
    if (!confirmation) throw fail('STRIPE_CONFIRMATION_REQUIRED', 'Stripe payment confirmation is required.');

    const connection = await this.posStripe.getConnectionSummary(tenantId);
    if (!connection.ready) throw fail('STRIPE_ACCOUNT_NOT_READY', 'The connected Stripe account is not ready to take payments.');

    if (isOnline && (confirmation.mode !== 'ONLINE_CHECKOUT' || !confirmation.paymentIntentId)) {
      throw fail('STRIPE_PAYMENT_INTENT_REQUIRED', 'The online Stripe payment is missing its confirmed PaymentIntent.');
    }
    if (isTerminal && confirmation.mode === 'ONLINE_CHECKOUT') {
      throw fail('STRIPE_CONFIRMATION_REQUIRED', 'The Stripe confirmation does not match the selected POS payment method.');
    }
    if (isTerminal && confirmation.mode === 'AUTOMATED_TERMINAL' && !confirmation.paymentIntentId) {
      throw fail('STRIPE_PAYMENT_INTENT_REQUIRED', 'The automated terminal payment is missing its Stripe PaymentIntent.');
    }

    let verificationSource: 'PROVIDER_CONFIRMED' | 'STAFF_CONFIRMED' = 'STAFF_CONFIRMED';
    let paymentIntentId: string | null = null;
    if (confirmation.paymentIntentId) {
      const paymentIntent = await this.stripe.assertPaymentSucceeded({
        tenantId,
        idempotencyKey: payload.idempotencyKey,
        paymentIntentId: confirmation.paymentIntentId,
        expectedAmountInCents,
      });
      paymentIntentId = paymentIntent.id;
      verificationSource = 'PROVIDER_CONFIRMED';
    } else if (!confirmation.manuallyConfirmed) {
      throw fail('STRIPE_MANUAL_CONFIRMATION_REQUIRED', 'Confirm that the Stripe payment succeeded before completing the sale.');
    }

    const provider = isOnline
      ? 'STRIPE_ONLINE'
      : confirmation.mode === 'TAP_TO_PAY_MANUAL'
        ? 'STRIPE_TAP_TO_PAY'
        : confirmation.mode === 'TERMINAL_MANUAL'
          ? 'STRIPE_TERMINAL_MANUAL'
          : 'STRIPE_TERMINAL';
    const method = isOnline ? 'STRIPE_ONLINE' as const : 'STRIPE_TERMINAL' as const;

    return {
      trustedComponents: [{
        method,
        amountInCents: expectedAmountInCents,
        externalProvider: provider,
        externalProviderName: 'Stripe',
        externalReference: paymentIntentId || confirmation.manualReference || undefined,
      }],
      paymentIntentId,
      verificationSource,
    };
  }

  async complete""")
sub_once(
    retail_service,
    r"  private async prepareStripeCheckout\(.*?\n  async complete",
    retail_prepare,
)
replace_once(
    retail_service,
    "const isStripe = component.method === 'STRIPE_TERMINAL';",
    "const isStripe = component.method === 'STRIPE_TERMINAL' || component.method === 'STRIPE_ONLINE';",
)

# Appointment POS routes create and poll online Checkout Sessions.
pos_routes = 'apps/api/src/modules/pos/pos.routes.ts'
replace_once(
    pos_routes,
    """  StartPosStripePaymentRequestSchema,\n} from '@ks-os/contracts';""",
    """  StartPosStripeOnlinePaymentRequestSchema,\n  StartPosStripePaymentRequestSchema,\n} from '@ks-os/contracts';""",
)
replace_once(
    pos_routes,
    "import { PosStripeService } from './pos-stripe.service.js';",
    "import { PosStripeService } from './pos-stripe.service.js';\nimport { PosOnlineStripeService } from './pos-online-stripe.service.js';",
)
replace_once(
    pos_routes,
    "  const stripe = new PosStripeService();",
    "  const stripe = new PosStripeService();\n  const onlineStripe = new PosOnlineStripeService();",
)
pos_online_routes = dedent("""
  fastify.post('/api/v1/pos/stripe/online-sessions', async (request, reply) => {
    const result = StartPosStripeOnlinePaymentRequestSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid online payment request', details: result.error.format() },
      });
    }

    try {
      const totals = await service.previewCheckout(
        request.auth!.tenantId,
        request.auth!.role,
        request.auth!.tenantUserId,
        {
          appointmentId: result.data.appointmentId,
          paymentMethod: 'STRIPE_ONLINE',
          tipAmountInCents: result.data.tipAmountInCents,
          purchasedProducts: result.data.purchasedProducts,
        },
      );
      const data = await onlineStripe.createSession({
        tenantId: request.auth!.tenantId,
        amountInCents: totals.grandTotalInCents,
        presentation: result.data.presentation,
        context: {
          kind: 'APPOINTMENT',
          appointmentId: result.data.appointmentId,
          idempotencyKey: result.data.idempotencyKey,
        },
      });
      return reply.status(201).send({ success: true, data });
    } catch (error: any) {
      const code = errorCode(error, 'STRIPE_ONLINE_PAYMENT_FAILED');
      let status = 502;
      if (code === 'POS_APPOINTMENT_NOT_FOUND' || code === 'PRODUCT_NOT_FOUND') status = 404;
      if (code === 'POS_ACCESS_DENIED' || code === 'ENTITLEMENT_REQUIRED') status = 403;
      if (code === 'INSUFFICIENT_STOCK' || code === 'STRIPE_ACCOUNT_NOT_READY' || code === 'STRIPE_PUBLISHABLE_KEY_MISSING') status = 409;
      if (code === 'INVALID_PAYMENT_TOTAL') status = 400;
      request.log.error({ err: error }, 'Could not start online POS payment');
      return reply.status(status).send({ error: { code, message: error.message || 'The online payment could not be started.' } });
    }
  });

  fastify.get('/api/v1/pos/stripe/online-sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid Stripe Checkout Session ID.' } });
    }
    try {
      const data = await onlineStripe.getSessionStatus(request.auth!.tenantId, sessionId);
      return reply.send({ success: true, data });
    } catch (error: any) {
      const code = errorCode(error, 'STRIPE_ONLINE_STATUS_FAILED');
      const status = code === 'STRIPE_ONLINE_SESSION_NOT_FOUND' ? 404 : code === 'STRIPE_ACCOUNT_NOT_READY' ? 409 : 502;
      return reply.status(status).send({ error: { code, message: error.message || 'Online payment status is unavailable.' } });
    }
  });

""")
replace_once(
    pos_routes,
    "  fastify.post('/api/v1/pos/stripe/payment-intents', async (request, reply) => {",
    pos_online_routes + "  fastify.post('/api/v1/pos/stripe/payment-intents', async (request, reply) => {",
)

# Retail POS creates hosted or embedded sessions and reuses the shared status route.
retail_routes = 'apps/api/src/modules/pos/retail-pos.routes.ts'
replace_once(
    retail_routes,
    """  RetailSalePreviewRequestSchema,\n  StartRetailStripePaymentRequestSchema,""",
    """  RetailSalePreviewRequestSchema,\n  StartRetailStripeOnlinePaymentRequestSchema,\n  StartRetailStripePaymentRequestSchema,""",
)
replace_once(
    retail_routes,
    "import { RetailPosService } from './retail-pos.service.js';",
    "import { RetailPosService } from './retail-pos.service.js';\nimport { PosOnlineStripeService } from './pos-online-stripe.service.js';",
)
replace_once(
    retail_routes,
    "  const entitlements = new EntitlementService();",
    "  const entitlements = new EntitlementService();\n  const onlineStripe = new PosOnlineStripeService();",
)
retail_online_route = dedent("""
  fastify.post('/api/v1/pos/retail/stripe/online-sessions', async (request, reply) => {
    const parsed = StartRetailStripeOnlinePaymentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Check the online retail payment request.', details: parsed.error.format() },
      });
    }

    try {
      const totals = await service.preview(request.auth!.tenantId, {
        paymentMethod: 'STRIPE_ONLINE',
        tipAmountInCents: parsed.data.tipAmountInCents,
        purchasedProducts: parsed.data.purchasedProducts,
      });
      const data = await onlineStripe.createSession({
        tenantId: request.auth!.tenantId,
        amountInCents: totals.grandTotalInCents,
        presentation: parsed.data.presentation,
        context: { kind: 'RETAIL', idempotencyKey: parsed.data.idempotencyKey },
      });
      return reply.status(201).send({ success: true, data });
    } catch (error: any) {
      const code = errorCode(error, 'RETAIL_STRIPE_ONLINE_PAYMENT_FAILED');
      const status = statusFor(code);
      request.log.error({ err: error }, 'Could not start standalone retail online payment');
      return reply.status(status === 500 && code === 'STRIPE_PUBLISHABLE_KEY_MISSING' ? 409 : status).send({
        error: { code, message: error.message || 'The online retail payment could not be started.' },
      });
    }
  });

""")
replace_once(
    retail_routes,
    "  fastify.post('/api/v1/pos/retail/stripe/payment-intents', async (request, reply) => {",
    retail_online_route + "  fastify.post('/api/v1/pos/retail/stripe/payment-intents', async (request, reply) => {",
)

# Tests cover both verified Stripe POS methods and online session safety.
calc_test = 'apps/api/tests/pos-stripe-calculator.test.ts'
replace_once(
    calc_test,
    """test('booking-page Stripe payments remain blocked from staff POS submission', () => {\n  assert.throws(\n    () => getFinalPaymentComponents('STRIPE_ONLINE', 9700),\n    (error: any) => error?.name === 'INVALID_PAYMENT_METHOD',\n  );\n});""",
    """test('Stripe Online is accepted as a provider-confirmed POS card method', () => {\n  const components = getFinalPaymentComponents('STRIPE_ONLINE', 9700);\n  assert.deepEqual(components, [{\n    method: 'STRIPE_ONLINE',\n    amountInCents: 9700,\n    externalProvider: 'STRIPE',\n    externalProviderName: 'Stripe',\n  }]);\n  assert.doesNotThrow(() => validatePaymentMethod('STRIPE_ONLINE', 9700, components));\n});""",
)
write('apps/api/tests/pos-online-payment.test.ts', dedent("""
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('online POS sessions use server totals and provider-confirmed completion', () => {
  const online = source('src/modules/pos/pos-online-stripe.service.ts');
  const routes = source('src/modules/pos/pos.routes.ts');
  const checkout = source('src/modules/pos/pos.service.ts');

  assert.match(online, /unit_amount: input\.amountInCents/);
  assert.match(online, /redirect_on_completion = 'never'/);
  assert.match(online, /stripeAccount: connection\.stripeAccountId/);
  assert.match(routes, /previewCheckout/);
  assert.match(routes, /stripe\/online-sessions/);
  assert.match(checkout, /confirmation\.mode !== 'ONLINE_CHECKOUT'/);
  assert.match(checkout, /method === 'STRIPE_ONLINE'/);
});

test('retail POS online sessions are calculated from live stock prices', () => {
  const routes = source('src/modules/pos/retail-pos.routes.ts');
  const service = source('src/modules/pos/retail-pos.service.ts');

  assert.match(routes, /service\.preview/);
  assert.match(routes, /retail\/stripe\/online-sessions/);
  assert.match(service, /payload\.paymentMethod === 'STRIPE_ONLINE'/);
});
"""))
