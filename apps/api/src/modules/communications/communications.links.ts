import { CommunicationLinkTargetSchema, type CommunicationLinkTarget } from '@ks-os/contracts';
import { sql } from '@ks-os/database';
import { CommunicationsAuthorization, communicationError, isCustomer, type CommunicationsActor } from './communications.authorization.js';
import type { CommunicationsDatabase } from './communications.database.js';
import { authorizedMeetingReference } from './communications.meeting-notifications.js';

const invalid = () => communicationError(400, 'INVALID_COMMUNICATION_LINK', 'This communication link is invalid.');
export class CommunicationLinks {
  constructor(private db: CommunicationsDatabase, private originSource = () => process.env.MOBILE_LINK_ORIGIN ?? '') {}
  private origin() {
    let value: URL;
    try { value = new URL(this.originSource()); } catch { throw communicationError(503, 'LINKS_UNAVAILABLE', 'Communication links have not been configured.'); }
    if (value.protocol !== 'https:' || value.username || value.password || value.search || value.hash || value.pathname !== '/') {
      throw communicationError(503, 'LINKS_UNAVAILABLE', 'Communication links have not been configured.');
    }
    return value.origin;
  }
  parse(value: string) {
    let url: URL;
    try { url = new URL(value); } catch { throw invalid(); }
    if (url.origin !== this.origin() || url.pathname !== '/open' || url.hash || url.username || url.password) throw invalid();
    const params: Record<string, string> = {};
    for (const [key, value] of url.searchParams) { if (key in params) throw invalid(); params[key] = value; }
    const target = CommunicationLinkTargetSchema.safeParse(params);
    if (!target.success) throw invalid();
    return target.data;
  }
  async resolve(actor: CommunicationsActor, url: string) { return this.create(actor, this.parse(url)); }
  async create(actor: CommunicationsActor, input: CommunicationLinkTarget) {
    const target = CommunicationLinkTargetSchema.parse(input), origin = this.origin();
    if (target.tenantId !== actor.tenantId || target.relationshipId !== (isCustomer(actor) ? actor.customerRelationshipId : undefined)) {
      throw communicationError(403, 'LINK_CONTEXT_MISMATCH', 'Choose the authorised account and business for this link.');
    }
    return this.db.transaction(async db => {
      await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.tenantId},8241))`);
      const auth = new CommunicationsAuthorization(db); await auth.authenticate(actor);
      const root = isCustomer(actor) ? `/customer/collaboration/${actor.userId}` : '/app';
      let webPath = root, parentMessageId: string | null = null;
      if (target.conversationId) {
        await auth.requireConversation(actor, target.conversationId);
        webPath += `${isCustomer(actor) ? '/messages/' : '/chat/'}${target.conversationId}`;
        if (target.messageId) {
          const [message] = await db.query<{ parent: string | null }>(sql`SELECT reply_to_message_id AS parent FROM conversation_messages
            WHERE id=${target.messageId} AND tenant_id=${actor.tenantId} AND conversation_id=${target.conversationId} AND channel_type='NATIVE' AND deleted_at IS NULL`);
          if (!message) throw communicationError(404, 'LINK_UNAVAILABLE', 'This message is no longer available.');
          parentMessageId = target.kind === 'THREAD' ? message.parent ?? target.messageId : message.parent;
          webPath += `?message=${target.messageId}${parentMessageId ? `&thread=${parentMessageId}` : ''}`;
        }
      } else if (target.meetingId) {
        const meeting = await authorizedMeetingReference(db, actor, target.meetingId);
        // A link only selects an authorised resource. Admission and media token
        // issuance remain separate operations governed by the meeting services.
        webPath = isCustomer(actor) ? `${root}/meetings?meetingId=${target.meetingId}`
          : meeting.scheduledStartAt ? `/app/meetings/${target.meetingId}` : `/app/chat/${meeting.conversationId}?meetings=1`;
      }
      const url = new URL('/open', origin);
      for (const [key, value] of Object.entries(target)) if (value) url.searchParams.set(key, value);
      return { version: 1, target, url: url.toString(), webPath, parentMessageId, requiresAdmission: target.kind === 'MEETING' };
    });
  }
}
