import { z } from 'zod';
import { normalizeBusinessType } from './business-profile.js';

export const ClientSalesLifecycleSchema = z.enum(['LEAD', 'PROSPECT', 'CUSTOMER', 'FORMER']);
export type ClientSalesLifecycle = z.infer<typeof ClientSalesLifecycleSchema>;

export const SalesStageCategorySchema = z.enum(['OPEN', 'WON', 'LOST']);
export type SalesStageCategory = z.infer<typeof SalesStageCategorySchema>;

export const SalesQuoteStatusSchema = z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'VOID']);
export type SalesQuoteStatus = z.infer<typeof SalesQuoteStatusSchema>;

export const SalesOpportunityActivityTypeSchema = z.enum([
  'CREATED', 'STAGE_CHANGED', 'OWNER_CHANGED', 'VALUE_CHANGED',
  'QUOTE_CREATED', 'QUOTE_SENT', 'QUOTE_ACCEPTED', 'QUOTE_DECLINED',
  'WON', 'LOST',
]);
export type SalesOpportunityActivityType = z.infer<typeof SalesOpportunityActivityTypeSchema>;

const ReferenceSchema = z.string().uuid();
const MoneyMinorSchema = z.number().int().min(0).max(2_147_483_647);
const CurrencySchema = z.string().trim().regex(/^[A-Z]{3}$/);
const IsoDateTimeSchema = z.string().datetime();

export const SalesStageTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: SalesStageCategorySchema,
  probability: z.number().int().min(0).max(100),
}).strict();
export type SalesStageTemplate = z.infer<typeof SalesStageTemplateSchema>;

const DEFAULT_SALES_STAGES: SalesStageTemplate[] = [
  { name: 'New lead', category: 'OPEN', probability: 10 },
  { name: 'Qualified', category: 'OPEN', probability: 30 },
  { name: 'Quote / Proposal', category: 'OPEN', probability: 60 },
  { name: 'Decision', category: 'OPEN', probability: 80 },
  { name: 'Won', category: 'WON', probability: 100 },
  { name: 'Lost', category: 'LOST', probability: 0 },
];

const STAGE_DEFAULTS: Record<string, SalesStageTemplate[]> = {
  AGENCY: [
    { name: 'New lead', category: 'OPEN', probability: 10 },
    { name: 'Discovery', category: 'OPEN', probability: 30 },
    { name: 'Proposal', category: 'OPEN', probability: 55 },
    { name: 'Negotiation', category: 'OPEN', probability: 80 },
    { name: 'Won', category: 'WON', probability: 100 },
    { name: 'Lost', category: 'LOST', probability: 0 },
  ],
  CONSULTANCY: [
    { name: 'New lead', category: 'OPEN', probability: 10 },
    { name: 'Discovery', category: 'OPEN', probability: 30 },
    { name: 'Proposal', category: 'OPEN', probability: 60 },
    { name: 'Decision', category: 'OPEN', probability: 80 },
    { name: 'Won', category: 'WON', probability: 100 },
    { name: 'Lost', category: 'LOST', probability: 0 },
  ],
  LOGISTICS_COURIER: [
    { name: 'Enquiry', category: 'OPEN', probability: 10 },
    { name: 'Qualified', category: 'OPEN', probability: 30 },
    { name: 'Pricing', category: 'OPEN', probability: 50 },
    { name: 'Quote sent', category: 'OPEN', probability: 75 },
    { name: 'Won', category: 'WON', probability: 100 },
    { name: 'Lost', category: 'LOST', probability: 0 },
  ],
  PLUMBING: [
    { name: 'Enquiry', category: 'OPEN', probability: 10 },
    { name: 'Qualified', category: 'OPEN', probability: 30 },
    { name: 'Site visit', category: 'OPEN', probability: 45 },
    { name: 'Quote prepared', category: 'OPEN', probability: 60 },
    { name: 'Quote sent', category: 'OPEN', probability: 80 },
    { name: 'Won', category: 'WON', probability: 100 },
    { name: 'Lost', category: 'LOST', probability: 0 },
  ],
  ELECTRICAL: [
    { name: 'Enquiry', category: 'OPEN', probability: 10 },
    { name: 'Qualified', category: 'OPEN', probability: 30 },
    { name: 'Site visit', category: 'OPEN', probability: 45 },
    { name: 'Quote prepared', category: 'OPEN', probability: 60 },
    { name: 'Quote sent', category: 'OPEN', probability: 80 },
    { name: 'Won', category: 'WON', probability: 100 },
    { name: 'Lost', category: 'LOST', probability: 0 },
  ],
  PROFESSIONAL_SERVICES: [
    { name: 'New lead', category: 'OPEN', probability: 10 },
    { name: 'Qualified', category: 'OPEN', probability: 35 },
    { name: 'Proposal', category: 'OPEN', probability: 60 },
    { name: 'Decision', category: 'OPEN', probability: 80 },
    { name: 'Won', category: 'WON', probability: 100 },
    { name: 'Lost', category: 'LOST', probability: 0 },
  ],
};

