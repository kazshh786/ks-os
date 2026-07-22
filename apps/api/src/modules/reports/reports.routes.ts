import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeAny } from 'zod';
import {
  AppointmentsReportQuerySchema, AppointmentsReportResponseSchema, ClientsReportQuerySchema, ClientsReportResponseSchema,
  CommunicationsReportQuerySchema, CommunicationsReportResponseSchema, FormsReportQuerySchema, FormsReportResponseSchema,
  PaymentsReportQuerySchema, PaymentsReportResponseSchema, ProductsReportQuerySchema, ProductsReportResponseSchema,
  RefundsReportQuerySchema, RefundsReportResponseSchema, ServicesReportQuerySchema, ServicesReportResponseSchema,
  StaffReportQuerySchema, StaffReportResponseSchema, StockReportQuerySchema, StockReportResponseSchema,
} from '@ks-os/contracts';
import { ReportsService } from './reports.service.js';

type Registration = { name:string; path:string; query:ZodTypeAny; response:ZodTypeAny; run:(service:ReportsService,tenantId:string,query:any)=>Promise<any> };
const registrations:Registration[]=[
  {name:'appointments',path:'/api/v1/reports/appointments',query:AppointmentsReportQuerySchema,response:AppointmentsReportResponseSchema,run:(s,t,q)=>s.appointments(t,q)},
  {name:'clients',path:'/api/v1/reports/clients',query:ClientsReportQuerySchema,response:ClientsReportResponseSchema,run:(s,t,q)=>s.clients(t,q)},
  {name:'services',path:'/api/v1/reports/services',query:ServicesReportQuerySchema,response:ServicesReportResponseSchema,run:(s,t,q)=>s.services(t,q)},
  {name:'staff',path:'/api/v1/reports/staff',query:StaffReportQuerySchema,response:StaffReportResponseSchema,run:(s,t,q)=>s.staff(t,q)},
  {name:'products',path:'/api/v1/reports/products',query:ProductsReportQuerySchema,response:ProductsReportResponseSchema,run:(s,t,q)=>s.products(t,q)},
  {name:'stock',path:'/api/v1/reports/stock',query:StockReportQuerySchema,response:StockReportResponseSchema,run:(s,t,q)=>s.stock(t,q)},
  {name:'payments',path:'/api/v1/reports/payments',query:PaymentsReportQuerySchema,response:PaymentsReportResponseSchema,run:(s,t,q)=>s.payments(t,q)},
  {name:'refunds',path:'/api/v1/reports/refunds',query:RefundsReportQuerySchema,response:RefundsReportResponseSchema,run:(s,t,q)=>s.refunds(t,q)},
  {name:'forms',path:'/api/v1/reports/forms',query:FormsReportQuerySchema,response:FormsReportResponseSchema,run:(s,t,q)=>s.forms(t,q)},
  {name:'communications',path:'/api/v1/reports/communications',query:CommunicationsReportQuerySchema,response:CommunicationsReportResponseSchema,run:(s,t,q)=>s.communications(t,q)},
];

const sendError=(reply:any,status:number,code:string,message:string)=>reply.code(status).send({success:false,error:{code,message}});

const hasErrorCode=(error:unknown,code:string)=>{
  let current:any=error;
  for(let depth=0;current&&depth<5;depth+=1){
    if(current.code===code)return true;
    current=current.cause;
  }
  return false;
};

export const createReportsRoutes=(service=new ReportsService()):FastifyPluginAsync=>async fastify=>{
  for(const registration of registrations){
    fastify.get(registration.path,async(request,reply)=>{
      request.requireAuth();
      if(request.auth!.role!=='owner')return sendError(reply,403,'REPORT_ACCESS_DENIED','Owner access is required.');
      const parsed=registration.query.safeParse(request.query);
      if(!parsed.success){
        const paths=parsed.error.issues.flatMap(issue=>issue.path.map(String));
        const code=paths.includes('sort')?'REPORT_INVALID_SORT':paths.some(path=>['period','from','to'].includes(path))?'REPORT_INVALID_PERIOD':'REPORT_INVALID_FILTER';
        return sendError(reply,400,code,code==='REPORT_INVALID_SORT'?'The requested sort is not supported.':'The report filters are invalid.');
      }
      const started=Date.now();
      try{
        const data=await registration.run(service,request.auth!.tenantId,parsed.data);
        const validated=registration.response.parse(data);
        request.log.info({tenantId:request.auth!.tenantId,report:registration.name,durationMs:Date.now()-started,queryCategory:'operational_report'},'Report query completed');
        return reply.send({success:true,data:validated});
      }catch(error:any){
        const range=error?.code==='ANALYTICS_RANGE_TOO_LARGE'||error?.code==='REPORT_RANGE_TOO_LARGE';
        const invalid=error?.code==='ANALYTICS_INVALID_PERIOD'||error?.code==='REPORT_INVALID_PERIOD';
        const missingRelation=hasErrorCode(error,'42P01');
        const unavailable=error?.code==='REPORT_DATA_UNAVAILABLE'||missingRelation;
        const status=range?422:invalid?400:unavailable?404:500;
        const code=range?'REPORT_RANGE_TOO_LARGE':invalid?'REPORT_INVALID_PERIOD':unavailable?'REPORT_DATA_UNAVAILABLE':'REPORT_QUERY_FAILED';
        request.log.error({tenantId:request.auth!.tenantId,report:registration.name,durationMs:Date.now()-started,code},'Report query failed');
        const message=status===500?'The report is temporarily unavailable.':missingRelation?'The report data source is not installed for this tenant environment.':error.message;
        return sendError(reply,status,code,message);
      }
    });
  }
};

export default createReportsRoutes();
