import { authorizeService, serviceClient } from '@/lib/service-api';
import { publicError } from '@/lib/booking-contract';
export const runtime='nodejs';

export async function GET(request:Request){
  const denied=authorizeService(request);if(denied)return denied;
  try{
    const {error}=await serviceClient().from('tenants').select('id').limit(1);
    if(error)return publicError(503,'DATABASE_UNAVAILABLE','KS OS database is unavailable');
    return Response.json({status:'healthy',version:'v1'},{headers:{'Cache-Control':'no-store'}});
  }catch{return publicError(503,'SERVICE_NOT_CONFIGURED','KS OS service is not configured');}
}
