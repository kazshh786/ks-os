import { serviceClient, verifyStripeSignature } from '@/lib/service-api';
import { publicError } from '@/lib/booking-contract';
export const runtime='nodejs';

export async function POST(request:Request){
  const payload=await request.text();const signature=request.headers.get('stripe-signature')||'';
  if(!verifyStripeSignature(payload,signature))return publicError(400,'INVALID_SIGNATURE','Invalid webhook signature');
  let event:any;try{event=JSON.parse(payload);}catch{return publicError(400,'INVALID_PAYLOAD','Invalid webhook payload');}
  const intent=event?.data?.object;const reference=intent?.metadata?.booking_reference;
  if(!reference)return Response.json({received:true});
  const db=serviceClient();
  if(event.type==='payment_intent.succeeded'){
    const {error}=await db.rpc('confirm_public_booking_payment',{p_booking_reference:reference,p_payment_intent_id:intent.id,p_amount:intent.amount_received});
    if(error)return publicError(500,'WEBHOOK_PROCESSING_FAILED','Payment confirmation could not be applied');
  }else if(['payment_intent.payment_failed','payment_intent.canceled'].includes(event.type)){
    await db.rpc('cancel_public_booking_hold',{p_booking_reference:reference});
  }
  return Response.json({received:true});
}
