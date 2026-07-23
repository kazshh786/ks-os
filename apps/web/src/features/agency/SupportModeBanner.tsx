import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

interface SupportMetadata {
  tenantId?: string;
  tenantName?: string;
  reason: string;
  expiresAt: string;
}

export const SupportModeBanner: React.FC = () => {
  const [metadata, setMetadata] = useState<SupportMetadata | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    try {
      const value = sessionStorage.getItem('ks-os-support-metadata');
      setMetadata(value ? JSON.parse(value) : null);
    } catch { setMetadata(null); }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!sessionStorage.getItem('ks-os-support-session') || !metadata) return null;
  const remaining = Math.max(0, new Date(metadata.expiresAt).getTime() - now);
  if (remaining === 0) {
    sessionStorage.removeItem('ks-os-support-session');
    sessionStorage.removeItem('ks-os-support-metadata');
    return null;
  }
  const end = () => {
    sessionStorage.removeItem('ks-os-support-session');
    sessionStorage.removeItem('ks-os-support-metadata');
    window.location.assign(metadata.tenantId ? `/agency/tenants/${metadata.tenantId}` : '/agency/tenants');
  };
  return <div role="status" className="flex shrink-0 flex-col gap-2 border-b border-amber-500 bg-amber-300 px-4 py-2.5 text-xs font-bold text-slate-950 sm:flex-row sm:items-center sm:justify-between sm:px-6">
    <span className="flex min-w-0 items-start gap-2"><ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Agency support mode — You are managing {metadata.tenantName || 'this business'}.</strong> Changes affect the live business workspace. <span className="font-medium">Reason: {metadata.reason} · {Math.ceil(remaining / 60000)} min remaining</span></span></span>
    <button type="button" onClick={end} className="shrink-0 rounded-lg bg-slate-950 px-3 py-2 text-white hover:bg-slate-800">Exit business workspace</button>
  </div>;
};
