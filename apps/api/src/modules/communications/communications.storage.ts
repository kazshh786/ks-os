import { getSupabaseAdmin } from '../../lib/supabase-admin.js';
import { communicationError } from './communications.authorization.js';
export interface ChatStorage { put(key:string,bytes:Buffer,mime:string):Promise<void>; get(key:string):Promise<Buffer>; remove(keys:string[]):Promise<void>; }
export class SupabaseChatStorage implements ChatStorage {
 private async bucket(){
  const bucket=process.env.CHAT_STORAGE_BUCKET||'private-chat';
  const api=getSupabaseAdmin().storage;const {data,error}=await api.getBucket(bucket);
  // Never create or alter infrastructure from a request. Release setup must supply a private bucket.
  if(error||!data||data.public)throw communicationError(503,'CHAT_STORAGE_UNAVAILABLE','Private Chat storage is not ready.');
  return api.from(bucket);
 }
 async put(key:string,bytes:Buffer,mime:string){const api=await this.bucket();const {error}=await api.upload(key,bytes,{contentType:mime,upsert:true,cacheControl:'0'});if(error)throw communicationError(503,'CHAT_UPLOAD_FAILED','File storage is temporarily unavailable.');}
 async get(key:string){const api=await this.bucket();const {data,error}=await api.download(key);if(error||!data)throw communicationError(404,'FILE_UNAVAILABLE','File is unavailable.');return Buffer.from(await data.arrayBuffer());}
 async remove(keys:string[]){if(!keys.length)return;const api=await this.bucket();const {error}=await api.remove(keys);if(error)throw communicationError(503,'CHAT_CLEANUP_FAILED','File cleanup will be retried.');}
}
