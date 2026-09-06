import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AcceptPublicSalesQuoteSchema,
  ChangeSalesStageSchema,
  CreateSalesOpportunitySchema,
  CreateSalesPipelineSchema,
  CreateSalesQuoteSchema,
  DeclinePublicSalesQuoteSchema,
  SalesOpportunityListQuerySchema,
  UpdateSalesOpportunitySchema,
  UpdateSalesQuoteSchema,
} from '@ks-os/contracts';
import { SalesService, type SalesActor } from './sales.service.js';

const ReferenceParamsSchema = { parse(value: unknown) {
  const reference = (value as { reference?: unknown })?.reference;
  if (typeof reference !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference)) throw Object.assign(new Error('Invalid sales reference.'), { statusCode: 400, code: 'SALES_REFERENCE_INVALID' });
  return { reference };
} };
const TokenParamsSchema = { parse(value: unknown) {
  const token = (value as { token?: unknown })?.token;
  if (typeof token !== 'string' || token.length < 32 || token.length > 200) throw Object.assign(new Error('Invalid quote link.'), { statusCode: 404, code: 'PUBLIC_QUOTE_NOT_FOUND' });
  return { token };
} };

function actor(request: FastifyRequest): SalesActor {
  request.requireAuth();
  return {
    tenantId: request.auth!.tenantId,
    userId: request.auth!.tenantUserId,
    role: request.auth!.role,
    permissions: request.auth!.permissions as string[],
  };
}

export async function salesRoutes(app: FastifyInstance) {
  const service = new SalesService();

  app.get('/summary', async request => ({ data: await service.summary(actor(request)) }));
  app.get('/pipelines', async request => ({ data: await service.listPipelines(actor(request)) }));
  app.post('/pipelines', async request => ({ data: await service.createPipeline(actor(request), CreateSalesPipelineSchema.parse(request.body)) }));

  app.get('/opportunities', async request => ({ data: await service.listOpportunities(actor(request), SalesOpportunityListQuerySchema.parse(request.query)) }));
  app.post('/opportunities', async request => ({ data: await service.createOpportunity(actor(request), CreateSalesOpportunitySchema.parse(request.body)) }));
  app.get('/opportunities/:reference', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.getOpportunity(actor(request), reference) };
  });
  app.patch('/opportunities/:reference', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.updateOpportunity(actor(request), reference, UpdateSalesOpportunitySchema.parse(request.body)) };
  });
  app.post('/opportunities/:reference/stage', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.changeStage(actor(request), reference, ChangeSalesStageSchema.parse(request.body)) };
  });
  app.post('/opportunities/:reference/quotes', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.createQuote(actor(request), reference, CreateSalesQuoteSchema.parse(request.body)) };
  });

  app.get('/quotes/:reference', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.getQuote(actor(request), reference) };
  });
  app.patch('/quotes/:reference', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.updateQuote(actor(request), reference, UpdateSalesQuoteSchema.parse(request.body)) };
  });
  app.post('/quotes/:reference/share', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.shareQuote(actor(request), reference) };
  });
  app.post('/quotes/:reference/void', async request => {
    const { reference } = ReferenceParamsSchema.parse(request.params);
    return { data: await service.voidQuote(actor(request), reference) };
  });
}

export async function publicSalesQuoteRoutes(app: FastifyInstance) {
  const service = new SalesService();
  app.get('/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async request => {
    const { token } = TokenParamsSchema.parse(request.params);
    return { data: await service.getPublicQuote(token) };
  });
  app.post('/:token/accept', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async request => {
    const { token } = TokenParamsSchema.parse(request.params);
    return { data: await service.acceptPublicQuote(token, AcceptPublicSalesQuoteSchema.parse(request.body)) };
  });
  app.post('/:token/decline', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async request => {
    const { token } = TokenParamsSchema.parse(request.params);
    return { data: await service.declinePublicQuote(token, DeclinePublicSalesQuoteSchema.parse(request.body)) };
  });
}
