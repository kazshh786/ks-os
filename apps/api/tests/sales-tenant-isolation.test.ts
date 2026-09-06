import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, getDatabase, sql, tenants, users } from '@ks-os/database';
import { SalesService, type SalesActor } from '../src/modules/sales/sales.service.js';

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const owner = (tenantId:string,userId:string):SalesActor => ({ tenantId, userId, role:'owner', permissions:[] });

test('sales service prevents cross-tenant customer, pipeline, opportunity and quote references', { skip: !databaseAvailable }, async (context) => {
  const db=getDatabase();
  // The default CI test service is intentionally an empty PostgreSQL database;
  // migrations are planned later in the workflow, not applied before pnpm test.
  // Run this integration test whenever the migrated Sales schema is available
  // (local/integration/deployment verification) and leave normal CI to the
  // migration/contract isolation tests when it is not.
  const schemaCheck:any = await db.execute(sql`select to_regclass('public.sales_pipelines') as table_name`);
  const schemaRow = schemaCheck?.rows?.[0] ?? schemaCheck?.[0];
  if (!schemaRow?.table_name) {
    context.skip('Sales migration is not applied in this database.');
    return;
  }

  const suffix=randomUUID().slice(0,8);
  const [tenantA,tenantB]=await db.insert(tenants).values([
    {name:`Sales Isolation A ${suffix}`,subdomain:`sales-iso-a-${suffix}`,businessType:'AGENCY'},
    {name:`Sales Isolation B ${suffix}`,subdomain:`sales-iso-b-${suffix}`,businessType:'LOGISTICS_COURIER'},
  ]).returning({id:tenants.id});
  const [userA,userB]=await db.insert(users).values([
    {tenantId:tenantA.id,email:`owner-a-${suffix}@example.test`,emailNormalized:`owner-a-${suffix}@example.test`,name:'Owner A',role:'owner'},
    {tenantId:tenantB.id,email:`owner-b-${suffix}@example.test`,emailNormalized:`owner-b-${suffix}@example.test`,name:'Owner B',role:'owner'},
  ]).returning({id:users.id,tenantId:users.tenantId});
  const actorA=owner(tenantA.id,userA.id),actorB=owner(tenantB.id,userB.id);
  const service=new SalesService();
  try{
    const created=await service.createOpportunity(actorA,{lead:{name:'Tenant A customer',email:`lead-${suffix}@example.test`},title:'Tenant A opportunity',estimatedValue:125000});
    const opportunity=created.opportunity;
    const pipelineA=(await service.listPipelines(actorA))[0]!;
    const quote=await service.createQuote(actorA,opportunity.reference,{title:'Tenant A quote',items:[{description:'Service',quantity:1,unitAmount:125000,taxRateBasisPoints:0}]});

    await assert.rejects(()=>service.getOpportunity(actorB,opportunity.reference),(error:any)=>error?.statusCode===404);
    await assert.rejects(()=>service.getQuote(actorB,quote.reference),(error:any)=>error?.statusCode===404);
    await assert.rejects(()=>service.createOpportunity(actorB,{clientId:opportunity.client.id,title:'Cross tenant customer'}),(error:any)=>error?.statusCode===400);
    await assert.rejects(()=>service.createOpportunity(actorB,{lead:{name:'Tenant B lead'},title:'Cross tenant pipeline',pipelineReference:pipelineA.reference}),(error:any)=>error?.statusCode===400);
  }finally{
    await db.delete(tenants).where(eq(tenants.id,tenantA.id));
    await db.delete(tenants).where(eq(tenants.id,tenantB.id));
  }
});
