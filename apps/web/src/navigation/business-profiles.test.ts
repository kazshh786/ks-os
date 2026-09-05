import {describe,it,expect} from 'vitest';
import {resolveBusinessProfile} from '@ks-os/contracts';
import {businessNavigation} from './business-navigation';
import {resolveNavigation} from './navigation.utils';
const entitlements={'inventory.enabled':{enabled:true},'automations.enabled':{enabled:true},'analytics.advanced':{enabled:true}};
const resolve=(type:string,role:'owner'|'staff'='owner',permissions:any[]=[],rights=entitlements)=>resolveNavigation(businessNavigation,{portal:'business',businessProfile:resolveBusinessProfile(type),role,permissions,entitlements:rights}).flatMap(group=>group.items);
describe('business navigation',()=>{
  it('keeps the existing salon destinations when entitled',()=>{
    expect(resolve('salon').map(item=>item.id)).toEqual(businessNavigation.flatMap(group=>group.items).map(item=>item.id));
  });
  it('materially differs for logistics and agency without exposing placeholders',()=>{
    expect(resolve('logistics').some(item=>item.id==='services')).toBe(false);
    expect(resolve('agency').find(item=>item.id==='customers')?.label).toBe('Clients');
    for(const type of ['logistics','agency'])expect(resolve(type).some(item=>['fleet','routes','projects','dispatch'].includes(item.id))).toBe(false);
  });
  it('filters permission-denied and unentitled engines',()=>{
    expect(resolve('salon','staff').map(item=>item.id)).toEqual(['security']);
    expect(resolve('salon','staff',['CLIENTS_VIEW_BASIC']).map(item=>item.id)).toEqual(['customers','security']);
    expect(resolve('salon','owner',[],{} as typeof entitlements).some(item=>['inventory','analytics','automations'].includes(item.id))).toBe(false);
  });
});
