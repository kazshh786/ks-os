import type { FastifyPluginAsync } from 'fastify';
import { DashboardOverviewQuerySchema, DashboardOverviewResponseSchema } from '@ks-os/contracts';
import { AnalyticsService } from './analytics.service.js';

const analyticsRoutes:FastifyPluginAsync=async fastify=>{
  const service=new AnalyticsService();
  fastify.get('/api/v1/dashboard/overview',async(request,reply)=>{
    request.requireAuth();
    if(request.auth!.role!=='owner')return reply.code(403).send({success:false,error:{code:'ANALYTICS_ACCESS_DENIED',message:'Owner access is required.'}});
    const parsed=DashboardOverviewQuerySchema.safeParse(request.query);
    if(!parsed.success)return reply.code(400).send({success:false,error:{code:'ANALYTICS_INVALID_PERIOD',message:'The reporting period is invalid.'}});
    const started=Date.now();
    try{const data=await service.overview(request.auth!.tenantId,parsed.data);request.log.info({tenantId:request.auth!.tenantId,preset:parsed.data.preset,durationMs:Date.now()-started,queryCategory:'dashboard_overview'},'Analytics query completed');return reply.send({success:true,data:DashboardOverviewResponseSchema.parse(data)});}
    catch(error:any){const status=error.statusCode===422?422:error.statusCode===400?400:500;const code=status===422?'ANALYTICS_RANGE_TOO_LARGE':status===400?'ANALYTICS_INVALID_PERIOD':'ANALYTICS_QUERY_FAILED';request.log.error({tenantId:request.auth!.tenantId,preset:parsed.data.preset,durationMs:Date.now()-started,code},'Analytics query failed');return reply.code(status).send({success:false,error:{code,message:status===500?'Dashboard analytics are temporarily unavailable.':error.message}});}
  });
};
export default analyticsRoutes;