export function defaultSalesStagesForBusinessType(value: unknown): SalesStageTemplate[] {
  const type = normalizeBusinessType(value);
  return (type ? STAGE_DEFAULTS[type] : undefined ?? DEFAULT_SALES_STAGES).map(stage => ({ ...stage }));
}

export const SalesPipelineStageSchema = z.object({
  reference: ReferenceSchema,
  name: z.string(),
  position: z.number().int().min(0),
  category: SalesStageCategorySchema,
  probability: z.number().int().min(0).max(100),
  isActive: z.boolean(),
}).strict();

export const SalesPipelineSchema = z.object({
  reference: ReferenceSchema,
  name: z.string(),
  purpose: z.literal('SALES'),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  stages: z.array(SalesPipelineStageSchema),
}).strict();
export type SalesPipeline = z.infer<typeof SalesPipelineSchema>;

export const CreateSalesPipelineSchema = z.object({
  name: z.string().trim().min(2).max(120),
  stages: z.array(SalesStageTemplateSchema).min(3).max(20),
}).strict().superRefine((value, ctx) => {
  if (!value.stages.some(stage => stage.category === 'WON')) ctx.addIssue({ code: 'custom', message: 'A pipeline needs a Won stage.', path: ['stages'] });
  if (!value.stages.some(stage => stage.category === 'LOST')) ctx.addIssue({ code: 'custom', message: 'A pipeline needs a Lost stage.', path: ['stages'] });
});
export type CreateSalesPipelineInput = z.infer<typeof CreateSalesPipelineSchema>;

export const SalesLeadInputSchema = z.object({
  name: z.string().trim().min(2).max(255),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().min(5).max(30).optional(),
}).strict();

export const CreateSalesOpportunitySchema = z.object({
  clientId: z.string().uuid().optional(),
  lead: SalesLeadInputSchema.optional(),
  pipelineReference: ReferenceSchema.optional(),
  stageReference: ReferenceSchema.optional(),
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().max(10_000).optional(),
  ownerUserId: z.string().uuid().optional(),
  source: z.string().trim().max(120).optional(),
  estimatedValue: MoneyMinorSchema.optional(),
  expectedCloseDate: IsoDateTimeSchema.optional(),
}).strict().refine(value => Boolean(value.clientId) !== Boolean(value.lead), {
  message: 'Provide either an existing clientId or a new lead, not both.',
  path: ['clientId'],
});
export type CreateSalesOpportunityInput = z.infer<typeof CreateSalesOpportunitySchema>;

export const UpdateSalesOpportunitySchema = z.object({
  title: z.string().trim().min(2).max(255).optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  source: z.string().trim().max(120).nullable().optional(),
  estimatedValue: MoneyMinorSchema.nullable().optional(),
  expectedCloseDate: IsoDateTimeSchema.nullable().optional(),
}).strict();
export type UpdateSalesOpportunityInput = z.infer<typeof UpdateSalesOpportunitySchema>;

export const ChangeSalesStageSchema = z.object({
  stageReference: ReferenceSchema,
  reason: z.string().trim().max(1000).optional(),
}).strict();
export type ChangeSalesStageInput = z.infer<typeof ChangeSalesStageSchema>;

