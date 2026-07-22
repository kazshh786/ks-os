import test from 'node:test';
import assert from 'node:assert/strict';
import { CreateReportExportSchema, CreateReportScheduleSchema } from '@ks-os/contracts';
import { csvCell, exportHeaders, exportRow } from '../src/modules/reporting/report-csv.js';
import { nextReportRun } from '../src/modules/reporting/report-schedules.service.js';
import { AdvancedAnalyticsService } from '../src/modules/analytics/advanced-analytics.service.js';

test('export contracts allow only approved report types and strict filters',()=>{
  assert.equal(CreateReportExportSchema.safeParse({reportType:'APPOINTMENTS',format:'CSV',filters:{period:'LAST_30_DAYS'}}).success,true);
  assert.equal(CreateReportExportSchema.safeParse({reportType:'RAW_SQL',format:'CSV',filters:{}}).success,false);
  assert.equal(CreateReportExportSchema.safeParse({reportType:'FORMS',filters:{columns:['answers']}}).success,false);
  assert.equal(CreateReportExportSchema.safeParse({reportType:'CLIENTS',filters:{period:'CUSTOM',from:'2026-01-01'}}).success,false);
});

test('CSV output is formula-safe and excludes sensitive report fields',()=>{
  assert.equal(csvCell('=HYPERLINK("bad")'),"\"'=HYPERLINK(\"\"bad\"\")\"");
  const formHeaders=exportHeaders('FORMS');assert.equal(formHeaders.some(header=>/answer|token|acknowledgement/i.test(header)),false);
  const communicationHeaders=exportHeaders('COMMUNICATIONS');assert.equal(communicationHeaders.some(header=>/body|payload|secure link/i.test(header)),false);
  const client=exportRow('CLIENTS',{clientId:'reference',name:'Safe',firstAppointmentAt:null,lastAppointmentAt:null,completedAppointmentCount:1,cancelledCount:0,noShowCount:0,recordedSpend:100,futureAppointmentCount:1,clientType:'RETURNING',medicalNotes:'never export'});
  assert.equal(client.includes('never export'),false);
});

test('daily, weekly and monthly recurrence uses tenant-local time across DST',()=>{
  const daily=nextReportRun({frequency:'DAILY',deliveryTimeLocal:'09:00'},'Europe/London',new Date('2026-03-28T10:00:00.000Z'));
  assert.equal(daily.toISOString(),'2026-03-29T08:00:00.000Z');
  const weekly=nextReportRun({frequency:'WEEKLY',deliveryTimeLocal:'09:00',weekday:1},'Europe/London',new Date('2026-03-29T12:00:00.000Z'));
  assert.equal(weekly.toISOString(),'2026-03-30T08:00:00.000Z');
  const monthly=nextReportRun({frequency:'MONTHLY',deliveryTimeLocal:'09:00',monthlyDay:'LAST'},'Europe/London',new Date('2026-04-01T00:00:00.000Z'));
  assert.equal(monthly.toISOString(),'2026-04-30T08:00:00.000Z');
  assert.equal(CreateReportScheduleSchema.safeParse({name:'Bad cron',reportType:'APPOINTMENTS',filters:{},recurrence:{frequency:'WEEKLY',deliveryTimeLocal:'09:00'},recipientUserIds:['11111111-1111-1111-1111-111111111111']}).success,false);
});

test('advanced analytics suppresses low samples and preserves integer money',async()=>{
  const repository:any={tenant:async()=>({timezone:'Europe/London',currency:'GBP'}),bookingTrend:async()=>[],revenueTrend:async()=>[{bucket:'2026-07-01',grossRecordedRevenue:1234,refundedAmount:234,netRecordedRevenue:1000,transactionCount:1,averageTransactionValue:1234}],retention:async()=>({eligible:9,matched:8}),rebooking:async()=>({eligible:10,matched:4}),leadTime:async()=>({sample:9,median:12.5,average:15,distribution:[]}),serviceDemand:async()=>[],staffTrend:async()=>[],patterns:async()=>[],revenueMix:async()=>[{dimension:'PAYMENT_METHOD',key:'CARD',gross:1234,transactions:1}],clientFrequency:async()=>[],forward:async()=>({horizon:30,future_count:2,future_value:5000,current_pace:12,previous_pace:10})};
  const data=await new AdvancedAnalyticsService(repository).overview('11111111-1111-1111-1111-111111111111',{preset:'LAST_30_DAYS',grain:'AUTO',retentionWindowDays:90});
  assert.equal(data.retention.status,'INSUFFICIENT_DATA');assert.equal(data.retention.percentage,null);assert.equal(data.rebooking.percentage,40);assert.equal(data.leadTime.medianHours,null);assert.equal(data.forwardBookings.confirmedBookingValue,5000);assert.equal(Number.isInteger(data.revenueMix[0].grossRecordedRevenue),true);
});
