import { sql } from '@ks-os/database';
import type { CommunicationsDatabase } from './communications.database.js';
import { communicationError } from './communications.authorization.js';
export interface MeetingLimits { concurrentMeetings: number; participants: number; externalGuests: number; infrastructureMeetings: number; infrastructureConnections: number }
const bounded = (value: unknown, fallback: number, max: number) => Number.isInteger(Number(value)) && Number(value) >= 0 ? Math.min(max, Number(value)) : fallback;
export async function meetingLimits(db: CommunicationsDatabase, tenantId: string, providerLimit: number, env: NodeJS.ProcessEnv = process.env): Promise<MeetingLimits> {
  const result: MeetingLimits = {
    concurrentMeetings: bounded(env.MEETING_DEFAULT_CONCURRENT, 3, 50), participants: providerLimit,
    externalGuests: bounded(env.MEETING_DEFAULT_GUESTS, Math.max(0, providerLimit - 1), providerLimit),
    infrastructureMeetings: bounded(env.MEETING_INFRA_MAX_ROOMS, 8, 100), infrastructureConnections: bounded(env.MEETING_INFRA_MAX_CONNECTIONS, 32, 800),
  };
  const rows = await db.query<{key:string;value:unknown}>(sql`
    WITH assignment AS (SELECT plan_version_id FROM tenant_plan_assignments WHERE tenant_id=${tenantId} AND status='ACTIVE' AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now()) ORDER BY starts_at DESC,id DESC LIMIT 1),
    configured AS (SELECT entitlement_key AS key,value_json AS value,0 AS priority,created_at FROM platform_plan_entitlements WHERE plan_version_id IN (SELECT plan_version_id FROM assignment)
      UNION ALL SELECT entitlement_key,value_json,1,created_at FROM tenant_entitlement_overrides WHERE tenant_id=${tenantId} AND starts_at<=now() AND expires_at>now() AND revoked_at IS NULL)
    SELECT DISTINCT ON (key) key,value FROM configured WHERE key IN ('meetings.concurrent','meetings.participants','meetings.external_guests') ORDER BY key,priority DESC,created_at DESC`);
  for (const row of rows) {
    const limit = (row.value as {limit?:unknown})?.limit;
    if (!Number.isInteger(limit) || Number(limit)<0) throw communicationError(409,'MEETING_POLICY_INVALID','Meeting capacity settings need administrator review.');
    if (row.key==='meetings.concurrent') result.concurrentMeetings=bounded(limit,result.concurrentMeetings,50);
    if (row.key==='meetings.participants') result.participants=bounded(limit,result.participants,providerLimit);
    if (row.key==='meetings.external_guests') result.externalGuests=bounded(limit,result.externalGuests,providerLimit);
  }
  result.externalGuests=Math.min(result.externalGuests,result.participants);
  return result;
}
// Call under the shared global-then-tenant transaction locks, before reserving a room/session.
export async function reserveMeetingCapacity(db:CommunicationsDatabase,tenantId:string,limits:MeetingLimits) {
  const [count]=await db.query<{tenant:number;global:number}>(sql`SELECT count(*) FILTER(WHERE tenant_id=${tenantId})::int AS tenant,count(*)::int AS global FROM communication_meetings WHERE status IN ('CREATED','RINGING','ACTIVE')`);
  if(count.tenant>=limits.concurrentMeetings)throw communicationError(409,'MEETING_ENTITLEMENT_LIMIT','Your organisation has reached its concurrent meeting limit.');
  if(count.global>=limits.infrastructureMeetings)throw communicationError(503,'MEETING_INFRASTRUCTURE_CAPACITY','The shared calling service is at capacity. Please try later.');
}
export async function reserveConnectionCapacity(db:CommunicationsDatabase,meetingId:string,limits:MeetingLimits,guest=false) {
  const [count]=await db.query<{meeting:number;guests:number;global:number}>(sql`SELECT count(*) FILTER(WHERE meeting_id=${meetingId})::int AS meeting,count(*) FILTER(WHERE meeting_id=${meetingId} AND guest_session_id IS NOT NULL)::int AS guests,count(*)::int AS global FROM communication_meeting_sessions WHERE revoked_at IS NULL AND left_at IS NULL AND (joined_at IS NOT NULL OR token_expires_at>now())`);
  if(count.meeting>=limits.participants||guest&&count.guests>=limits.externalGuests)throw communicationError(409,'CALL_CAPACITY','This meeting has reached its connection limit.');
  if(count.global>=limits.infrastructureConnections)throw communicationError(503,'MEETING_INFRASTRUCTURE_CAPACITY','The shared calling service is at capacity. Please try later.');
}
