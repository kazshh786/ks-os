import { authorizeService, serviceClient } from '@/lib/service-api';
import { isUuid, publicError } from '@/lib/booking-contract';
export const runtime='nodejs';

export async function GET(request:Request,{params}:{params:Promise<{tenantId:string}>}){
  const denied=authorizeService(request);if(denied)return denied;
  const {tenantId}=await params;if(!isUuid(tenantId))return publicError(400,'INVALID_TENANT','Invalid tenant identifier');
  try{
    const db=serviceClient();
    const [{data:tenant,error},{count:services},{count:staff}]=await Promise.all([
      db.from('tenants').select('id,name,subdomain,timezone,currency').eq('id',tenantId).single(),
      db.from('services').select('id',{count:'exact',head:true}).eq('tenant_id',tenantId).eq('is_active',true),
      db.from('users').select('id',{count:'exact',head:true}).eq('tenant_id',tenantId),
    ]);
    if(error||!tenant)return publicError(404,'TENANT_NOT_FOUND','KS OS tenant not found');
    return Response.json({tenant:{id:tenant.id,name:tenant.name,subdomain:tenant.subdomain,timezone:tenant.timezone,currency:tenant.currency},readiness:{ready:(services||0)>0&&(staff||0)>0,services:services||0,staff:staff||0}},{headers:{'Cache-Control':'no-store'}});
  }catch{return publicError(500,'INTERNAL_ERROR','Unable to load KS OS tenant status');}
}
