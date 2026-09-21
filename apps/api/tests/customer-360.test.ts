import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import Fastify from 'fastify';
import * as database from '@ks-os/database';
import { CustomerCommandSchema, CustomerTimelineQuerySchema, CustomerTimelineEntrySchema, CustomerOverviewSchema, resolveBusinessProfile } from '@ks-os/contracts';
import { customerAdapters, type CustomerActor } from '../src/modules/customer-360/customer-360.adapters.js';
import { Customer360Repository } from '../src/modules/customer-360/customer-360.repository.js';
import { Customer360Service } from '../src/modules/customer-360/customer-360.service.js';
import { readCursor } from '../src/modules/customer-360/customer-timeline.service.js';
import { customer360Routes } from '../src/modules/customer-360/customer-360.routes.js';

const now = new Date('2026-09-21T12:00:00.000Z');
const tenant = randomUUID(), otherTenant = randomUUID(), user = randomUUID(), otherUser = randomUUID(), client = randomUUID(), otherClient = randomUUID(), reference = randomUUID();
const owner: CustomerActor = { tenantId: tenant, userId: user, role: 'owner', permissions: [] };
test('strict bounded contracts reject tenant control, metadata, malformed booleans and unsafe links', () => {
  for (const query of [{ tenantId: tenant }, { limit: 51 }, { limit: 0 }, { importantOnly: 'yes' }, { cursor: 'x'.repeat(1201) }, { source: 'medical' }]) assert.equal(CustomerTimelineQuerySchema.safeParse(query).success, false);
  assert.equal(CustomerTimelineQuerySchema.parse({ importantOnly: 'false' }).importantOnly, false);
  assert.equal(CustomerTimelineQuerySchema.parse({ importantOnly: 'true' }).importantOnly, true);
  assert.equal(CustomerCommandSchema.safeParse({ kind: 'ADD_TASK', title: 'A task', tenantId: tenant }).success, false);
  const entry = { key: 'crm:x', source: 'crm', reference, type: 'CREATED', title: 'Created', occurredAt: now.toISOString(), important: true, route: null };
  assert.equal(CustomerTimelineEntrySchema.safeParse(entry).success, true);
  assert.equal(CustomerTimelineEntrySchema.safeParse({ ...entry, metadata: { notes: 'secret' } }).success, false);
  assert.equal(CustomerTimelineEntrySchema.safeParse({ ...entry, route: '//evil.example' }).success, false);
  assert.throws(() => readCursor({ limit: 20, importantOnly: false, cursor: Buffer.from('{}').toString('base64url') }, reference, now));
});
test('Business Profile composition includes only implemented, enabled and permitted sources', () => {
  for (const [type, expected, excluded] of [
    ['SALON_BARBER','bookings','sales'],['AGENCY','sales','bookings'],['PLUMBING','work','bookings'],['LOGISTICS_COURIER','work','bookings'],['PROFESSIONAL_SERVICES','work','bookings'],
  ]) {
    const profile = resolveBusinessProfile(type);
    const sources = customerAdapters({ actor: owner, clientId: client, profile, now }).map(a => a.source);
    assert.ok(sources.includes(expected as typeof sources[number])); assert.ok(!sources.includes(excluded as typeof sources[number]));
    assert.ok(!sources.includes('fleet' as never));
  }
  const sources = customerAdapters({ actor: { ...owner, role: 'staff', permissions: ['CLIENTS_VIEW_BASIC'] }, clientId: client, profile: resolveBusinessProfile('AGENCY'), now });
  assert.equal(sources.length, 0);
});
test('HTTP boundaries reject anonymous access, injected tenant context and unauthorised actions', async () => {
  const app = Fastify();
  let authenticated = false;
  app.decorateRequest('requireAuth', function () { if (!authenticated) throw Object.assign(new Error('Unauthenticated'),{statusCode:401}); });
  app.addHook('preHandler',async request=>{ request.auth={tenantId:tenant,tenantUserId:user,role:'staff',permissions:[]} as never; });
  app.setErrorHandler((error,_request,reply)=>reply.code(error.name==='ZodError'?400:error.statusCode??500).send({error:error.message}));
  await app.register(customer360Routes,{prefix:'/api/v1/clients'});
  try {
    assert.equal((await app.inject(`/api/v1/clients/${reference}/overview`)).statusCode,401);
    authenticated=true;
    for(const suffix of ['overview','timeline','attention','actions']){
      assert.equal((await app.inject(`/api/v1/clients/${reference}/${suffix}?tenantId=${otherTenant}`)).statusCode,400);
      assert.equal((await app.inject(`/api/v1/clients/${reference}/${suffix}`)).statusCode,403);
    }
    assert.equal((await app.inject({method:'POST',url:`/api/v1/clients/${reference}/actions`,payload:{kind:'ADD_TASK',title:'Follow up',tenantId:otherTenant}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:`/api/v1/clients/${reference}/actions`,payload:{kind:'ADD_TASK',title:'Follow up'}})).statusCode,403);
  } finally { await app.close(); }
});

