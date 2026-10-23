import type { ChatEphemeral, ChatSignal } from '@ks-os/contracts';
import type { CommunicationsActor } from './communications.authorization.js';

// Ephemeral, bounded by the route's connection limit. One registry per API server.
// The current VPS runs one API process; a multi-process rollout requires a shared adapter.
type Lease = {actor:CommunicationsActor;expires:number;activeAt:number;away:boolean;conversationId:string|null;userIds:string[];typingUntil:number};
export class CommunicationsPresence {
  private leases=new Map<string,Lease>();
  constructor(private now:()=>number=Date.now) {}
  open(key:string,actor:CommunicationsActor) {
    this.leases.set(key,{actor,expires:this.now()+45000,activeAt:this.now(),away:false,conversationId:null,userIds:[],typingUntil:0});
  }
  close(key:string) { this.leases.delete(key); }
  touch(key:string) { const lease=this.leases.get(key);if(lease)lease.expires=this.now()+45000; }
  watch(key:string) { const lease=this.leases.get(key);return {conversationId:lease?.conversationId ?? null,userIds:lease?.userIds ?? []}; }
  signal(key:string,signal:ChatSignal) {
    const lease=this.leases.get(key);if(!lease)return;
    this.touch(key);
    if(signal.type==='watch'){lease.conversationId=signal.conversationId;lease.userIds=signal.userIds;lease.typingUntil=0;}
    if(signal.type==='activity'){lease.away=!signal.active;if(signal.active)lease.activeAt=this.now();else lease.typingUntil=0;}
    if(signal.type==='typing')lease.typingUntil=signal.active && lease.conversationId?this.now()+5000:0;
  }
  snapshot(key:string,scope:{visible:{userId:string}[];readers:{userId:string;name:string;position:string}[]}):ChatEphemeral {
    const now=this.now();
    for(const [id,lease] of this.leases)if(lease.expires<=now || new Date(lease.actor.expiresAt).getTime()<=now)this.leases.delete(id);
    const own=this.leases.get(key),tenant=own?.actor.tenantId;
    const leases=[...this.leases.values()].filter(l=>l.actor.tenantId===tenant);
    return {version:1,type:'ephemeral.snapshot',conversationId:own?.conversationId ?? null,
      presence:scope.visible.map(({userId})=>{const active=leases.filter(l=>l.actor.userId===userId);return {userId,state:active.some(l=>!l.away && now-l.activeAt<300000)?'ONLINE':active.length?'AWAY':'OFFLINE'};}),
      readers:scope.readers,
      typing:scope.readers.filter(m=>m.userId!==own?.actor.userId && leases.some(l=>l.actor.userId===m.userId && l.conversationId===own?.conversationId && l.typingUntil>now)).map(({userId,name})=>({userId,name})),
    };
  }
}
