import {useEffect,useState} from 'react';
import {getOperationsSummary} from './operations.api.js';
export function useOperationsSummary(enabled:boolean){const[count,setCount]=useState(0);useEffect(()=>{if(!enabled)return;let active=true;const load=()=>getOperationsSummary().then(x=>{if(active)setCount(x.totalActionable)}).catch(()=>{});void load();const timer=window.setInterval(load,60_000);return()=>{active=false;window.clearInterval(timer);};},[enabled]);return count;}
