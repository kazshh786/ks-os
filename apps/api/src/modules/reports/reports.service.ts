import type {
  AppointmentsReportQuery, ClientsReportQuery, CommunicationsReportQuery, FormsReportQuery, PaymentsReportQuery,
  ProductsReportQuery, RefundsReportQuery, ServicesReportQuery, StaffReportQuery, StockReportQuery,
} from '@ks-os/contracts';
import { resolveAnalyticsPeriod } from '../analytics/analytics.period.js';
import { ReportsRepository, type ReportsRepositoryLike } from './reports.repository.js';

type PeriodQuery = { period: any; from?: string; to?: string };

export class ReportsService {
  constructor(private readonly repository: ReportsRepositoryLike = new ReportsRepository()) {}

  private async context(tenantId: string, query: PeriodQuery) {
    const tenant = await this.repository.getTenantConfig(tenantId);
    if (!tenant) throw Object.assign(new Error('Report data is unavailable.'), { code: 'REPORT_DATA_UNAVAILABLE', statusCode: 404 });
    const period = resolveAnalyticsPeriod({ preset: query.period, from: query.from, to: query.to }, tenant.timezone);
    return { ...tenant, period };
  }

  async appointments(tenantId:string, query:AppointmentsReportQuery){const ctx=await this.context(tenantId,query);return this.repository.appointments(tenantId,ctx,query);}
  async clients(tenantId:string, query:ClientsReportQuery){const ctx=await this.context(tenantId,query);return this.repository.clients(tenantId,ctx,query);}
  async services(tenantId:string, query:ServicesReportQuery){const ctx=await this.context(tenantId,query);return this.repository.services(tenantId,ctx,query);}
  async staff(tenantId:string, query:StaffReportQuery){const ctx=await this.context(tenantId,query);return this.repository.staff(tenantId,ctx,query);}
  async products(tenantId:string, query:ProductsReportQuery){const ctx=await this.context(tenantId,query);return this.repository.products(tenantId,ctx,query);}
  async stock(tenantId:string, query:StockReportQuery){const tenant=await this.repository.getTenantConfig(tenantId);if(!tenant)throw Object.assign(new Error('Report data is unavailable.'),{code:'REPORT_DATA_UNAVAILABLE',statusCode:404});return this.repository.stock(tenantId,tenant,query);}
  async payments(tenantId:string, query:PaymentsReportQuery){const ctx=await this.context(tenantId,query);return this.repository.payments(tenantId,ctx,query);}
  async refunds(tenantId:string, query:RefundsReportQuery){const ctx=await this.context(tenantId,query);return this.repository.refunds(tenantId,ctx,query);}
  async forms(tenantId:string, query:FormsReportQuery){const ctx=await this.context(tenantId,query);return this.repository.forms(tenantId,ctx,query);}
  async communications(tenantId:string, query:CommunicationsReportQuery){const ctx=await this.context(tenantId,query);return this.repository.communications(tenantId,ctx,query);}
}
