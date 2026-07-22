import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, getTableColumns, gt, inArray, lt, sql } from 'drizzle-orm';
import { getDatabase, reportExportJobs, users } from '@ks-os/database';
import {
  AppointmentsReportQuerySchema, ClientsReportQuerySchema, CommunicationsReportQuerySchema, CreateReportExportSchema, FormsReportQuerySchema,
  PaymentsReportQuerySchema, ProductsReportQuerySchema, RefundsReportQuerySchema, ServicesReportQuerySchema, StaffReportQuerySchema, StockReportQuerySchema,
  type CreateReportExport, type ExportableReportType, type ReportExportFilters,
} from '@ks-os/contracts';
import { ReportsService } from '../reports/reports.service.js';
import { csvLine, exportHeaders, exportRow } from './report-csv.js';
import { SupabaseReportStorage, type ReportStorageLike } from './report-storage.js';

const active=['PENDING','PROCESSING'] as const;
const maxRows=()=>Math.min(50_000,Math.max(100,Number(process.env.REPORT_EXPORT_MAX_ROWS||10_000)));
const maxActive=()=>Math.min(20,Math.max(1,Number(process.env.REPORT_EXPORT_MAX_ACTIVE_PER_TENANT||5)));
const maxHourly=()=>Math.min(50,Math.max(1,Number(process.env.REPORT_EXPORTS_PER_USER_HOUR||10)));
const retentionMs=()=>Math.min(168,Math.max(1,Number(process.env.REPORT_EXPORT_RETENTION_HOURS||72)))*3_600_000;
const signedSeconds=()=>Math.min(300,Math.max(30,Number(process.env.REPORT_EXPORT_SIGNED_URL_SECONDS||120)));
const error=(statusCode:number,code:string,message:string)=>Object.assign(new Error(message),{statusCode,code});

const runners:Record<ExportableReportType,{schema:any;run:(s:ReportsService,t:string,q:any)=>Promise<any>}>= {
  APPOINTMENTS:{schema:AppointmentsReportQuerySchema,run:(s,t,q)=>s.appointments(t,q)}, CLIENTS:{schema:ClientsReportQuerySchema,run:(s,t,q)=>s.clients(t,q)},
  SERVICES:{schema:ServicesReportQuerySchema,run:(s,t,q)=>s.services(t,q)}, STAFF_ACTIVITY:{schema:StaffReportQuerySchema,run:(s,t,q)=>s.staff(t,q)},
  PRODUCTS:{schema:ProductsReportQuerySchema,run:(s,t,q)=>s.products(t,q)}, STOCK:{schema:StockReportQuerySchema,run:(s,t,q)=>s.stock(t,q)},
  PAYMENTS:{schema:PaymentsReportQuerySchema,run:(s,t,q)=>s.payments(t,q)}, REFUNDS:{schema:RefundsReportQuerySchema,run:(s,t,q)=>s.refunds(t,q)},
  FORMS:{schema:FormsReportQuerySchema,run:(s,t,q)=>s.forms(t,q)}, COMMUNICATIONS:{schema:CommunicationsReportQuerySchema,run:(s,t,q)=>s.communications(t,q)},
};
const serialise=(row:any)=>({id:row.id,reportType:row.reportType,filters:row.filtersJson,format:row.format,status:row.status,requestedByUserId:row.requestedByUserId??null,requestedByName:row.requestedByName??null,rowCount:row.rowCount??null,fileSizeBytes:row.fileSizeBytes??null,requestedAt:row.requestedAt.toISOString(),startedAt:row.startedAt?.toISOString()??null,completedAt:row.completedAt?.toISOString()??null,expiresAt:row.expiresAt?.toISOString()??null,failureCode:row.failureCode??null,downloadFilename:row.downloadFilename??null});

