import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { productOnboardingRoutes, type ProductOnboardingStore } from '../src/modules/business-profile/product-onboarding.routes.js';
const answers={businessName:'Agency A',businessType:'AGENCY',teamSize:'2-5',buying:['quotes'],delivery:['projects'],resources:['staff'],payment:['invoices'],manage:['customers','projects']};

async function setup(role='owner',tenantId='tenant-a',supportMode=false,authenticated=true){
  const rows=new Map<string,any>([['tenant-a',{name:'Business A',businessType:'AGENCY',businessProfile:null}],['tenant-b',{name:'Business B',businessType:'SALON',businessProfile:null}]]);
  const writes:string[]=[];
  const store:ProductOnboardingStore={
    async read(id){return rows.get(id);},
    async save(id,configuration){writes.push(id);rows.set(id,{name:configuration.answers.businessName,businessType:configuration.answers.businessType,businessProfile:configuration});},
  };
  const app=Fastify();
  app.decorateRequest('requireAuth',function(){if(!this.auth)throw Object.assign(new Error('Sign in'),{statusCode:401});});
  app.decorateRequest('requireContext',function(context:string){if(this.applicationContext!==context)throw Object.assign(new Error('Context'),{statusCode:403});});
  app.addHook('onRequest',async request=>{
    request.applicationContext='TENANT';
    if(authenticated)request.auth={role,tenantId,supportMode,authUserId:'identity',tenantUserId:'member'} as any;
  });
  await app.register(productOnboardingRoutes,{store});
  return {app,rows,writes};
}
test('owner setup writes only the authenticated tenant and staff inherit its profile',async()=>{
  const {app,rows,writes}=await setup();
  try{
    const result=await app.inject({method:'PUT',url:'/api/v1/workspace/product-onboarding',payload:answers});
    assert.equal(result.statusCode,200);
    assert.deepEqual(writes,['tenant-a']);
    assert.equal(rows.get('tenant-b').businessProfile,null);
    const read=await app.inject('/api/v1/workspace/product-onboarding');
    assert.equal(read.json().data.profile.terminology.customers,'Clients');
  }finally{await app.close();}
});
test('browser cannot target another tenant, supply permissions, or enable engines',async()=>{
  const {app,writes}=await setup();
  try{
    for(const injected of [{tenantId:'tenant-b'},{businessReference:'tenant-b'},{permissions:['ALL']},{enabledModules:['fleet']}]){
      const result=await app.inject({method:'PUT',url:'/api/v1/workspace/product-onboarding',payload:{...answers,...injected}});
      assert.equal(result.statusCode,400);
    }
    assert.deepEqual(writes,[]);
  }finally{await app.close();}
});
test('staff read the tenant profile but cannot configure it',async()=>{
  const {app,writes}=await setup('staff');
  try{
    assert.equal((await app.inject('/api/v1/workspace/product-onboarding')).json().data.profile.businessType,'AGENCY');
    assert.equal((await app.inject({method:'PUT',url:'/api/v1/workspace/product-onboarding',payload:answers})).statusCode,403);
    assert.deepEqual(writes,[]);
  }finally{await app.close();}
});
test('support and unauthenticated requests cannot save product configuration',async()=>{
  for(const config of [{support:true,authenticated:true},{support:false,authenticated:false}]){
    const {app,writes}=await setup('owner','tenant-a',config.support,config.authenticated);
    try{
      const result=await app.inject({method:'PUT',url:'/api/v1/workspace/product-onboarding',payload:answers});
      assert.equal(result.statusCode,config.support?403:401);
      assert.deepEqual(writes,[]);
    }finally{await app.close();}
  }
});
