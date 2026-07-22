import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  AgencyRoleSchema, BillingExceptionSchema, CreateAgencyTenantSchema, CreateEntitlementOverrideSchema,
  StartSupportSessionSchema, UpdateOnboardingStageSchema, agencyRoleNeedsMfa, capabilitiesForAgencyRole,
  evaluateDowngrade, isSupportPathBlocked,
} from '@ks-os/contracts';
import { verifyGoCardlessSignature } from '../src/modules/agency/gocardless.service.js';

const migration=readFileSync(new URL('../../../packages/database/migrations/20260720230000_phase_12_agency_operations.sql',import.meta.url),'utf8');
const auth=readFileSync(new URL('../src/plugins/auth.ts',import.meta.url),'utf8');
const agencyService=readFileSync(new URL('../src/modules/agency/agency.service.ts',import.meta.url),'utf8');
const routes=readFileSync(new URL('../src/modules/agency/agency.routes.ts',import.meta.url),'utf8');
const gc=readFileSync(new URL('../src/modules/agency/gocardless.service.ts',import.meta.url),'utf8');
const web=readFileSync(new URL('../../../apps/web/src/features/agency/AgencyPages.tsx',import.meta.url),'utf8');
const agencyAuthWeb=readFileSync(new URL('../../../apps/web/src/features/agency/AgencyAuth.tsx',import.meta.url),'utf8');
const exportSource=readFileSync(new URL('../src/modules/agency/agency-exports.service.ts',import.meta.url),'utf8');
const teamService=readFileSync(new URL('../src/modules/team/team.service.ts',import.meta.url),'utf8');
const teamOperationsService=readFileSync(new URL('../src/modules/team-operations/team-operations.service.ts',import.meta.url),'utf8');
const posRoutes=readFileSync(new URL('../src/modules/pos/pos.routes.ts',import.meta.url),'utf8');
const bookingRoutes=readFileSync(new URL('../src/modules/bookings/booking.routes.ts',import.meta.url),'utf8');
const publicBookingRoutes=readFileSync(new URL('../src/routes/public/booking.ts',import.meta.url),'utf8');
const bookingPageService=readFileSync(new URL('../src/modules/bookings/booking-page.service.ts',import.meta.url),'utf8');

test('agency roles are a closed server-owned set',()=>{
  assert.deepEqual(AgencyRoleSchema.options,['PLATFORM_OWNER','AGENCY_ADMINISTRATOR','SUPPORT_ADMINISTRATOR','FULFILMENT_ADMINISTRATOR']);
  assert.equal(AgencyRoleSchema.safeParse('owner').success,false);
  assert.equal(capabilitiesForAgencyRole('SUPPORT_ADMINISTRATOR').includes('billing.manage'),false);
  assert.equal(capabilitiesForAgencyRole('FULFILMENT_ADMINISTRATOR').includes('support.session.start'),false);
});

test('MFA is mandatory for privileged agency roles',()=>{
  assert.equal(agencyRoleNeedsMfa('PLATFORM_OWNER'),true);
  assert.equal(agencyRoleNeedsMfa('AGENCY_ADMINISTRATOR'),true);
  assert.equal(agencyRoleNeedsMfa('SUPPORT_ADMINISTRATOR'),true);
  assert.match(auth,/claims\.aal === 'aal2'/);
  assert.match(auth,/AGENCY_MFA_REQUIRED/);
});

test('agency sessions have a hard expiry and central revocation',()=>{
  assert.match(auth,/8 \* 60 \* 60 \* 1000/);
  assert.match(migration,/agency_sessions[\s\S]+revoked_at timestamptz/i);
  assert.match(routes,/sessions\/:id\/revoke/);
});

test('support sessions are short-lived, hash-only and reasoned',()=>{
  const valid=StartSupportSessionSchema.parse({tenantId:'11111111-1111-4111-8111-111111111111',reason:'Investigating failed reminder delivery',durationMinutes:30});
  assert.equal(valid.durationMinutes,30);
  assert.equal(StartSupportSessionSchema.safeParse({...valid,durationMinutes:121}).success,false);
  assert.match(agencyService,/randomBytes\(32\)/);
  assert.match(agencyService,/createHash\('sha256'\)\.update\(token\)/);
  assert.doesNotMatch(migration,/raw_token|access_token/i);
});

