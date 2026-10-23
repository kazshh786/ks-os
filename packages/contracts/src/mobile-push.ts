import { z } from 'zod';
import { ApplicationContextSchema } from './authentication.js';

export const MobilePushProviderSchema = z.enum(['APNS', 'FCM']);
export const MobilePushChannelSchema = z.enum(['ALERT', 'VOIP']);
export const MobilePushApplicationContextSchema = ApplicationContextSchema.extract(['TENANT', 'CUSTOMER']);
export const MobilePushKindSchema = z.enum([
  'CHAT_MESSAGE', 'CHAT_MENTION', 'CHAT_THREAD', 'CHAT_INVITATION',
  'CALL_INCOMING', 'CALL_MISSED',
  'MEETING_INVITATION', 'MEETING_UPDATED', 'MEETING_CANCELLED', 'MEETING_REMINDER',
]);

/** Versioned opaque references shared by APNs ksos and FCM data payloads. */
export const MobilePushReferencesSchema = z.object({
  version: z.literal('1'),
  notificationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  kind: MobilePushKindSchema,
  context: MobilePushApplicationContextSchema,
  relationshipId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  meetingId: z.string().uuid().optional(),
  expiresAt: z.string().datetime(),
}).strict();

/** The device header and verified session determine the application and environment. */
export const MobilePushRegistrationInputSchema = z.object({
  provider: MobilePushProviderSchema,
  channel: MobilePushChannelSchema,
  token: z.string().min(2).max(4096).refine(value => !/\s/.test(value)),
}).strict();
export const MobilePushResourceParamsSchema = z.object({ id: z.string().uuid() }).strict();

/** Staff use their selected workspace; customers explicitly select an authorised relationship. */
export const MobilePushContextInputSchema = z.object({ relationshipId: z.string().uuid().optional() }).strict();
export const MobilePushCapabilitiesSchema = z.object({ enabled: z.boolean(), voip: z.boolean() }).strict();

/** Registration responses never contain tokens, token hashes, or ciphertext. */
export const MobilePushRegistrationSchema = z.object({
  id: z.string().uuid(),
  provider: MobilePushProviderSchema,
  channel: MobilePushChannelSchema,
  tokenVersion: z.number().int().positive(),
  lastSeenAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  invalidatedAt: z.string().datetime().nullable(),
}).strict();
export const MobilePushContextSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  context: MobilePushApplicationContextSchema,
  userId: z.string().uuid().nullable(),
  relationshipId: z.string().uuid().nullable(),
  enabled: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.context === 'TENANT' ? !value.userId || value.relationshipId !== null : !value.relationshipId || value.userId !== null) {
    context.addIssue({ code: 'custom', message: 'The recipient must match the selected application context.' });
  }
});

export const MobilePushCapabilitiesResponseSchema = z.object({ data: MobilePushCapabilitiesSchema }).strict();
export const MobilePushRegistrationResponseSchema = z.object({ data: MobilePushRegistrationSchema }).strict();
export const MobilePushRegistrationsResponseSchema = z.object({ data: z.array(MobilePushRegistrationSchema) }).strict();
export const MobilePushContextResponseSchema = z.object({ data: MobilePushContextSchema }).strict();
export const MobilePushContextsResponseSchema = z.object({ data: z.array(MobilePushContextSchema) }).strict();
export const MobilePushRevokeResponseSchema = z.object({ data: z.object({ revoked: z.literal(true) }).strict() }).strict();
export const MobilePushDisableContextResponseSchema = z.object({ data: z.object({ disabled: z.literal(true) }).strict() }).strict();

export type MobilePushProvider = z.infer<typeof MobilePushProviderSchema>;
export type MobilePushChannel = z.infer<typeof MobilePushChannelSchema>;
export type MobilePushKind = z.infer<typeof MobilePushKindSchema>;
export type MobilePushReferences = z.infer<typeof MobilePushReferencesSchema>;
export type MobilePushRegistrationInput = z.infer<typeof MobilePushRegistrationInputSchema>;
export type MobilePushRegistration = z.infer<typeof MobilePushRegistrationSchema>;
export type MobilePushContextInput = z.infer<typeof MobilePushContextInputSchema>;
export type MobilePushContext = z.infer<typeof MobilePushContextSchema>;
export type MobilePushCapabilities = z.infer<typeof MobilePushCapabilitiesSchema>;
export type MobilePushCapabilitiesResponse = z.infer<typeof MobilePushCapabilitiesResponseSchema>;
export type MobilePushRegistrationResponse = z.infer<typeof MobilePushRegistrationResponseSchema>;
export type MobilePushRegistrationsResponse = z.infer<typeof MobilePushRegistrationsResponseSchema>;
export type MobilePushContextResponse = z.infer<typeof MobilePushContextResponseSchema>;
export type MobilePushContextsResponse = z.infer<typeof MobilePushContextsResponseSchema>;
