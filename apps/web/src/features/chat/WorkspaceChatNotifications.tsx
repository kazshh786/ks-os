import { CallWorkspace } from '../calls/CallWorkspace';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommunicationsEvent } from '@ks-os/contracts';
import { ChatNotifications } from './ChatNotifications';
import { connectChat } from './chat.realtime';
import type { SubscribeChat } from './MessageTimeline';
import './chat.css';

// Mounted only outside Chat. ChatWorkspace owns the same transport inside Chat.
export function WorkspaceChatNotifications() {
 const listeners=useRef(new Set<(event:CommunicationsEvent)=>void>());
 const [revision,setRevision]=useState(0),[revoked,setRevoked]=useState(false);
 const subscribe:SubscribeChat=useCallback(listener=>{listeners.current.add(listener);return()=>{listeners.current.delete(listener);};},[]);
 useEffect(()=>{
  let active=true;
  const stop=connectChat({
   event:event=>{if(active)for(const listener of listeners.current)listener(event);},
   ready:async()=>{if(active)setRevision(value=>value+1);},
   state:()=>{},
   revoked:()=>{if(active)setRevoked(true);},
  });
  return()=>{active=false;stop();};
 },[]);
 return revoked?null:<><ChatNotifications subscribe={subscribe} revision={revision}/><CallWorkspace subscribe={subscribe} revision={revision}/></>;
}

