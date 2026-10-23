import { sql } from '@ks-os/database';
import type { CommunicationsDatabase } from './communications.database.js';

/** The API-only migration function exposes a boolean, never provider user data. */
export async function validateCustomerProviderSession(db: CommunicationsDatabase, actor: { sessionId: string; authUserId: string }) {
  const [row] = await db.query<{ current: boolean }>(sql`SELECT public.customer_provider_session_is_current(${actor.sessionId}::uuid,${actor.authUserId}::uuid) AS current`);
  if (!row?.current) throw Object.assign(new Error('Sign in is required to continue.'), { statusCode: 401, code: 'CUSTOMER_AUTH_REQUIRED' });
}
