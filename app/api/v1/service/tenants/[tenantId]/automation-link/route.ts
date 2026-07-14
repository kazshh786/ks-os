import {authorizeService,parseJson,serviceClient} from '@/lib/service-api';
import {isUuid,publicError} from '@/lib/booking-contract';
export const runtime='nodejs';

export async function POST(request:Request,{params}:{params:Promise<{tenantId:string}>}){
  const denied=authorizeService(request);if(denied)return denied;const {tenantId}=await params;
  if(!isUuid(tenantId))return publicError(400,'INVALID_TENANT','Invalid tenant identifier');
  try{
    const body=await parseJson(request,2048);if(!body||Object.keys(body).some(key=>key!=='workspaceId')||!isUuid(body.workspaceId))return publicError(400,'INVALID_WORKSPACE','Invalid agency workspace identifier');
    const {data,error}=await serviceClient().from('tenants').update({agency_workspace_id:body.workspaceId}).eq('id',tenantId).select('id').single();
    if(error||!data)return publicError(404,'TENANT_NOT_FOUND','KS OS tenant not found');
    return Response.json({linked:true,tenantId,workspaceId:body.workspaceId},{headers:{'Cache-Control':'no-store'}});
  }catch(error:any){return publicError(error.status||500,error.code||'INTERNAL_ERROR',error.status?error.message:'Unable to link automation events');}
}
