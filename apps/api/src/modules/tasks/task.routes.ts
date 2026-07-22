import type {FastifyInstance,FastifyRequest} from 'fastify';
import {AssignTaskSchema,CreateTaskSchema,TaskActivityResponseSchema,TaskIdParamsSchema,TaskListQuerySchema,TaskListResponseSchema,TaskResponseSchema,UpdateTaskSchema} from '@ks-os/contracts';
import {TaskService} from './task.service.js';
const actor=(r:FastifyRequest)=>{r.requireAuth();return{tenantId:r.auth!.tenantId,userId:r.auth!.authUserId,role:r.auth!.role,permissions:r.auth!.permissions as string[]};};
export async function taskRoutes(app:FastifyInstance){const s=new TaskService();
 app.get('/',async r=>TaskListResponseSchema.parse(await s.list(actor(r),TaskListQuerySchema.parse(r.query))));
 app.post('/',async r=>TaskResponseSchema.parse({data:await s.create(actor(r),CreateTaskSchema.parse(r.body))}));
 app.get('/:taskId',async r=>{const{taskId}=TaskIdParamsSchema.parse(r.params);return TaskResponseSchema.parse({data:await s.get(actor(r),taskId)});});
 app.patch('/:taskId',async r=>{const{taskId}=TaskIdParamsSchema.parse(r.params);return TaskResponseSchema.parse({data:await s.update(actor(r),taskId,UpdateTaskSchema.parse(r.body))});});
 app.get('/:taskId/activity',async r=>{const{taskId}=TaskIdParamsSchema.parse(r.params);return TaskActivityResponseSchema.parse({data:await s.activity(actor(r),taskId)});});
 app.patch('/:taskId/assignment',async r=>{const{taskId}=TaskIdParamsSchema.parse(r.params);const b=AssignTaskSchema.parse(r.body);return TaskResponseSchema.parse({data:await s.assign(actor(r),taskId,b.assignedUserId)});});
 for(const action of ['start','complete','reopen','cancel'] as const)app.post(`/:taskId/${action}`,async r=>{const{taskId}=TaskIdParamsSchema.parse(r.params);return TaskResponseSchema.parse({data:await s[action](actor(r),taskId)});});
}
export async function taskWorkerRoutes(app:FastifyInstance){app.post('/overdue',async r=>({data:await new TaskService().processOverdue(r.headers.authorization?.replace(/^Bearer\s+/i,''))}));}