const url = process.env.CUSTOMER360_TEST_DATABASE_URL;
test('Customer 360 PostgreSQL isolation, visibility, cursor, attention and failure integration', { skip: !url }, async t => {
  const parsed = new URL(url!);
  assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/customer360_test', 'Integration tests only run against the dedicated disposable database');
  const pool = new Pool({ connectionString: url, max: 1 });
  const connection = await pool.connect();
  const schema = `c360_${randomUUID().replaceAll('-','')}`;
  await connection.query(`create schema ${schema}`);
  await connection.query(`set search_path to ${schema},public`);
  const tables = [database.services,database.bookingAuditEvents,database.clients,database.tenants,database.users,database.clientSalesProfiles,database.salesOpportunities,database.salesPipelineStages,database.salesOpportunityActivity,database.salesQuotes,database.workItems,database.workItemActivity,database.tasks,database.taskActivity,database.appointments,database.formAssignments,database.checkoutTransactions,database.stripePaymentAttempts,database.stripeRefunds,database.emailOutbox,database.smsOutbox,database.reviewInvitations,database.conversations,database.operationsIssues];
  // Use canonical column names/types, with nullable fixture columns so corrupt cross-tenant links can be exercised.
  for (const table of tables) { const config = getTableConfig(table); await connection.query(`create table "${config.name}" (${config.columns.map(column => `"${column.name}" ${column.getSQLType()}`).join(',')})`); }
  const migration = await readFile(new URL('../../../packages/database/migrations/20260921120000_customer_360_references_indexes.sql', import.meta.url), 'utf8');
  await connection.query(migration); await connection.query(migration); // Additive and rerunnable.
  const dialect = new PgDialect();
  let failWork = false;
  class TestRepository extends Customer360Repository {
    override async query<T extends Record<string, unknown>>(query: SQL): Promise<T[]> {
      const compiled = dialect.sqlToQuery(query);
      if (failWork && compiled.sql.includes('work_item_activity')) throw new Error('sensitive SQL parameters must never escape');
      const result = await connection.query(compiled.sql, compiled.params); return result.rows as T[];
    }
  }
  const repo = new TestRepository();
  const service = new Customer360Service(repo, () => {}, 'test-request', () => now);
  async function insert(table: string, row: Record<string, unknown>) {
    const columns = Object.keys(row); await connection.query(`insert into "${table}" (${columns.map(c => `"${c}"`).join(',')}) values (${columns.map((_,i) => `$${i+1}`).join(',')})`, Object.values(row));
  }
  const created = '2026-09-01T10:00:00.000Z';
  const base = { tenant_id: tenant, created_at: created, updated_at: created };
  const stage = randomUUID(), won = randomUUID(), opportunity = randomUUID(), opportunityRef = randomUUID(), wonOpportunity = randomUUID(), wonRef = randomUUID();
  const work = randomUUID(), workRef = randomUUID(), task = randomUUID(), taskRef = randomUUID(), booking = randomUUID(), bookingRef = randomUUID();
  try {
    await insert('tenants',{ id: tenant, business_type: 'AGENCY' }); await insert('tenants',{ id: otherTenant, business_type: 'AGENCY' });
    await insert('users',{ id: user, tenant_id: tenant, name: 'Assigned colleague' }); await insert('users',{ id: otherUser, tenant_id: tenant, name: 'Other colleague' });
    await insert('clients',{ ...base, id: client, public_reference: reference, name: 'Example customer', email: 'example@example.test', phone: null, medical_notes: 'MEDICAL_SECRET' });
    await insert('clients',{ ...base, tenant_id: otherTenant, id: otherClient, public_reference: randomUUID(), name: 'Other tenant' });
    await insert('sales_pipeline_stages',{ id: stage, tenant_id: tenant, category: 'OPEN' }); await insert('sales_pipeline_stages',{ id: won, tenant_id: tenant, category: 'WON' });
    for (const [id,ref,stageId,assignee] of [[opportunity,opportunityRef,stage,user],[wonOpportunity,wonRef,won,otherUser]]) {
      await insert('sales_opportunities',{ ...base,id,public_reference:ref,client_id:client,title:'Proposal',stage_id:stageId,owner_user_id:assignee,estimated_value:450000,currency:'GBP' });
      await insert('sales_opportunity_activity',{ tenant_id:tenant,created_at:created,id:randomUUID(),public_reference:randomUUID(),opportunity_id:id,activity_type:'CREATED',metadata:{private:'PRIVATE_SECRET'} });
    }
    await insert('sales_quotes',{ ...base,id:randomUUID(),public_reference:randomUUID(),opportunity_id:wonOpportunity,client_id:client,title:'Accepted quote',status:'ACCEPTED',accepted_at:created,total:450000,currency:'GBP' });
    await insert('sales_quotes',{ ...base,id:randomUUID(),public_reference:randomUUID(),opportunity_id:opportunity,client_id:client,title:'Waiting quote',status:'SENT',sent_at:created,total:9000,currency:'GBP' });
    await insert('work_items',{ ...base,id:work,public_reference:workRef,client_id:client,title:'Blocked project',work_type:'PROJECT',status:'BLOCKED',assigned_user_id:user,due_at:created,blocked_reason:'PRIVATE_BLOCKER' });
    for (let i=0;i<7;i++) await insert('work_item_activity',{ tenant_id:tenant,created_at:created,id:randomUUID(),public_reference:randomUUID(),work_item_id:work,activity_type:i===0?'CREATED':'STATUS_CHANGED',to_value:'BLOCKED',metadata:{reason:'PRIVATE_SECRET'} });
    await insert('tasks',{ ...base,id:task,public_reference:taskRef,client_id:client,title:'Overdue task',status:'OPEN',source_type:'CLIENT',assigned_user_id:user,due_at:created,notes:'PRIVATE_TASK_NOTES' });
    await insert('task_activity',{ tenant_id:tenant,created_at:created,id:randomUUID(),public_reference:randomUUID(),task_id:task,activity_type:'CREATED' });
    await insert('tasks',{ ...base,id:randomUUID(),public_reference:randomUUID(),client_id:client,title:'Finance secret',status:'OPEN',source_type:'PAYMENT',assigned_user_id:user });
    // Rows deliberately link Tenant B data to Tenant A's client and records. Every adapter must still exclude them.
    await insert('work_items',{ ...base,tenant_id:otherTenant,id:randomUUID(),public_reference:randomUUID(),client_id:client,title:'TENANT_B_SECRET',status:'BLOCKED',work_type:'PROJECT',assigned_user_id:user });
    await insert('work_item_activity',{ tenant_id:otherTenant,created_at:created,id:randomUUID(),public_reference:randomUUID(),work_item_id:work,activity_type:'COMPLETED' });
    await insert('appointments',{ ...base,id:booking,public_reference:bookingRef,client_id:client,user_id:user,status:'CONFIRMED',start_time:'2026-09-22T09:00:00Z',is_internal:false,is_test:false });
    await insert('form_assignments',{ ...base,id:randomUUID(),public_reference:randomUUID(),client_id:client,appointment_id:booking,status:'PENDING',expires_at:'2026-10-01T00:00:00Z',public_token_hash:'TOKEN_SECRET' });
    const paymentId=randomUUID();
    await insert('checkout_transactions',{tenant_id:tenant,created_at:created,id:paymentId,public_reference:randomUUID(),appointment_id:booking,payment_status:'FAILED'});
    await insert('stripe_payment_attempts',{...base,id:randomUUID(),public_reference:randomUUID(),appointment_id:booking,status:'SUCCEEDED',completed_at:created,amount:9000,currency:'gbp'});
    await insert('stripe_refunds',{...base,id:randomUUID(),public_reference:randomUUID(),checkout_transaction_id:paymentId,status:'SUCCEEDED',completed_at:created,amount:2000,currency:'GBP',internal_note:'PRIVATE_REFUND'});
    await insert('sms_outbox',{tenant_id:tenant,created_at:created,id:randomUUID(),public_reference:randomUUID(),client_id:client,sent_at:created,template_data_json:{body:'PRIVATE_MESSAGE'}});
    await insert('email_outbox',{tenant_id:tenant,created_at:created,id:randomUUID(),public_reference:randomUUID(),related_entity_type:'client',related_entity_id:client,sent_at:created,template_data_json:{body:'PRIVATE_EMAIL'}});
    await insert('review_invitations',{...base,id:randomUUID(),public_reference:randomUUID(),client_id:client,status:'SENT',sent_at:created,scheduled_for:created});
    await insert('conversations',{...base,id:randomUUID(),public_reference:randomUUID(),client_id:client,status:'OPEN',unread_count:2,last_message_at:created,last_message_preview:'PRIVATE_PREVIEW'});
    await insert('operations_issues',{...base,id:randomUUID(),public_reference:randomUUID(),related_appointment_id:booking,title:'PRIVATE_ISSUE',status:'OPEN',category:'BOOKING',assigned_to_user_id:user,occurred_at:created});
    const financeIssue=randomUUID();
    await insert('operations_issues',{...base,id:financeIssue,public_reference:randomUUID(),related_appointment_id:booking,title:'PRIVATE_ISSUE',status:'OPEN',category:'PAYMENT',assigned_to_user_id:user,occurred_at:created});
    await insert('tasks',{...base,id:randomUUID(),public_reference:randomUUID(),client_id:client,title:'Indirect finance task',status:'OPEN',source_type:'OPERATIONS_ISSUE',source_id:financeIssue,assigned_user_id:user});

    await t.test('every adapter rejects cross-tenant rows even with forged links to this customer', async () => {
      const before = await service.overview(owner,reference);
      for (const table of tables.filter(table => ![database.clients,database.tenants,database.users,database.salesPipelineStages].includes(table as never))) {
        const config = getTableConfig(table);
        const columns = config.columns.map(c => `"${c.name}"`).join(',');
        const values = config.columns.map(c => c.name === 'tenant_id' ? '$1::uuid' : ['id','public_reference'].includes(c.name) ? 'gen_random_uuid()' : `"${c.name}"`).join(',');
        await connection.query(`insert into "${config.name}" (${columns}) select ${values} from "${config.name}" where tenant_id=$2`,[otherTenant,tenant]);
      }
      assert.deepEqual(await service.overview(owner,reference),before);
    });
    await t.test('owner sees normalized active relationship and deterministic actions, without private payloads', async () => {
      const result = await service.overview(owner,reference); assert.equal(CustomerOverviewSchema.safeParse(result).success,true);
      assert.ok(result.attention.some(a=>a.code==='WORK_BLOCKED')); assert.ok(result.attention.some(a=>a.code==='TASK_OVERDUE'));
      assert.ok(result.attention.some(a=>a.code==='SALE_WITHOUT_WORK'&&a.action?.kind==='CONVERT_WORK'));
      assert.ok(result.attention.some(a=>a.code==='QUOTE_WAITING')); assert.ok(result.attention.some(a=>a.code==='FORM_PENDING')); assert.ok(result.attention.some(a=>a.code==='PAYMENT_FAILED'));
      assert.equal(result.diagnostics.length,0); assert.equal(result.timeline.diagnostics.length,0);
      assert.equal(result.summary.find(m=>m.key==='open-sales-GBP')?.value,450000);
      assert.ok(!JSON.stringify(result).includes('PRIVATE')); assert.ok(!JSON.stringify(result).includes('SECRET'));
      assert.ok(!JSON.stringify(result).includes(otherTenant)); assert.ok(!JSON.stringify(result).includes(client));
      assert.ok(!result.summary.some(m=>/revenue|outstanding|lifetime/i.test(m.label)));
    });
    await t.test('own-only staff sees assigned records, no finance/communication or quotes without capability', async () => {
      const actor: CustomerActor = {...owner,role:'staff',permissions:['CLIENTS_VIEW_BASIC','SALES_VIEW_OWN','WORK_VIEW_OWN','TASKS_VIEW_OWN','FORMS_VIEW_ASSIGNED']};
      const result = await service.overview(actor,reference);
      assert.equal(result.diagnostics.length,0); assert.equal(result.timeline.diagnostics.length,0);
      assert.ok(!result.sources.includes('payments')); assert.ok(!result.sources.includes('communications'));
      assert.ok(!result.now.some(n=>n.type==='QUOTE'||n.title==='Finance secret'||n.title==='Indirect finance task'));
      assert.ok(!result.attention.some(n=>n.action)); assert.equal(result.actions.length,0);
      assert.ok(result.now.some(n=>n.reference===workRef)); assert.ok(!result.now.some(n=>n.reference===wonRef));
      const stranger = await service.overview({...actor,userId:otherUser},reference);
      assert.ok(!stranger.now.some(n=>n.reference===workRef||n.reference===taskRef));
    });
    await t.test('tenant/customer isolation denies foreign identity and unauthorised CRM before source reads', async () => {
      await assert.rejects(service.overview({...owner,tenantId:otherTenant},reference),/not found/);
      await assert.rejects(service.overview({...owner,role:'staff',permissions:[]},reference),/cannot view/);
    });
    await t.test('keyset timeline traverses equal timestamps exactly once and keeps source references public', async () => {
      const entries: unknown[]=[]; let cursor: string|undefined;
      for(let page=0;page<30;page++) {const result=await service.timeline(owner,reference,{limit:2,importantOnly:false,cursor}); assert.equal(result.diagnostics.length,0); entries.push(...result.entries); if(!result.nextCursor)break; cursor=result.nextCursor;}
      const all=await service.timeline(owner,reference,{limit:50,importantOnly:false});
      assert.deepEqual(entries,all.entries); assert.equal(new Set(all.entries.map(e=>e.key)).size,all.entries.length);
      assert.ok(all.entries.some(e=>e.source==='work'&&e.reference===workRef));
      assert.ok(all.entries.some(e=>e.type==='PAYMENT_SUCCEEDED')); assert.ok(all.entries.some(e=>e.type==='REFUND_SUCCEEDED'));
      const important=await service.timeline(owner,reference,{limit:50,importantOnly:true,source:'work'}); assert.ok(important.entries.length>0); assert.ok(important.entries.every(e=>e.source==='work'&&e.important));
      if(cursor) await assert.rejects(service.timeline(owner,reference,{limit:2,importantOnly:true,cursor}),/cursor/);
    });
    await t.test('optional failure preserves the customer and prevents cursor gaps',async()=>{
      failWork=true; const result=await service.overview(owner,reference); failWork=false;
      assert.equal(result.customer.reference,reference); assert.ok(result.timeline.diagnostics.some(d=>d.source==='work')); assert.equal(result.timeline.nextCursor,null);
      assert.ok(!JSON.stringify(result).includes('sensitive SQL')); assert.ok(result.now.length>0);
    });
    await t.test('support sessions discover no creation or mutation recommendations',async()=>{
      const result=await service.overview({...owner,readOnly:true},reference);
      assert.equal(result.actions.length,0); assert.ok(result.attention.every(item=>item.action===null));
    });
    await t.test('empty customers have no fabricated modules and profile-based terminology',async()=>{
      const emptyId=randomUUID(),emptyRef=randomUUID(); await insert('clients',{...base,id:emptyId,public_reference:emptyRef,name:'New customer'});
      for(const [type,label] of [['SALON_BARBER','Appointment'],['AGENCY','Project'],['PLUMBING','Job'],['LOGISTICS_COURIER','Delivery'],['PROFESSIONAL_SERVICES','Case']]){
        await connection.query('update tenants set business_type=$1 where id=$2',[type,tenant]);
        const result=await service.overview(owner,emptyRef); assert.equal(result.customer.workLabel,label); assert.equal(result.now.length,0); assert.equal(result.attention.length,0); assert.equal(result.timeline.entries.length,1);
      }
      await connection.query('update tenants set business_type=$1 where id=$2',['SALON_BARBER',tenant]);
      const salon=await service.overview(owner,reference); assert.equal(salon.diagnostics.length,0); assert.equal(salon.now[0].attentionLevel,'IMPORTANT'); assert.ok(salon.now.some(n=>n.source==='bookings')); assert.ok(!salon.sources.includes('sales'));
    });
  } finally { await connection.query(`drop schema ${schema} cascade`); connection.release(); await pool.end(); }
});