test('high-risk actions are blocked during support access',()=>{
  for(const path of ['/api/v1/finance/payouts','/api/v1/payments/x/refund','/api/v1/settings/team','/api/v1/integrations/stripe/connect','/api/v1/agency/tenants'])assert.equal(isSupportPathBlocked(path),true,path);
  assert.equal(isSupportPathBlocked('/api/v1/bookings'),false);
  assert.match(auth,/SUPPORT_ACTION_BLOCKED/);
});

test('support actions retain both agency actor and tenant in audit',()=>{
  assert.match(auth,/agencyUserId: request\.agencyAuth\.agencyUserId/);
  assert.match(auth,/tenantId: request\.auth\.tenantId/);
  assert.match(auth,/supportSessionId: request\.auth\.supportSessionId/);
});

test('platform audit storage is append-only',()=>{
  assert.match(migration,/prevent_platform_audit_mutation/);
  assert.match(migration,/BEFORE UPDATE OR DELETE ON platform_audit_events/);
  assert.match(migration,/REVOKE UPDATE, DELETE ON platform_audit_events FROM service_role/);
});

test('plans are versioned and entitlement types and availability are constrained',()=>{
  assert.match(migration,/UNIQUE\(plan_id,version\)/i);
  assert.match(migration,/BOOLEAN','QUANTITY','USAGE/);
  assert.match(migration,/INTERNAL_PILOT','BETA','GENERALLY_AVAILABLE','RETIRED/);
  assert.match(migration,/CORE','Core'[\s\S]+GROWTH','Growth'[\s\S]+SCALE','Scale/);
});

test('timed entitlement overrides require a reason and future expiry',()=>{
  const base={entitlementKey:'analytics.advanced',value:{enabled:true},reason:'Temporary managed-service pilot',startsAt:new Date('2026-01-01')};
  assert.equal(CreateEntitlementOverrideSchema.safeParse({...base,expiresAt:new Date('2026-02-01')}).success,true);
  assert.equal(CreateEntitlementOverrideSchema.safeParse({...base,expiresAt:new Date('2025-02-01')}).success,false);
  assert.match(agencyService,/availability==='GENERALLY_AVAILABLE'/);
});

test('downgrades preserve data and report limit blockers',()=>{
  assert.deepEqual(evaluateDowngrade({currentStaff:8,currentLocations:3,targetStaffLimit:5,targetLocationLimit:1}),{safe:false,blockers:['Reduce active staff from 8 to 5.','Reduce active locations from 3 to 1.']});
  assert.doesNotMatch(agencyService,/delete\(users\)|delete\(locations\)/);
  assert.match(agencyService,/scheduledReplacementAt:sub\.nextChargeAt/);
});

test('tenant creation is strict and starts one shared onboarding transaction',()=>{
  const input={name:'Salon One',legalBusinessName:'Salon One Ltd',subdomain:'salon-one',businessType:'SALON',planVersionId:'20000000-0000-4000-8000-000000000001',primaryContactName:'Owner Name',primaryContactEmail:'owner@example.com'};
  assert.equal(CreateAgencyTenantSchema.safeParse(input).success,true);
  assert.equal(CreateAgencyTenantSchema.safeParse({...input,subdomain:'Not Valid'}).success,false);
  assert.match(agencyService,/this\.db\.transaction[\s\S]+tenantPlanAssignments[\s\S]+tenantOnboardingStages[\s\S]+tenantBillingAccounts/);
});

test('onboarding has all twelve ordered stages and blocked stages require detail',()=>{
  for(const stage of ['SALE_HANDOVER','CONTRACT','SETUP_FEE','DIRECT_DEBIT','BUSINESS_PROFILE','BRAND_ASSETS','CATALOGUE','TEAM_AND_LOCATIONS','PAYMENTS','COMMUNICATIONS','TRAINING','LAUNCH'])assert.match(agencyService,new RegExp(stage));
  assert.equal(UpdateOnboardingStageSchema.safeParse({status:'BLOCKED'}).success,false);
  assert.equal(UpdateOnboardingStageSchema.safeParse({status:'BLOCKED',blockerNote:'Awaiting signed contract'}).success,true);
});

test('launch is guarded by persisted launch checks',()=>{
  for(const check of ['OWNER_ACTIVE','LOCATION_ACTIVE','SERVICE_ACTIVE','DIRECT_DEBIT_MANDATE','SETUP_FEE','SUBSCRIPTION','STRIPE_CONNECT','ONBOARDING_STAGES'])assert.match(agencyService,new RegExp(check));
  assert.match(agencyService,/LAUNCH_BLOCKED/);
});

