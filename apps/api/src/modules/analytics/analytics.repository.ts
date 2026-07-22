import { sql } from 'drizzle-orm';
import { getDatabase } from '@ks-os/database';
import type { AnalyticsPeriod } from './analytics.period.js';

const number = (value:unknown) => Number(value ?? 0);
export type Summary = { total:number;completed:number;cancelled:number;noShow:number;eligible:number;uniqueClients:number;newClients:number;returningClients:number;recordedRevenue:number;refundedAmount:number;outstandingAmount:number;transactionCount:number };

export interface AnalyticsRepositoryLike {
  getSummary(tenantId:string,from:Date,to:Date):Promise<Summary>;
  getOperations(tenantId:string,todayFrom:Date,todayTo:Date):Promise<Record<string,number>>;
  getTopServices(tenantId:string,period:AnalyticsPeriod):Promise<any[]>;
  getStaffUtilisation(tenantId:string,period:AnalyticsPeriod):Promise<any[]>;
  getDailyTrend(tenantId:string,period:AnalyticsPeriod):Promise<any[]>;
}

export class AnalyticsRepository implements AnalyticsRepositoryLike {
  private db=getDatabase();
  async getSummary(tenantId:string,from:Date,to:Date):Promise<Summary>{
    const result=await this.db.execute(sql`
      with period_appointments as (
        select * from appointments where tenant_id=${tenantId}::uuid and start_time>=${from.toISOString()}::timestamptz and start_time<${to.toISOString()}::timestamptz
      ), eligible_clients as (
        select distinct client_id from period_appointments where client_id is not null and status in ('CONFIRMED','CHECKED_IN','IN_SERVICE','AWAITING_PAYMENT','COMPLETED','CANCELLED','NO_SHOW')
      ), client_kpis as (
        select count(*)::int unique_clients,
          count(*) filter(where not exists(select 1 from appointments old where old.tenant_id=${tenantId}::uuid and old.client_id=ec.client_id and old.start_time<${from.toISOString()}::timestamptz and old.status in ('CONFIRMED','CHECKED_IN','IN_SERVICE','AWAITING_PAYMENT','COMPLETED','CANCELLED','NO_SHOW')))::int new_clients
        from eligible_clients ec
      ), revenue as (
        select coalesce(sum(total_amount) filter(where payment_status in ('SUCCEEDED','REFUNDED')),0)::int recorded_revenue,
          count(*) filter(where payment_status in ('SUCCEEDED','REFUNDED'))::int transaction_count
        from checkout_transactions where tenant_id=${tenantId}::uuid and created_at>=${from.toISOString()}::timestamptz and created_at<${to.toISOString()}::timestamptz
      ), refunds as (
        select coalesce(sum(amount) filter(where status='SUCCEEDED'),0)::int refunded_amount from stripe_refunds
        where tenant_id=${tenantId}::uuid and completed_at>=${from.toISOString()}::timestamptz and completed_at<${to.toISOString()}::timestamptz
      ), paid_by_appointment as (
        select appointment_id,coalesce(sum(total_amount) filter(where payment_status='SUCCEEDED'),0)::int paid from checkout_transactions where tenant_id=${tenantId}::uuid group by appointment_id
      ), outstanding as (
        select coalesce(sum(greatest(a.quoted_amount-coalesce(p.paid,0),0)),0)::int outstanding_amount from period_appointments a left join paid_by_appointment p on p.appointment_id=a.id where a.status='AWAITING_PAYMENT'
      ) select
        count(*) filter(where pa.status<>'BLOCKED')::int total,
        count(*) filter(where pa.status='COMPLETED')::int completed,
        count(*) filter(where pa.status='CANCELLED')::int cancelled,
        count(*) filter(where pa.status='NO_SHOW')::int no_show,
        count(*) filter(where pa.status in ('CONFIRMED','CHECKED_IN','IN_SERVICE','AWAITING_PAYMENT','COMPLETED','CANCELLED','NO_SHOW'))::int eligible,
        coalesce(ck.unique_clients,0)::int unique_clients,coalesce(ck.new_clients,0)::int new_clients,
        (coalesce(ck.unique_clients,0)-coalesce(ck.new_clients,0))::int returning_clients,
        r.recorded_revenue,rf.refunded_amount,o.outstanding_amount,r.transaction_count
      from period_appointments pa cross join client_kpis ck cross join revenue r cross join refunds rf cross join outstanding o
      group by ck.unique_clients,ck.new_clients,r.recorded_revenue,rf.refunded_amount,o.outstanding_amount,r.transaction_count`);
    const row=(result.rows[0]??{}) as any;return{total:number(row.total),completed:number(row.completed),cancelled:number(row.cancelled),noShow:number(row.no_show),eligible:number(row.eligible),uniqueClients:number(row.unique_clients),newClients:number(row.new_clients),returningClients:number(row.returning_clients),recordedRevenue:number(row.recorded_revenue),refundedAmount:number(row.refunded_amount),outstandingAmount:number(row.outstanding_amount),transactionCount:number(row.transaction_count)};
  }
  async getOperations(tenantId:string,todayFrom:Date,todayTo:Date){const result=await this.db.execute(sql`
    select
      (select count(*)::int from appointments where tenant_id=${tenantId}::uuid and start_time>=${todayFrom.toISOString()}::timestamptz and start_time<${todayTo.toISOString()}::timestamptz and status<>'BLOCKED') today_appointments,
      (select count(*)::int from appointments where tenant_id=${tenantId}::uuid and status='AWAITING_PAYMENT') awaiting_payment,
      (select count(*)::int from form_assignments fa join appointments a on a.id=fa.appointment_id and a.tenant_id=fa.tenant_id where fa.tenant_id=${tenantId}::uuid and fa.status in ('PENDING','OPENED') and fa.expires_at>now() and a.start_time>=now() and a.status not in ('CANCELLED','COMPLETED','NO_SHOW','BLOCKED')) incomplete_forms,
      (select count(*)::int from email_outbox where tenant_id=${tenantId}::uuid and status in ('FAILED','BOUNCED')) failed_emails,
      (select count(*)::int from sms_outbox where tenant_id=${tenantId}::uuid and status in ('FAILED','UNDELIVERED')) failed_sms,
      (select count(*)::int from stripe_disputes where tenant_id=${tenantId}::uuid and status not in ('won','lost')) open_disputes,
      (select count(*)::int from stripe_payouts where tenant_id=${tenantId}::uuid and status='failed') failed_payouts,
      (select count(*)::int from stripe_connections where tenant_id=${tenantId}::uuid and connection_status in ('ACTION_REQUIRED','RESTRICTED','DISABLED')) stripe_action_required`);
    const r=(result.rows[0]??{}) as any;return{todayAppointments:number(r.today_appointments),awaitingPayment:number(r.awaiting_payment),incompleteForms:number(r.incomplete_forms),failedEmails:number(r.failed_emails),failedSms:number(r.failed_sms),openDisputes:number(r.open_disputes),failedPayouts:number(r.failed_payouts),stripeActionRequired:number(r.stripe_action_required)};}
  async getTopServices(tenantId:string,p:AnalyticsPeriod){const result=await this.db.execute(sql`
    with activity as (select service_id,count(*) filter(where status<>'BLOCKED')::int booking_count,count(*) filter(where status='COMPLETED')::int completed_count from appointments where tenant_id=${tenantId}::uuid and start_time>=${p.from.toISOString()}::timestamptz and start_time<${p.to.toISOString()}::timestamptz and service_id is not null group by service_id), revenue as (select a.service_id,coalesce(sum(ct.total_amount) filter(where ct.payment_status in ('SUCCEEDED','REFUNDED')),0)::int recorded_revenue from checkout_transactions ct join appointments a on a.id=ct.appointment_id and a.tenant_id=ct.tenant_id where ct.tenant_id=${tenantId}::uuid and ct.created_at>=${p.from.toISOString()}::timestamptz and ct.created_at<${p.to.toISOString()}::timestamptz group by a.service_id) select s.id service_id,s.name service_name,a.booking_count,a.completed_count,coalesce(r.recorded_revenue,0)::int recorded_revenue from activity a join services s on s.id=a.service_id and s.tenant_id=${tenantId}::uuid left join revenue r on r.service_id=a.service_id order by a.booking_count desc,s.name limit 8`);return result.rows.map((r:any)=>({serviceId:r.service_id,serviceName:r.service_name,bookingCount:number(r.booking_count),completedCount:number(r.completed_count),recordedRevenue:number(r.recorded_revenue)}));}
  async getStaffUtilisation(tenantId:string,p:AnalyticsPeriod){const result=await this.db.execute(sql`
    with days as (select generate_series(${p.localFrom}::date,${p.localTo}::date,'1 day')::date day), availability as (select s.user_id,round(sum(extract(epoch from ((d.day+s.end_time::time)-(d.day+s.start_time::time)))/60))::int available_minutes from staff_schedules s join days d on extract(dow from d.day)=s.day_of_week where s.tenant_id=${tenantId}::uuid group by s.user_id), activity as (select user_id,round(sum(extract(epoch from (end_time-start_time))/60) filter(where status in ('CONFIRMED','CHECKED_IN','IN_SERVICE','AWAITING_PAYMENT','COMPLETED')))::int booked_minutes,count(*) filter(where status='COMPLETED')::int completed_appointments from appointments where tenant_id=${tenantId}::uuid and start_time>=${p.from.toISOString()}::timestamptz and start_time<${p.to.toISOString()}::timestamptz group by user_id), revenue as (select a.user_id,coalesce(sum(ct.total_amount) filter(where ct.payment_status in ('SUCCEEDED','REFUNDED')),0)::int recorded_revenue from checkout_transactions ct join appointments a on a.id=ct.appointment_id and a.tenant_id=ct.tenant_id where ct.tenant_id=${tenantId}::uuid and ct.created_at>=${p.from.toISOString()}::timestamptz and ct.created_at<${p.to.toISOString()}::timestamptz group by a.user_id) select u.id staff_id,u.name staff_name,coalesce(ac.booked_minutes,0)::int booked_minutes,av.available_minutes,coalesce(ac.completed_appointments,0)::int completed_appointments,coalesce(r.recorded_revenue,0)::int recorded_revenue from users u left join activity ac on ac.user_id=u.id left join availability av on av.user_id=u.id left join revenue r on r.user_id=u.id where u.tenant_id=${tenantId}::uuid and u.role in ('owner','staff') order by coalesce(ac.booked_minutes,0) desc,u.name`);return result.rows.map((r:any)=>{const booked=number(r.booked_minutes),available=r.available_minutes===null?null:number(r.available_minutes);return{staffId:r.staff_id,staffName:r.staff_name,bookedMinutes:booked,availableMinutes:available,utilisationPercentage:available&&available>0?Number(((booked/available)*100).toFixed(1)):null,completedAppointments:number(r.completed_appointments),recordedRevenue:number(r.recorded_revenue)}});}
  async getDailyTrend(tenantId:string,p:AnalyticsPeriod){const result=await this.db.execute(sql`
    with days as (select generate_series(${p.localFrom}::date,${p.localTo}::date,'1 day')::date day), appt as (select (start_time at time zone ${p.timezone})::date day,count(*) filter(where status<>'BLOCKED')::int bookings,count(*) filter(where status='COMPLETED')::int completed from appointments where tenant_id=${tenantId}::uuid and start_time>=${p.from.toISOString()}::timestamptz and start_time<${p.to.toISOString()}::timestamptz group by 1), rev as (select (created_at at time zone ${p.timezone})::date day,coalesce(sum(total_amount) filter(where payment_status in ('SUCCEEDED','REFUNDED')),0)::int revenue from checkout_transactions where tenant_id=${tenantId}::uuid and created_at>=${p.from.toISOString()}::timestamptz and created_at<${p.to.toISOString()}::timestamptz group by 1) select to_char(d.day,'YYYY-MM-DD') date,coalesce(a.bookings,0)::int bookings,coalesce(a.completed,0)::int completed,coalesce(r.revenue,0)::int revenue from days d left join appt a on a.day=d.day left join rev r on r.day=d.day order by d.day`);return result.rows.map((r:any)=>({date:r.date,bookings:number(r.bookings),completedAppointments:number(r.completed),recordedRevenue:number(r.revenue)}));}
}
