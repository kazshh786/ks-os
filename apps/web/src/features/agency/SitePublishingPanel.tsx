import React, { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { agencyFetch } from './AgencyAuth';

const status = (value: string) => String(value || 'NOT_STARTED').replaceAll('_', ' ');

export function SitePublishingPanel(props: {
  siteReference: string;
  publication: any;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const run = async (key: string, operation: () => Promise<unknown>, success: string) => {
    setBusy(key); setError(''); setMessage('');
    try {
      await operation();
      setMessage(success);
      await props.onChanged();
    } catch (caught: any) {
      setError(caught.message);
    } finally {
      setBusy('');
    }
  };
  const previewGeneratedSite = async () => {
    const previewWindow = window.open('about:blank', '_blank');
    if (previewWindow) previewWindow.opener = null;
    setBusy('preview'); setError(''); setMessage('');
    try {
      const preview = await agencyFetch(`/sites/${props.siteReference}/preview-link`, {
        method: 'POST',
        body: '{}',
      }) as {
        previewUrl: string;
        versionNumber: number;
        generationStatus: string | null;
      };
      if (previewWindow) previewWindow.location.href = preview.previewUrl;
      else window.location.assign(preview.previewUrl);
      setMessage(`Opened generated website version ${preview.versionNumber}. Previewing does not publish the site.`);
    } catch (caught: any) {
      previewWindow?.close();
      setError(caught.message || 'The generated website preview could not be opened.');
    } finally {
      setBusy('');
    }
  };
  const publish = () => {
    const quality = props.publication?.quality;
    if (!quality) return;
    void run('publish', () => agencyFetch(`/sites/${props.siteReference}/publications`, {
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
    void run('domain', () => agencyFetch(`/sites/${props.siteReference}/domains/custom`, {
      method: 'POST',
      body: JSON.stringify({ hostname }),
    }), 'Custom domain DNS discovery was queued.');
  };
  const reserveFallback = () => void run(
    'domain',
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
      <div><h2 className="text-xs font-black uppercase tracking-widest text-cyan-300">Preview, publishing and domains</h2><p className="mt-2 text-sm text-slate-400">Preview generated output immediately. Quality, review, payments and publication remain separate gates for going live.</p></div>
      <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-black">{status(props.publication?.status)}</span>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg border border-rose-900 p-3 text-xs text-rose-200">{error}</p>}
    {message && <p role="status" className="mt-3 rounded-lg border border-emerald-900 p-3 text-xs text-emerald-200">{message}</p>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-800 bg-cyan-950/25 p-4">
      <div><strong className="text-sm text-cyan-100">See the generated website now</strong><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">Opens the latest available secure rendered preview. This does not publish the site or require launch readiness.</p></div>
      <button type="button" disabled={Boolean(busy)} onClick={() => void previewGeneratedSite()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-600 px-4 text-xs font-black text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}{busy === 'preview' ? 'Opening preview…' : 'Preview generated site'}</button>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      <div className="rounded-xl bg-slate-950 p-4 text-xs"><strong>Quality gate</strong><p className="mt-2 text-slate-400">{status(quality?.gateStatus)}</p></div>
      <div className="rounded-xl bg-slate-950 p-4 text-xs"><strong>Live snapshot</strong><p className="mt-2 break-all text-slate-400">{props.publication?.pointer?.snapshotReference || 'None'}</p></div>
      <div className="rounded-xl bg-slate-950 p-4 text-xs"><strong>Pointer version</strong><p className="mt-2 text-slate-400">{props.publication?.pointer?.pointerVersion || '—'}</p></div>
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      <button disabled={Boolean(busy) || !canPublish} onClick={publish} className="rounded-xl border border-emerald-700 px-4 py-2 text-xs font-black text-emerald-300 disabled:opacity-40">{busy === 'publish' ? 'Publishing…' : 'Publish approved version'}</button>
      <button disabled={Boolean(busy)} onClick={reserveFallback} className="rounded-xl border border-cyan-700 px-4 py-2 text-xs font-black">Reserve fallback hostname</button>
      <button disabled={Boolean(busy)} onClick={addCustom} className="rounded-xl border border-cyan-700 px-4 py-2 text-xs font-black">Add custom domain</button>
    </div>
    <div className="mt-4 space-y-2">{props.publication?.domains?.map((domain: any) => <div key={domain.reference} className="flex flex-wrap justify-between gap-2 rounded-xl bg-slate-950 p-3 text-xs"><span className="font-bold">{domain.hostname}</span><span className="text-slate-400">{domain.type} · {status(domain.status)} · ownership {status(domain.ownershipStatus)} · SSL {status(domain.sslStatus)}</span></div>)}</div>
  </section>;
}
