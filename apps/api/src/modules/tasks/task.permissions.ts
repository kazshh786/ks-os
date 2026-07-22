export type TaskActor={tenantId:string;userId:string;role:'owner'|'staff';permissions:string[]};
export const can=(actor:TaskActor,capability:string)=>actor.role==='owner'||actor.permissions.includes(capability);
export const canViewAll=(actor:TaskActor)=>can(actor,'TASKS_VIEW_ALL');
export const canUpdate=(actor:TaskActor,assignedUserId:string|null)=>can(actor,'TASKS_UPDATE_ALL')||(assignedUserId===actor.userId&&can(actor,'TASKS_UPDATE_OWN'));
export const canComplete=(actor:TaskActor,assignedUserId:string|null)=>can(actor,'TASKS_COMPLETE_ALL')||(assignedUserId===actor.userId&&can(actor,'TASKS_COMPLETE_OWN'));
export const isFinanceSource=(sourceType:string)=>sourceType==='PAYMENT'||sourceType==='REFUND';
export const isTaskOverdue=(status:string,dueAt:Date|string|null,now=new Date())=>!!dueAt&&['OPEN','IN_PROGRESS'].includes(status)&&new Date(dueAt).getTime()<now.getTime();