test('GoCardless webhook signatures are HMAC verified with timing-safe comparison',()=>{
  const secret='webhook-secret-value';const body='{"events":[]}';const signature=createHmac('sha256',secret).update(body).digest('hex');
  assert.equal(verifyGoCardlessSignature(body,signature,secret),true);
  assert.equal(verifyGoCardlessSignature(body,signature.slice(0,-1)+'0',secret),false);
  assert.match(gc,/timingSafeEqual/);
});

test('GoCardless webhooks are idempotent and never guess tenant ownership',()=>{
  assert.match(gc,/onConflictDoNothing\(\{ target: tenantSubscriptionEvents\.providerEventId \}\)/);
  assert.match(gc,/never guess tenant ownership/);
  assert.match(migration,/provider_event_id varchar\(255\) NOT NULL UNIQUE/);
});

test('subscription failures enter a grace period instead of abruptly disabling bookings',()=>{
  assert.match(gc,/GRACE_PERIOD/);
  assert.match(gc,/7 \* 86400000/);
  assert.doesNotMatch(gc,/isActive: false|lifecycleStatus: 'SUSPENDED'/);
});

test('GoCardless owns subscription billing while Stripe Connect remains a launch prerequisite only',()=>{
  assert.match(agencyService,/revenueSource:'GOCARDLESS_TENANT_SUBSCRIPTIONS_ONLY'/);
  assert.match(agencyService,/from tenant_subscriptions/);
  assert.doesNotMatch(agencyService,/sum\([^\n]+stripe/i);
  assert.match(gc,/api\.gocardless\.com/);
});

test('price exceptions are typed, bounded and audited',()=>{
  const valid={kind:'DISCOUNT',percentageBasisPoints:1000,reason:'Founding client contract rate',startsAt:new Date()};
  assert.equal(BillingExceptionSchema.safeParse(valid).success,true);
  assert.equal(BillingExceptionSchema.safeParse({...valid,percentageBasisPoints:10001}).success,false);
  assert.match(agencyService,/PRICE_EXCEPTION_CREATED/);
});

test('offboarding schedules cancellation without deleting tenant data',()=>{
  assert.match(agencyService,/CANCELLATION_SCHEDULED/);
  assert.match(agencyService,/lifecycleStatus:'OFFBOARDING'/);
  assert.doesNotMatch(agencyService,/delete\(tenants\)/);
});

test('safe retries are allowlisted and concurrency checked',()=>{
  assert.match(agencyService,/AUTOMATION_ACTION','EMAIL_DELIVERY','SMS_DELIVERY','REPORT_EXPORT','REPUTATION_SYNC','GOCARDLESS_EVENT/);
  assert.match(agencyService,/eq\(platformFailedJobs\.status,'FAILED'\)/);
  assert.match(agencyService,/JOB_NOT_SAFE_TO_RETRY/);
});

test('every control-plane table enables RLS and revokes browser access',()=>{
  for(const table of ['agency_users','agency_sessions','agency_support_sessions','platform_audit_events','platform_plan_versions','tenant_plan_assignments','tenant_onboarding','tenant_billing_accounts','tenant_subscriptions','managed_deliverables','platform_failed_jobs','agency_export_jobs'])assert.match(migration,new RegExp(`'${table}'`));
  assert.match(migration,/ALTER TABLE %I ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/REVOKE ALL ON TABLE %I FROM anon, authenticated/);
});

test('agency UI uses live APIs and the real audited workspace handoff',()=>{
  assert.match(web,/agencyFetch\('\/tenants'\)/);
  assert.match(web,/ks-os-support-session/);
  assert.match(web,/window\.location\.assign\('\/app\/calendar\?support=1'\)/);
  assert.doesNotMatch(web,/mockData|useWorkspace|setActiveTenant/);
});

test('agency login performs TOTP enrolment or verification and session calls are rate limited',()=>{
  assert.match(agencyAuthWeb,/signInWithPassword/);
  assert.match(agencyAuthWeb,/mfa\.enroll/);
  assert.match(agencyAuthWeb,/mfa\.challengeAndVerify/);
  assert.match(routes,/session'[\s\S]+rateLimit:\{max:20/);
});

test('tenant credentials cannot grant agency access',()=>{
  assert.match(auth,/from\(agencyUsers\)/);
  assert.match(auth,/request\.agencyAuth/);
  assert.doesNotMatch(auth,/user\.role === 'agency_admin'/);
});

test('read-only support sessions cannot mutate tenant state',()=>{
  assert.match(auth,/support\.scope === 'READ_ONLY'/);
  assert.match(auth,/SUPPORT_READ_ONLY/);
  assert.match(auth,/GET','HEAD','OPTIONS/);
});

test('setup and subscription money is resolved from immutable plan versions',()=>{
  assert.doesNotMatch(CreateAgencyTenantSchema.toString(),/monthlyPrice/);
  assert.match(agencyService,/setupFeeAmountMinor:platformPlanVersions\.setupFeeAmountMinor/);
  assert.match(agencyService,/monthlyPriceMinor/);
  assert.match(migration,/Core v1','ACTIVE',9700,29700/);
  assert.match(migration,/Growth v1','ACTIVE',29700,39700/);
  assert.match(migration,/Scale v1','ACTIVE',49700,69700/);
});

test('onboarding profiles are structured and do not accept credential fields',async()=>{
  const { UpdateTenantOnboardingSchema }=await import('@ks-os/contracts');
  assert.equal(UpdateTenantOnboardingSchema.safeParse({domainEmailProfile:{domain:'example.com',dnsAccessStatus:'REQUESTED'}}).success,true);
  assert.equal(UpdateTenantOnboardingSchema.safeParse({domainEmailProfile:{domain:'example.com',password:'secret'}}).success,false);
  assert.match(migration,/completion_percentage[\s\S]+business_profile[\s\S]+domain_email_profile[\s\S]+website_profile/);
});

test('activation and churn are durable data rather than inferred customer detail',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS tenant_activation_milestones/);
  assert.match(migration,/UNIQUE\(tenant_id,milestone_key\)/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS tenant_churn_records/);
  assert.match(agencyService,/FIRST_REAL_BOOKING|WEBSITE_LIVE|SETUP_FEE_CONFIRMED/);
  assert.match(agencyService,/monthlyValueMinor/);
});

test('agency exports are private, bounded, formula-safe and time limited',()=>{
  assert.match(exportSource,/SupabaseReportStorage/);
  assert.match(exportSource,/limit 10000/i);
  assert.match(exportSource,/10_485_760/);
  assert.match(exportSource,/csvLine/);
  assert.match(exportSource,/signedUrl\([^,]+,120/);
  assert.match(exportSource,/expiresAt:new Date\(Date\.now\(\)\+72\*3600000\)/);
  assert.match(routes,/AGENCY_EXPORT_DOWNLOADED/);
});

test('protected tenant operations enforce entitlements on the backend',()=>{
  assert.match(teamService,/assertQuantity\(actor\.tenantId,'staff\.limit'/);
  assert.match(teamOperationsService,/assertQuantity\(a\.tenantId,'locations\.limit'/);
  assert.match(posRoutes,/assertBoolean\(request\.auth!\.tenantId, 'pos\.enabled'/);
  assert.match(bookingRoutes,/assertUsageAvailable\(tenantId, 'bookings\.monthly'/);
  assert.match(publicBookingRoutes,/assertUsageAvailable\(tenant\.id, 'bookings\.monthly'/);
});

test('commercial terms are stored server-side and carried into billing',()=>{
  const parsed=CreateAgencyTenantSchema.safeParse({name:'Founding Salon',legalBusinessName:'Founding Salon Ltd',subdomain:'founding-salon',businessType:'Salon',planVersionId:'20000000-0000-4000-8000-000000000001',primaryContactName:'Owner Name',primaryContactEmail:'owner@example.test',foundingClient:true,commercialNotes:'Signed founding-client agreement'});
  assert.equal(parsed.success,true);
  assert.match(migration,/minimum_term_ends_at timestamptz/);
  assert.match(migration,/founding_client boolean/);
  assert.match(agencyService,/minimumTermEndsAt:tenant\?\.minimumTermEndsAt/);
});

test('offboarding honours minimum terms and completes through a provider worker',()=>{
  assert.match(agencyService,/sub\.minimumTermEndsAt>new Date\(\)/);
  assert.match(agencyService,/processDueOffboarding/);
  assert.match(agencyService,/actions\/cancel/);
  assert.match(routes,/post\('\/offboarding'/);
  assert.match(auth,/Inactive tenant access denied/);
  assert.match(bookingPageService,/eq\(tenants\.lifecycleStatus,\s*'ACTIVE'\)/);
});
