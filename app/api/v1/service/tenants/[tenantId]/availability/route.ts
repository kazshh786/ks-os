import { authorizeService, serviceClient } from '@/lib/service-api';
import { isDateOnly, isUuid, publicError, zonedDateTimeToUtc } from '@/lib/booking-contract';
export const runtime='nodejs';

export async function GET(request:Request,{params}:{params:Promise<{tenantId:string}>}){
  const denied=authorizeService(request);if(denied)return denied;
  const {tenantId}=await params;const url=new URL(request.url);
  const serviceId=url.searchParams.get('serviceId');const staffId=url.searchParams.get('staffId');const date=url.searchParams.get('date');const bookingChannel=url.searchParams.get('bookingChannel');
  if(!isUuid(tenantId)||!isUuid(serviceId)||!isDateOnly(date)||staffId&&staffId!=='any'&&!isUuid(staffId)||!['in_shop','mobile'].includes(bookingChannel||''))return publicError(400,'INVALID_REQUEST','Valid tenant, service, booking type and date are required');
  try{
    const db=serviceClient();
    const [{data:tenant,error:tenantError},{data:service,error:serviceError}]=await Promise.all([
      db.from('tenants').select('id,timezone,currency').eq('id',tenantId).single(),
      db.from('services').select('id,duration,price,discount').eq('id',serviceId).eq('tenant_id',tenantId).eq('is_active',true).single(),
    ]);
    if(tenantError||serviceError||!tenant||!service)return publicError(404,'BOOKING_RESOURCE_NOT_FOUND','Tenant or service not found');
    const dayOfWeek=new Date(`${date}T00:00:00Z`).getUTCDay();
    let scheduleQuery=db.from('booking_channel_schedules').select('user_id,start_time,end_time,users(name)').eq('tenant_id',tenantId).eq('booking_channel',bookingChannel).eq('day_of_week',dayOfWeek);
    if(staffId&&staffId!=='any')scheduleQuery=scheduleQuery.eq('user_id',staffId);
    const dayStart=zonedDateTimeToUtc(date,'00:00',tenant.timezone);const dayEnd=new Date(dayStart);dayEnd.setUTCDate(dayEnd.getUTCDate()+1);
    const [{data:schedules,error:scheduleError},{data:appointments,error:appointmentError},{data:pricing}]=await Promise.all([
      scheduleQuery,
      db.from('appointments').select('user_id,start_time,end_time,status,payment_status,hold_expires_at').eq('tenant_id',tenantId).gte('start_time',dayStart.toISOString()).lt('start_time',dayEnd.toISOString()).not('status','in','("CANCELLED","NO_SHOW")'),
      db.from('staff_pricing').select('user_id,custom_price_in_cents,custom_duration_minutes').eq('service_id',serviceId),
    ]);
    if(scheduleError||appointmentError)return publicError(500,'AVAILABILITY_UNAVAILABLE','Availability could not be calculated');
    const now=Date.now();const slots:any[]=[];
    for(const schedule of schedules||[]){
      const override=(pricing||[]).find((item:any)=>item.user_id===schedule.user_id);
      const duration=override?.custom_duration_minutes||service.duration;
      const price=Math.max(0,(override?.custom_price_in_cents??service.price)-(service.discount||0));
      const [startHour,startMinute]=schedule.start_time.split(':').map(Number);const [endHour,endMinute]=schedule.end_time.split(':').map(Number);
      for(let minute=startHour*60+startMinute;minute+duration<=endHour*60+endMinute;minute+=30){
        const time=`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
        const start=zonedDateTimeToUtc(date,time,tenant.timezone);const end=new Date(start.getTime()+duration*60000);
        if(start.getTime()<now+5*60000)continue;
        const overlaps=(appointments||[]).some((appt:any)=>{
          if(appt.user_id!==schedule.user_id)return false;
          if(appt.status==='PENDING'&&appt.payment_status==='PENDING'&&appt.hold_expires_at&&new Date(appt.hold_expires_at).getTime()<now)return false;
          return start<new Date(appt.end_time)&&end>new Date(appt.start_time);
        });
        if(!overlaps)slots.push({start:start.toISOString(),end:end.toISOString(),staffId:schedule.user_id,staffName:(schedule.users as any)?.name||'Team member',price,duration});
      }
    }
    slots.sort((a,b)=>a.start.localeCompare(b.start));
    return Response.json({date,timezone:tenant.timezone,currency:tenant.currency,bookingChannel,slots},{headers:{'Cache-Control':'no-store'}});
  }catch{return publicError(500,'INTERNAL_ERROR','Unable to calculate availability');}
}
