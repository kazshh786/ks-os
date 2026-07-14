import {authorizeAutomationWorker,serviceClient,signAutomationEvent} from '@/lib/service-api';
import {publicError} from '@/lib/booking-contract';
export const runtime='nodejs';

type OutboxEvent={id:string;tenant_id:string;agency_workspace_id:string;event_type:string;subject_id:string;safe_payload:Record<string,unknown>;occurred_at:string;lease_token:string};

export async function POST(request:Request){
  const denied=authorizeAutomationWorker(request);if(denied)return denied;
  const target=process.env.AUTOMATION_EVENT_INGEST_URL||'';if(!/^https:\/\//.test(target))return publicError(503,'AUTOMATION_TARGET_NOT_CONFIGURED','Automation event target is not configured');
  try{
    const db=serviceClient();const {data,error}=await db.rpc('claim_automation_outbox_events',{p_limit:20,p_lease_seconds:60});
    if(error)return publicError(500,'OUTBOX_CLAIM_FAILED','Unable to claim automation events');const results=[];
    for(const event of (data||[]) as OutboxEvent[]){
      const body={workspaceId:event.agency_workspace_id,eventType:event.event_type,source:'ks_os',sourceEventId:event.id,subjectType:'booking',subjectId:event.subject_id,occurredAt:event.occurred_at,payload:event.safe_payload,causationId:null,depth:0};
      const raw=JSON.stringify(body),timestamp=Math.floor(Date.now()/1000);let delivered=false,errorCode='DELIVERY_FAILED';
      try{
        const response=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json','X-KS-Timestamp':String(timestamp),'X-KS-Signature':signAutomationEvent(raw,timestamp)},body:raw,signal:AbortSignal.timeout(10000)});
        delivered=response.ok;errorCode=response.ok?'':`TARGET_${response.status}`;
      }catch(error:any){errorCode=error.code==='AUTOMATION_SECURITY_NOT_CONFIGURED'?error.code:'TARGET_UNAVAILABLE';}
      await db.rpc('complete_automation_outbox_event',{p_id:event.id,p_lease_token:event.lease_token,p_delivered:delivered,p_error_code:errorCode||null});results.push({eventId:event.id,delivered,errorCode:errorCode||null});
    }
    return Response.json({processed:results.length,results},{headers:{'Cache-Control':'no-store'}});
  }catch{return publicError(500,'INTERNAL_ERROR','Unable to dispatch automation events');}
}

export const GET=POST;
