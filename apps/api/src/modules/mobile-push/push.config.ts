import { z } from 'zod';
import { ApnsAdapter } from './push.apns.js';
import { FcmAdapter } from './push.fcm.js';
import type { PushAdapter } from './push.types.js';

const environment = z.enum(['SANDBOX', 'PRODUCTION']);
const application = z.string().min(3).max(255).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/);
/** No default identifiers, credentials or real send enablement are supplied. */
export function configuredPushAdapters(env: NodeJS.ProcessEnv = process.env): PushAdapter[] {
  if (env.MOBILE_PUSH_ENABLED !== 'true') return [];
  const adapters: PushAdapter[] = [];
  try {
    if (env.APNS_PRIVATE_KEY) adapters.push(new ApnsAdapter({ teamId: z.string().regex(/^[A-Z0-9]{10}$/).parse(env.APNS_TEAM_ID), keyId: z.string().regex(/^[A-Z0-9]{10}$/).parse(env.APNS_KEY_ID), privateKey: env.APNS_PRIVATE_KEY, applicationId: application.parse(env.APNS_BUNDLE_ID), environment: environment.parse(env.APNS_ENVIRONMENT), voipEnabled: env.APNS_VOIP_ENABLED === 'true' }));
    if (env.FCM_PRIVATE_KEY) adapters.push(new FcmAdapter({ projectId: z.string().regex(/^[a-z][a-z0-9-]{4,62}$/).parse(env.FCM_PROJECT_ID), clientEmail: z.string().email().parse(env.FCM_CLIENT_EMAIL), privateKey: env.FCM_PRIVATE_KEY, applicationId: application.parse(env.FCM_APPLICATION_ID), environment: environment.parse(env.FCM_ENVIRONMENT) }));
  } catch { for (const adapter of adapters) adapter.close?.(); throw new Error('MOBILE_PUSH_CONFIGURATION_INVALID'); }
  if (!adapters.length) throw new Error('MOBILE_PUSH_CONFIGURATION_REQUIRED');
  return adapters;
}
