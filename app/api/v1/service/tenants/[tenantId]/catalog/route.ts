import { authorizeService, serviceClient } from '@/lib/service-api';
import { isUuid, publicError } from '@/lib/booking-contract';
export const runtime='nodejs';

export async function GET(request:Request,{params}:{params:Promise<{tenantId:string}>}){
  const denied=authorizeService(request);if(denied)return denied;
  const {tenantId}=await params;if(!isUuid(tenantId))return publicError(400,'INVALID_TENANT','Invalid tenant identifier');
  try{
    const db=serviceClient();
    const [{data:tenant,error:tenantError},{data:services,error:serviceError},{data:staff,error:staffError}]=await Promise.all([
      db.from('tenants').select('id,name,timezone,currency,primary_color,secondary_color,accent_color,default_payment_mode').eq('id',tenantId).single(),
      db.from('services').select('id,name,description,duration,price,discount,requires_deposit').eq('tenant_id',tenantId).eq('is_active',true).order('name'),
      db.from('users').select('id,name').eq('tenant_id',tenantId).order('name'),
    ]);
    if(tenantError||!tenant)return publicError(404,'TENANT_NOT_FOUND','KS OS tenant not found');
    if(serviceError||staffError)return publicError(500,'CATALOG_UNAVAILABLE','Booking catalog is unavailable');
    return Response.json({tenant:{id:tenant.id,name:tenant.name,timezone:tenant.timezone,currency:tenant.currency,colors:{primary:tenant.primary_color,secondary:tenant.secondary_color,accent:tenant.accent_color}},paymentMode:tenant.default_payment_mode,services:services||[],staff:staff||[]},{headers:{'Cache-Control':'private, max-age=60'}});
  }catch{return publicError(500,'INTERNAL_ERROR','Unable to load booking catalog');}
}
