import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { publicError } from './booking-contract';

export function serviceClient() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL||'';
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!url||!key) throw Object.assign(new Error('Service database is not configured'),{code:'SERVICE_NOT_CONFIGURED'});
  return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
}

export function authorizeService(request: Request): Response|null {
  const expected=Buffer.from(process.env.KS_OS_SERVICE_TOKEN||'');
  const supplied=Buffer.from((request.headers.get('authorization')||'').replace(/^Bearer\s+/i,''));
  if(!expected.length) return publicError(503,'SERVICE_NOT_CONFIGURED','KS OS service authentication is not configured');
  if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected)) return publicError(401,'UNAUTHORIZED','Invalid service credential');
  return null;
}

export async function parseJson(request: Request, maxBytes=16384) {
  const raw=await request.text();
  if(Buffer.byteLength(raw)>maxBytes) throw Object.assign(new Error('Request too large'),{code:'REQUEST_TOO_LARGE',status:413});
  try{return JSON.parse(raw||'{}');}catch{throw Object.assign(new Error('Invalid JSON'),{code:'INVALID_JSON',status:400});}
}

export async function createPaymentIntent(input:{amount:number;currency:string;bookingReference:string;tenantId:string}) {
  const secret=process.env.STRIPE_SECRET_KEY||'';
  const publishableKey=process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY||'';
  if(!secret||!publishableKey) throw Object.assign(new Error('Payments are not configured'),{code:'PAYMENTS_NOT_CONFIGURED',status:503});
  const form=new URLSearchParams({
    amount:String(input.amount),currency:input.currency.toLowerCase(),'automatic_payment_methods[enabled]':'true',
    'metadata[booking_reference]':input.bookingReference,'metadata[tenant_id]':input.tenantId,
  });
  const response=await fetch('https://api.stripe.com/v1/payment_intents',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/x-www-form-urlencoded'},body:form});
  const body=await response.json();
  if(!response.ok||!body.client_secret) throw Object.assign(new Error('Payment could not be initialized'),{code:'PAYMENT_PROVIDER_ERROR',status:502});
  return {id:body.id as string,clientSecret:body.client_secret as string,publishableKey};
}

export function verifyStripeSignature(payload:string,header:string) {
  const secret=process.env.STRIPE_WEBHOOK_SECRET||'';
  if(!secret) return false;
  const entries=Object.fromEntries(header.split(',').map(item=>item.split('=',2)));
  const timestamp=Number(entries.t);const signature=entries.v1||'';
  if(!Number.isFinite(timestamp)||Math.abs(Date.now()/1000-timestamp)>300) return false;
  const expected=crypto.createHmac('sha256',secret).update(`${timestamp}.${payload}`).digest('hex');
  const a=Buffer.from(signature);const b=Buffer.from(expected);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

export async function enforcePublicRateLimit(request:Request,tenantId:string,limit:number){
  const salt=process.env.BOOKING_RATE_LIMIT_SALT||'';
  if(salt.length<32)return {allowed:false,status:503,code:'BOOKING_SECURITY_NOT_CONFIGURED'};
  const forwarded=(request.headers.get('x-vercel-forwarded-for')||request.headers.get('x-forwarded-for')||'').split(',')[0].trim();
  const ip=forwarded||'unknown';const key=crypto.createHmac('sha256',salt).update(`${tenantId}:${ip}`).digest('hex');
  const {data,error}=await serviceClient().rpc('consume_public_booking_rate_limit',{p_key_hash:key,p_limit:limit,p_window_seconds:60});
  if(error)return {allowed:false,status:503,code:'RATE_LIMIT_UNAVAILABLE'};
  return data?{allowed:true}:{allowed:false,status:429,code:'RATE_LIMITED'};
}
