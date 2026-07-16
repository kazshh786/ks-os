import {enforcePublicRateLimit,serviceClient} from '@/lib/service-api';
import {publicError} from '@/lib/booking-contract';
import {GET as getCatalog} from '@/app/api/v1/service/tenants/[tenantId]/catalog/route';
import {GET as getAvailability} from '@/app/api/v1/service/tenants/[tenantId]/availability/route';
import {POST as createBooking} from '@/app/api/v1/service/tenants/[tenantId]/bookings/route';
import {GET as getBookingStatus} from '@/app/api/v1/service/tenants/[tenantId]/bookings/[reference]/route';
export const runtime='nodejs';

async function context(request:Request,subdomain:string){
  if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(subdomain))return null;
  const {data}=await serviceClient().from('tenants').select('id,subdomain,custom_domain').eq('subdomain',subdomain).single();
  if(!data)return null;
  const host=(request.headers.get('host')||'').split(':')[0].toLowerCase();
  const allowed=host===`${data.subdomain}.kasimshah.com`||host===data.custom_domain||process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1'].includes(host);
  return allowed?data:null;
}

function internalRequest(request:Request,body?:string){
  const headers=new Headers({'Authorization':`Bearer ${process.env.KS_OS_SERVICE_TOKEN||''}`,'Content-Type':'application/json'});
  return new Request(request.url,{method:request.method,headers,body});
}

export async function GET(request:Request,{params}:{params:Promise<{subdomain:string}>}){
  const {subdomain}=await params;const tenant=await context(request,subdomain);if(!tenant)return publicError(404,'BOOKING_SITE_NOT_FOUND','Booking site not found');
  const url=new URL(request.url);const action=url.searchParams.get('action');const routeParams={params:Promise.resolve({tenantId:tenant.id})};
  const rate=await enforcePublicRateLimit(request,tenant.id,action==='status'?30:60);if(!rate.allowed)return publicError(rate.status!,rate.code!,rate.code==='RATE_LIMITED'?'Too many booking requests':'Booking security is unavailable');
  if(action==='catalog')return getCatalog(internalRequest(request),routeParams);
  if(action==='availability')return getAvailability(internalRequest(request),routeParams);
  if(action==='status'){
    const reference=url.searchParams.get('reference')||'';
    return getBookingStatus(internalRequest(request),{params:Promise.resolve({tenantId:tenant.id,reference})});
  }
  return publicError(400,'INVALID_ACTION','Invalid booking action');
}

export async function POST(request:Request,{params}:{params:Promise<{subdomain:string}>}){
  const {subdomain}=await params;const tenant=await context(request,subdomain);if(!tenant)return publicError(404,'BOOKING_SITE_NOT_FOUND','Booking site not found');
  const url=new URL(request.url);if(url.searchParams.get('action')!=='create')return publicError(400,'INVALID_ACTION','Invalid booking action');
  const rate=await enforcePublicRateLimit(request,tenant.id,10);if(!rate.allowed)return publicError(rate.status!,rate.code!,rate.code==='RATE_LIMITED'?'Too many booking requests':'Booking security is unavailable');
  const body=await request.text();return createBooking(internalRequest(request,body),{params:Promise.resolve({tenantId:tenant.id})});
}
