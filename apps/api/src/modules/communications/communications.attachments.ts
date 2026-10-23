import { randomUUID } from 'node:crypto';
import { sql } from '@ks-os/database';
import type { CommunicationsDatabase } from './communications.database.js';
import { CommunicationsAuthorization, staffId, customerId, communicationError, notFound, type CommunicationsActor } from './communications.authorization.js';
import { fileLimits,safeFileName,validateChatFile,type FileScan } from './communications.file-policy.js';
import { SupabaseChatStorage,type ChatStorage } from './communications.storage.js';
export const attachmentFields=sql`a.id,a.file_name AS "fileName",a.mime_type AS "mimeType",a.file_size_bytes AS "sizeBytes",a.status,
 (a.thumbnail_key IS NOT NULL) AS thumbnail,coalesce(a.uploaded_by,a.uploaded_by_customer_relationship_id) AS "uploadedBy",a.created_at AS "createdAt",a.message_id AS "messageId",a.conversation_id AS "conversationId",a.scan_status AS "scanStatus"`;
// All route/service instances share the process's bounded validation capacity.
let runningUploads=0;
export class CommunicationsAttachments {
 constructor(private db:CommunicationsDatabase,private storage:ChatStorage=new SupabaseChatStorage(),private scan?:FileScan){}
 async authorize(actor:CommunicationsActor,id:string){await new CommunicationsAuthorization(this.db).requireConversation(actor,id,'post');}
 private async locked<T>(actor:CommunicationsActor,id:string,action:'post'|'view',work:(db:CommunicationsDatabase)=>Promise<T>){
  return this.db.transaction(async db=>{
   await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.tenantId},8241))`);
   await new CommunicationsAuthorization(db).requireConversation(actor,id,action);return work(db);
  });
 }
 async reserve(actor:CommunicationsActor,id:string,input:{name:string;size:number}){
  const limits=fileLimits(),name=safeFileName(input.name),ext=name.split('.').at(-1)!.toLowerCase();
  if(input.size>limits.maxBytes)throw communicationError(413,'FILE_TOO_LARGE','File exceeds the '+Math.floor(limits.maxBytes/1048576)+' MB limit.');
  if(!limits.allowed.includes(ext))throw communicationError(422,'FILE_TYPE','This file type is not allowed.');
  // Bounded opportunistic cleanup is also exposed to the maintenance command.
  await this.authorize(actor,id);
  await this.cleanup(10);
  return this.locked(actor,id,'post',async db=>{
   const [count]=await db.query<{pending:number;recent:number}>(sql`SELECT count(*) FILTER(WHERE message_id IS NULL AND status IN ('PENDING','VALIDATING','AVAILABLE','QUARANTINED'))::int AS pending,
     count(*) FILTER(WHERE created_at>now()-interval '1 hour')::int AS recent FROM conversation_attachments WHERE tenant_id=${actor.tenantId} AND coalesce(uploaded_by,uploaded_by_customer_relationship_id)=${actor.userId}`);
   if(count.pending>=limits.maxPending||count.recent>=limits.perHour)throw communicationError(429,'UPLOAD_LIMIT','Upload limit reached. Remove unused files or try again later.');
   const key=randomUUID();const [row]=await db.query(sql`INSERT INTO conversation_attachments(id,tenant_id,conversation_id,uploaded_by,uploaded_by_customer_relationship_id,file_name,mime_type,file_size_bytes,storage_key,status,expires_at)
     VALUES(${key},${actor.tenantId},${id},${staffId(actor)},${customerId(actor)},${name},'application/octet-stream',${input.size},${actor.tenantId+'/'+key},'PENDING',now()+interval '24 hours')
     RETURNING id,file_name AS "fileName",status`);return row;
  });
 }
 async upload(actor:CommunicationsActor,id:string,fileId:string,bytes:Buffer){
  if(runningUploads>=2)throw communicationError(429,'UPLOAD_BUSY','Two files are being processed. Please retry shortly.');
  runningUploads++;
  try{
   const row=await this.locked(actor,id,'post',async db=>{
    const [r]=await db.query<{fileName:string;size:number;key:string}>(sql`UPDATE conversation_attachments SET status='VALIDATING',expires_at=now()+interval '24 hours'
      WHERE id=${fileId} AND tenant_id=${actor.tenantId} AND conversation_id=${id} AND coalesce(uploaded_by,uploaded_by_customer_relationship_id)=${actor.userId}
      AND message_id IS NULL AND status IN ('PENDING','REJECTED','QUARANTINED') AND deleted_at IS NULL
      RETURNING file_name AS "fileName",file_size_bytes AS size,storage_key AS key`);
    if(!r)throw notFound();return r;
   });
   try{
    if(bytes.length!==row.size||bytes.length>fileLimits().maxBytes)throw communicationError(413,'FILE_SIZE','File size does not match the selected upload.');
    const result=await validateChatFile(bytes,row.fileName,this.scan);
    // Record deterministic thumbnail key before writes so a process crash cannot orphan it.
    if(result.thumbnail)await this.db.query(sql`UPDATE conversation_attachments SET thumbnail_key=${row.key+'/thumb'} WHERE id=${fileId}`);
    await this.storage.put(row.key,result.bytes,result.mime);
    if(result.thumbnail)await this.storage.put(row.key+'/thumb',result.thumbnail,'image/webp');
    return await this.locked(actor,id,'post',async db=>{
     await db.query(sql`UPDATE conversation_attachments SET status=${result.available?'AVAILABLE':'QUARANTINED'},
       mime_type=${result.mime},file_size_bytes=${result.bytes.length},scan_status=${result.scanStatus}
       WHERE id=${fileId} AND status='VALIDATING' AND deleted_at IS NULL`);
     const [file]=await db.query(sql`SELECT ${attachmentFields} FROM conversation_attachments a WHERE a.id=${fileId}`);return file;
    });
   }catch(error){
    await this.db.query(sql`UPDATE conversation_attachments SET status='REJECTED',expires_at=now()+interval '1 hour' WHERE id=${fileId} AND status='VALIDATING'`);
    throw error;
   }
  }finally{runningUploads--;}
 }
 async remove(actor:CommunicationsActor,id:string,fileId:string){
  return this.locked(actor,id,'view',async db=>{
   const rows=await db.query(sql`UPDATE conversation_attachments SET status='DELETED',deleted_at=now(),expires_at=now()
    WHERE id=${fileId} AND tenant_id=${actor.tenantId} AND conversation_id=${id} AND coalesce(uploaded_by,uploaded_by_customer_relationship_id)=${actor.userId}
    AND message_id IS NULL AND status<>'VALIDATING' RETURNING id`);
   if(!rows.length)throw notFound();return {removed:true};
  });
 }
 async files(actor:CommunicationsActor,id:string,q:{after?:string;limit:number;type?:string}){
  return this.locked(actor,id,'view',async db=>{
   const rows=await db.query<{id:string}>(sql`SELECT ${attachmentFields},coalesce(u.name,ca.display_name) AS "uploaderName" FROM conversation_attachments a
    JOIN conversation_messages msg ON msg.id=a.message_id AND msg.deleted_at IS NULL LEFT JOIN users u ON u.id=a.uploaded_by
    LEFT JOIN customer_collaboration_relationships cr ON cr.id=a.uploaded_by_customer_relationship_id AND cr.tenant_id=a.tenant_id
    LEFT JOIN customer_accounts ca ON ca.id=cr.customer_account_id
    WHERE a.tenant_id=${actor.tenantId} AND a.conversation_id=${id} AND a.status='AVAILABLE' AND a.deleted_at IS NULL
    ${q.after?sql`AND a.id>${q.after}::uuid`:sql``}
    ${q.type==='image'?sql`AND a.mime_type LIKE 'image/%'`:q.type==='document'?sql`AND a.mime_type NOT LIKE 'image/%'`:sql``}
    ORDER BY a.id LIMIT ${q.limit+1}`);
   return {data:rows.slice(0,q.limit),nextCursor:rows.length>q.limit?rows[q.limit-1].id:null};
  });
 }
 async download(actor:CommunicationsActor,id:string,fileId:string,thumbnail=false){
  const select=async(db:CommunicationsDatabase)=>{
   const [row]=await db.query<{key:string;thumbnailKey:string|null;fileName:string;mimeType:string}>(sql`SELECT a.storage_key AS key,a.thumbnail_key AS "thumbnailKey",a.file_name AS "fileName",a.mime_type AS "mimeType"
    FROM conversation_attachments a JOIN conversation_messages msg ON msg.id=a.message_id AND msg.deleted_at IS NULL
    WHERE a.id=${fileId} AND a.tenant_id=${actor.tenantId} AND a.conversation_id=${id} AND a.status='AVAILABLE' AND a.deleted_at IS NULL`);
   if(!row || thumbnail&&!row.thumbnailKey)throw notFound();return row;
  };
  const row=await this.locked(actor,id,'view',select);
  const bytes=await this.storage.get(thumbnail?row.thumbnailKey!:row.key);
  // Recheck after slow object-store IO, so concurrent removal cannot release new bytes.
  await this.locked(actor,id,'view',select);
  return {bytes,name:row.fileName,mime:thumbnail?'image/webp':row.mimeType};
 }
 async cleanup(limit=100){
  // Keep tombstone records for rate accounting and retry-safe cleanup. Object deletion precedes clearing expiry.
  return this.db.transaction(async db=>{
   const rows=await db.query<{id:string;key:string;thumb:string|null}>(sql`SELECT id,storage_key AS key,thumbnail_key AS thumb FROM conversation_attachments
    WHERE status<>'LEGACY' AND expires_at<now() ORDER BY expires_at LIMIT ${Math.min(limit,100)} FOR UPDATE SKIP LOCKED`);
   for(const row of rows){
    await this.storage.remove([row.key,...(row.thumb?[row.thumb]:[])]);
    await db.query(sql`UPDATE conversation_attachments SET status='DELETED',deleted_at=coalesce(deleted_at,now()),expires_at=NULL,thumbnail_key=NULL WHERE id=${row.id}`);
   }
   return {removed:rows.length};
  });
 }
}
