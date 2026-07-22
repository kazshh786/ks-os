import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { and, eq, like, sql } from 'drizzle-orm';
import {
  appointments, checkoutTransactions, clients, closeDatabase, getDatabase, services,
  staffSchedules, tenants, users,
} from '@ks-os/database';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
if (process.env.NODE_ENV === 'production') throw new Error('Demo data seed is disabled in production.');

const db = getDatabase();
const clientFixtures = [
  ['Amelia Hart', 'amelia.hart@example.test', '+447700900101'],
  ['Priya Shah', 'priya.shah@example.test', '+447700900102'],
  ['Sophie Turner', 'sophie.turner@example.test', '+447700900103'],
  ['Grace Williams', 'grace.williams@example.test', '+447700900104'],
  ['Maya Thompson', 'maya.thompson@example.test', '+447700900105'],
  ['Olivia Brooks', 'olivia.brooks@example.test', '+447700900106'],
  ['Isla Morgan', 'isla.morgan@example.test', '+447700900107'],
  ['Zara Evans', 'zara.evans@example.test', '+447700900108'],
] as const;
const serviceFixtures = [
  ['Cut & Finish', 60, 5200], ['Balayage Refresh', 150, 12500],
  ['Gel Manicure', 50, 3800], ['Brow Shape & Tint', 30, 2800],
] as const;

function atDayOffset(days:number,hour:number,minute=0) {
  const date=new Date();date.setHours(hour,minute,0,0);date.setDate(date.getDate()+days);return date;
}

async function main() {
  const [tenant]=await db.select().from(tenants).where(eq(tenants.subdomain,'salon-a')).limit(1);
  if(!tenant) throw new Error('Salon A is missing. Run pnpm seed:auth:dev first.');
  const staff=await db.select().from(users).where(and(eq(users.tenantId,tenant.id),eq(users.accountStatus,'ACTIVE')));
  if(!staff.length) throw new Error('Salon A has no active owner or staff membership.');

  const demoClients=[];
  for(const [name,email,phone] of clientFixtures){
    const [existing]=await db.select().from(clients).where(and(eq(clients.tenantId,tenant.id),eq(clients.email,email))).limit(1);
    if(existing){demoClients.push((await db.update(clients).set({name,phone,phoneE164:phone,loyaltyPoints:120,updatedAt:new Date()}).where(eq(clients.id,existing.id)).returning())[0]);}
    else demoClients.push((await db.insert(clients).values({tenantId:tenant.id,name,email,phone,phoneE164:phone,loyaltyPoints:120,smsTransactionalStatus:'OPTED_IN',smsMarketingStatus:'OPTED_IN'}).returning())[0]);
  }

  const demoServices=[];
  for(const [name,duration,price] of serviceFixtures){
    const result=await db.execute(sql`with updated as (
      update services set duration=${duration},price=${price},is_active=true,updated_at=now() where tenant_id=${tenant.id}::uuid and name=${name} returning id,name,duration,price
    ), inserted as (
      insert into services (tenant_id,name,description,duration,price,requires_deposit,is_active,discount,category,requires_resource)
      select ${tenant.id}::uuid,${name},'Fictional demo service',${duration},${price},false,true,0,'Demo',false where not exists(select 1 from updated)
      returning id,name,duration,price
    ) select * from updated union all select * from inserted limit 1`);
    demoServices.push(result.rows[0] as {id:string;name:string;duration:number;price:number});
  }

  await db.delete(appointments).where(and(eq(appointments.tenantId,tenant.id),eq(appointments.isTest,true),like(appointments.notes,'[DEMO]%')));
  for(const member of staff){
    const existing=await db.select().from(staffSchedules).where(and(eq(staffSchedules.tenantId,tenant.id),eq(staffSchedules.userId,member.id))).limit(1);
    if(!existing.length)await db.insert(staffSchedules).values([1,2,3,4,5,6].map(dayOfWeek=>({tenantId:tenant.id,userId:member.id,dayOfWeek,startTime:'09:00',endTime:'18:00'})));
  }

  const rows=[];
  for(let day=-13;day<=-1;day++){
    const count=day%3===0?3:2;
    for(let slot=0;slot<count;slot++)rows.push({day,hour:10+slot*3,status:slot===1&&day%5===0?'CANCELLED':slot===0&&day%7===0?'NO_SHOW':'COMPLETED'} as const);
  }
  rows.push(
    {day:0,hour:9,status:'COMPLETED'},{day:0,hour:11,status:'PENDING'},
    {day:0,hour:13,status:'CONFIRMED'},{day:0,hour:15,status:'PENDING'},
    {day:1,hour:10,status:'CONFIRMED'},{day:1,hour:14,status:'CONFIRMED'},
  );

  let completed=0;let revenue=0;
  for(let index=0;index<rows.length;index++){
    const row=rows[index];const service=demoServices[index%demoServices.length];const client=demoClients[index%demoClients.length];const member=staff[index%staff.length];
    const start=atDayOffset(row.day,row.hour);const end=new Date(start.getTime()+service.duration*60000);
    const [appointment]=await db.insert(appointments).values({tenantId:tenant.id,userId:member.id,clientId:client.id,clientName:client.name,serviceId:service.id,startTime:start,endTime:end,status:row.status,notes:'[DEMO] Fictional dashboard appointment',quotedAmount:service.price,paymentStatus:row.status==='COMPLETED'?'SUCCEEDED':row.status==='AWAITING_PAYMENT'?'PENDING':'NOT_REQUIRED',isTest:true,reviewInvitationExcluded:true,reviewInvitationExclusionReason:'DEMO_DATA'}).returning();
    if(row.status==='COMPLETED'){
      await db.insert(checkoutTransactions).values({tenantId:tenant.id,appointmentId:appointment.id,totalAmount:service.price,paymentStatus:'SUCCEEDED',paymentMethod:index%2?'EXTERNAL_CARD':'CASH',purpose:'point_of_sale',createdAt:new Date(start.getTime()+service.duration*60000)});
      completed++;revenue+=service.price;
    }
  }
  console.info(JSON.stringify({tenant:tenant.name,clients:demoClients.length,services:demoServices.length,appointments:rows.length,completed,revenueMinor:revenue}));
}

main().finally(()=>closeDatabase()).catch(error=>{console.error(error);process.exitCode=1;});
