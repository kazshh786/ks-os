import fs from 'node:fs';

const required=[
  'module10_booking_service_api.sql','module11_booking_channels.sql','lib/booking-contract.ts','lib/service-api.ts',
  'app/api/v1/service/health/route.ts',
  'app/api/v1/service/tenants/[tenantId]/status/route.ts',
  'app/api/v1/service/tenants/[tenantId]/catalog/route.ts',
  'app/api/v1/service/tenants/[tenantId]/availability/route.ts',
  'app/api/v1/service/tenants/[tenantId]/bookings/route.ts',
  'app/api/v1/service/tenants/[tenantId]/bookings/[reference]/route.ts',
  'app/api/v1/webhooks/stripe/route.ts',
  'app/api/v1/public/[subdomain]/booking/route.ts',
  'components/booking/PublicBookingWidget.tsx',
  'components/booking/BookingScheduleManager.tsx',
  'app/(tenants)/[subdomain]/book/page.tsx'
];
let errors=0;
for(const file of required){if(!fs.existsSync(file)){console.error(`Missing: ${file}`);errors++;}}
const serviceFiles=required.filter(file=>file.endsWith('.ts')).map(file=>fs.readFileSync(file,'utf8')).join('\n');
for(const forbidden of [/MOCK_SERVICES/,/MOCK_STAFF/,/dep_pi_/,/Math\.random\(\).*payment/i,/cardNumber/]){
  if(forbidden.test(serviceFiles)){console.error(`Forbidden fake booking/payment pattern: ${forbidden}`);errors++;}
}
const publicPage=fs.readFileSync('app/(tenants)/[subdomain]/book/page.tsx','utf8');
if(/MOCK_|supabase\.from|TimeSlotPicker/.test(publicPage)){console.error('Public booking page still uses browser database access or mocks');errors++;}
const productionUi=['app/(tenants)/[subdomain]/page.tsx','components/calendar/TimeSlotPicker.tsx','components/pos/CheckoutDrawer.tsx'].map(file=>fs.readFileSync(file,'utf8')).join('\n');
if(/MOCK_|dep_pi_|mockStripe|Simulate Stripe/i.test(productionUi)){console.error('Production UI still contains mock data or simulated payment success');errors++;}
if(!/timingSafeEqual/.test(fs.readFileSync('lib/service-api.ts','utf8'))){console.error('Service token comparison is not constant-time');errors++;}
console.log(errors?`Verification failed: ${errors} error(s)`:'Verification passed: secure booking service contract present');
process.exit(errors?1:0);
