import { z } from 'zod';
export const MobilePlatformSchema = z.enum(['IOS', 'ANDROID']);
export const MobileEnvironmentSchema = z.enum(['SANDBOX', 'PRODUCTION']);
export const MobileDeviceRegistrationSchema = z.object({
  platform: MobilePlatformSchema,
  applicationId: z.string().min(3).max(255).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/),
  environment: MobileEnvironmentSchema,
  installationId: z.string().uuid(),
  deviceName: z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f\u007f]+$/).optional(),
}).strict();
export const MobileDeviceParamsSchema = z.object({ deviceId: z.string().uuid() }).strict();
export const MobileDeviceSchema = z.object({
  id: z.string().uuid(), platform: MobilePlatformSchema, applicationId: z.string(), environment: MobileEnvironmentSchema,
  deviceName: z.string().nullable(), current: z.boolean(), createdAt: z.string().datetime(), lastSeenAt: z.string().datetime(), revokedAt: z.string().datetime().nullable(),
}).strict();
