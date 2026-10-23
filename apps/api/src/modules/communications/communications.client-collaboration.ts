import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { effectiveCapabilities, type AccessProfile } from '@ks-os/auth';
import { sql } from '@ks-os/database';
import { z } from 'zod';
import { CustomerAuthService, normalizeCustomerEmail, verifyCustomerEmail, type CustomerIdentity } from '../customer-portal/customer-auth.service.js';
import { EmailService } from '../email/email.service.js';
import { CommunicationsAuthorization, CommunicationsActorSchema, communicationError, type CommunicationsActor } from './communications.authorization.js';
import { communicationsDatabase, type CommunicationsDatabase } from './communications.database.js';
import { ClientMeetings } from './communications.client-meetings.js';
import { meetingBranding } from './communications.meeting-branding.js';
import { validateCustomerProviderSession } from './communications.customer-provider.js';
import { collaborationLimits, reserveCollaborationCapacity } from './communications.collaboration-policy.js';
import { collaborationHash, collaborationInvitationToken, collaborationInvitationUrl, collaborationSecretMatches } from './communications.collaboration-secrets.js';

type Row = Record<string, any>;
export type CollaborationIdentity = CustomerIdentity & { sessionId: string; issuedAt: string; expiresAt: string };
export const ClientChannelInput = z.object({ clientId: z.string().uuid(), name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).default(''), staffUserIds: z.array(z.string().uuid()).max(100).default([]), requestId: z.string().uuid() }).strict();
const missing = () => communicationError(404, 'COLLABORATION_UNAVAILABLE', 'This customer collaboration is unavailable.');
const denied = () => communicationError(403, 'COLLABORATION_FORBIDDEN', 'You do not have permission to manage customer collaboration.');
const iso = (value: unknown) => value ? new Date(value as string).toISOString() : null;

export function collaborationIdentity(request: FastifyRequest): CollaborationIdentity {
  const identity = new CustomerAuthService().requireIdentity(request);
  return { ...identity, sessionId: request.authIdentity!.authSessionId!, issuedAt: request.authIdentity!.issuedAt!, expiresAt: request.authIdentity!.expiresAt! };
}
export async function customerCollaborationActor(request: FastifyRequest, relationshipId?: string) {
  const id = z.string().uuid().parse(relationshipId ?? (request.params as { relationshipId?: string }).relationshipId);
  return new ClientCollaboration().actor(collaborationIdentity(request), id);
}

