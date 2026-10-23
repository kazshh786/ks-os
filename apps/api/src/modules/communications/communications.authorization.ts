import { sql } from '@ks-os/database';
import { z } from 'zod';
import { effectiveCapabilities, type AccessProfile } from '@ks-os/auth';
import type { CommunicationsDatabase } from './communications.database.js';
import { validateCustomerProviderSession } from './communications.customer-provider.js';

export const CommunicationsActorSchema = z.object({
  tenantId: z.string().uuid(), userId: z.string().uuid(), authUserId: z.string().uuid(),
  sessionId: z.string().uuid(), issuedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  // userId is the public principal ID. Customer principals are relationship IDs,
  // never rows in users; persistence always uses the distinct FK below.
  kind: z.literal('CUSTOMER').optional(), customerAccountId: z.string().uuid().optional(),
  customerRelationshipId: z.string().uuid().optional(),
}).strict().refine(a => a.kind === 'CUSTOMER'
  ? Boolean(a.customerAccountId && a.customerRelationshipId === a.userId)
  : !a.customerAccountId && !a.customerRelationshipId, 'Invalid communications principal');
export type CommunicationsActor = z.infer<typeof CommunicationsActorSchema>;
export const isCustomer = (actor: CommunicationsActor) => actor.kind === 'CUSTOMER';
export const staffId = (actor: CommunicationsActor) => isCustomer(actor) ? null : actor.userId;
export const customerId = (actor: CommunicationsActor) => isCustomer(actor) ? actor.customerRelationshipId! : null;
export function requireStaff(actor: CommunicationsActor) {
  if (isCustomer(actor)) throw communicationError(403, 'COMMUNICATIONS_FORBIDDEN', 'Staff access required');
}
export type ConversationAccess = Record<string, unknown> & {
  id: string; tenantId: string; type: string; role: string; archivedAt: Date | null;
};
export const communicationError = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
export const notFound = () => communicationError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');

export class CommunicationsAuthorization {
  constructor(private db: CommunicationsDatabase) {}

  async authenticate(actor: CommunicationsActor) {
    if (new Date(actor.expiresAt).getTime() <= Date.now()) {
      throw communicationError(401, 'AUTH_REQUIRED', 'Authentication required');
    }
    if (isCustomer(actor)) {
      await validateCustomerProviderSession(this.db, actor);
      if (actor.userId !== actor.customerRelationshipId || !actor.customerAccountId) throw communicationError(401, 'AUTH_REQUIRED', 'Authentication required');
      const [active] = await this.db.query(sql`SELECT r.id FROM customer_collaboration_relationships r
        JOIN customer_accounts a ON a.id=r.customer_account_id JOIN tenants t ON t.id=r.tenant_id
        JOIN application_sessions s ON s.auth_user_id=a.auth_user_id
        WHERE r.id=${actor.customerRelationshipId} AND r.tenant_id=${actor.tenantId}
          AND a.id=${actor.customerAccountId} AND a.auth_user_id=${actor.authUserId}
          AND r.status='ACTIVE' AND r.revoked_at IS NULL AND a.status='ACTIVE'
          AND t.is_active=true AND t.lifecycle_status NOT IN ('SUSPENDED','OFFBOARDING','OFFBOARDED')
          AND (a.sessions_valid_after IS NULL OR a.sessions_valid_after < ${actor.issuedAt}::timestamptz)
          AND s.auth_session_id=${actor.sessionId} AND s.application_context='CUSTOMER'
          AND s.revoked_at IS NULL AND s.expires_at>now() LIMIT 1`);
      if (!active) throw communicationError(401, 'AUTH_REQUIRED', 'Authentication required');
      return {userId:actor.userId,canCreateChannels:false,canCreateClientChannels:false};
    }
    const [active] = await this.db.query(sql`
      SELECT u.id,u.role,u.access_profile,u.permissions FROM users u JOIN tenants t ON t.id=u.tenant_id
      JOIN application_sessions s ON s.auth_user_id=u.auth_user_id
      WHERE u.id=${actor.userId} AND u.tenant_id=${actor.tenantId} AND u.auth_user_id=${actor.authUserId}
        AND u.account_status='ACTIVE' AND t.is_active=true
        AND t.lifecycle_status NOT IN ('SUSPENDED','OFFBOARDING','OFFBOARDED')
        AND (u.sessions_valid_after IS NULL OR u.sessions_valid_after < ${actor.issuedAt}::timestamptz)
        AND s.auth_session_id=${actor.sessionId} AND s.application_context='TENANT'
        AND s.selected_tenant_user_id=u.id AND s.security_version=u.security_version
        AND s.revoked_at IS NULL AND s.expires_at > now() LIMIT 1`);
    if (!active) throw communicationError(401, 'AUTH_REQUIRED', 'Authentication required');
    const capabilities=effectiveCapabilities(active.role as 'owner'|'staff',(active.access_profile??'PRACTITIONER') as AccessProfile,(active.permissions??{}) as Record<string,boolean>);
    return { userId: actor.userId, canCreateChannels: active.role === 'owner', canCreateClientChannels:capabilities.includes('CLIENTS_VIEW_BASIC')&&capabilities.includes('CLIENTS_EDIT') };
  }

  async requireConversation(actor: CommunicationsActor, id: string, action: 'view' | 'post' | 'manage' | 'invite' | 'remove' = 'view') {
    await this.authenticate(actor);
    const [access] = await this.db.query<ConversationAccess>(sql`
      SELECT c.id,c.tenant_id AS "tenantId",c.conversation_type AS type,c.archived_at AS "archivedAt",m.role
      FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id AND m.tenant_id=c.tenant_id
      WHERE c.id=${id} AND c.tenant_id=${actor.tenantId} AND c.access_mode='MEMBERS'
        AND ${isCustomer(actor) ? sql`m.customer_relationship_id=${customerId(actor)} AND c.external_client_channel=true
          AND c.conversation_type='CLIENT' AND EXISTS(SELECT 1 FROM customer_collaboration_relationships r
            WHERE r.id=m.customer_relationship_id AND r.tenant_id=c.tenant_id AND r.client_id=c.client_id AND r.status='ACTIVE')`
          : sql`m.user_id=${actor.userId}`} AND m.left_at IS NULL`);
    if (!access) throw notFound();
    if (action !== 'view' && access.archivedAt) throw communicationError(409, 'CONVERSATION_ARCHIVED', 'Conversation is archived');
    if (['manage','invite','remove'].includes(action)) requireStaff(actor);
    if (['manage', 'invite', 'remove'].includes(action) && !['OWNER', 'ADMIN'].includes(access.role)) {
      throw communicationError(403, 'COMMUNICATIONS_FORBIDDEN', 'Conversation manager access required');
    }
    // Direct participants are fixed. A group conversation must be created to add people.
    if (['invite', 'remove'].includes(action) && access.type === 'DIRECT') {
      throw communicationError(409, 'DIRECT_MEMBERS_FIXED', 'Direct conversation participants are fixed');
    }
    return access;
  }

  async requireMessage(actor: CommunicationsActor, conversationId: string, messageId: string) {
    await this.requireConversation(actor, conversationId);
    const [message] = await this.db.query(sql`SELECT id FROM conversation_messages
      WHERE id=${messageId} AND tenant_id=${actor.tenantId} AND conversation_id=${conversationId} AND channel_type='NATIVE'`);
    if (!message) throw notFound();
  }
}
