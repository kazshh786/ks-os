import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  AppointmentsReportQuerySchema, AppointmentsReportResponseSchema, CommunicationsReportQuerySchema,
  PaymentsReportQuerySchema,
} from '@ks-os/contracts';
import { ReportsService } from '../src/modules/reports/reports.service.js';
import { createReportsRoutes } from '../src/modules/reports/reports.routes.js';
import {
  decodeReportCursor, deriveReportPaymentState, encodeReportCursor, mapReportPaymentSource,
  maskReportEmail, maskReportPhone,
} from '../src/modules/reports/reports.utils.js';

test('report query contracts enforce allowlisted sorts, filters and pagination limits',()=>{
  assert.equal(AppointmentsReportQuerySchema.safeParse({period:'LAST_30_DAYS',sort:'drop_table'}).success,false);
  assert.equal(AppointmentsReportQuerySchema.safeParse({period:'LAST_30_DAYS',limit:101}).success,false);
  assert.equal(AppointmentsReportQuerySchema.safeParse({period:'CUSTOM',from:'2026-01-01'}).success,false);
  assert.equal(PaymentsReportQuerySchema.safeParse({period:'LAST_7_DAYS',source:'STRIPE_ONLINE',status:'PARTIALLY_REFUNDED'}).success,true);
  assert.equal(CommunicationsReportQuerySchema.safeParse({period:'TODAY',channel:'SMS',status:'SUPPRESSED'}).success,true);
});

test('report cursors are opaque, stable and reject malformed values',()=>{
  const cursor=encodeReportCursor(100);assert.equal(decodeReportCursor(cursor),100);assert.throws(()=>decodeReportCursor('not-a-valid-cursor'));
});

test('payment reports distinguish sources and partial or full refunds',()=>{
  assert.equal(mapReportPaymentSource('CARD','booking_payment'),'STRIPE_ONLINE');
  assert.equal(mapReportPaymentSource('CARD','point_of_sale'),'EXTERNAL_TERMINAL');
  assert.equal(mapReportPaymentSource('CASH','point_of_sale'),'MANUAL_CASH');
  assert.equal(mapReportPaymentSource('SPLIT','point_of_sale'),'MANUAL_SPLIT');
  assert.equal(deriveReportPaymentState('SUCCEEDED',250,1000),'PARTIALLY_REFUNDED');
  assert.equal(deriveReportPaymentState('SUCCEEDED',1000,1000),'REFUNDED');
  assert.equal(deriveReportPaymentState('FAILED',0,1000),'FAILED');
});

test('communication recipients are masked without message data',()=>{
  assert.equal(maskReportEmail('person@example.com'),'p***@example.com');
  assert.equal(maskReportPhone('+447700900123'),'***0123');
});

test('report service derives timezone periods and passes only the authenticated tenant',async()=>{
  const seen:any[]=[];
  const repository:any={
    getTenantConfig:async(tenantId:string)=>{seen.push(['tenant',tenantId]);return{timezone:'Europe/London',currency:'GBP'};},
    appointments:async(tenantId:string,ctx:any,query:any)=>{seen.push(['report',tenantId,ctx.period.localFrom,ctx.period.localTo,query.status]);return{ok:true};},
  };
  const service=new ReportsService(repository);const result=await service.appointments('11111111-1111-1111-1111-111111111111',{period:'CUSTOM',from:'2026-03-29',to:'2026-03-29',limit:50,sort:'date_desc',status:'COMPLETED'});
  assert.deepEqual(result,{ok:true});assert.deepEqual(seen,[['tenant','11111111-1111-1111-1111-111111111111'],['report','11111111-1111-1111-1111-111111111111','2026-03-29','2026-03-29','COMPLETED']]);
  await assert.rejects(()=>service.appointments('11111111-1111-1111-1111-111111111111',{period:'CUSTOM',from:'2025-01-01',to:'2026-12-31',limit:50,sort:'date_desc'} as any),(error:any)=>error.code==='ANALYTICS_RANGE_TOO_LARGE');
});

test('owner access is mandatory and invalid sorts have a stable error',async()=>{
  const build=async(role:'owner'|'staff')=>{const app=Fastify();app.decorateRequest('auth',null);app.decorateRequest('requireAuth',function(){});app.addHook('preHandler',async request=>{(request as any).auth={role,tenantId:'11111111-1111-1111-1111-111111111111',authUserId:'22222222-2222-2222-2222-222222222222'};});await app.register(createReportsRoutes({} as ReportsService));await app.ready();return app;};
  const staff=await build('staff');const denied=await staff.inject({method:'GET',url:'/api/v1/reports/appointments'});assert.equal(denied.statusCode,403);assert.equal(denied.json().error.code,'REPORT_ACCESS_DENIED');await staff.close();
  const owner=await build('owner');const invalid=await owner.inject({method:'GET',url:'/api/v1/reports/appointments?sort=tenant_id'});assert.equal(invalid.statusCode,400);assert.equal(invalid.json().error.code,'REPORT_INVALID_SORT');await owner.close();
});

test('missing prerequisite report tables return a safe data-unavailable error',async()=>{
  const app=Fastify();
  app.decorateRequest('auth',null);
  app.decorateRequest('requireAuth',function(){});
  app.addHook('preHandler',async request=>{(request as any).auth={role:'owner',tenantId:'11111111-1111-1111-1111-111111111111',authUserId:'22222222-2222-2222-2222-222222222222'};});
  const service={payments:async()=>{throw Object.assign(new Error('relation "stripe_refunds" does not exist'),{code:'42P01'});}} as unknown as ReportsService;
  await app.register(createReportsRoutes(service));
  await app.ready();
  const response=await app.inject({method:'GET',url:'/api/v1/reports/payments?period=LAST_30_DAYS'});
  assert.equal(response.statusCode,404);
  assert.deepEqual(response.json(),{success:false,error:{code:'REPORT_DATA_UNAVAILABLE',message:'The report data source is not installed for this tenant environment.'}});
  assert.equal(response.body.includes('stripe_refunds'),false);
  await app.close();
});

test('appointment response contracts reject sensitive extra fields',()=>{
  const response={period:{period:'TODAY',from:'2026-01-01T00:00:00.000Z',to:'2026-01-02T00:00:00.000Z',timezone:'UTC',localFrom:'2026-01-01',localTo:'2026-01-01'},currency:'GBP',filters:{search:null,status:null,staffId:null,serviceId:null,clientId:null,bookingChannel:null,paymentStatus:null,sort:'date_desc'},summary:{total:1,completed:1,cancelled:0,noShow:0,awaitingPayment:0,quotedAmountTotal:1000},rows:[{appointmentId:'11111111-1111-1111-1111-111111111111',publicReference:'22222222-2222-2222-2222-222222222222',startTime:'2026-01-01T10:00:00.000Z',endTime:'2026-01-01T11:00:00.000Z',clientId:null,clientDisplayName:'Safe name',serviceId:null,serviceName:null,staffId:'33333333-3333-3333-3333-333333333333',staffName:'Stylist',status:'COMPLETED',bookingChannel:'in_shop',quotedAmount:1000,paymentState:'FullyPaid',createdAt:'2025-12-01T10:00:00.000Z',medicalNotes:'must never leave the API'}],pagination:{limit:50,nextCursor:null,hasMore:false},generatedAt:'2026-01-01T12:00:00.000Z'};
  assert.equal(AppointmentsReportResponseSchema.safeParse(response).success,false);
});
