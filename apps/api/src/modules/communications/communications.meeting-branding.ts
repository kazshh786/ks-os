import { sql } from '@ks-os/database';
import type { CommunicationsDatabase } from './communications.database.js';
export interface MeetingBranding { name:string; logoUrl:string|null; primaryColor:string; secondaryColor:string; welcomeMessage:string }
export function safeMeetingLogo(value: unknown):string|null {
  if(typeof value!=='string'||value.length>1500)return null;
  try { const url=new URL(value); if(url.protocol!=='https:'||url.username||url.password||url.hash||!/^\/(?:.*\/)?[^/]+\.(png|jpe?g|webp|gif)$/i.test(url.pathname))return null; return url.toString(); } catch { return null; }
}
const color=(value:unknown,fallback:string)=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value:fallback;
export async function meetingBranding(db:CommunicationsDatabase,tenantId:string):Promise<MeetingBranding> {
  const [row]=await db.query<{name:string;primary:string;secondary:string;settings:unknown;logo:string|null}>(sql`SELECT t.name,t.primary_color AS primary,t.secondary_color AS secondary,s.settings_json AS settings,(SELECT logo_url FROM booking_pages WHERE tenant_id=t.id ORDER BY created_at LIMIT 1) AS logo FROM tenants t LEFT JOIN tenant_email_automation_settings s ON s.tenant_id=t.id WHERE t.id=${tenantId}`);
  const saved=(row?.settings as {branding?:{businessName?:unknown;logoUrl?:unknown}})?.branding;
  const name=typeof saved?.businessName==='string'&&saved.businessName.trim()?saved.businessName.trim().slice(0,255):row?.name??'KSOS';
  return {name,logoUrl:safeMeetingLogo(saved?.logoUrl??row?.logo),primaryColor:color(row?.primary,'#0f172a'),secondaryColor:color(row?.secondary,'#475569'),welcomeMessage:`Welcome to your meeting with ${name}. Your host will admit you when ready.`};
}
