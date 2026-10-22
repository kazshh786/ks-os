import { useState, type CSSProperties } from 'react';
import type { MeetingBrand } from './meetings.api';

export function brandStyle(brand: MeetingBrand): CSSProperties {
  const colour = /^#[0-9a-f]{6}$/i.test(brand.primaryColor) ? brand.primaryColor : '#334155';
  const channels = [1, 3, 5].map(index => parseInt(colour.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const light = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return { '--meeting-accent': colour, '--meeting-on-accent': light > 0.179 ? '#000000' : '#ffffff' } as CSSProperties;
}
export function MeetingBrandHeader({ brand }: { brand: MeetingBrand }) {
  const [failed, setFailed] = useState(false);
  let logo: string | null = null;
  try { const url = new URL(brand.logoUrl || '', window.location.origin); if (brand.logoUrl && (url.protocol === 'https:' || url.origin === window.location.origin) && !/\.svg(?:$|[?#])/i.test(url.pathname)) logo = url.href; } catch { /* Use the business initials when its configured asset is unavailable. */ }
  return <div className="meeting-brand">{logo && !failed ? <img src={logo} alt={`${brand.name} logo`} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="meeting-brand-fallback" aria-hidden="true">{brand.name.slice(0, 2).toUpperCase()}</span>}<strong>{brand.name}</strong></div>;
}
