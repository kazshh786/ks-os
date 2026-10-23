import type { Meeting, MeetingType } from '../../src/features/calls/calls.api';
export { callingError, meetingDuration, meetingOutcome, isJoinable } from '../../src/features/calls/calls.api';
export type { Meeting, MeetingType, CallingConfig, JoinTicket } from '../../src/features/calls/calls.api';
const base: Meeting = {
 id:'11111111-1111-4111-8111-111111111111',conversationId:'22222222-2222-4222-8222-222222222222',conversationName:'Design team',type:'VIDEO',status:'RINGING',createdBy:'ada',organizerName:'Ada Lovelace',title:'Design team call',createdAt:new Date().toISOString(),startedAt:null,endedAt:null,endReason:null,expiresAt:'2099-01-01T00:00:00Z',canManage:true,invitationState:'INVITED',
 participants:[{userId:'ada',name:'Ada Lovelace',role:'ORGANIZER',invitationState:'ACCEPTED',joinedAt:null,leftAt:null,sessionCount:1},{userId:'grace',name:'Grace Hopper',role:'PARTICIPANT',invitationState:'ACCEPTED',joinedAt:null,leftAt:null,sessionCount:1}],
};
let meeting: Meeting = structuredClone(base), history: Meeting[] = [], incoming: Meeting[] = [];
const listeners = new Set<(event: any)=>void>();
const emit = () => { for(const listener of listeners)listener({type:'call.updated',conversationId:base.conversationId,resourceId:base.id}); };
export const subscribe = (listener: (event: any)=>void) => { listeners.add(listener); return()=>{listeners.delete(listener);}; };
export const fixture = {
 invite(){meeting={...structuredClone(base),canManage:false,createdBy:'grace',organizerName:'Grace Hopper'};incoming=[meeting];history=[meeting];emit();},
 end(){meeting={...meeting,status:'ENDED',endReason:'ORGANIZER_ENDED',endedAt:new Date().toISOString()};history=[meeting];incoming=[];emit();},
};
export const callsApi = {
 config:async()=>({enabled:true,participantLimit:6,tokenTtlSeconds:120}),
 history:async()=>({data:history,nextCursor:null}),
 create:async(_id:string,type:MeetingType)=>{meeting={...structuredClone(base),type};history=[meeting];emit();return meeting;},
 incoming:async()=>incoming,
 meeting:async()=>meeting,
 invitation:async(_id:string,accept:boolean)=>{incoming=[];meeting={...meeting,invitationState:accept?'ACCEPTED':'DECLINED'};emit();return meeting;},
 join:async()=>{meeting={...meeting,status:'ACTIVE',invitationState:'ACCEPTED',startedAt:new Date().toISOString()};history=[meeting];return{token:'isolated-native-ui-test',url:'ws://127.0.0.1:7880',identity:'ada:session',sessionId:'test-session',expiresIn:120,meeting};},
 leave:async()=>({}),
 end:async()=>{fixture.end();return meeting;},
 remove:async(_id:string,userId:string)=>{meeting={...meeting,participants:meeting.participants?.map(person=>person.userId===userId?{...person,invitationState:'REMOVED',sessionCount:0}:person)};emit();return{};},
};

