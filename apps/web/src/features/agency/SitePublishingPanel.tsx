import React, { useState } from 'react';
import { agencyFetch } from './AgencyAuth';

const status = (value: string) => String(value || 'NOT_STARTED').replaceAll('_', ' ');

export function SitePublishingPanel(props: {
  siteReference: string;
  publication: any;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await operation();
      setMessage(success);
      await props.onChanged();
    } catch (caught: any) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  const publish = () => {
    const quality = props.publication?.quality;
    if (!quality) return;
    void run(() => agencyFetch(`/sites/${props.siteReference}/publications`, {
      method: 'POST',
      body: JSON.stringify({
        siteVersionReference: quality.versionReference,
        qualityRunReference: quality.reference,
        reason: 'CONTENT_UPDATE',
        acknowledgeWarnings: quality.gateStatus === 'READY_WITH_WARNINGS',
      }),
    }), 'Digest-pinned publication was queued.');
  };
  const addCustom = () => {
    const hostname = prompt('Custom hostname (for example www.example.com)');
    if (!hostname) return;
    void run(() => agencyFetch(`/sites/${props.siteReference}/domains/custom`, {
      method: 'POST',
      body: JSON.stringify({ hostname }),
    }), 'Custom domain DNS discovery was queued.');
  };
  const reserveFallback = () => void run(
    () => agencyFetch(`/sites/${props.siteReference}/domains/fallback`, {
      method: 'POST',
      body: JSON.stringify({ fallbackDomain: 'sites.kasimshah.com' }),
    }),
    'Managed fallback hostname reserved.',
  );
  const quality = props.publication?.quality;
  const canPublish = quality?.status === 'READY'
    && ['READY', 'READY_WITH_WARNINGS'].includes(quality?.gateStatus);
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xs font-black uppercase tracking-widest text-cyan-300">Publishing and domains</h2><p className="mt-2 text-sm text-slate-400">One shared renderer, immutable snapshots, and an atomic live pointer. Provider operations run only through controlled jobs.</p></div>
      <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-black">{status(props.publication?.status)}</span>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg border border-rose-900 p-3 text-xs text-rose-200">{error}</p>}
    {message && <p role="status" className="mt-3 rounded-lg border border-emerald-900 p-3 text-xs text-emerald-200">{message}</p>}
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      <div className="rounded-xl bg-slate-950 p-4 text-xs"><strong>Quality gate</strong><p className="mt-2 text-slate-400">{status(quality?.gateStatus)}</p></div>
      <div className="rounded-xl bg-slate-950 p-4 text-xs"><strong>Live snapshot</strong><p className="mt-2 break-all text-slate-400">{props.publication?.pointer?.snapshotReference || 'None'}</p></div>
      <div className="rounded-xl bg-slate-950 p-4 text-xs"><strong>Pointer version</strong><p className="mt-2 text-slate-400">{props.publication?.pointer?.pointerVersion || '—'}</p></div>
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      <button disabled={busy || !canPublish} onClick={publish} className="rounded-xl border border-emerald-700 px-4 py-2 text-xs font-black text-emerald-300 disabled:opacity-40">Publish approved version</button>
      <button disabled={busy} onClick={reserveFallback} className="rounded-xl border border-cyan-700 px-4 py-2 text-xs font-black">Reserve fallback hostname</button>
      <button disabled={busy} onClick={addCustom} className="rounded-xl border border-cyan-700 px-4 py-2 text-xs font-black">Add custom domain</button>
    </div>
    <div className="mt-4 space-y-2">{props.publication?.domains?.map((domain: any) => <div key={domain.reference} className="flex flex-wrap justify-between gap-2 rounded-xl bg-slate-950 p-3 text-xs"><span className="font-bold">{domain.hostname}</span><span className="text-slate-400">{domain.type} · {status(domain.status)} · ownership {status(domain.ownershipStatus)} · SSL {status(domain.sslStatus)}</span></div>)}</div>
  </section>;
}
