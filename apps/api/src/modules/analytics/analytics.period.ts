import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { AnalyticsPreset, DashboardOverviewQuery } from '@ks-os/contracts';

export type AnalyticsPeriod = { preset:AnalyticsPreset; from:Date; to:Date; previousFrom:Date; previousTo:Date; timezone:string; localFrom:string; localTo:string };
const parseLocalDate = (value:string) => { const [y,m,d]=value.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); };
const dateKey = (date:Date) => date.toISOString().slice(0,10);
const addCalendarDays=(date:Date,days:number)=>new Date(date.getTime()+days*86400000);
const startOfCalendarMonth=(date:Date)=>new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1));
const endOfCalendarMonth=(date:Date)=>new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0));
const utcBoundary = (date:Date, timezone:string) => fromZonedTime(`${dateKey(date)}T00:00:00`,timezone);

export function resolveAnalyticsPeriod(query:DashboardOverviewQuery, timezone:string, now=new Date()):AnalyticsPeriod {
  const today=parseLocalDate(formatInTimeZone(now,timezone,'yyyy-MM-dd')); let start:Date; let endInclusive:Date;
  switch(query.preset){
    case 'TODAY': start=today;endInclusive=today;break;
    case 'YESTERDAY': start=addCalendarDays(today,-1);endInclusive=start;break;
    case 'LAST_7_DAYS': endInclusive=today;start=addCalendarDays(today,-6);break;
    case 'LAST_30_DAYS': endInclusive=today;start=addCalendarDays(today,-29);break;
    case 'LAST_90_DAYS': endInclusive=today;start=addCalendarDays(today,-89);break;
    case 'LAST_6_MONTHS': endInclusive=today;start=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-6,today.getUTCDate()+1));break;
    case 'LAST_12_MONTHS': endInclusive=today;start=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-12,today.getUTCDate()+1));break;
    case 'THIS_MONTH': start=startOfCalendarMonth(today);endInclusive=today;break;
    case 'LAST_MONTH': { const last=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-1,1));start=startOfCalendarMonth(last);endInclusive=endOfCalendarMonth(last);break; }
    case 'CUSTOM': start=parseLocalDate(query.from!);endInclusive=parseLocalDate(query.to!);break;
  }
  const days=Math.round((endInclusive.getTime()-start.getTime())/86400000)+1;
  if(days<1) throw Object.assign(new Error('The reporting period is invalid.'),{code:'ANALYTICS_INVALID_PERIOD',statusCode:400});
  if(days>366) throw Object.assign(new Error('The reporting period cannot exceed 366 days.'),{code:'ANALYTICS_RANGE_TOO_LARGE',statusCode:422});
  const endExclusive=addCalendarDays(endInclusive,1); const previousEnd=start; const previousStart=addCalendarDays(start,-days);
  return {preset:query.preset,from:utcBoundary(start,timezone),to:utcBoundary(endExclusive,timezone),previousFrom:utcBoundary(previousStart,timezone),previousTo:utcBoundary(previousEnd,timezone),timezone,localFrom:dateKey(start),localTo:dateKey(endInclusive)};
}