/** Explicit communications-only relationships never create legacy booking links. */
export class ClientCollaboration {
  private meetings: ClientMeetings;
  private verifyEmail: (identity: CustomerIdentity) => Promise<void>;
  constructor(private db: CommunicationsDatabase = communicationsDatabase(), options: { meetings?: ClientMeetings; verifyEmail?: (identity: CustomerIdentity) => Promise<void> } = {}) {
    this.meetings = options.meetings ?? new ClientMeetings(db);
    this.verifyEmail = options.verifyEmail ?? verifyCustomerEmail;
  }
  private lock<T>(tenantId: string, work: (db: CommunicationsDatabase) => Promise<T>) { return this.db.transaction(async db => {
    await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId},8241))`); return work(db);
  }); }
  private async staff(db: CommunicationsDatabase, actor: CommunicationsActor, manage = false) {
    if (actor.kind === 'CUSTOMER') throw denied();
    await new CommunicationsAuthorization(db).authenticate(actor);
    const [user] = await db.query<Row>(sql`SELECT role,access_profile,permissions FROM users WHERE id=${actor.userId} AND tenant_id=${actor.tenantId}`);
    const caps = effectiveCapabilities(user.role, (user.access_profile ?? 'PRACTITIONER') as AccessProfile, user.permissions ?? {});
    if (!caps.includes('CLIENTS_VIEW_BASIC') || manage && !caps.includes('CLIENTS_EDIT')) throw denied();
    return { canManage: caps.includes('CLIENTS_EDIT') };
  }
  private async channel(db: CommunicationsDatabase, actor: CommunicationsActor, id: string, manage = false) {
    await this.staff(db, actor);
    await new CommunicationsAuthorization(db).requireConversation(actor, id, manage ? 'invite' : 'view');
    const [row] = await db.query<Row>(sql`SELECT * FROM conversations WHERE id=${id} AND tenant_id=${actor.tenantId} AND external_client_channel AND access_mode='MEMBERS' AND conversation_type='CLIENT'`);
    if (!row || manage && row.archived_at) throw missing(); return row;
  }
  private async audit(db: CommunicationsDatabase, actor: CommunicationsActor | CollaborationIdentity, tenant: string, action: string, metadata: Record<string, unknown>) {
    const staff = 'userId' in actor && actor.kind !== 'CUSTOMER';
    await db.query(sql`INSERT INTO account_access_audit_events(auth_user_id,tenant_id,tenant_user_id,application_context,action,outcome,metadata)
      VALUES(${actor.authUserId},${tenant},${staff ? actor.userId : null},${staff ? 'TENANT' : 'CUSTOMER'},${action},'SUCCESS',${JSON.stringify(metadata)}::jsonb)`);
  }
  private async event(db: CommunicationsDatabase, tenant: string, conversation: string, type: string, resource: string) {
    await db.query(sql`UPDATE conversations SET updated_at=now() WHERE tenant_id=${tenant} AND id=${conversation}`);
    await db.query(sql`INSERT INTO communication_events(tenant_id,conversation_id,type,resource_id) VALUES(${tenant},${conversation},${type},${resource})`);
  }
  private async identity(db: CommunicationsDatabase, identity: CollaborationIdentity, create = false) {
    if (!Number.isFinite(new Date(identity.expiresAt).getTime()) || new Date(identity.expiresAt).getTime() <= Date.now()) throw missing();
    await validateCustomerProviderSession(db, identity);
    const [session] = await db.query(sql`SELECT id FROM application_sessions WHERE auth_session_id=${identity.sessionId} AND auth_user_id=${identity.authUserId}
      AND application_context='CUSTOMER' AND revoked_at IS NULL AND expires_at>now()`);
    if (!session) throw communicationError(401, 'CUSTOMER_AUTH_REQUIRED', 'Sign in is required to continue.');
    if (create) await db.query(sql`INSERT INTO customer_accounts(auth_user_id,email_normalized,display_name) VALUES(${identity.authUserId},${normalizeCustomerEmail(identity.email)},${identity.email.split('@')[0].slice(0,120)}) ON CONFLICT(auth_user_id) DO NOTHING`);
    const [account] = await db.query<Row>(sql`SELECT * FROM customer_accounts WHERE auth_user_id=${identity.authUserId} AND status='ACTIVE' AND (sessions_valid_after IS NULL OR sessions_valid_after<${identity.issuedAt}::timestamptz)`);
    if (!account) throw communicationError(401, 'CUSTOMER_AUTH_REQUIRED', 'Sign in is required to continue.'); return account;
  }
  async actor(identity: CollaborationIdentity, relationshipId: string) {
    const account = await this.identity(this.db, identity);
    const [r] = await this.db.query<Row>(sql`SELECT * FROM customer_collaboration_relationships WHERE id=${relationshipId} AND customer_account_id=${account.id} AND status='ACTIVE' AND revoked_at IS NULL`);
    if (!r) throw missing();
    const actor = CommunicationsActorSchema.parse({ tenantId: r.tenant_id, userId: r.id, kind: 'CUSTOMER', customerAccountId: account.id, customerRelationshipId: r.id, authUserId: identity.authUserId, sessionId: identity.sessionId, issuedAt: identity.issuedAt, expiresAt: identity.expiresAt });
    await new CommunicationsAuthorization(this.db).authenticate(actor); return actor;
  }
  async session(identity: CollaborationIdentity) {
    await this.verifyEmail(identity);
    const account = await this.identity(this.db, identity, true);
    const rows = await this.db.query<Row>(sql`SELECT r.id,r.tenant_id,r.client_id,c.name AS client_name FROM customer_collaboration_relationships r JOIN clients c ON c.id=r.client_id AND c.tenant_id=r.tenant_id JOIN tenants t ON t.id=r.tenant_id WHERE r.customer_account_id=${account.id} AND r.status='ACTIVE' AND r.revoked_at IS NULL AND t.is_active AND t.lifecycle_status NOT IN ('SUSPENDED','OFFBOARDING','OFFBOARDED') ORDER BY t.name,c.name,r.id LIMIT 200`);
    const relationships = [];
    for (const r of rows) { const b = await meetingBranding(this.db, r.tenant_id); relationships.push({ id: r.id, tenantId: r.tenant_id, clientId: r.client_id, businessName: b.name, clientName: r.client_name, logoUrl: b.logoUrl, primaryColor: b.primaryColor, secondaryColor: b.secondaryColor }); }
    return { actorId: account.id, displayName: account.display_name, email: normalizeCustomerEmail(identity.email), relationships };
  }
  async customers(actor: CommunicationsActor, q = '', clientReference?: string) {
    await this.staff(this.db, actor);
    return this.db.query(sql`SELECT id,name,public_reference AS reference FROM clients WHERE tenant_id=${actor.tenantId} ${clientReference?sql`AND public_reference=${clientReference}`:sql``} ${q ? sql`AND strpos(lower(name),lower(${q.slice(0,100)}))>0` : sql``} ORDER BY name,id LIMIT 50`);
  }
  async config(actor: CommunicationsActor, clientId?: string) {
    const permissions = await this.staff(this.db, actor);
    const staff = await this.db.query(sql`SELECT id,name FROM users WHERE tenant_id=${actor.tenantId} AND account_status='ACTIVE' AND auth_user_id IS NOT NULL ORDER BY name,id LIMIT 200`);
    const contacts = clientId ? await this.db.query(sql`SELECT r.id AS "relationshipId",r.customer_account_id AS "customerAccountId",a.display_name AS name,a.email_normalized AS email,r.status FROM customer_collaboration_relationships r JOIN customer_accounts a ON a.id=r.customer_account_id WHERE r.tenant_id=${actor.tenantId} AND r.client_id=${clientId} AND a.status='ACTIVE' ORDER BY a.display_name,r.id LIMIT 200`) : [];
    return { ...permissions, staff, contacts, limits:await collaborationLimits(this.db,actor.tenantId) };
  }
  async channels(actor: CommunicationsActor, query: { clientId?: string; clientReference?: string; after?: string } = {}) {
    await this.staff(this.db, actor);
    const rows = await this.db.query<Row>(sql`SELECT c.id,c.name,c.client_id AS "clientId",cl.name AS "clientName",c.archived_at AS "archivedAt" FROM conversations c JOIN clients cl ON cl.id=c.client_id AND cl.tenant_id=c.tenant_id JOIN conversation_members m ON m.conversation_id=c.id AND m.tenant_id=c.tenant_id AND m.user_id=${actor.userId} AND m.left_at IS NULL WHERE c.tenant_id=${actor.tenantId} AND c.external_client_channel ${query.clientId ? sql`AND c.client_id=${query.clientId}` : sql``} ${query.clientReference ? sql`AND cl.public_reference=${query.clientReference}` : sql``} ${query.after ? sql`AND c.id>${query.after}` : sql``} ORDER BY c.id LIMIT 31`);
    return { data: rows.slice(0,30), nextCursor: rows.length > 30 ? rows[29].id : null };
  }
  async create(actor: CommunicationsActor, raw: unknown) {
    const input = ClientChannelInput.parse(raw), members = [...new Set([actor.userId,...input.staffUserIds])].sort();
    const hash = collaborationHash(JSON.stringify({ ...input, staffUserIds: members }));
    return this.lock(actor.tenantId, async db => {
      await this.staff(db, actor, true);
      const [retry] = await db.query<Row>(sql`SELECT id,collaboration_request_hash FROM conversations WHERE tenant_id=${actor.tenantId} AND collaboration_request_id=${input.requestId} AND external_client_channel`);
      if (retry) { if (retry.collaboration_request_hash !== hash) throw communicationError(409,'RETRY_CONFLICT','Create a new channel request.'); await this.channel(db,actor,retry.id); return { id: retry.id }; }
      await reserveCollaborationCapacity(db,actor.tenantId,'channel');
      const [client] = await db.query(sql`SELECT id FROM clients WHERE id=${input.clientId} AND tenant_id=${actor.tenantId}`); if (!client) throw missing();
      const staff = await db.query(sql`SELECT id FROM users WHERE tenant_id=${actor.tenantId} AND account_status='ACTIVE' AND auth_user_id IS NOT NULL AND id IN (${sql.join(members.map(id=>sql`${id}::uuid`),sql`,`)})`);
      if (staff.length !== members.length) throw missing();
      const id = randomUUID();
      await db.query(sql`INSERT INTO conversations(id,tenant_id,client_id,primary_channel,customer_display_name,access_mode,conversation_type,name,description,created_by_user_id,external_client_channel,collaboration_request_id,collaboration_request_hash) VALUES(${id},${actor.tenantId},${input.clientId},'NATIVE',${input.name},'MEMBERS','CLIENT',${input.name},${input.description},${actor.userId},true,${input.requestId},${hash})`);
      for (const user of members) await db.query(sql`INSERT INTO conversation_members(tenant_id,conversation_id,user_id,role) VALUES(${actor.tenantId},${id},${user},${user===actor.userId?'OWNER':'MEMBER'})`);
      await this.audit(db,actor,actor.tenantId,'CUSTOMER_CHANNEL_CREATED',{conversationId:id,clientId:input.clientId}); await this.event(db,actor.tenantId,id,'conversation.created',id); return {id};
    });
  }
  async access(actor: CommunicationsActor, conversationId: string) {
    const channel = await this.channel(this.db,actor,conversationId);
    const [member] = await this.db.query<Row>(sql`SELECT role FROM conversation_members WHERE conversation_id=${conversationId} AND user_id=${actor.userId} AND left_at IS NULL`);
    const canManage = ['OWNER','ADMIN'].includes(member?.role);
    const contacts = await this.db.query(sql`SELECT r.id AS "relationshipId",r.customer_account_id AS "customerAccountId",a.display_name AS name,a.email_normalized AS email,r.status FROM conversation_members m JOIN customer_collaboration_relationships r ON r.id=m.customer_relationship_id JOIN customer_accounts a ON a.id=r.customer_account_id WHERE m.conversation_id=${conversationId} AND m.tenant_id=${actor.tenantId} AND m.left_at IS NULL ORDER BY a.display_name,r.id LIMIT 200`);
    const invitations = canManage ? await this.db.query(sql`SELECT id,email_normalized AS email,expires_at AS "expiresAt",CASE WHEN status='PENDING' AND expires_at<=now() THEN 'EXPIRED' ELSE status END AS status FROM customer_collaboration_invitations WHERE conversation_id=${conversationId} AND tenant_id=${actor.tenantId} ORDER BY created_at DESC LIMIT 100`) : [];
    const staff = await this.db.query(sql`SELECT u.id,u.name,m.role FROM conversation_members m JOIN users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id WHERE m.conversation_id=${conversationId} AND m.tenant_id=${actor.tenantId} AND m.left_at IS NULL ORDER BY u.name LIMIT 200`);
    return { contacts, invitations, staff, canManage, clientId: channel.client_id };
  }
  async invite(actor: CommunicationsActor, conversationId: string, input: { email: string; requestId: string }) {
    const email = normalizeCustomerEmail(input.email); z.string().uuid().parse(input.requestId);
    return this.lock(actor.tenantId,async db=>{
      const c = await this.channel(db,actor,conversationId,true);
      let [i] = await db.query<Row>(sql`SELECT * FROM customer_collaboration_invitations WHERE tenant_id=${actor.tenantId} AND request_id=${input.requestId}`);
      if (i && (i.email_normalized!==email || i.conversation_id!==conversationId || i.client_id!==c.client_id || i.status!=='PENDING' || new Date(i.expires_at).getTime()<=Date.now())) throw communicationError(409,'INVITATION_RETRY_CONFLICT','Create a new invitation request.');
      if (!i) {
        const [rate] = await db.query<Row>(sql`SELECT count(*)::int AS n FROM customer_collaboration_invitations WHERE tenant_id=${actor.tenantId} AND created_by=${actor.userId} AND created_at>now()-interval '1 hour'`);
        if(rate.n>=50) throw communicationError(429,'INVITATION_RATE_LIMIT','Please wait before inviting more contacts.');
        const id=randomUUID(),hash=collaborationHash(collaborationInvitationToken(id));
        await db.query(sql`UPDATE customer_collaboration_invitations SET status='REVOKED',revoked_at=now() WHERE conversation_id=${conversationId} AND email_normalized=${email} AND status='PENDING'`);
        [i]=await db.query<Row>(sql`INSERT INTO customer_collaboration_invitations(id,tenant_id,client_id,conversation_id,email_normalized,secret_hash,created_by,request_id,expires_at) VALUES(${id},${actor.tenantId},${c.client_id},${conversationId},${email},${hash},${actor.userId},${input.requestId},now()+interval '7 days') RETURNING *`);
        await this.audit(db,actor,actor.tenantId,'CUSTOMER_INVITATION_CREATED',{conversationId,invitationId:id,clientId:c.client_id});
      }
      const queued=await new EmailService().enqueueEmail({tenantId:actor.tenantId,recipientEmail:email,templateKey:'customer-collaboration-invitation',templateDataJson:{invitationId:i.id},idempotencyKey:`customer-collaboration:${i.id}`,relatedEntityType:'customer_collaboration_invitation',relatedEntityId:i.id},db);
      return {id:i.id,url:collaborationInvitationUrl(i.id),expiresAt:iso(i.expires_at),emailQueued:queued.queued};
    });
  }
  async revokeInvitation(actor: CommunicationsActor, conversation: string, id: string) { return this.lock(actor.tenantId,async db=>{
    await this.channel(db,actor,conversation,true);
    const [i]=await db.query(sql`UPDATE customer_collaboration_invitations SET status='REVOKED',revoked_at=coalesce(revoked_at,now()) WHERE id=${id} AND conversation_id=${conversation} AND tenant_id=${actor.tenantId} AND status<>'ACCEPTED' RETURNING id`);
    if(!i)throw missing(); await this.audit(db,actor,actor.tenantId,'CUSTOMER_INVITATION_REVOKED',{conversationId:conversation,invitationId:id}); return {revoked:true};
  }); }
  private async invitation(db: CommunicationsDatabase, token: string) {
    if(!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(token))throw missing();
    const [i]=await db.query<Row>(sql`SELECT i.* FROM customer_collaboration_invitations i JOIN conversations c ON c.id=i.conversation_id AND c.tenant_id=i.tenant_id AND c.client_id=i.client_id JOIN tenants t ON t.id=i.tenant_id WHERE i.secret_hash=${collaborationHash(token)} AND i.status='PENDING' AND i.revoked_at IS NULL AND i.expires_at>now() AND c.external_client_channel AND c.archived_at IS NULL AND t.is_active AND t.lifecycle_status NOT IN ('SUSPENDED','OFFBOARDING','OFFBOARDED')`);
    if(!i||!collaborationSecretMatches(collaborationInvitationToken(i.id),i.secret_hash))throw missing(); return i;
  }
  async handoff(token: string) {
    const i=await this.invitation(this.db,token);
    return this.lock(i.tenant_id,async db=>{
      const current=await this.invitation(db,token),id=randomUUID(),credential=`${id}.${randomBytes(32).toString('base64url')}`;
      const [row]=await db.query<Row>(sql`INSERT INTO customer_collaboration_handoffs(id,invitation_id,secret_hash,expires_at) VALUES(${id},${current.id},${collaborationHash(credential)},least(${iso(current.expires_at)}::timestamptz,now()+interval '30 minutes')) RETURNING expires_at`);
      return {credential,expiresAt:iso(row.expires_at)};
    });
  }
  private async pendingRow(db: CommunicationsDatabase, credential: string, allowConsumed = false) {
    if(!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(credential))throw missing();
    const [row]=await db.query<Row>(sql`SELECT h.id AS handoff_id,h.consumed_at,i.* FROM customer_collaboration_handoffs h JOIN customer_collaboration_invitations i ON i.id=h.invitation_id WHERE h.secret_hash=${collaborationHash(credential)} ${allowConsumed?sql`AND i.status IN ('PENDING','ACCEPTED')`:sql`AND h.consumed_at IS NULL AND i.status='PENDING'`} AND h.expires_at>now() AND i.revoked_at IS NULL AND i.expires_at>now()`);
    if(!row)throw missing(); return row;
  }
  async pending(credential: string) { await this.pendingRow(this.db,credential); return {available:true}; }
  async accept(identity: CollaborationIdentity, credential: string) {
    await this.verifyEmail(identity);
    const initial=await this.pendingRow(this.db,credential,true);
    return this.lock(initial.tenant_id,async db=>{
      const i=await this.pendingRow(db,credential,true);
      await db.query(sql`SELECT id FROM customer_collaboration_handoffs WHERE id=${i.handoff_id} FOR UPDATE`);
      if(normalizeCustomerEmail(identity.email)!==i.email_normalized)throw communicationError(403,'INVITATION_EMAIL_MISMATCH','Sign in with the verified email address that received this invitation.');
      const account=await this.identity(db,identity,true);
      if(i.status==='ACCEPTED'){
        if(i.accepted_customer_account_id!==account.id)throw missing();
        const [previous]=await db.query<Row>(sql`SELECT r.id FROM customer_collaboration_relationships r JOIN conversation_members cm ON cm.customer_relationship_id=r.id AND cm.tenant_id=r.tenant_id JOIN conversations c ON c.id=cm.conversation_id AND c.tenant_id=r.tenant_id JOIN tenants t ON t.id=r.tenant_id WHERE r.customer_account_id=${account.id} AND r.tenant_id=${i.tenant_id} AND r.client_id=${i.client_id} AND r.status='ACTIVE' AND r.revoked_at IS NULL AND cm.conversation_id=${i.conversation_id} AND cm.left_at IS NULL AND c.external_client_channel AND c.archived_at IS NULL AND t.is_active AND t.lifecycle_status NOT IN ('SUSPENDED','OFFBOARDING','OFFBOARDED')`);
        if(!previous)throw missing(); return {relationshipId:previous.id,conversationId:i.conversation_id};
      }
      await this.invitation(db,collaborationInvitationToken(i.id));
      await db.query(sql`UPDATE customer_accounts SET email_normalized=${normalizeCustomerEmail(identity.email)},updated_at=now() WHERE id=${account.id}`);
      // Revocation applies to old invitations even after a verified email change.
      // Audit tombstones also survive a later fresh grant, which clears revoked_at
      // and left_at; an older invitation cannot use that grant to restore a channel.
      const [existing]=await db.query<Row>(sql`SELECT r.id,r.status,(
        coalesce(r.revoked_at>=inv.created_at,false) OR coalesce(cm.left_at>=inv.created_at,false)
        OR EXISTS(SELECT 1 FROM account_access_audit_events e WHERE e.tenant_id=r.tenant_id
          AND e.occurred_at>=inv.created_at AND e.metadata->>'relationshipId'=r.id::text
          AND (e.action='CUSTOMER_RELATIONSHIP_REVOKED' OR (e.action='CUSTOMER_CHANNEL_ACCESS_REVOKED' AND e.metadata->>'conversationId'=inv.conversation_id::text)))
        ) AS "invitationRevoked" FROM customer_collaboration_relationships r
        JOIN customer_collaboration_invitations inv ON inv.id=${i.id}
        LEFT JOIN conversation_members cm ON cm.customer_relationship_id=r.id AND cm.conversation_id=inv.conversation_id
        WHERE r.tenant_id=${i.tenant_id} AND r.client_id=${i.client_id} AND r.customer_account_id=${account.id}`);
      if(existing?.invitationRevoked)throw missing();
      if(!existing||existing.status!=='ACTIVE')await reserveCollaborationCapacity(db,i.tenant_id,'relationship');
      const [membership]=existing?await db.query(sql`SELECT id FROM conversation_members WHERE conversation_id=${i.conversation_id} AND customer_relationship_id=${existing.id} AND left_at IS NULL`):[];
      if(!membership)await reserveCollaborationCapacity(db,i.tenant_id,'member',i.conversation_id);
      const [r]=await db.query<Row>(sql`INSERT INTO customer_collaboration_relationships(tenant_id,client_id,customer_account_id,status,created_by) VALUES(${i.tenant_id},${i.client_id},${account.id},'ACTIVE',${i.created_by}) ON CONFLICT(tenant_id,client_id,customer_account_id) DO UPDATE SET status='ACTIVE',revoked_at=NULL RETURNING *`);
      await db.query(sql`INSERT INTO conversation_members(tenant_id,conversation_id,customer_relationship_id,role) VALUES(${i.tenant_id},${i.conversation_id},${r.id},'EXTERNAL') ON CONFLICT(conversation_id,customer_relationship_id) DO UPDATE SET left_at=NULL,joined_at=now(),role='EXTERNAL'`);
      await db.query(sql`UPDATE customer_collaboration_invitations SET status='ACCEPTED',accepted_at=now(),accepted_customer_account_id=${account.id} WHERE id=${i.id}`);
      await db.query(sql`UPDATE customer_collaboration_handoffs SET consumed_at=now() WHERE invitation_id=${i.id} AND consumed_at IS NULL`);
      await this.audit(db,identity,i.tenant_id,'CUSTOMER_INVITATION_ACCEPTED',{invitationId:i.id,relationshipId:r.id,conversationId:i.conversation_id}); await this.event(db,i.tenant_id,i.conversation_id,'conversation.member_joined',r.id);
      return {relationshipId:r.id,conversationId:i.conversation_id};
    });
  }
  async addContact(actor: CommunicationsActor, conversation: string, relationshipId: string) { return this.lock(actor.tenantId,async db=>{
    const c=await this.channel(db,actor,conversation,true);
    const [r]=await db.query(sql`SELECT r.id FROM customer_collaboration_relationships r JOIN customer_accounts a ON a.id=r.customer_account_id WHERE r.id=${relationshipId} AND r.tenant_id=${actor.tenantId} AND r.client_id=${c.client_id} AND r.status='ACTIVE' AND r.revoked_at IS NULL AND a.status='ACTIVE'`); if(!r)throw missing();
    const [membership]=await db.query(sql`SELECT id FROM conversation_members WHERE conversation_id=${conversation} AND customer_relationship_id=${relationshipId} AND left_at IS NULL`);
    if(!membership)await reserveCollaborationCapacity(db,actor.tenantId,'member',conversation);
    await db.query(sql`INSERT INTO conversation_members(tenant_id,conversation_id,customer_relationship_id,role) VALUES(${actor.tenantId},${conversation},${relationshipId},'EXTERNAL') ON CONFLICT(conversation_id,customer_relationship_id) DO UPDATE SET left_at=NULL,joined_at=now(),role='EXTERNAL'`);
    await this.audit(db,actor,actor.tenantId,'CUSTOMER_CHANNEL_ACCESS_GRANTED',{conversationId:conversation,relationshipId}); await this.event(db,actor.tenantId,conversation,'conversation.member_joined',relationshipId); return {added:true};
  }); }
  async removeContact(actor: CommunicationsActor, conversation: string, relationshipId: string) {
    await this.lock(actor.tenantId,async db=>{
      await this.channel(db,actor,conversation,true);
      const [m]=await db.query(sql`UPDATE conversation_members SET left_at=now() WHERE tenant_id=${actor.tenantId} AND conversation_id=${conversation} AND customer_relationship_id=${relationshipId} RETURNING id`); if(!m)throw missing();
      await db.query(sql`UPDATE customer_collaboration_invitations SET status='REVOKED',revoked_at=now() WHERE tenant_id=${actor.tenantId} AND conversation_id=${conversation} AND status='PENDING' AND email_normalized IN (SELECT a.email_normalized FROM customer_accounts a JOIN customer_collaboration_relationships r ON r.customer_account_id=a.id WHERE r.id=${relationshipId})`);
      await db.query(sql`DELETE FROM communication_tickets WHERE tenant_id=${actor.tenantId} AND conversation_id=${conversation} AND actor->>'customerRelationshipId'=${relationshipId}`);
      await this.audit(db,actor,actor.tenantId,'CUSTOMER_CHANNEL_ACCESS_REVOKED',{conversationId:conversation,relationshipId}); await this.event(db,actor.tenantId,conversation,'conversation.member_left',relationshipId);
    });
    await this.meetings.revokeCustomerAccess(actor.tenantId,relationshipId,conversation); return {removed:true};
  }
  async revokeRelationship(actor: CommunicationsActor, relationshipId: string) {
    await this.lock(actor.tenantId,async db=>{
      await this.staff(db,actor,true);
      const [r]=await db.query<Row>(sql`UPDATE customer_collaboration_relationships SET status='REVOKED',revoked_at=now() WHERE id=${relationshipId} AND tenant_id=${actor.tenantId} RETURNING id,client_id`); if(!r)throw missing();
      await db.query(sql`UPDATE customer_collaboration_invitations SET status='REVOKED',revoked_at=now() WHERE tenant_id=${actor.tenantId} AND client_id=${r.client_id} AND status='PENDING' AND email_normalized IN (SELECT a.email_normalized FROM customer_accounts a JOIN customer_collaboration_relationships r ON r.customer_account_id=a.id WHERE r.id=${relationshipId})`);
      const members=await db.query<Row>(sql`UPDATE conversation_members SET left_at=now() WHERE customer_relationship_id=${relationshipId} AND tenant_id=${actor.tenantId} RETURNING conversation_id`);
      await db.query(sql`DELETE FROM communication_tickets WHERE tenant_id=${actor.tenantId} AND actor->>'customerRelationshipId'=${relationshipId}`);
      for(const m of members)await this.event(db,actor.tenantId,m.conversation_id,'conversation.member_left',relationshipId);
      await this.audit(db,actor,actor.tenantId,'CUSTOMER_RELATIONSHIP_REVOKED',{relationshipId,clientId:r.client_id});
    });
    await this.meetings.revokeCustomerAccess(actor.tenantId,relationshipId); return {revoked:true};
  }
}
