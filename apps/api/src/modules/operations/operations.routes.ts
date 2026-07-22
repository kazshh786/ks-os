import type {FastifyInstance,FastifyRequest} from 'fastify';
import {AssignOperationsIssueSchema,OperationsIssueIdParamsSchema,OperationsIssueListQuerySchema,OperationsIssueListResponseSchema,OperationsIssueResponseSchema,OperationsIssueSummaryResponseSchema,OperationsRetryResponseSchema} from '@ks-os/contracts';
import {OperationsService} from './operations.service.js';
import {OperationsReconciliationService} from './operations.reconciliation.js';
import {CreateTaskSchema,TaskResponseSchema} from '@ks-os/contracts';
import {TaskService} from '../tasks/task.service.js';
const actor=(r:FastifyRequest)=>{r.requireAuth();return{tenantId:r.auth!.tenantId,userId:r.auth!.authUserId,role:r.auth!.role};};
export async function operationsRoutes(app:FastifyInstance){const service=new OperationsService();
 app.get('/summary',async r=>OperationsIssueSummaryResponseSchema.parse({data:await service.summary(actor(r))}));
 app.get('/',async r=>OperationsIssueListResponseSchema.parse(await service.list(actor(r),OperationsIssueListQuerySchema.parse(r.query))));
 app.get('/:issueId',async r=>{const{issueId}=OperationsIssueIdParamsSchema.parse(r.params);return OperationsIssueResponseSchema.parse({data:await service.get(actor(r),issueId)});});
 app.post('/:issueId/acknowledge',async r=>{const{issueId}=OperationsIssueIdParamsSchema.parse(r.params);return OperationsIssueResponseSchema.parse({data:await service.acknowledge(actor(r),issueId)});});
 app.post('/:issueId/resolve',async r=>{const{issueId}=OperationsIssueIdParamsSchema.parse(r.params);return OperationsIssueResponseSchema.parse({data:await service.resolve(actor(r),issueId)});});
 app.post('/:issueId/dismiss',async r=>{const{issueId}=OperationsIssueIdParamsSchema.parse(r.params);return OperationsIssueResponseSchema.parse({data:await service.dismiss(actor(r),issueId)});});
 app.post('/:issueId/retry',async r=>{const{issueId}=OperationsIssueIdParamsSchema.parse(r.params);return OperationsRetryResponseSchema.parse({data:await service.retry(actor(r),issueId)});});
 app.patch('/:issueId/assignment',async r=>{const{issueId}=OperationsIssueIdParamsSchema.parse(r.params);const body=AssignOperationsIssueSchema.parse(r.body);return OperationsIssueResponseSchema.parse({data:await service.assign(actor(r),issueId,body.assignedToUserId)});});
 app.post('/:issueId/create-task',async r=>{const{issueId}=OperationsIssueIdParamsSchema.parse(r.params);const body=CreateTaskSchema.omit({sourceType:true,sourceId:true,operationsIssueId:true}).parse(r.body);return TaskResponseSchema.parse({data:await new TaskService().createFromIssue({...actor(r),permissions:r.auth!.permissions as string[]},issueId,body)});});
}
export async function operationsReconciliationRoutes(app:FastifyInstance){app.post('/',async r=>{const supplied=r.headers.authorization?.replace(/^Bearer\s+/i,'');if(!process.env.OPERATIONS_WORKER_SECRET||supplied!==process.env.OPERATIONS_WORKER_SECRET)throw Object.assign(new Error('Unauthorized'),{statusCode:401,code:'UNAUTHENTICATED'});return{data:await new OperationsReconciliationService().run()};});}
