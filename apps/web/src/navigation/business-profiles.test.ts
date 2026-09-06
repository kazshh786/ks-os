import {describe,it,expect} from 'vitest';
import {resolveBusinessProfile} from '@ks-os/contracts';
import {businessNavigation} from './business-navigation';
import {resolveNavigation} from './navigation.utils';
const entitlements={'inventory.enabled':{enabled:true},'automations.enabled':{enabled:true},'analytics.advanced':{enabled:true}};
const resolve=(type:string,role:'owner'|'staff'='owner',permissions:any[]=[],rights=entitlements)=>resolveNavigation(businessNavigation,{portal:'business',businessProfile:resolveBusinessProfile(type),role,permissions,entitlements:rights}).flatMap(group=>group.items);
describe('business navigation',()=>{
  it('keeps the established salon destinations and does not add Sales or Work by default',()=>{
    const legacyIds=businessNavigation.flatMap(group=>group.items).map(item=>item.id).filter(id=>!['sales','work'].includes(id));
    expect(resolve('salon').map(item=>item.id)).toEqual(legacyIds);
    expect(resolve('salon').some(item=>item.id==='sales')).toBe(false);
    expect(resolve('salon').some(item=>item.id==='work')).toBe(false);
  });
  it('materially differs for logistics and agency and exposes implemented Sales and Work engines',()=>{
    expect(resolve('logistics').some(item=>item.id==='services')).toBe(false);
    expect(resolve('logistics').some(item=>item.id==='sales')).toBe(true);
    expect(resolve('logistics').find(item=>item.id==='work')?.label).toBe('Deliveries');
    expect(resolve('agency').find(item=>item.id==='customers')?.label).toBe('Clients');
    expect(resolve('agency').some(item=>item.id==='sales')).toBe(true);
    expect(resolve('agency').find(item=>item.id==='work')?.label).toBe('Projects');
    expect(resolve('plumbing').find(item=>item.id==='work')?.label).toBe('Jobs');
    for(const type of ['logistics','agency'])expect(resolve(type).some(item=>['fleet','routes','projects','dispatch'].includes(item.id))).toBe(false);
  });
  it('filters permission-denied and unentitled engines',()=>{
    expect(resolve('salon','staff').map(item=>item.id)).toEqual(['security']);
    expect(resolve('salon','staff',['CLIENTS_VIEW_BASIC']).map(item=>item.id)).toEqual(['customers','security']);
    expect(resolve('agency','staff',['SALES_VIEW_OWN']).some(item=>item.id==='sales')).toBe(true);
    expect(resolve('agency','staff',[]).some(item=>item.id==='sales')).toBe(false);
    expect(resolve('agency','staff',['WORK_VIEW_OWN']).some(item=>item.id==='work')).toBe(true);
    expect(resolve('agency','staff',[]).some(item=>item.id==='work')).toBe(false);
    expect(resolve('salon','owner',[],{} as typeof entitlements).some(item=>['inventory','analytics','automations'].includes(item.id))).toBe(false);
  });
});