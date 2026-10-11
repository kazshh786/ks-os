import {createContext,useContext,useEffect,useRef} from 'react';
import type {ChatEphemeral,ChatSignal,NativeMessage} from '@ks-os/contracts';
export const ChatLiveContext=createContext<{snapshot:ChatEphemeral|null;signal:(signal:ChatSignal)=>void}>({snapshot:null,signal:()=>{}});
export function PresenceLabel({state}:{state?:'ONLINE'|'AWAY'|'OFFLINE'}) {
  const label=state==='ONLINE'?'Online':state==='AWAY'?'Away':'Offline';
  return <span className={'chat-presence '+label.toLowerCase()}><span aria-hidden="true">●</span> {label}</span>;
}
export function ReadReceipt({message,userId}:{message:NativeMessage;userId:string}) {
  const {snapshot}=useContext(ChatLiveContext);
  if(message.senderId!==userId || !snapshot || snapshot.conversationId!==message.conversationId || !snapshot.readers.length)return null;
  const readers=snapshot.readers.filter(person=>person.userId!==userId && BigInt(person.position)>=BigInt(message.position));
  return <small className="chat-read-receipt">{readers.length?'Read by '+readers.map(person=>person.name).join(', '):'Sent'}</small>;
}
export function TypingStatus({conversationId}:{conversationId:string}) {
  const {snapshot}=useContext(ChatLiveContext);
  const people=snapshot?.conversationId===conversationId?snapshot.typing:[];
  return <p className="chat-typing" aria-live="off">{people.length?people.map(person=>person.name).join(', ')+(people.length===1?' is typing…':' are typing…'):' '}</p>;
}
export function useTyping(conversationId:string) {
  const {snapshot,signal}=useContext(ChatLiveContext);
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),last=useRef(0);
  const enabled=snapshot?.conversationId===conversationId && snapshot.readers.length>0;
  useEffect(()=>()=>{clearTimeout(timer.current);if(enabled)signal({type:'typing',active:false});},[conversationId,enabled,signal]);
  return (active:boolean)=>{
    if(!enabled)return;
    clearTimeout(timer.current);
    if(!active || Date.now()-last.current>=2000){signal({type:'typing',active});last.current=Date.now();}
    if(active)timer.current=setTimeout(()=>signal({type:'typing',active:false}),3000);
  };
}
