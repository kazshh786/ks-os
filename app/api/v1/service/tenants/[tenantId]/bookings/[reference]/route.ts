import { authorizeService, serviceClient } from '@/lib/service-api';
import { isUuid, publicError } from '@/lib/booking-contract';
export const runtime='nodejs';

export async function GET(request:Request,{params}:{params:Promise<{tenantId:string;reference:string}>}){
  const denied=authorizeService(request);if(denied)return denied;
  const {tenantId,reference}=await params;if(!isUuid(tenantId)||!isUuid(reference))return publicError(400,'INVALID_REQUEST','Invalid booking reference');
  try{
    const {data,error}=await serviceClient().from('appointments').select('public_reference,status,payment_status,start_time,end_time,booking_channel').eq('tenant_id',tenantId).eq('public_reference',reference).single();
    if(error||!data)return publicError(404,'BOOKING_NOT_FOUND','Booking not found');
    return Response.json({booking:{reference:data.public_reference,status:data.status,paymentStatus:data.payment_status,startTime:data.start_time,endTime:data.end_time,bookingChannel:data.booking_channel}},{headers:{'Cache-Control':'no-store'}});
  }catch{return publicError(500,'INTERNAL_ERROR','Unable to load booking status');}
}
