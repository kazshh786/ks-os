import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';

test('customer collaboration: production migration enforces principal and tenant boundaries', { timeout: 180000 }, async t => {
  const f = await createClientMeetingFixture(t);
  const alice = await f.seedCustomer('alice@example.test', 'Alice Contact');
  const bob = await f.seedCustomer('bob@example.test', 'Bob Contact');
  const secondClient = randomUUID();
  await f.pg.query('INSERT INTO clients(id,tenant_id,name) VALUES($1,$2,$3)', [secondClient, f.owner.tenantId, 'Another Alpha customer']);
  const relationship = async (accountId = alice.accountId, clientId = f.customer.id, tenantId = f.owner.tenantId, createdBy = f.owner.userId) => {
    const id = randomUUID();
    await f.pg.query('INSERT INTO customer_collaboration_relationships(id,tenant_id,client_id,customer_account_id,created_by) VALUES($1,$2,$3,$4,$5)', [id, tenantId, clientId, accountId, createdBy]);
    return id;
  };
  const channel = async (clientId = f.customer.id, tenantId = f.owner.tenantId, createdBy = f.owner.userId, external = true) => {
    const id = randomUUID();
    await f.pg.query("INSERT INTO conversations(id,tenant_id,client_id,primary_channel,customer_display_name,access_mode,conversation_type,name,created_by_user_id,external_client_channel) VALUES($1,$2,$3,'NATIVE','Collaboration','MEMBERS','CLIENT','Collaboration',$4,$5)", [id, tenantId, clientId, createdBy, external]);
    return id;
  };
  const member = (conversation: string, principal: string, tenant = f.owner.tenantId) => f.pg.query("INSERT INTO conversation_members(tenant_id,conversation_id,customer_relationship_id,role) VALUES($1,$2,$3,'EXTERNAL')", [tenant, conversation, principal]);
  const rAlice = await relationship(), rBob = await relationship(bob.accountId), rOtherClient = await relationship(alice.accountId, secondClient);
  const rOtherBusiness = await relationship(alice.accountId, f.otherCustomer.id, f.other.tenantId, f.other.userId);
  const c = await channel(), cOtherClient = await channel(secondClient), cOtherBusiness = await channel(f.otherCustomer.id, f.other.tenantId, f.other.userId), internal = await channel(f.customer.id, f.owner.tenantId, f.owner.userId, false);
  await member(c, rAlice); await member(c, rBob); await member(cOtherClient, rOtherClient); await member(cOtherBusiness, rOtherBusiness, f.other.tenantId);
  const message = async (conversation = c, principal = rAlice, retryId = randomUUID(), tenant = f.owner.tenantId) => {
    const id = randomUUID();
    await f.pg.query("INSERT INTO conversation_messages(id,tenant_id,conversation_id,channel_type,direction,sender_type,sender_customer_relationship_id,sender_name,body,status,native_position,client_message_id) VALUES($1,$2,$3,'NATIVE','INTERNAL','CUSTOMER',$4,'Contact','Shared update','SENT',nextval('native_message_position_seq'),$5)", [id, tenant, conversation, principal, retryId]);
    return id;
  };
  const denied = (work: Promise<unknown>, code = '23514') => assert.rejects(work, (error: unknown) => (error as { code?: string }).code === code);

  await t.test('multiple contacts and businesses reuse customer accounts without creating booking ownership', async () => {
    assert.equal((await f.pg.query('SELECT id FROM customer_collaboration_relationships WHERE customer_account_id=$1', [alice.accountId])).rows.length, 3);
    assert.equal((await f.pg.query('SELECT id FROM customer_collaboration_relationships WHERE tenant_id=$1 AND client_id=$2', [f.owner.tenantId, f.customer.id])).rows.length, 2);
    assert.equal((await f.pg.query('SELECT id FROM customer_client_links')).rows.length, 0);
    await denied(relationship(), '23505');
    await denied(f.pg.query('UPDATE customer_collaboration_relationships SET client_id=$1 WHERE id=$2', [secondClient, rAlice]));
  });

  await t.test('relationships reject cross-tenant clients and creators', async () => {
    await denied(relationship(bob.accountId, f.otherCustomer.id), '23503');
    await denied(relationship(bob.accountId, secondClient, f.owner.tenantId, f.other.userId));
  });

  await t.test('external channels cannot expose existing internal history or move to another customer', async () => {
    await denied(f.pg.query('UPDATE conversations SET external_client_channel=true WHERE id=$1', [internal]));
    await denied(f.pg.query('UPDATE conversations SET external_client_channel=false WHERE id=$1', [c]));
    await denied(f.pg.query('UPDATE conversations SET client_id=$1 WHERE id=$2', [secondClient, c]));
    await denied(f.pg.query("UPDATE conversations SET conversation_type='CHANNEL' WHERE id=$1", [c]));
    await denied(channel(f.otherCustomer.id));
    await denied(f.pg.query("INSERT INTO conversations(tenant_id,primary_channel,customer_display_name,external_client_channel,created_by_user_id) VALUES($1,'EMAIL','Inbox',true,$2)", [f.owner.tenantId, f.owner.userId]));
    await denied(f.pg.query('UPDATE conversations SET collaboration_request_id=$1 WHERE id=$2', [randomUUID(), internal]));
  });

  await t.test('membership accepts exactly one correctly scoped principal', async () => {
    await denied(member(internal, rAlice));
    await denied(member(c, rOtherClient));
    await denied(member(c, rOtherBusiness));
    await denied(member(c, rAlice), '23505');
    await denied(f.pg.query("INSERT INTO conversation_members(tenant_id,conversation_id,user_id,customer_relationship_id,role) VALUES($1,$2,$3,$4,'EXTERNAL')", [f.owner.tenantId, c, f.owner.userId, rAlice]));
    await denied(f.pg.query("UPDATE conversation_members SET role='OWNER' WHERE conversation_id=$1 AND customer_relationship_id=$2", [c, rAlice]));
  });

  await t.test('native customer author and retry identity cannot be forged or retargeted', async () => {
    const retry = randomUUID(), id = await message(c, rAlice, retry);
    await denied(message(c, rAlice, retry), '23505');
    await message(c, rBob, retry); // Retry identity is scoped to the actual author.
    await denied(message(c, rOtherClient));
    await denied(message(internal, rAlice));
    await denied(f.pg.query('UPDATE conversation_messages SET sender_user_id=$1 WHERE id=$2', [f.owner.userId, id]));
    await denied(f.pg.query('UPDATE conversation_messages SET sender_customer_relationship_id=$1 WHERE id=$2', [rBob, id]));
    await denied(f.pg.query("UPDATE conversation_messages SET sender_type='STAFF' WHERE id=$1", [id]));
    const nonMember = await channel();
    await denied(message(nonMember, rAlice));
  });

  await t.test('reactions and mentions require current scoped membership and preserve uniqueness', async () => {
    const id = await message();
    const react = (r: string) => f.pg.query("INSERT INTO communication_reactions(tenant_id,conversation_id,message_id,customer_relationship_id,emoji) VALUES($1,$2,$3,$4,'👍')", [f.owner.tenantId, c, id, r]);
    await react(rAlice); await denied(react(rAlice), '23505'); await react(rBob); await denied(react(rOtherClient));
    await f.pg.query('INSERT INTO communication_mentions(tenant_id,conversation_id,message_id,customer_relationship_id,start_offset,end_offset,display_name) VALUES($1,$2,$3,$4,0,4,$5)', [f.owner.tenantId, c, id, rBob, 'Bob']);
    await denied(f.pg.query('INSERT INTO communication_mentions(tenant_id,conversation_id,message_id,customer_relationship_id,start_offset,end_offset,display_name) VALUES($1,$2,$3,$4,5,9,$5)', [f.owner.tenantId, c, id, rOtherClient, 'Other']));
    await f.pg.query('UPDATE conversation_members SET left_at=now() WHERE conversation_id=$1 AND customer_relationship_id=$2', [c, rBob]);
    await denied(f.pg.query("INSERT INTO communication_reactions(tenant_id,conversation_id,message_id,customer_relationship_id,emoji) VALUES($1,$2,$3,$4,'🎉')", [f.owner.tenantId, c, id, rBob]));
    await f.pg.query('UPDATE conversation_members SET left_at=NULL WHERE conversation_id=$1 AND customer_relationship_id=$2', [c, rBob]);
  });

  await t.test('file ownership is exclusive and cannot be moved across customer scopes', async () => {
    const id = randomUUID();
    const upload = (r: string, staff: string | null = null) => f.pg.query("INSERT INTO conversation_attachments(id,tenant_id,conversation_id,uploaded_by,uploaded_by_customer_relationship_id,status,file_name,mime_type,storage_key) VALUES($1,$2,$3,$4,$5,'PENDING','file.txt','text/plain',$6)", [id, f.owner.tenantId, c, staff, r, `private-chat/${id}`]);
    await denied(upload(rOtherClient)); await denied(upload(rAlice, f.owner.userId)); await upload(rAlice);
    await denied(f.pg.query('UPDATE conversation_attachments SET conversation_id=$1 WHERE id=$2', [cOtherClient, id]));
    await denied(f.pg.query('UPDATE conversation_attachments SET uploaded_by_customer_relationship_id=$1 WHERE id=$2', [rBob, id]));
    await f.pg.query("UPDATE customer_collaboration_relationships SET status='REVOKED',revoked_at=now() WHERE id=$1", [rAlice]);
    await f.pg.query("UPDATE conversation_attachments SET status='DELETED',deleted_at=now() WHERE id=$1", [id]);
    await denied(message());
    await f.pg.query("UPDATE customer_collaboration_relationships SET status='ACTIVE',revoked_at=NULL WHERE id=$1", [rAlice]);
  });

  await t.test('preferences are scoped to a relationship, including one account in two businesses', async () => {
    await f.pg.query('INSERT INTO communication_preferences(tenant_id,customer_relationship_id,sound) VALUES($1,$2,true)', [f.owner.tenantId, rAlice]);
    await f.pg.query('INSERT INTO communication_preferences(tenant_id,customer_relationship_id,sound) VALUES($1,$2,false)', [f.other.tenantId, rOtherBusiness]);
    await denied(f.pg.query('INSERT INTO communication_preferences(tenant_id,customer_relationship_id) VALUES($1,$2)', [f.other.tenantId, rBob]), '23503');
    await denied(f.pg.query('INSERT INTO communication_preferences(tenant_id,user_id,customer_relationship_id) VALUES($1,$2,$3)', [f.owner.tenantId, f.owner.userId, rAlice]));
    await f.pg.query('INSERT INTO communication_preferences(tenant_id,user_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET sound=true', [f.owner.tenantId, f.owner.userId]);
    await f.pg.query('INSERT INTO communication_preferences(tenant_id,user_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET sound=true', [f.owner.tenantId, f.owner.userId]);
  });

  await t.test('notification and event recipients cannot cross customers or share staff identity', async () => {
    const id = await message();
    const notify = (r: string) => f.pg.query("INSERT INTO internal_notifications(tenant_id,recipient_customer_relationship_id,type,title,message,source_type,source_id,chat_conversation_id,chat_message_id) VALUES($1,$2,'CHAT_MESSAGE','Update','New message','CHAT',$3,$4,$3)", [f.owner.tenantId, r, id, c]);
    await notify(rAlice); await denied(notify(rAlice), '23505'); await notify(rBob); await denied(notify(rOtherClient));
    await denied(f.pg.query('UPDATE internal_notifications SET recipient_user_id=$1 WHERE recipient_customer_relationship_id=$2', [f.owner.userId, rAlice]));
    await f.pg.query("INSERT INTO communication_events(tenant_id,conversation_id,type,resource_id,actor_customer_relationship_id,recipient_customer_relationship_id) VALUES($1,$2,'message.created',$3,$4,$5)", [f.owner.tenantId, c, id, rAlice, rBob]);
    await denied(f.pg.query("INSERT INTO communication_events(tenant_id,conversation_id,type,resource_id,recipient_customer_relationship_id) VALUES($1,$2,'message.created',$3,$4)", [f.owner.tenantId, c, id, rOtherClient]));
  });

  await t.test('invitation acceptance binds verified account email and preserves historical revocation', async () => {
    const id = randomUUID();
    await f.pg.query('INSERT INTO customer_collaboration_invitations(id,tenant_id,client_id,conversation_id,email_normalized,secret_hash,expires_at,created_by,request_id) VALUES($1,$2,$3,$4,$5,$6,now()+interval \'1 day\',$7,$8)', [id, f.owner.tenantId, f.customer.id, c, alice.identity.email, 'a'.repeat(64), f.owner.userId, randomUUID()]);
    await denied(f.pg.query("UPDATE customer_collaboration_invitations SET status='ACCEPTED',accepted_at=now(),accepted_customer_account_id=$1 WHERE id=$2", [bob.accountId, id]));
    await f.pg.query("UPDATE customer_collaboration_invitations SET status='ACCEPTED',accepted_at=now(),accepted_customer_account_id=$1 WHERE id=$2", [alice.accountId, id]);
    await f.pg.query('UPDATE customer_accounts SET email_normalized=$1 WHERE id=$2', ['alice-new@example.test', alice.accountId]);
    await f.pg.query("UPDATE customer_collaboration_invitations SET status='REVOKED',revoked_at=now() WHERE id=$1", [id]);
    await denied(f.pg.query('UPDATE customer_collaboration_invitations SET conversation_id=$1 WHERE id=$2', [cOtherClient, id]));
  });

  await t.test('scheduled meeting grants and portal guest principals retain exact customer scope', async () => {
    const meeting = randomUUID(), participant = randomUUID();
    await f.pg.query("INSERT INTO communication_meetings(id,tenant_id,created_by,request_id,title,type,status,provider_room_name,audience,host_user_id,customer_id,scheduled_start_at,scheduled_end_at) VALUES($1,$2,$3,$4,'Customer meeting','VIDEO','SCHEDULED',$5,'EXTERNAL_CLIENT',$3,$6,now(),now()+interval '1 hour')", [meeting, f.owner.tenantId, f.owner.userId, randomUUID(), `isolated_${meeting}`, f.customer.id]);
    const grant = (conversation: string) => f.pg.query('INSERT INTO communication_meeting_customer_grants(tenant_id,meeting_id,conversation_id,created_by) VALUES($1,$2,$3,$4)', [f.owner.tenantId, meeting, conversation, f.owner.userId]);
    await denied(grant(cOtherClient)); await denied(grant(internal)); await denied(grant(cOtherBusiness)); await grant(c);
    await f.pg.query("INSERT INTO communication_meeting_participants(id,tenant_id,meeting_id,guest_name,role) VALUES($1,$2,$3,'Alice','GUEST')", [participant, f.owner.tenantId, meeting]);
    const guest = randomUUID();
    const addGuest = (r: string, authUser = alice.identity.authUserId) => f.pg.query("INSERT INTO communication_meeting_guests(id,tenant_id,meeting_id,participant_id,request_id,name,credential_hash,expires_at,customer_relationship_id,customer_conversation_id,customer_auth_session_id,customer_auth_user_id,customer_issued_at,customer_expires_at) VALUES($1,$2,$3,$4,$5,'Alice',$6,$7,$8,$9,$10,$11,$12,$7)", [guest, f.owner.tenantId, meeting, participant, randomUUID(), 'b'.repeat(64), alice.identity.expiresAt, r, c, alice.identity.sessionId, authUser, alice.identity.issuedAt]);
    await denied(addGuest(rOtherClient)); await denied(addGuest(rAlice, bob.identity.authUserId)); await addGuest(rAlice);
    await denied(f.pg.query('UPDATE communication_meeting_guests SET customer_auth_session_id=$1 WHERE id=$2', [randomUUID(), guest]));
    await denied(f.pg.query('UPDATE communication_meeting_guests SET customer_auth_user_id=NULL WHERE id=$1', [guest]));
    // A later meeting context change must not prevent closing historical admissions.
    await f.pg.query('UPDATE communication_meetings SET customer_id=$1 WHERE id=$2', [secondClient, meeting]);
    await f.pg.query('UPDATE communication_meeting_customer_grants SET revoked_at=now() WHERE meeting_id=$1', [meeting]);
    await f.pg.query("UPDATE communication_meeting_guests SET state='DENIED',revoked_at=now() WHERE id=$1", [guest]);
    await denied(addGuest(rAlice));
    assert.equal((await f.pg.query('SELECT conversation_id FROM communication_meetings WHERE id=$1', [meeting])).rows[0].conversation_id, null);
  });

  await t.test('provider-session boolean rejects logout, wrong identity, expiry, bans and unverified accounts', async () => {
    const current = async (session = alice.identity.sessionId, user = alice.identity.authUserId) => (await f.pg.query<{ current: boolean }>('SELECT customer_provider_session_is_current($1,$2) AS current', [session, user])).rows[0].current;
    assert.equal(await current(), true); assert.equal(await current(alice.identity.sessionId, bob.identity.authUserId), false);
    await f.pg.query("UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=$1", [alice.identity.sessionId]); assert.equal(await current(), false);
    await f.pg.query('UPDATE auth.sessions SET not_after=NULL WHERE id=$1', [alice.identity.sessionId]);
    await f.pg.query("UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=$1", [alice.identity.authUserId]); assert.equal(await current(), false);
    await f.pg.query('UPDATE auth.users SET banned_until=NULL,email_confirmed_at=NULL WHERE id=$1', [alice.identity.authUserId]); assert.equal(await current(), false);
    await f.pg.query('UPDATE auth.users SET email_confirmed_at=now(),is_anonymous=true WHERE id=$1', [alice.identity.authUserId]); assert.equal(await current(), false);
    await f.pg.query('UPDATE auth.users SET is_anonymous=false WHERE id=$1', [alice.identity.authUserId]); assert.equal(await current(), true);
    await f.pg.query('DELETE FROM auth.sessions WHERE id=$1', [alice.identity.sessionId]); assert.equal(await current(), false);
  });

  await t.test('new identity tables and provider helper remain inaccessible to browser database roles', async () => {
    for (const table of ['customer_collaboration_relationships', 'customer_collaboration_invitations', 'customer_collaboration_handoffs', 'communication_meeting_customer_grants']) {
      const result = (await f.pg.query<{ rls: boolean; anon: boolean; authenticated: boolean; api: boolean }>("SELECT c.relrowsecurity AS rls,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS anon,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS authenticated,has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS api FROM pg_class c WHERE c.oid=$1::regclass", [table])).rows[0];
      assert.deepEqual(result, { rls: true, anon: false, authenticated: false, api: true });
    }
    const access = (await f.pg.query<{ browser: boolean; api: boolean }>("SELECT has_function_privilege('authenticated','customer_provider_session_is_current(uuid,uuid)','EXECUTE') AS browser,has_function_privilege('service_role','customer_provider_session_is_current(uuid,uuid)','EXECUTE') AS api")).rows[0];
    assert.deepEqual(access, { browser: false, api: true });
  });
});
