import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDatabase, tenants, accountAccessAuditEvents } from '@ks-os/database';
import { ProductOnboardingAnswersSchema, ProductOnboardingConfigurationSchema, parseProductOnboardingConfiguration, resolveBusinessProfile, type ProductOnboardingConfiguration } from '@ks-os/contracts';

const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), {statusCode,code});
export interface ProductOnboardingStore {
  read(tenantId:string):Promise<{name:string;businessType:string|null;businessProfile:unknown}|undefined>;
  save(tenantId:string,configuration:ProductOnboardingConfiguration,actor:{authUserId:string;tenantUserId:string;requestId:string}):Promise<void>;
}
const databaseStore:ProductOnboardingStore = {
  async read(tenantId) {
    const [tenant]=await getDatabase().select().from(tenants).where(eq(tenants.id,tenantId)).limit(1);
    return tenant;
  },
  async save(tenantId,configuration,actor) {
    await getDatabase().transaction(async tx=>{
      const [tenant]=await tx.update(tenants).set({
        name:configuration.answers.businessName,businessType:configuration.answers.businessType,
        businessProfile:configuration,updatedAt:new Date(),
      }).where(eq(tenants.id,tenantId)).returning({id:tenants.id});
      if(!tenant)throw fail(404,'WORKSPACE_NOT_FOUND','Business workspace not found.');
      await tx.insert(accountAccessAuditEvents).values({
        authUserId:actor.authUserId,tenantId,tenantUserId:actor.tenantUserId,
        applicationContext:'TENANT',action:'PRODUCT_ONBOARDING_SAVED',requestId:actor.requestId,metadata:{version:1},
      });
    });
  },
};
export const productOnboardingRoutes: FastifyPluginAsync<{store?:ProductOnboardingStore}> = async (fastify,options) => {
  const store=options.store??databaseStore;
  fastify.get('/api/v1/workspace/product-onboarding', async request => {
    request.requireContext('TENANT');request.requireAuth();
    const tenant=await store.read(request.auth!.tenantId);
    if(!tenant)throw fail(404,'WORKSPACE_NOT_FOUND','Business workspace not found.');
    return {success:true,data:{businessName:tenant.name,businessType:tenant.businessType,
      configuration:parseProductOnboardingConfiguration(tenant.businessProfile),
      profile:resolveBusinessProfile(tenant.businessType,tenant.businessProfile),
    }};
  });
  fastify.put('/api/v1/workspace/product-onboarding', async request => {
    request.requireContext('TENANT');request.requireAuth();
    if(request.auth!.role!=='owner'||request.auth!.supportMode)throw fail(403,'PRODUCT_ONBOARDING_FORBIDDEN','Only the business owner can set up this business.');
    const parsed=ProductOnboardingAnswersSchema.safeParse(request.body);
    if(!parsed.success)throw fail(400,'PRODUCT_ONBOARDING_INVALID','Check your business details and choices.');
    const configuration=ProductOnboardingConfigurationSchema.parse({version:1,completedAt:new Date().toISOString(),answers:parsed.data});
    await store.save(request.auth!.tenantId,configuration,{
      authUserId:request.auth!.authUserId,tenantUserId:request.auth!.tenantUserId,requestId:request.id,
    });
    return {success:true,data:{configuration,profile:resolveBusinessProfile(parsed.data.businessType,configuration)}};
  });
};
