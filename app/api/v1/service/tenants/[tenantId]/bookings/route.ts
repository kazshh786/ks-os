import { authorizeService, createPaymentIntent, parseJson, serviceClient } from '@/lib/service-api';
import { isPaymentMode, isUuid, publicError, requiresPayment } from '@/lib/booking-contract';
export const runtime='nodejs';

const ALLOWED=new Set(['serviceId','staffId','startTime','client','paymentMode','payNow','idempotencyKey']);

export async function POST(request:Request,{params}:{params:Promise<{tenantId:string}>}){
  const denied=authorizeService(request);if(denied)return denied;
  const {tenantId}=await params;if(!isUuid(tenantId))return publicError(400,'INVALID_TENANT','Invalid tenant identifier');
  try{
    const body=await parseJson(request);
    if(Object.keys(body).some(key=>!ALLOWED.has(key)))return publicError(400,'INVALID_REQUEST','Unknown booking fields');
    if(!isUuid(body.serviceId)||!isUuid(body.staffId)||!isUuid(body.idempotencyKey)||!isPaymentMode(body.paymentMode))return publicError(400,'INVALID_REQUEST','Invalid booking identifiers or payment mode');
    const start=new Date(body.startTime);if(!Number.isFinite(start.getTime()))return publicError(400,'INVALID_REQUEST','Invalid booking time');
    const client=body.client;
    if(!client||typeof client!=='object'||Array.isArray(client)||Object.keys(client).some(key=>!['name','email','phone'].includes(key)))return publicError(400,'INVALID_CUSTOMER','Invalid customer fields');
    if(requiresPayment(body.paymentMode,body.payNow===true)&&(!process.env.STRIPE_SECRET_KEY||!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY))return publicError(503,'PAYMENTS_NOT_CONFIGURED','Online payments are not configured');
    const db=serviceClient();
    const {data,error}=await db.rpc('create_public_booking',{
      p_tenant_id:tenantId,p_service_id:body.serviceId,p_staff_id:body.staffId,p_start_time:start.toISOString(),
      p_client_name:client.name,p_client_email:client.email,p_client_phone:client.phone,
      p_payment_mode:body.paymentMode,p_pay_now:body.payNow===true,p_idempotency_key:body.idempotencyKey,
    });
    if(error){
      const message=error.message||'';
      if(/no longer available|outside staff schedule/i.test(message))return publicError(409,'SLOT_UNAVAILABLE','The selected slot is no longer available');
      if(/customer details|booking time|payment mode/i.test(message))return publicError(400,'INVALID_REQUEST','Booking details are invalid');
      if(/not found/i.test(message))return publicError(404,'BOOKING_RESOURCE_NOT_FOUND','Booking resource not found');
      return publicError(500,'BOOKING_FAILED','The booking could not be created');
    }
    const booking=Array.isArray(data)?data[0]:data;
    if(!booking)return publicError(500,'BOOKING_FAILED','The booking could not be created');
    if(booking.amount_due>0){
      try{
        const payment=await createPaymentIntent({amount:booking.amount_due,currency:booking.currency,bookingReference:booking.booking_reference,tenantId});
        const {error:transactionError}=await db.from('checkout_transactions').upsert({
          tenant_id:tenantId,appointment_id:booking.appointment_id,total_amount:booking.amount_due,payment_status:'PENDING',payment_method:'CARD',purchased_products:[],stripe_payment_intent_id:payment.id,purpose:'booking_payment',
        },{onConflict:'stripe_payment_intent_id'});
        if(transactionError)throw new Error('Transaction state failed');
        return Response.json({booking:{reference:booking.booking_reference,status:'PENDING',startTime:booking.start_time,endTime:booking.end_time},payment:{required:true,amount:booking.amount_due,currency:booking.currency,clientSecret:payment.clientSecret,publishableKey:payment.publishableKey}},{status:201,headers:{'Cache-Control':'no-store'}});
      }catch(error:any){
        await db.rpc('cancel_public_booking_hold',{p_booking_reference:booking.booking_reference});
        return publicError(error.status||502,error.code||'PAYMENT_PROVIDER_ERROR','Payment could not be initialized');
      }
    }
    return Response.json({booking:{reference:booking.booking_reference,status:'CONFIRMED',startTime:booking.start_time,endTime:booking.end_time},payment:{required:false,amount:0,currency:booking.currency}},{status:201,headers:{'Cache-Control':'no-store'}});
  }catch(error:any){return publicError(error.status||500,error.code||'INTERNAL_ERROR',error.status?error.message:'Unable to create booking');}
}
