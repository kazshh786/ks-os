import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const REPORT_EXPORT_BUCKET='report-exports';
export interface ReportStorageLike { upload(path:string,body:Buffer,contentType?:string):Promise<void>; signedUrl(path:string,expiresInSeconds:number,filename:string):Promise<string>; remove(paths:string[]):Promise<void>; }

let admin:SupabaseClient|null=null;
function getAdmin(){
  if(admin)return admin;
  const url=process.env.SUPABASE_URL;const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw Object.assign(new Error('Private report storage is not configured.'),{code:'EXPORT_STORAGE_UNAVAILABLE'});
  admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});return admin;
}
export class SupabaseReportStorage implements ReportStorageLike {
  async upload(path:string,body:Buffer,contentType='text/csv'){const{error}=await getAdmin().storage.from(REPORT_EXPORT_BUCKET).upload(path,body,{contentType,upsert:false,cacheControl:'private, max-age=0'});if(error)throw Object.assign(new Error('Private export upload failed.'),{code:'EXPORT_UPLOAD_FAILED',cause:error});}
  async signedUrl(path:string,expiresInSeconds:number,filename:string){const{data,error}=await getAdmin().storage.from(REPORT_EXPORT_BUCKET).createSignedUrl(path,expiresInSeconds,{download:filename});if(error||!data?.signedUrl)throw Object.assign(new Error('Export download could not be prepared.'),{code:'EXPORT_DOWNLOAD_FAILED',cause:error});return data.signedUrl;}
  async remove(paths:string[]){if(!paths.length)return;const{error}=await getAdmin().storage.from(REPORT_EXPORT_BUCKET).remove(paths);if(error)throw Object.assign(new Error('Expired export cleanup failed.'),{code:'EXPORT_CLEANUP_FAILED',cause:error});}
}
