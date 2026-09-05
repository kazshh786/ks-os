import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_TYPES,BusinessProfileSchema,MODULE_REGISTRY,ModuleKeySchema,normalizeBusinessType,
  resolveBusinessProfile,canUseProfileModule,ProductOnboardingAnswersSchema,
} from '@ks-os/contracts';

test('all twenty canonical keys, labels, and legacy aliases normalize deterministically',()=>{
  assert.equal(BUSINESS_TYPES.length,20);
  for(const type of BUSINESS_TYPES)for(const value of [type.key,type.label,...type.aliases]){
    assert.equal(normalizeBusinessType('  '+value.toUpperCase()+'  '),type.key);
  }
  assert.equal(normalizeBusinessType('Hair salon'),'SALON_BARBER');
  assert.equal(normalizeBusinessType('Beauty studio'),'BEAUTY_AESTHETICS');
  assert.equal(normalizeBusinessType('Restaurant / Café'),'RESTAURANT_CAFE');
  for(const input of [null,undefined,{},'','unknown salon supplier'])assert.equal(normalizeBusinessType(input),null);
});
test('profiles are validated, independent, and distinguish enabled engines from future recommendations',()=>{
  for(const type of BUSINESS_TYPES)assert.doesNotThrow(()=>BusinessProfileSchema.parse(resolveBusinessProfile(type.key)));
  const salon=resolveBusinessProfile('salon'),logistics=resolveBusinessProfile('logistics'),agency=resolveBusinessProfile('agency');
  assert.ok(salon.enabledModules.includes('services'));
  assert.ok(logistics.enabledModules.includes('fleet'));
  assert.ok(!logistics.enabledModules.includes('services'));
  assert.ok(agency.enabledModules.includes('projects'));
  assert.equal(agency.terminology.customers,'Clients');
  assert.equal(logistics.terminology.staff,'Driver');
  assert.ok(!logistics.dashboard.includes('booking-summary'));
  salon.terminology.customer='Changed';
  assert.equal(resolveBusinessProfile('salon').terminology.customer,'Customer');
});
test('unknown legacy values preserve the established experience without rewriting business type',()=>{
  const raw='Independent business';
  const profile=resolveBusinessProfile(raw);
  assert.equal(raw,'Independent business');
  assert.equal(profile.businessType,null);
  assert.equal(profile.compatibilityMode,true);
  assert.ok(profile.enabledModules.includes('pos'));
});
test('registry has all requested engines and never grants a route to unimplemented engines',()=>{
  for(const key of ModuleKeySchema.options){
    const module=MODULE_REGISTRY[key];
    assert.equal(module.key,key);
    if(module.status==='implemented')assert.ok(module.route?.startsWith('/app/'));
    else {
      assert.equal(module.route,null);
      assert.equal(canUseProfileModule(resolveBusinessProfile('logistics'),key,{role:'owner'}),false);
    }
  }
});
test('capabilities and entitlements remain independent of profile recommendations',()=>{
  const salon=resolveBusinessProfile('salon');
  assert.equal(canUseProfileModule(salon,'crm',{role:'staff',permissions:[]}),false);
  assert.equal(canUseProfileModule(salon,'crm',{role:'staff',permissions:['CLIENTS_VIEW_BASIC']}),true);
  assert.equal(canUseProfileModule(salon,'finance',{role:'staff'}),false);
  assert.equal(canUseProfileModule(salon,'inventory',{role:'owner'}),false);
  assert.equal(canUseProfileModule(salon,'inventory',{role:'owner',entitlements:{'inventory.enabled':{enabled:true}}}),true);
});
test('product answers are strict and generate useful defaults without granting planned features',()=>{
  const answers=ProductOnboardingAnswersSchema.parse({businessName:'Courier One',businessType:'LOGISTICS_COURIER',teamSize:'2-5',buying:['quotes'],delivery:['deliveries'],resources:['vehicles','documents'],payment:['invoices'],manage:['customers','jobs','reports']});
  assert.equal(ProductOnboardingAnswersSchema.safeParse({...answers,tenantId:'another-tenant'}).success,false);
  assert.equal(ProductOnboardingAnswersSchema.safeParse({...answers,enabledModules:['fleet']}).success,false);
  const profile=resolveBusinessProfile(answers.businessType,{version:1,completedAt:new Date().toISOString(),answers});
  assert.ok(profile.enabledModules.includes('fleet'));
  assert.equal(canUseProfileModule(profile,'fleet',{role:'owner'}),false);
  assert.deepEqual(profile.crmExtensions,[]);
  assert.equal(profile.compatibilityMode,false);
});
