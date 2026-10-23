import type { ChatAttachment,ChatPreferences } from '@ks-os/contracts';
import { fetchWithAuth,uploadWithAuth } from '../../api/client';
import { chatBase,chatRequest,ChatError,type Page } from './chat.api';
export type SearchHit={id:string;conversationId:string;parentMessageId:string|null;senderName:string;conversationName:string;createdAt:string;excerpt:string;position:string};
export type ChatNotice={id:string;type:string;conversationType?:string|null;conversationId:string|null;meetingId?:string|null;messageId:string|null;parentMessageId:string|null;senderName:string|null;conversationName:string;preview:string|null;createdAt:string;readAt:string|null};
const data=async<T>(p:Promise<{data:T}>)=>(await p).data;
export function createPhase4Api(base = chatBase, request: typeof chatRequest = chatRequest, authenticatedFetch: typeof fetchWithAuth = fetchWithAuth, upload: typeof uploadWithAuth = uploadWithAuth) { return {
 policy:()=>data(request<{data:{maxBytes:number;allowed:string[]}}>('/file-policy')),
 reserve:(id:string,file:File)=>data(request<{data:{id:string}}>(`/${id}/files`,'POST',{name:file.name,size:file.size})),
 async upload(id:string,fileId:string,file:File,signal:AbortSignal,progress:(n:number)=>void){
  const response=await upload(`${base}/${id}/files/${fileId}`,file,signal,progress);const result=await response.json();
  if(!response.ok)throw new ChatError(typeof result.error==='string'?result.error:result.error?.message||'File upload failed',response.status);
  return result.data as ChatAttachment;
 },
 remove:(id:string,fileId:string)=>request(`/${id}/files/${fileId}`,'DELETE'),
 files:(id:string,after='',type='')=>request<Page<ChatAttachment>>(`/${id}/files?`+new URLSearchParams({...after?{after}:{},...type?{type}:{}})),
 async content(id:string,fileId:string,thumbnail=false,signal?:AbortSignal){
  const response=await authenticatedFetch(`${base}/${id}/files/${fileId}/content${thumbnail?'?thumbnail=true':''}`,{signal});
  if(!response.ok)throw new ChatError('This file is no longer available to you.',response.status);return response.blob();
 },
 search:(query:URLSearchParams,signal?:AbortSignal)=>request<Page<SearchHit>>('/search?'+query,'GET',undefined,signal),
 preferences:()=>data(request<{data:ChatPreferences}>('/preferences')),
 savePreferences:(input:ChatPreferences)=>data(request<{data:ChatPreferences}>('/preferences','PUT',input)),
 conversationPreference:(id:string)=>data(request<{data:{mode:string}}>(`/${id}/notification-preference`)),
 saveConversationPreference:(id:string,mode:string)=>data(request<{data:{mode:string}}>(`/${id}/notification-preference`,'PUT',{mode})),
 notifications:(after='')=>request<Page<ChatNotice>>('/notifications'+(after?'?after='+encodeURIComponent(after):'')),
 readNotice:(id:string)=>request(`/notifications/${id}/read`,'POST'),
}; }
export const phase4Api = createPhase4Api();
export type NotificationTarget={conversationId:string|null;meetingId?:string|null;type?:string;messageId?:string|null;id?:string;parentMessageId?:string|null};
export const isMeetingNotice=(item:Pick<NotificationTarget,'meetingId'|'type'>)=>Boolean(item.type?.startsWith('MEETING_')||(item.meetingId&&!item.type?.startsWith('CALL_')));
export function messageLink(item:NotificationTarget){
 if(item.meetingId&&isMeetingNotice(item))return '/app/meetings/'+encodeURIComponent(item.meetingId);
 if(!item.conversationId)return '/app/chat';
 const q=new URLSearchParams();
 if(item.meetingId&&item.type?.startsWith('CALL_'))q.set('call',item.meetingId);
 else {const messageId=item.messageId||(item.type?undefined:item.id);if(messageId)q.set('message',messageId);if(item.parentMessageId)q.set('thread',item.parentMessageId);}
 return '/app/chat/'+encodeURIComponent(item.conversationId)+(q.size?'?'+q:'');
}
