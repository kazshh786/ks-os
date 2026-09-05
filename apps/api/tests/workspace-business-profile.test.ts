import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthenticationService } from '../src/modules/authentication/authentication.service.js';
import { WorkspaceSessionSchema } from '@ks-os/contracts';

function fixture(role:'owner'|'staff'='staff',selected=true) {
  const tenantA={id:'a',businessReference:'10000000-0000-4000-8000-000000000001',name:'Agency A',subdomain:'agency-a',businessType:'AGENCY',businessProfile:null,lifecycleStatus:'ONBOARDING',primaryColor:'#000000',secondaryColor:'#ffffff',accentColor:'#10b981'};
  const tenantB={...tenantA,id:'b',businessReference:'10000000-0000-4000-8000-000000000002',name:'Salon B',businessType:'SALON'};
  const membership={id:'member-a',publicReference:'20000000-0000-4000-8000-000000000001',name:'Invited staff',emailNormalized:'staff@example.test',role,accessProfile:'PRACTITIONER',permissions:{},sessionsValidAfter:null};
  const queries:any[]=[
    [{tenant:tenantA,membership},{tenant:tenantB,membership:{...membership,id:'member-b',publicReference:'20000000-0000-4000-8000-000000000002'}}],
    [{revokedAt:null,expiresAt:new Date(Date.now()+60000)}],
  ];
  const db={select(){
    const result=queries.shift();
    const chain:any={from:()=>chain,innerJoin:()=>chain,where:()=>chain,limit:async()=>result,then:(resolve:any,reject:any)=>Promise.resolve(result).then(resolve,reject)};
    return chain;
  }};
  const request:any={
    auth:selected?{tenantUserId:'member-a',tenantId:'a'}:undefined,
    body:{tenantId:'b',businessType:'SALON'},
    requireContext:()=>{},requireIdentity:()=>({authUserId:'identity',authSessionId:'session',issuedAt:new Date().toISOString(),email:'staff@example.test'}),
  };
  return {service:new AuthenticationService(db as any),request};
}
test('trusted selected membership resolves its tenant profile, ignoring browser profile hints',async()=>{
  const {service,request}=fixture();
  const response=WorkspaceSessionSchema.parse(await service.workspaceSession(request));
  assert.equal(response.business?.profile?.businessType,'AGENCY');
  assert.equal(response.business?.profile?.terminology.customers,'Clients');
  assert.equal(response.business?.onboardingRequired,false);
  assert.equal(response.user.role,'staff');
  assert.equal(response.memberships.filter(item=>item.selected).length,1);
});
test('only an owner of an onboarding tenant is asked to configure the business',async()=>{
  const {service,request}=fixture('owner');
  assert.equal((await service.workspaceSession(request)).business?.onboardingRequired,true);
});
test('multiple memberships without selection disclose no resolved business profile',async()=>{
  const {service,request}=fixture('staff',false);
  const response=await service.workspaceSession(request);
  assert.equal(response.selectionRequired,true);
  assert.equal(response.business,null);
  assert.deepEqual(response.user.permissions,{});
});
