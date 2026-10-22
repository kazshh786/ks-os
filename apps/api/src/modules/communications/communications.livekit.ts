import { AccessToken, RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';
import { communicationError } from './communications.authorization.js';

export interface MeetingMediaProvider {
 enabled:boolean; url:string; participantLimit:number; tokenTtlSeconds:number;
 createRoom(name:string):Promise<void>; deleteRoom(name:string):Promise<void>;
 participants(name:string):Promise<{identity:string;sid:string}[]>;
 rooms():Promise<{name:string;sid:string}[]>;
 removeParticipant(name:string,identity:string):Promise<void>;
 token(room:string,identity:string,name:string):Promise<string>;
 verify(raw:string,authorization:string):Promise<{id?:string;event:string;createdAt?:number|bigint;room?:{name?:string;sid?:string};participant?:{identity?:string;sid?:string}}>;
}
export class LiveKitProvider implements MeetingMediaProvider {
 readonly enabled:boolean; readonly url:string; readonly participantLimit:number; readonly tokenTtlSeconds=60;
 private readonly key:string; private readonly secret:string; private client?:RoomServiceClient;
 constructor(env:Record<string,string|undefined>=process.env){
  this.enabled=env.LIVEKIT_ENABLED==='true'; this.url=env.LIVEKIT_URL??'';
  this.key=env.LIVEKIT_API_KEY??'';this.secret=env.LIVEKIT_API_SECRET??'';
  this.participantLimit=Math.max(2,Math.min(8,Number(env.LIVEKIT_MAX_PARTICIPANTS)||4));
  if(this.enabled){
   const url=new URL(this.url),local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
   if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(!local&&url.protocol!=='wss:')||!['ws:','wss:'].includes(url.protocol)||!this.key||this.secret.length<32)throw new Error('Invalid LiveKit configuration');
   const api=new URL(env.LIVEKIT_API_URL??this.url.replace(/^ws/,'http'));
   if(api.username||api.password||!['https:','http:'].includes(api.protocol)||api.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(api.hostname))throw new Error('Invalid LiveKit control URL');
   this.client=new RoomServiceClient(api.toString(),this.key,this.secret,{requestTimeout:10});
  }
 }
 private require(){if(!this.client)throw communicationError(503,'CALLS_UNAVAILABLE','Calling is not configured for this workspace.');return this.client;}
 async createRoom(name:string){await this.require().createRoom({name,emptyTimeout:120,departureTimeout:30,maxParticipants:this.participantLimit,metadata:'ksos-internal-v1'});}
 async deleteRoom(name:string){try{await this.require().deleteRoom(name);}catch(e){if((e as {status?:number}).status!==404)throw e;}}
 async participants(name:string){try{return await this.require().listParticipants(name);}catch(e){if((e as {status?:number}).status===404)return [];throw e;}}
 async rooms(){return this.require().listRooms();}
 async removeParticipant(name:string,identity:string){try{await this.require().removeParticipant(name,identity);}catch(e){if((e as {status?:number}).status!==404)throw e;}}
 async token(room:string,identity:string,name:string){
  this.require(); const token=new AccessToken(this.key,this.secret,{identity,name,ttl:this.tokenTtlSeconds});
  token.addGrant({room,roomJoin:true,canPublish:true,canSubscribe:true,canPublishData:false,canUpdateOwnMetadata:false});
  return token.toJwt();
 }
 async verify(raw:string,authorization:string){
  this.require();try{return await new WebhookReceiver(this.key,this.secret).receive(raw,authorization,false,5);}
  catch{throw communicationError(401,'INVALID_WEBHOOK','Invalid media notification');}
 }
}
