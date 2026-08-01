import { z } from 'zod';
import { WhatsAppPackageTierSchema, WhatsAppTemplateSchema } from './conversations.js';

export const WhatsAppCampaignAudienceSchema = z.enum([
  'ALL_OPTED_IN',
  'UPCOMING_BOOKING_30_DAYS',
  'LAPSED_90_DAYS',
]);

export const WhatsAppCampaignStatusSchema = z.enum([
  'SCHEDULED',
  'PROCESSING',
  'DISPATCHED',
  'CANCELLED',
  'FAILED',
]);

export const CreateWhatsAppCampaignSchema = z.object({
  name: z.string().trim().min(2).max(255),
  templateId: z.string().uuid(),
  audienceType: WhatsAppCampaignAudienceSchema,
  templateParameters: z.array(z.string().trim().max(1000)).max(20).default([]),
  scheduledAt: z.string().datetime().optional(),
  recipientLimit: z.coerce.number().int().min(1).max(1000).default(500),
}).strict();

export const WhatsAppCampaignSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: WhatsAppCampaignStatusSchema,
  audienceType: WhatsAppCampaignAudienceSchema,
  templateId: z.string().uuid(),
  templateName: z.string(),
  templateLanguage: z.string(),
  scheduledAt: z.string().datetime(),
  recipientLimit: z.number().int().positive(),
  queuedCount: z.number().int().nonnegative(),
  sentCount: z.number().int().nonnegative(),
  deliveredCount: z.number().int().nonnegative(),
  readCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  failureCode: z.string().nullable(),
  createdAt: z.string().datetime(),
}).strict();

export const WhatsAppCampaignListResponseSchema = z.object({
  data: z.array(WhatsAppCampaignSchema),
  meta: z.object({
    packageTier: WhatsAppPackageTierSchema,
    monthlyLimit: z.number().int().positive(),
    usedThisMonth: z.number().int().nonnegative(),
    remainingThisMonth: z.number().int().nonnegative(),
    frequencyCapDays: z.number().int().positive(),
    marketingTemplates: z.array(WhatsAppTemplateSchema),
  }).strict(),
}).strict();

export type WhatsAppCampaignAudience = z.infer<typeof WhatsAppCampaignAudienceSchema>;
export type WhatsAppCampaignStatus = z.infer<typeof WhatsAppCampaignStatusSchema>;
export type CreateWhatsAppCampaign = z.infer<typeof CreateWhatsAppCampaignSchema>;
export type WhatsAppCampaign = z.infer<typeof WhatsAppCampaignSchema>;
export type WhatsAppCampaignListResponse = z.infer<typeof WhatsAppCampaignListResponseSchema>;
