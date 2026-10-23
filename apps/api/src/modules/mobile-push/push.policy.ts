import { sql } from '@ks-os/database';
import { validateMobileDeviceSession } from '../authentication/mobile-devices.service.js';
import type { CommunicationsDatabase } from '../communications/communications.database.js';
import { canDeliverMeetingNotification } from '../communications/communications.meeting-notifications.js';
import { decryptSecret } from '../integrations/integration-security.js';
import type { PushPayload, PushTarget } from './push.types.js';

export type PushDelivery = Record<string, unknown> & { id: string; notification_id: string; registration_id: string; context_id: string; token_version: number; tenant_id: string; attempt_count: number; lease_id: string; expires_at: Date | string };
export type PushEligibility = { target: PushTarget; payload: PushPayload } | { reason: string };
type Row = Record<string, any>;
export async function authorizePush(db: CommunicationsDatabase, delivery: PushDelivery): Promise<PushEligibility> {
  const [row] = await db.query<Row>(sql`SELECT n.*,n.chat_conversation_id AS conversation_id,n.chat_meeting_id AS meeting_id,
    d.id AS device_id,d.auth_user_id,d.application_id,d.environment,d.platform,d.auth_issued_at,
    r.provider,r.channel,r.token_ciphertext,r.token_version,r.token_updated_at,c.application_context,c.user_id AS context_user,c.customer_relationship_id AS context_customer,c.security_version,
    p.push,p.dnd,p.sound,p.direct_messages,p.meetings,p.incoming_calls,p.content_previews
    FROM mobile_push_deliveries q JOIN internal_notifications n ON n.id=q.notification_id AND n.tenant_id=q.tenant_id
    JOIN mobile_push_registrations r ON r.id=q.registration_id JOIN mobile_devices d ON d.id=r.device_id
    JOIN mobile_push_contexts c ON c.id=q.context_id AND c.device_id=d.id AND c.tenant_id=n.tenant_id
    JOIN communication_preferences p ON p.tenant_id=c.tenant_id AND coalesce(p.user_id,p.customer_relationship_id)=coalesce(c.user_id,c.customer_relationship_id)
    JOIN tenants t ON t.id=n.tenant_id
    WHERE q.id=${delivery.id} AND q.status='PROCESSING' AND q.lease_id=${delivery.lease_id} AND q.lease_expires_at>now()
      AND q.expires_at>now() AND (n.expires_at IS NULL OR n.expires_at>now()) AND n.read_at IS NULL
      AND r.token_version=q.token_version AND r.revoked_at IS NULL AND r.invalidated_at IS NULL AND d.revoked_at IS NULL AND c.enabled
      AND coalesce(n.recipient_user_id,n.recipient_customer_relationship_id)=coalesce(c.user_id,c.customer_relationship_id)
      AND t.is_active AND t.lifecycle_status NOT IN ('SUSPENDED','OFFBOARDING','OFFBOARDED')`);
  if (!row) return { reason: 'PUSH_ACCESS_CHANGED' };
  if (!row.push || row.dnd) return { reason: 'PUSH_PREFERENCE' };
  try { await validateMobileDeviceSession(db, { deviceId: row.device_id, authUserId: row.auth_user_id, context: row.application_context }); }
  catch (error) {
    if ((error as { statusCode?: number }).statusCode === 401 || (error as { statusCode?: number }).statusCode === 403) return { reason: 'PUSH_SESSION_REVOKED' };
    throw error; // A database outage is retryable, never evidence of revocation.
  }
  if (row.application_context === 'TENANT') {
    const [principal] = await db.query(sql`SELECT id FROM users WHERE id=${row.context_user} AND id=${row.recipient_user_id} AND tenant_id=${row.tenant_id} AND auth_user_id=${row.auth_user_id}
      AND account_status='ACTIVE' AND security_version=${row.security_version} AND (sessions_valid_after IS NULL OR sessions_valid_after<${new Date(row.auth_issued_at).toISOString()}::timestamptz)`);
    if (!principal) return { reason: 'PUSH_PRINCIPAL_REVOKED' };
  } else {
    const [principal] = await db.query(sql`SELECT r.id FROM customer_collaboration_relationships r JOIN customer_accounts a ON a.id=r.customer_account_id
      WHERE r.id=${row.context_customer} AND r.id=${row.recipient_customer_relationship_id} AND r.tenant_id=${row.tenant_id} AND a.auth_user_id=${row.auth_user_id}
      AND r.status='ACTIVE' AND r.revoked_at IS NULL AND a.status='ACTIVE' AND (a.sessions_valid_after IS NULL OR a.sessions_valid_after<${new Date(row.auth_issued_at).toISOString()}::timestamptz)`);
    if (!principal) return { reason: 'PUSH_RELATIONSHIP_REVOKED' };
  }
  let conversation: Row | undefined;
  if (row.conversation_id) {
    [conversation] = await db.query<Row>(sql`SELECT c.name,c.conversation_type,m.notification_preference,m.last_read_position FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id AND m.tenant_id=c.tenant_id
      WHERE c.id=${row.conversation_id} AND c.tenant_id=${row.tenant_id} AND c.access_mode='MEMBERS' AND c.archived_at IS NULL AND m.left_at IS NULL
      AND coalesce(m.user_id,m.customer_relationship_id)=coalesce(${row.context_user}::uuid,${row.context_customer}::uuid)
      AND (${row.application_context}<>'CUSTOMER' OR (c.external_client_channel AND c.conversation_type='CLIENT' AND EXISTS(SELECT 1 FROM customer_collaboration_relationships rel WHERE rel.id=m.customer_relationship_id AND rel.client_id=c.client_id AND rel.tenant_id=c.tenant_id)))`);
    if (!conversation) return { reason: 'PUSH_MEMBERSHIP_REVOKED' };
    if (conversation.notification_preference === 'NONE' || (conversation.conversation_type === 'DIRECT' && !row.direct_messages)) return { reason: 'PUSH_CONVERSATION_MUTED' };
  } else if (row.application_context === 'CUSTOMER' || !row.meeting_id) return { reason: 'PUSH_CONTEXT_INVALID' };
  if (row.chat_message_id) {
    if (conversation?.notification_preference === 'MENTIONS' && row.type !== 'CHAT_MENTION') return { reason: 'PUSH_MENTIONS_ONLY' };
    const [message] = await db.query<Row>(sql`SELECT id,native_position FROM conversation_messages WHERE id=${row.chat_message_id} AND tenant_id=${row.tenant_id} AND conversation_id=${row.conversation_id} AND channel_type='NATIVE' AND deleted_at IS NULL`);
    if (!message || BigInt(conversation?.last_read_position ?? 0) >= BigInt(message.native_position)) return { reason: 'PUSH_MESSAGE_READ_OR_DELETED' };
  }
  if (row.meeting_id) {
    if ((row.type.startsWith('CALL_') && !row.incoming_calls) || (row.type.startsWith('MEETING_') && !row.meetings)) return { reason: 'PUSH_MEETING_PREFERENCE' };
    if (row.type === 'CALL_INCOMING' && conversation?.notification_preference !== 'ALL') return { reason: 'PUSH_CALL_MUTED' };
    if (!await canDeliverMeetingNotification(db, { tenantId: row.tenant_id, recipientUserId: row.recipient_user_id, recipientCustomerRelationshipId: row.recipient_customer_relationship_id, meetingId: row.meeting_id, meetingVersion: row.meeting_version, type: row.type, conversationId: row.conversation_id })) return { reason: 'PUSH_MEETING_CHANGED' };
  }
  if (row.channel === 'VOIP' && row.type !== 'CALL_INCOMING') return { reason: 'PUSH_VOIP_CALL_ONLY' };
  let token: string; try { token = decryptSecret<{ token: string }>(row.token_ciphertext).token; if (typeof token !== 'string') throw new Error(); } catch { return { reason: 'PUSH_TOKEN_UNAVAILABLE' }; }
  // Content previews reveal only the explicitly opted-in conversation label, never message/document bodies.
  const suffix = row.content_previews && conversation?.name ? ' in ' + String(conversation.name).replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 80) : '';
  const labels: Record<string, string> = { CHAT_MESSAGE: 'New message', CHAT_MENTION: 'New mention', CHAT_THREAD: 'New thread reply', CHAT_INVITATION: 'New conversation invitation', CALL_INCOMING: 'Incoming call', CALL_MISSED: 'Missed call', MEETING_INVITATION: 'Meeting invitation', MEETING_UPDATED: 'Meeting updated', MEETING_CANCELLED: 'Meeting cancelled', MEETING_REMINDER: 'Meeting starting soon' };
  return { target: { provider: row.provider, channel: row.channel, applicationId: row.application_id, environment: row.environment, token }, payload: {
    notificationId: row.id, tenantId: row.tenant_id, kind: row.type, context: row.application_context, ...(row.conversation_id ? { conversationId: row.conversation_id } : {}), ...(row.meeting_id ? { meetingId: row.meeting_id } : {}), ...(row.context_customer ? { relationshipId: row.context_customer } : {}),
    expiresAt: new Date(delivery.expires_at).toISOString(), title: 'KSOS', body: (labels[row.type] ?? 'New activity') + suffix + '. Open KSOS to view it.', sound: Boolean(row.sound),
  } };
}