export class ReportExportsService {
  private db=getDatabase();
  constructor(private reports=new ReportsService(),private storage:ReportStorageLike=new SupabaseReportStorage()){}
  validate(type:ExportableReportType,filters:ReportExportFilters){const parsed=runners[type].schema.safeParse({...filters,limit:100});if(!parsed.success)throw error(400,'EXPORT_INVALID_FILTER','The report filters are invalid.');return parsed.data;}
  async create(tenantId:string,userId:string,input:CreateReportExport){const parsed=CreateReportExportSchema.parse(input);this.validate(parsed.reportType,parsed.filters);
    const[[tenantActive],[hourly]]=await Promise.all([
      this.db.select({value:count()}).from(reportExportJobs).where(and(eq(reportExportJobs.tenantId,tenantId),inArray(reportExportJobs.status,[...active]))),
      this.db.select({value:count()}).from(reportExportJobs).where(and(eq(reportExportJobs.tenantId,tenantId),eq(reportExportJobs.requestedByUserId,userId),gt(reportExportJobs.requestedAt,new Date(Date.now()-3_600_000))))
    ]);
    if(Number(tenantActive?.value||0)>=maxActive())throw error(429,'EXPORT_LIMIT_EXCEEDED','Too many exports are already active.');
    if(Number(hourly?.value||0)>=maxHourly())throw error(429,'EXPORT_LIMIT_EXCEEDED','The hourly export limit has been reached.');
    const[row]=await this.db.insert(reportExportJobs).values({tenantId,requestedByUserId:userId,reportType:parsed.reportType,filtersJson:parsed.filters,format:'CSV',status:'PENDING'}).returning();return serialise(row);
  }
  async createScheduled(tx:any,tenantId:string,userId:string|null,reportType:ExportableReportType,filters:ReportExportFilters){this.validate(reportType,filters);const[row]=await tx.insert(reportExportJobs).values({tenantId,requestedByUserId:userId,reportType,filtersJson:filters,format:'CSV',status:'PENDING'}).returning();return row;}
  async list(tenantId:string,limit=50,cursor?:Date){const conditions=[eq(reportExportJobs.tenantId,tenantId)];if(cursor)conditions.push(lt(reportExportJobs.requestedAt,cursor));const rows=await this.db.select({...getTableColumns(reportExportJobs),requestedByName:users.name}).from(reportExportJobs).leftJoin(users,and(eq(users.id,reportExportJobs.requestedByUserId),eq(users.tenantId,tenantId))).where(and(...conditions)).orderBy(desc(reportExportJobs.requestedAt),desc(reportExportJobs.id)).limit(limit+1);const page=rows.slice(0,limit);return{data:page.map(serialise),nextCursor:rows.length>limit?page.at(-1)!.requestedAt.toISOString():null};}
  async get(tenantId:string,id:string){const[row]=await this.db.select({...getTableColumns(reportExportJobs),requestedByName:users.name}).from(reportExportJobs).leftJoin(users,and(eq(users.id,reportExportJobs.requestedByUserId),eq(users.tenantId,tenantId))).where(and(eq(reportExportJobs.id,id),eq(reportExportJobs.tenantId,tenantId))).limit(1);if(!row)throw error(404,'EXPORT_NOT_FOUND','Export not found.');return serialise(row);}
  async cancel(tenantId:string,id:string){const[row]=await this.db.update(reportExportJobs).set({status:'CANCELLED',updatedAt:new Date()}).where(and(eq(reportExportJobs.id,id),eq(reportExportJobs.tenantId,tenantId),eq(reportExportJobs.status,'PENDING'))).returning();if(!row){await this.get(tenantId,id);throw error(409,'EXPORT_NOT_READY','Only pending exports can be cancelled.');}return serialise(row);}
  async download(tenantId:string,id:string){const[row]=await this.db.select().from(reportExportJobs).where(and(eq(reportExportJobs.id,id),eq(reportExportJobs.tenantId,tenantId))).limit(1);if(!row)throw error(404,'EXPORT_NOT_FOUND','Export not found.');if(row.status!=='READY'||!row.fileStoragePath||!row.downloadFilename)throw error(409,'EXPORT_NOT_READY','Export is not ready.');if(!row.expiresAt||row.expiresAt<=new Date())throw error(410,'EXPORT_EXPIRED','Export has expired.');const seconds=signedSeconds();const url=await this.storage.signedUrl(row.fileStoragePath,seconds,row.downloadFilename);return{url,expiresAt:new Date(Date.now()+seconds*1000).toISOString(),filename:row.downloadFilename};}
  async processPending(limit=5){const claimed=await this.db.execute(sql`with candidates as (select id from report_export_jobs where status='PENDING' order by requested_at,id for update skip locked limit ${Math.min(20,Math.max(1,limit))}) update report_export_jobs j set status='PROCESSING',started_at=now(),updated_at=now() from candidates where j.id=candidates.id returning j.*`);let ready=0,failed=0;
    for(const job of claimed.rows as any[]){try{await this.generate(job);ready++;}catch(cause:any){failed++;await this.db.update(reportExportJobs).set({status:'FAILED',failureCode:cause?.code==='EXPORT_LIMIT_EXCEEDED'?'EXPORT_LIMIT_EXCEEDED':'EXPORT_GENERATION_FAILED',completedAt:new Date(),updatedAt:new Date()}).where(eq(reportExportJobs.id,job.id));}}
    return{claimed:claimed.rows.length,ready,failed};
  }
  private async generate(job:any){const type=job.report_type as ExportableReportType;const filters=job.filters_json as ReportExportFilters;let query=this.validate(type,filters);let cursor:string|undefined;let rows=0;const chunks=[Buffer.from('\uFEFF'+csvLine(exportHeaders(type)),'utf8')];
    do{const response=await runners[type].run(this.reports,job.tenant_id,{...query,limit:100,cursor});for(const row of response.rows){if(rows>=maxRows())throw error(422,'EXPORT_LIMIT_EXCEEDED','The export exceeds the row limit; narrow the filters.');chunks.push(Buffer.from(csvLine(exportRow(type,row)),'utf8'));rows++;}cursor=response.pagination.nextCursor??undefined;if(chunks.reduce((sum,item)=>sum+item.byteLength,0)>10_485_760)throw error(422,'EXPORT_LIMIT_EXCEEDED','The export exceeds the file-size limit; narrow the filters.');}while(cursor);
    const body=Buffer.concat(chunks);const opaque=`${job.tenant_id}/${job.id}/${randomUUID()}.csv`;const from=filters.from||filters.period||'current';const to=filters.to?`-to-${filters.to}`:'';const filename=`${type.toLowerCase().replace('_','-')}-${from}${to}.csv`.replace(/[^a-z0-9._-]/gi,'-').slice(0,180);
    await this.storage.upload(opaque,body);const completedAt=new Date();await this.db.update(reportExportJobs).set({status:'READY',fileStoragePath:opaque,downloadFilename:filename,rowCount:rows,fileSizeBytes:body.byteLength,completedAt,expiresAt:new Date(completedAt.getTime()+retentionMs()),updatedAt:completedAt}).where(and(eq(reportExportJobs.id,job.id),eq(reportExportJobs.status,'PROCESSING')));
  }
  async cleanupExpired(limit=100){const rows=await this.db.select({id:reportExportJobs.id,path:reportExportJobs.fileStoragePath}).from(reportExportJobs).where(and(eq(reportExportJobs.status,'READY'),lt(reportExportJobs.expiresAt,new Date()))).limit(Math.min(500,limit));const paths=rows.flatMap(row=>row.path?[row.path]:[]);await this.storage.remove(paths);if(rows.length)await this.db.update(reportExportJobs).set({status:'EXPIRED',fileStoragePath:null,updatedAt:new Date()}).where(inArray(reportExportJobs.id,rows.map(row=>row.id)));return{expired:rows.length};}
}
