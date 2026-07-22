import type {CreateTaskInput,TaskActivity,TaskDetail,TaskListQuery,TaskSummary,UpdateTaskInput} from '@ks-os/contracts';
import {fetchWithAuth} from '../../api/client.js';
async function request<T>(path:string,init?:RequestInit):Promise<T>{const response=await fetchWithAuth(path,{...init,headers:{'Content-Type':'application/json',...(init?.headers??{})}});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error?.message??body.message??'Task request failed');return body;}
export async function listTasks(query:Partial<TaskListQuery>={}){const params=new URLSearchParams();Object.entries(query).forEach(([key,value])=>{if(value!==undefined&&value!=='')params.set(key,String(value));});return request<{data:TaskSummary[];nextCursor:string|null}>(`/api/v1/tasks?${params}`);}
export async function getTask(id:string){return(await request<{data:TaskDetail}>(`/api/v1/tasks/${id}`)).data;}
export async function getTaskActivity(id:string){return(await request<{data:TaskActivity[]}>(`/api/v1/tasks/${id}/activity`)).data;}
export async function createTask(input:CreateTaskInput){return(await request<{data:TaskDetail}>('/api/v1/tasks',{method:'POST',body:JSON.stringify(input)})).data;}
export async function updateTask(id:string,input:UpdateTaskInput){return(await request<{data:TaskDetail}>(`/api/v1/tasks/${id}`,{method:'PATCH',body:JSON.stringify(input)})).data;}
export async function assignTask(id:string,assignedUserId:string){return(await request<{data:TaskDetail}>(`/api/v1/tasks/${id}/assignment`,{method:'PATCH',body:JSON.stringify({assignedUserId})})).data;}
export async function taskCommand(id:string,command:'start'|'complete'|'reopen'|'cancel'){return(await request<{data:TaskDetail}>(`/api/v1/tasks/${id}/${command}`,{method:'POST'})).data;}
export async function createTaskFromIssue(issueId:string,input:Omit<CreateTaskInput,'sourceType'|'sourceId'|'operationsIssueId'>){return(await request<{data:TaskDetail}>(`/api/v1/operations/issues/${issueId}/create-task`,{method:'POST',body:JSON.stringify(input)})).data;}
