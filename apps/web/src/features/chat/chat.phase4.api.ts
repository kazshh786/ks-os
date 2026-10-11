import type { ChatAttachment,ChatPreferences } from '@ks-os/contracts';
import { fetchWithAuth,uploadWithAuth } from '../../api/client';
import { chatBase,chatRequest,ChatError,type Page } from './chat.api';
export type SearchHit={id:string;conversationId:string;parentMessageId:string|null;senderName:string;conversationName:string;createdAt:string;excerpt:string;position:string};
export type ChatNotice={id:string;type:string;conversationType?:string;conversationId:string;messageId:string|null;parentMessageId:string|null;senderName:string|null;conversationName:string;preview:string|null;createdAt:string;readAt:string|null};
const data=async<T>(p:Promise<{data:T}>)=>(await p).data;
export const phase4Api={
 policy:()=>data(chatRequest<{data:{maxBytes:number;allowed:string[]}}>('/file-policy')),
 reserve:(id:string,file:File)=>data(chatRequest<{data:{id:string}}>(`/${id}/files`,'POST',{name:file.name,size:file.size})),
 async upload(id:string,fileId:string,file:File,signal:AbortSignal,progress:(n:number)=>void){
  const response=await uploadWithAuth(`${chatBase}/${id}/files/${fileId}`,file,signal,progress);const result=await response.json();
  if(!response.ok)throw new ChatError(typeof result.error==='string'?result.error:result.error?.message||'File upload failed',response.status);
  return result.data as ChatAttachment;
 },
 remove:(id:string,fileId:string)=>chatRequest(`/${id}/files/${fileId}`,'DELETE'),
 files:(id:string,after='',type='')=>chatRequest<Page<ChatAttachment>>(`/${id}/files?`+new URLSearchParams({...after?{after}:{},...type?{type}:{}})),
 async content(id:string,fileId:string,thumbnail=false,signal?:AbortSignal){
  const response=await fetchWithAuth(`${chatBase}/${id}/files/${fileId}/content${thumbnail?'?thumbnail=true':''}`,{signal});
  if(!response.ok)throw new ChatError('This file is no longer available to you.',response.status);return response.blob();
 },
 search:(query:URLSearchParams,signal?:AbortSignal)=>chatRequest<Page<SearchHit>>('/search?'+query,'GET',undefined,signal),
 preferences:()=>data(chatRequest<{data:ChatPreferences}>('/preferences')),
 savePreferences:(input:ChatPreferences)=>data(chatRequest<{data:ChatPreferences}>('/preferences','PUT',input)),
 conversationPreference:(id:string)=>data(chatRequest<{data:{mode:string}}>(`/${id}/notification-preference`)),
 saveConversationPreference:(id:string,mode:string)=>data(chatRequest<{data:{mode:string}}>(`/${id}/notification-preference`,'PUT',{mode})),
 notifications:(after='')=>chatRequest<Page<ChatNotice>>('/notifications'+(after?'?after='+encodeURIComponent(after):'')),
 readNotice:(id:string)=>chatRequest(`/notifications/${id}/read`,'POST'),
};
export function messageLink(item:{conversationId:string;messageId?:string|null;id?:string;parentMessageId?:string|null}){
 const q=new URLSearchParams();if(item.messageId||item.id)q.set('message',item.messageId||item.id!);if(item.parentMessageId)q.set('thread',item.parentMessageId);
 return '/app/chat/'+item.conversationId+(q.size?'?'+q:'');
}