export const SalesOpportunityListQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  stageReference: ReferenceSchema.optional(),
  ownerUserId: z.string().uuid().optional(),
  state: z.enum(['OPEN', 'WON', 'LOST']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();
export type SalesOpportunityListQuery = z.infer<typeof SalesOpportunityListQuerySchema>;

export const SalesOpportunitySummarySchema = z.object({
  openCount: z.number().int().min(0),
  openValue: MoneyMinorSchema,
  wonCount: z.number().int().min(0),
  wonValue: MoneyMinorSchema,
  quotesAwaitingDecision: z.number().int().min(0),
  currency: CurrencySchema,
}).strict();

export const SalesOpportunitySchema = z.object({
  reference: ReferenceSchema,
  title: z.string(),
  description: z.string().nullable(),
  client: z.object({ id: z.string().uuid(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), lifecycle: ClientSalesLifecycleSchema }),
  pipeline: z.object({ reference: ReferenceSchema, name: z.string() }),
  stage: SalesPipelineStageSchema,
  owner: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  source: z.string().nullable(),
  estimatedValue: MoneyMinorSchema.nullable(),
  currency: CurrencySchema,
  expectedCloseDate: z.string().nullable(),
  closedAt: z.string().nullable(),
  closedReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();
export type SalesOpportunity = z.infer<typeof SalesOpportunitySchema>;

export const SalesOpportunityActivitySchema = z.object({
  reference: ReferenceSchema,
  type: SalesOpportunityActivityTypeSchema,
  actorUserId: z.string().uuid().nullable(),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
}).strict();

export const SalesQuoteItemInputSchema = z.object({
  description: z.string().trim().min(1).max(1000),
  quantity: z.number().int().min(1).max(100_000),
  unitAmount: MoneyMinorSchema,
  taxRateBasisPoints: z.number().int().min(0).max(100_000).default(0),
}).strict();
export type SalesQuoteItemInput = z.infer<typeof SalesQuoteItemInputSchema>;

export const CreateSalesQuoteSchema = z.object({
  title: z.string().trim().min(2).max(255),
  introduction: z.string().trim().max(10_000).optional(),
  terms: z.string().trim().max(20_000).optional(),
  validUntil: IsoDateTimeSchema.optional(),
  items: z.array(SalesQuoteItemInputSchema).min(1).max(100),
}).strict();
export type CreateSalesQuoteInput = z.infer<typeof CreateSalesQuoteSchema>;

export const UpdateSalesQuoteSchema = z.object({
  title: z.string().trim().min(2).max(255).optional(),
  introduction: z.string().trim().max(10_000).nullable().optional(),
  terms: z.string().trim().max(20_000).nullable().optional(),
  validUntil: IsoDateTimeSchema.nullable().optional(),
  items: z.array(SalesQuoteItemInputSchema).min(1).max(100).optional(),
}).strict();
export type UpdateSalesQuoteInput = z.infer<typeof UpdateSalesQuoteSchema>;

export const SalesQuoteItemSchema = SalesQuoteItemInputSchema.extend({
  reference: ReferenceSchema,
  position: z.number().int().min(0),
  subtotal: MoneyMinorSchema,
  taxAmount: MoneyMinorSchema,
  total: MoneyMinorSchema,
}).strict();

export const SalesQuoteSchema = z.object({
  reference: ReferenceSchema,
  opportunityReference: ReferenceSchema,
  clientId: z.string().uuid(),
  status: SalesQuoteStatusSchema,
  quoteNumber: z.string(),
  version: z.number().int().min(1),
  title: z.string(),
  introduction: z.string().nullable(),
  terms: z.string().nullable(),
  currency: CurrencySchema,
  subtotal: MoneyMinorSchema,
  taxTotal: MoneyMinorSchema,
  total: MoneyMinorSchema,
  validUntil: z.string().nullable(),
  sentAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  acceptedByName: z.string().nullable(),
  acceptedByEmail: z.string().nullable(),
  declinedAt: z.string().nullable(),
  declinedReason: z.string().nullable(),
  voidedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(SalesQuoteItemSchema),
}).strict();
export type SalesQuote = z.infer<typeof SalesQuoteSchema>;

export const ShareSalesQuoteResponseSchema = z.object({
  quote: SalesQuoteSchema,
  publicPath: z.string().startsWith('/quote/'),
  expiresAt: z.string(),
}).strict();

export const PublicSalesQuoteSchema = z.object({
  business: z.object({
    name: z.string(),
    primaryColor: z.string(),
    secondaryColor: z.string(),
    accentColor: z.string(),
  }).strict(),
  customer: z.object({ name: z.string(), email: z.string().nullable() }).strict(),
  quote: SalesQuoteSchema,
}).strict();

export const AcceptPublicSalesQuoteSchema = z.object({
  name: z.string().trim().min(2).max(255),
  email: z.string().trim().email().max(255).optional(),
}).strict();
export type AcceptPublicSalesQuoteInput = z.infer<typeof AcceptPublicSalesQuoteSchema>;

export const DeclinePublicSalesQuoteSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
}).strict();
export type DeclinePublicSalesQuoteInput = z.infer<typeof DeclinePublicSalesQuoteSchema>;
