import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import Fastify from 'fastify';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as database from '@ks-os/database';
import { CreateBookingRequestSchema, StaffCreateBookingRequestSchema, SalesBookingContextQuerySchema, resolveBusinessProfile, salesBookingActionLabel, salesAppointmentSuggestion, type SalesAppointment } from '@ks-os/contracts';
import { SalesBookingService, type JourneyActor } from '../src/modules/bookings/sales-booking.service.js';
import { BookingService } from '../src/modules/bookings/booking.service.js';
import bookingsRoutes from '../src/modules/bookings/booking.routes.js';
import { customerAdapters } from '../src/modules/customer-360/customer-360.adapters.js';
import { attentionFor } from '../src/modules/customer-360/customer-attention.service.js';

const id = randomUUID;
test('staff-only public-reference contracts preserve public booking compatibility', () => {
  const request = { serviceId:id(),staffId:id(),startTime:'2027-01-01T12:00:00Z',client:{name:'Test Customer',email:'test@example.test',phone:'07000000000'},bookingChannel:'in_shop',paymentMode:'pay_later' };
  assert.ok(StaffCreateBookingRequestSchema.safeParse(request).success);
  assert.ok(StaffCreateBookingRequestSchema.safeParse({...request,clientReference:id(),salesOpportunityReference:id()}).success);
  assert.ok(StaffCreateBookingRequestSchema.safeParse({...request,client:{name:'Existing customer'},clientReference:id()}).success);
  assert.equal(StaffCreateBookingRequestSchema.safeParse({...request,salesOpportunityReference:id()}).success,false);
  assert.equal(StaffCreateBookingRequestSchema.safeParse({...request,clientReference:id(),salesOpportunityReference:id(),walkIn:true}).success,false);
  for (const field of ['tenantId','salesOpportunityId','clientId']) assert.equal(StaffCreateBookingRequestSchema.safeParse({...request,[field]:id()}).success,false);
  const publicRequest = {...request,idempotencyKey:id()};
  assert.ok(CreateBookingRequestSchema.safeParse(publicRequest).success);
  assert.equal(CreateBookingRequestSchema.safeParse({...publicRequest,salesOpportunityReference:id()}).success,false);
  assert.equal(SalesBookingContextQuerySchema.safeParse({clientReference:id(),tenantId:id()}).success,false);
  assert.equal(SalesBookingContextQuerySchema.safeParse({clientReference:id(),opportunityReference:id()}).success,false);
});

test('suggestions use canonical status, recency, open sale and quote evidence', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const a: SalesAppointment = {reference:id(),title:'Site survey',status:'COMPLETED',startTime:'2026-09-20T09:00:00Z',endTime:'2026-09-20T10:00:00Z',timezone:'UTC',staffName:null,route:'/app/bookings?view=day',canReschedule:false};
  assert.equal(salesAppointmentSuggestion([a],true,false,now)?.code,'SALES_BOOKING_COMPLETED');
  assert.equal(salesAppointmentSuggestion([a],true,true,now),null);
  assert.equal(salesAppointmentSuggestion([a],false,false,now),null);
  assert.equal(salesAppointmentSuggestion([{...a,status:'CANCELLED'}],true,false,now)?.code,'SALES_BOOKING_CANCELLED');
  assert.equal(salesAppointmentSuggestion([a,{...a,status:'CONFIRMED',startTime:'2026-09-22T09:00:00Z'}],true,false,now),null);
  assert.equal(salesAppointmentSuggestion([{...a,endTime:'2026-07-01T00:00:00Z'}],true,false,now),null);
  assert.equal(salesBookingActionLabel(resolveBusinessProfile('PLUMBING')),'Book site visit');
  assert.equal(salesBookingActionLabel(resolveBusinessProfile('AGENCY')),'Book discovery call');
});

