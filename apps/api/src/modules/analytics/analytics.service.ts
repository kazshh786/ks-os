import { eq } from 'drizzle-orm';
import { getDatabase, tenants } from '@ks-os/database';
import type { DashboardOverviewQuery, DashboardOverviewResponse } from '@ks-os/contracts';
import { compareKpi, safeRate } from './analytics.calculations.js';
import { resolveAnalyticsPeriod } from './analytics.period.js';
import { AnalyticsRepository, type AnalyticsRepositoryLike } from './analytics.repository.js';

type TenantInfo={timezone:string;currency:string};
export class AnalyticsService {
  constructor(private repository:AnalyticsRepositoryLike=new AnalyticsRepository(),private loadTenant=async(tenantId:string):Promise<TenantInfo>=>{const [tenant]=await getDatabase().select({timezone:tenants.timezone,currency:tenants.currency}).from(tenants).where(eq(tenants.id,tenantId)).limit(1);if(!tenant)throw Object.assign(new Error('Analytics data is unavailable.'),{code:'ANALYTICS_DATA_UNAVAILABLE',statusCode:404});return tenant;}){}
  async overview(tenantId:string,query:DashboardOverviewQuery,now=new Date()):Promise<DashboardOverviewResponse>{
    const tenant=await this.loadTenant(tenantId);const period=resolveAnalyticsPeriod(query,tenant.timezone,now);const today=resolveAnalyticsPeriod({preset:'TODAY'},tenant.timezone,now);
    const [current,previous,operations,topServices,staffUtilisation,dailyTrend]=await Promise.all([this.repository.getSummary(tenantId,period.from,period.to),this.repository.getSummary(tenantId,period.previousFrom,period.previousTo),this.repository.getOperations(tenantId,today.from,today.to),this.repository.getTopServices(tenantId,period),this.repository.getStaffUtilisation(tenantId,period),this.repository.getDailyTrend(tenantId,period)]);
    const money=(value:number,previousValue:number)=>({...compareKpi(value,previousValue),currency:tenant.currency});
    const currentCancellation=safeRate(current.cancelled,current.eligible),previousCancellation=safeRate(previous.cancelled,previous.eligible),currentNoShow=safeRate(current.noShow,current.eligible),previousNoShow=safeRate(previous.noShow,previous.eligible);
    const net=current.recordedRevenue-current.refundedAmount,previousNet=previous.recordedRevenue-previous.refundedAmount;
    return {period:{preset:period.preset,from:period.from.toISOString(),to:period.to.toISOString(),previousFrom:period.previousFrom.toISOString(),previousTo:period.previousTo.toISOString(),timezone:period.timezone,localFrom:period.localFrom,localTo:period.localTo},currency:tenant.currency,
      bookings:{total:compareKpi(current.total,previous.total),completed:compareKpi(current.completed,previous.completed),cancelled:compareKpi(current.cancelled,previous.cancelled),noShow:compareKpi(current.noShow,previous.noShow),cancellationRate:compareKpi(currentCancellation,previousCancellation),noShowRate:compareKpi(currentNoShow,previousNoShow)},
      revenue:{recordedRevenue:money(current.recordedRevenue,previous.recordedRevenue),refundedAmount:money(current.refundedAmount,previous.refundedAmount),netRecordedRevenue:money(net,previousNet),outstandingAmount:money(current.outstandingAmount,previous.outstandingAmount),averageTransactionValue:money(current.transactionCount?Math.round(current.recordedRevenue/current.transactionCount):0,previous.transactionCount?Math.round(previous.recordedRevenue/previous.transactionCount):0)},
      clients:{uniqueClients:compareKpi(current.uniqueClients,previous.uniqueClients),newClients:compareKpi(current.newClients,previous.newClients),returningClients:compareKpi(current.returningClients,previous.returningClients)},operations:operations as DashboardOverviewResponse['operations'],topServices,staffUtilisation,dailyTrend,generatedAt:now.toISOString()};
  }
}
