import type { KpiValue } from '@ks-os/contracts';
export function compareKpi(value:number,previousValue:number|null):KpiValue{const changeValue=previousValue===null?null:value-previousValue;const changePercentage=previousValue===null||previousValue===0?null:Number((((value-previousValue)/previousValue)*100).toFixed(1));return{value,previousValue,changeValue,changePercentage};}
export const safeRate=(part:number,total:number)=>total===0?0:Number(((part/total)*100).toFixed(1));