const url = process.env.SALES_BOOKING_TEST_DATABASE_URL;
test('Sales-booking PostgreSQL: integrity, permissions, canonical creation and composition', { skip: !url }, async t => {
  const parsed = new URL(url!);
  assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname)); assert.equal(parsed.pathname,'/sales_booking_test');
  const pool = new Pool({connectionString:url,max:1}); const c=await pool.connect();
  const schema='sales_booking_'+id().replaceAll('-','');
  await c.query(`create schema ${schema}; set search_path to ${schema},public`);
  const dbUrl=new URL(url!);dbUrl.searchParams.set('options',`-c search_path=${schema},public`);
  database.getDatabase(dbUrl.toString());
  const tables=[database.tenants,database.users,database.clients,database.services,database.appointments,database.salesOpportunities,database.salesPipelineStages,database.salesQuotes,database.bookingAuditEvents];
  for (const table of tables) { const config=getTableConfig(table); await c.query(`create table "${config.name}" (${config.columns.map(col=>`"${col.name}" ${col.getSQLType()}${col.name==='id'?' primary key default gen_random_uuid()':col.name==='public_reference'?' default gen_random_uuid()':['created_at','updated_at'].includes(col.name)?' default now()':['is_internal','is_test'].includes(col.name)?' default false':''}`).join(',')})`); }
  const insert=async(table:string,row:Record<string,unknown>)=>{const cols=Object.keys(row);await c.query(`insert into ${table} (${cols.join(',')}) values (${cols.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));};
  const tenant=id(),otherTenant=id(),user=id(),otherUser=id(),customer=id(),otherCustomer=id(),customerRef=id(),otherCustomerRef=id(),sale=id(),saleRef=id(),foreignRef=id(),stage=id(),serviceId=id();
  const actor:JourneyActor={tenantId:tenant,userId:user,role:'owner',permissions:[]};
  const profile={version:1,completedAt:'2026-09-01T12:00:00Z',answers:{businessName:'Test Plumbing',businessType:'PLUMBING',teamSize:'2-5',buying:['appointments','quotes'],delivery:['jobs'],resources:['staff'],payment:['quotes'],manage:['customers','sales','bookings']}};
  const journey=new SalesBookingService();
  try {
    const migration=await readFile(new URL('../../../packages/database/migrations/20260921140000_sales_booking_relationship.sql',import.meta.url),'utf8');
    await c.query(migration);await c.query(migration);
    await insert('tenants',{id:tenant,business_type:'PLUMBING',business_profile:profile,timezone:'UTC'});
    await insert('tenants',{id:otherTenant,business_type:'SALON_BARBER',timezone:'UTC'});
    for(const u of [user,otherUser])await insert('users',{id:u,tenant_id:tenant,name:'Team member',account_status:'ACTIVE'});
    await insert('clients',{id:customer,public_reference:customerRef,tenant_id:tenant,name:'Original customer',email:'original@example.test',phone:'07000000000'});
    await insert('clients',{id:otherCustomer,public_reference:otherCustomerRef,tenant_id:tenant,name:'Different customer'});
    await insert('services',{id:serviceId,tenant_id:tenant,name:'Site survey',duration:60,price:0,discount:0,is_active:true});
    await insert('sales_pipeline_stages',{id:stage,tenant_id:tenant,name:'Site visit',category:'OPEN'});
    await insert('sales_opportunities',{id:sale,public_reference:saleRef,tenant_id:tenant,client_id:customer,owner_user_id:user,title:'Boiler replacement',stage_id:stage,currency:'GBP',estimated_value:450000});
    await insert('sales_opportunities',{id:id(),public_reference:foreignRef,tenant_id:otherTenant,client_id:customer,owner_user_id:user,title:'Foreign secret',stage_id:stage,currency:'GBP'});
    await t.test('only accessible public references for the same customer can be resolved',async()=>{
      assert.equal((await journey.resolveLink(actor,saleRef,customerRef)).id,sale);
      for(const ref of [foreignRef,id(),sale])await assert.rejects(journey.resolveLink(actor,ref,customerRef));
      await assert.rejects(journey.resolveLink(actor,saleRef,otherCustomerRef));
      await assert.rejects(journey.resolveLink({...actor,role:'staff',permissions:['BOOKINGS_VIEW_ALL']},saleRef,customerRef));
      await assert.rejects(journey.resolveLink({...actor,userId:otherUser,role:'staff',permissions:['BOOKINGS_VIEW_ALL','SALES_VIEW_OWN']},saleRef,customerRef));
      await assert.rejects(journey.resolveLink({...actor,tenantId:otherTenant},saleRef,customerRef));
    });
    await t.test('HTTP context rejects unauthenticated, injected tenant and inaccessible Sales requests',async()=>{
      const app=Fastify();let authenticated=false;
      app.decorateRequest('requireAuth',function(){if(!authenticated)throw Object.assign(new Error('Unauthenticated'),{statusCode:401});});
      app.addHook('preHandler',async request=>{request.auth={tenantId:tenant,tenantUserId:user,authUserId:user,role:'staff',permissions:['BOOKINGS_CREATE','BOOKINGS_VIEW_ALL','CLIENTS_VIEW_BASIC']} as never;});
      app.setErrorHandler((error,_request,reply)=>reply.code(error.name==='ZodError'?400:error.statusCode??500).send({error:error.message}));
      await app.register(bookingsRoutes);
      try {
        assert.equal((await app.inject('/api/v1/bookings/sales-context?clientReference='+customerRef)).statusCode,401);
        authenticated=true;
        assert.equal((await app.inject('/api/v1/bookings/sales-context?clientReference='+customerRef+'&tenantId='+otherTenant)).statusCode,400);
        assert.equal((await app.inject('/api/v1/bookings/sales-context?opportunityReference='+saleRef)).statusCode,404);
        const response=await app.inject('/api/v1/bookings/sales-context?clientReference='+customerRef);
        assert.equal(response.statusCode,200);assert.deepEqual(response.json().data.sales,[]);assert.ok(!response.body.includes(saleRef));
      } finally { await app.close(); }
    });
    const bookingService=new BookingService();
    const auth={tenantId:tenant,authUserId:user,tenantUserId:user,role:'owner' as const,permissions:[]};
    const future=new Date(Date.now()+86400000*2); future.setUTCMinutes(0,0,0);
    let bookingRef='';
    await t.test('canonical creation persists sale, retains customer and still rejects conflicts',async()=>{
      const before=(await c.query('select count(*) from clients')).rows[0].count;
      const result=await bookingService.createManualBooking(auth,serviceId,user,future.toISOString(),{name:'Changed form name',email:'different@example.test',phone:'07111111111'},'in_shop',{clientReference:customerRef,salesOpportunityReference:saleRef,notifyCustomer:false});
      const row=(await c.query('select * from appointments where id=$1',[result.appointment_id])).rows[0];bookingRef=row.public_reference;
      assert.equal(row.client_id,customer);assert.equal(row.sales_opportunity_id,sale);
      assert.equal(row.client_name,'Original customer');
      assert.equal((await c.query('select count(*) from clients')).rows[0].count,before);
      assert.equal((await c.query('select name from clients where id=$1',[customer])).rows[0].name,'Original customer');
      await assert.rejects(bookingService.createManualBooking(auth,serviceId,user,future.toISOString(),{name:'Customer'},'in_shop',{clientReference:customerRef,salesOpportunityReference:saleRef,notifyCustomer:false}),/no longer available/);
      await assert.rejects(bookingService.createManualBooking(auth,serviceId,user,new Date(future.getTime()+7200000).toISOString(),{name:'Customer'},'in_shop',{clientReference:otherCustomerRef,salesOpportunityReference:saleRef,notifyCustomer:false}));
    });
    await t.test('database rejects forged tenant/customer and updates; deletion only clears provenance',async()=>{
      const base={tenant_id:tenant,client_id:customer,sales_opportunity_id:sale,user_id:user};
      await assert.rejects(insert('appointments',{...base,tenant_id:otherTenant}),/foreign key/);
      await assert.rejects(insert('appointments',{...base,client_id:otherCustomer}),/foreign key/);
      await assert.rejects(insert('appointments',{...base,client_id:null}),/check constraint/);
      await assert.rejects(c.query('update sales_opportunities set client_id=$1 where id=$2',[otherCustomer,sale]),/foreign key/);
      const temporarySale=id(),temporaryBooking=id();
      await insert('sales_opportunities',{id:temporarySale,tenant_id:tenant,client_id:customer});
      await insert('appointments',{...base,id:temporaryBooking,sales_opportunity_id:temporarySale});
      await c.query('delete from sales_opportunities where id=$1',[temporarySale]);
      const row=(await c.query('select * from appointments where id=$1',[temporaryBooking])).rows[0];
      assert.equal(row.sales_opportunity_id,null);assert.equal(row.tenant_id,tenant);assert.equal(row.client_id,customer);
    });
    await t.test('ordinary bookings still work without Sales; optional customer selector is permission-aware',async()=>{
      const result=await bookingService.createManualBooking(auth,serviceId,user,new Date(future.getTime()+7200000).toISOString(),{name:'Original customer',email:'original@example.test'},'in_shop',{notifyCustomer:false});
      assert.equal((await c.query('select sales_opportunity_id from appointments where id=$1',[result.appointment_id])).rows[0].sales_opportunity_id,null);
      const context=await journey.context(actor,{opportunityReference:saleRef});assert.equal(context.customer.reference,customerRef);assert.equal(context.selectedReference,saleRef);assert.equal(context.suggestedStaffId,user);
      const staffActor={...actor,role:'staff' as const,permissions:['BOOKINGS_CREATE','BOOKINGS_VIEW_OWN','CLIENTS_VIEW_BASIC']};
      assert.deepEqual((await journey.context(staffActor,{clientReference:customerRef})).sales,[]);
      await c.query('update tenants set business_type=$1,business_profile=null where id=$2',['SALON_BARBER',tenant]);
      assert.deepEqual((await journey.context(actor,{clientReference:customerRef})).sales,[]);
      await assert.rejects(journey.resolveLink(actor,saleRef,customerRef));
      await c.query('update tenants set business_type=$1,business_profile=$2 where id=$3',['PLUMBING',profile,tenant]);
    });
    await t.test('calendar and Sales independently filter own/all permissions with multiple appointments',async()=>{
      await insert('appointments',{tenant_id:tenant,client_id:customer,sales_opportunity_id:sale,user_id:otherUser,service_id:serviceId,start_time:new Date(future.getTime()+86400000),end_time:new Date(future.getTime()+90000000),status:'CONFIRMED'});
      assert.equal((await journey.salesForBookings(actor,[bookingRef])).get(bookingRef)?.title,'Boiler replacement');
      assert.equal((await journey.appointmentsForSales(actor,[saleRef])).get(saleRef)?.length,2);
      const ownActor={...actor,role:'staff' as const,permissions:['SALES_VIEW_OWN','BOOKINGS_VIEW_OWN']};
      assert.equal((await journey.appointmentsForSales(ownActor,[saleRef])).get(saleRef)?.length,1);
      for(const permissions of [['BOOKINGS_VIEW_ALL'],['SALES_VIEW_ALL'],[]]){
        assert.equal((await journey.salesForBookings({...ownActor,permissions},[bookingRef])).size,0);
        assert.equal((await journey.appointmentsForSales({...ownActor,permissions},[saleRef])).size,0);
      }
      assert.equal((await journey.salesForBookings({...ownActor,userId:otherUser},[bookingRef])).size,0);
      assert.equal((await journey.appointmentsForSales({...actor,tenantId:otherTenant},[saleRef])).size,0);
    });
    await t.test('Customer 360 relates canonical sources and protects timeline and attention',async()=>{
      const db=database.getDatabase();const now=new Date();const resolved=resolveBusinessProfile('PLUMBING',profile);
      const adapter=customerAdapters({actor,clientId:customer,profile:resolved,now}).find(a=>a.source==='bookings')!;
      const rows=(await db.execute(adapter.current)).rows as any[];
      assert.equal(rows.find(r=>r.reference===bookingRef).related_sale.reference,saleRef);
      const timeline=(await db.execute(adapter.timeline)).rows as any[];assert.ok(timeline.some(r=>r.title.includes('Boiler replacement')));
      assert.ok(!timeline.some(r=>r.type==='BOOKING_COMPLETED'));
      const bookingId=(await c.query('select id from appointments where public_reference=$1',[bookingRef])).rows[0].id;
      await insert('booking_audit_events',{tenant_id:tenant,appointment_id:bookingId,action:'STATUS_CHANGED',new_values:{status:'COMPLETED',private:'PRIVATE_AUDIT_SECRET'}});
      const audited=(await db.execute(adapter.timeline)).rows as any[];
      assert.equal(audited.filter(r=>r.type==='BOOKING_COMPLETED').length,1);assert.ok(!JSON.stringify(audited).includes('PRIVATE_AUDIT_SECRET'));
      const staffActor={...actor,role:'staff' as const,permissions:['BOOKINGS_VIEW_ALL']};
      const hidden=customerAdapters({actor:staffActor,clientId:customer,profile:resolved,now}).find(a=>a.source==='bookings')!;
      assert.ok((await db.execute(hidden.current)).rows.every((r:any)=>!r.related_sale));
      assert.ok(!(JSON.stringify((await db.execute(hidden.timeline)).rows)).includes('Boiler replacement'));
      const item:any={key:'bookings:'+bookingRef,source:'bookings',reference:bookingRef,type:'APPOINTMENT',title:'Site survey',status:'COMPLETED',dueAt:now.toISOString(),relatedSale:rows[0].related_sale};
      assert.equal(attentionFor(item,{...rows[0],has_quote:false,sales_can_update:false},now)?.action,null);
      assert.equal(attentionFor(item,{...rows[0],has_quote:false,sales_can_update:true},now)?.code,'SALES_BOOKING_COMPLETED');
      assert.equal((await c.query('select stage_id from sales_opportunities where id=$1',[sale])).rows[0].stage_id,stage);
    });
  } finally { await database.closeDatabase(); await c.query(`drop schema ${schema} cascade`);c.release();await pool.end(); }
});
