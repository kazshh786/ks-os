import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  FileBadge,
  FileImage,
  FileText,
  Image as ImageIcon,
  Loader2,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { Link, useParams } from 'react-router';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';

const surface = 'rounded-3xl border border-slate-800/90 bg-slate-900/80 shadow-[0_24px_80px_rgba(2,6,23,0.2)]';
const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white transition hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-40';
const secondary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-black text-slate-200 transition hover:border-violet-500 disabled:cursor-not-allowed disabled:opacity-40';
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'application/pdf', 'text/plain']);

const categories = [
  { group: 'Brand', values: [['LOGO', 'Logo'], ['BRAND_GUIDE', 'Brand guidelines']] },
  { group: 'Photography', values: [['TEAM_PHOTO', 'Team'], ['LOCATION_PHOTO', 'Locations'], ['SERVICE_PHOTO', 'Services'], ['RESULT_PHOTO', 'Results']] },
  { group: 'Documents', values: [['CERTIFICATE', 'Certificates'], ['AWARD_EVIDENCE', 'Awards and accreditations'], ['POLICY_DOCUMENT', 'Policies'], ['PRICE_LIST', 'Price lists'], ['BROCHURE', 'Brochures'], ['WEBSITE_COPY', 'Website copy'], ['SERVICE_MENU', 'Service menus'], ['SUPPORTING_DOCUMENT', 'Supporting evidence']] },
] as const;

type Asset = {
  reference: string;
  category: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  provenance: string;
  publicUsePermission: boolean;
  aiUsePermission: boolean;
  copyrightConfirmed: boolean;
  uploadStatus: string;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  signedViewUrl: string | null;
  usage: { pageReferences: string[]; note: string };
};
type AssetPayload = {
  tenant: { reference: string; name: string };
  canUpload: boolean;
  assets: Asset[];
};

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
function categoryLabel(value: string) {
  for (const group of categories) for (const [key, label] of group.values) if (key === value) return label;
  return value.replaceAll('_', ' ').toLowerCase();
}
async function sha256(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function Permission({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black ${ok ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-200' : 'border-slate-700 bg-slate-950 text-slate-500'}`}>
    {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{label}
  </span>;
}

function AssetCard({ asset, tenantReference, canManage, onChanged }: { asset: Asset; tenantReference: string; canManage: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [publicUse, setPublicUse] = useState(asset.publicUsePermission);
  const [aiUse, setAiUse] = useState(asset.aiUsePermission);
  const [copyright, setCopyright] = useState(asset.copyrightConfirmed);
  const changed = publicUse !== asset.publicUsePermission || aiUse !== asset.aiUsePermission || copyright !== asset.copyrightConfirmed;
  const command = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key); setError('');
    try { await operation(); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The asset could not be updated.'); }
    finally { setBusy(''); }
  };
  return <article className={`${surface} overflow-hidden`}>
    <div className="aspect-[16/10] border-b border-slate-800 bg-slate-950">
      {asset.mimeType.startsWith('image/') && asset.signedViewUrl
        ? <img src={asset.signedViewUrl} alt="" className="h-full w-full object-cover" />
        : <div className="grid h-full place-items-center text-slate-600">{asset.mimeType === 'application/pdf' ? <FileText className="h-12 w-12" /> : <FileBadge className="h-12 w-12" />}</div>}
    </div>
    <div className="space-y-4 p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-violet-700/50 bg-violet-950/30 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-violet-200">{categoryLabel(asset.category)}</span>
          <span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${asset.reviewStatus === 'APPROVED' ? 'border-emerald-700 bg-emerald-950/30 text-emerald-200' : asset.reviewStatus === 'REJECTED' ? 'border-rose-700 bg-rose-950/30 text-rose-200' : 'border-amber-700 bg-amber-950/30 text-amber-200'}`}>{asset.reviewStatus === 'PENDING' ? 'Needs review' : asset.reviewStatus.toLowerCase()}</span>
        </div>
        <h3 className="mt-3 truncate font-black text-white" title={asset.fileName}>{asset.fileName}</h3>
        <p className="mt-1 text-xs text-slate-500">{bytes(asset.byteSize)} · {asset.provenance.replaceAll('_', ' ').toLowerCase()}</p>
      </div>
      <div className="flex flex-wrap gap-2"><Permission ok={copyright} label="Copyright confirmed" /><Permission ok={publicUse} label="Public website use" /><Permission ok={aiUse} label="AI use" /></div>
      {canManage ? <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Permissions</p>
        <div className="mt-3 space-y-2 text-xs font-bold text-slate-300">
          <label className="flex items-center gap-2"><input type="checkbox" checked={copyright} onChange={event => setCopyright(event.target.checked)} />Copyright / usage rights confirmed</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={publicUse} onChange={event => setPublicUse(event.target.checked)} />May appear on the public website</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={aiUse} onChange={event => setAiUse(event.target.checked)} />May be used as AI design/generation input</label>
        </div>
        {changed ? <button type="button" disabled={!copyright || Boolean(busy)} className={`${secondary} mt-3`} onClick={() => void command('permissions', () => agencyFetch(`/tenants/${tenantReference}/assets/${asset.reference}/permissions`, { method: 'PATCH', body: JSON.stringify({ publicUsePermission: publicUse, aiUsePermission: aiUse, copyrightConfirmed: copyright, consentStatus: publicUse ? 'CONFIRMED' : 'NOT_APPLICABLE' }) }))}>{busy === 'permissions' ? 'Saving…' : 'Save permissions'}</button> : null}
        <p className="mt-2 text-[11px] leading-5 text-slate-600">Changing permissions returns the asset to agency review.</p>
      </div> : null}
      <div><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Website usage</p><p className="mt-1 text-xs leading-5 text-slate-500">{asset.usage.pageReferences.length ? `Used on ${asset.usage.pageReferences.length} page${asset.usage.pageReferences.length === 1 ? '' : 's'}.` : asset.usage.note}</p></div>
      {error ? <p role="alert" className="text-xs font-bold text-rose-300">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {canManage && asset.uploadStatus === 'UPLOADED' && asset.reviewStatus !== 'APPROVED' ? <button type="button" disabled={Boolean(busy) || !copyright} className={primary} onClick={() => void command('approve', () => agencyFetch(`/fact-finding/uploads/${asset.reference}/review`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED' }) }))}>{busy === 'approve' ? 'Approving…' : 'Approve asset'}</button> : null}
        {canManage && asset.uploadStatus === 'UPLOADED' && asset.reviewStatus !== 'REJECTED' ? <button type="button" disabled={Boolean(busy)} className={secondary} onClick={() => void command('reject', () => agencyFetch(`/fact-finding/uploads/${asset.reference}/review`, { method: 'POST', body: JSON.stringify({ decision: 'REJECTED' }) }))}>{busy === 'reject' ? 'Rejecting…' : 'Reject'}</button> : null}
      </div>
    </div>
  </article>;
}

export default function AgencyClientAssetLibraryPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { session } = useAgencyAuth();
  const canManage = Boolean(session?.capabilities.includes('fact_finding.manage'));
  const [data, setData] = useState<AssetPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('LOGO');
  const [publicUse, setPublicUse] = useState(true);
  const [aiUse, setAiUse] = useState(false);
  const [copyright, setCopyright] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true); setError('');
    try {
      const detail = await agencyFetch(`/tenants/${tenantId}`);
      setData(await agencyFetch(`/tenants/${detail.tenant.agencyReference}/assets`));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Brand and assets could not be loaded.'); }
    finally { setLoading(false); }
  }, [tenantId]);
  useEffect(() => { void load(); }, [load]);

  const chooseFile = (candidate?: File | null) => {
    setNotice(''); setError('');
    if (!candidate) { setFile(null); return; }
    if (!acceptedMimeTypes.has(candidate.type)) { setFile(null); setError('Choose a JPG, PNG, WebP, AVIF, PDF or plain-text file.'); return; }
    if (candidate.size > 20 * 1024 * 1024) { setFile(null); setError('Assets must be smaller than 20 MB.'); return; }
    setFile(candidate);
  };
  const grouped = useMemo(() => categories.map(group => ({ ...group, assets: data?.assets.filter(asset => group.values.some(([key]) => key === asset.category)) ?? [] })), [data?.assets]);
  const upload = async () => {
    if (!data || !file || !copyright) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const digestSha256 = await sha256(file);
      const initiated = await agencyFetch(`/tenants/${data.tenant.reference}/assets`, { method: 'POST', body: JSON.stringify({ fileName: file.name, mimeType: file.type, byteSize: file.size, digestSha256, category, publicUsePermission: publicUse, aiUsePermission: aiUse, copyrightConfirmed: true, consentStatus: publicUse ? 'CONFIRMED' : 'NOT_APPLICABLE' }) });
      const uploaded = await fetch(initiated.signedUploadUrl, { method: 'PUT', headers: { 'content-type': file.type, 'x-upsert': 'false' }, body: file });
      if (!uploaded.ok) throw new Error('The private file upload did not complete.');
      await agencyFetch(`/tenants/${data.tenant.reference}/assets/${initiated.reference}/complete`, { method: 'POST', body: '{}' });
      setFile(null); setCopyright(false); setNotice('Asset uploaded privately. Review its permissions, then approve it before website use.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The asset could not be uploaded.'); }
    finally { setBusy(false); }
  };

  if (loading && !data) return <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin" />Loading brand and assets…</div>;
  if (!tenantId) return null;
  return <div className="space-y-6">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Client workspace</p><h1 className="mt-2 text-3xl font-black text-white">Brand and assets{data ? ` · ${data.tenant.name}` : ''}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Keep logos, photography and evidence in one governed library. Uploading a file does not approve it for website use.</p></div><Link to={`/agency/tenants/${tenantId}/onboarding`} className={secondary}>Back to launch</Link></header>
    {error ? <div role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/30 p-4 text-sm text-rose-200">{error}</div> : null}
    {notice ? <div className="rounded-2xl border border-emerald-800 bg-emerald-950/20 p-4 text-sm text-emerald-200">{notice}</div> : null}
    {data && !data.canUpload ? <div className="rounded-2xl border border-amber-800 bg-amber-950/20 p-5"><h2 className="font-black text-amber-100">Start Discovery first</h2><p className="mt-2 text-sm leading-6 text-amber-100/70">Assets remain tied to the client’s governed discovery record, so create Discovery before adding files here.</p><Link to={`/agency/tenants/${tenantId}/onboarding`} className={`${primary} mt-4`}>Continue launch</Link></div> : null}
    {data && data.canUpload && canManage ? <section className={`${surface} p-5 sm:p-6`}>
      <div className="flex items-start gap-3"><UploadCloud className="mt-1 h-6 w-6 text-violet-300" /><div><h2 className="text-xl font-black text-white">Add an asset</h2><p className="mt-1 text-sm text-slate-500">Files are verified and stored privately until agency review.</p></div></div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <label
          onDragEnter={event => { event.preventDefault(); setDragging(true); }}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
          onDragLeave={event => { event.preventDefault(); if (event.currentTarget === event.target) setDragging(false); }}
          onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files?.[0]); }}
          className={`rounded-2xl border-2 border-dashed p-6 text-center text-sm transition ${dragging ? 'border-violet-400 bg-violet-950/30 text-violet-100' : 'border-slate-700 bg-slate-950/60 text-slate-400 hover:border-violet-600'}`}
        >
          <FileImage className="mx-auto h-8 w-8 text-violet-300" /><span className="mt-3 block font-black text-white">{file ? file.name : dragging ? 'Drop the file here' : 'Drag and drop or choose a file'}</span><span className="mt-1 block text-xs">JPG, PNG, WebP, AVIF, PDF or text · max 20 MB</span>
          <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,image/avif,application/pdf,text/plain" onChange={event => chooseFile(event.target.files?.[0])} />
        </label>
        <div className="space-y-3">
          <label className="block text-xs font-bold text-slate-400">Asset type<select value={category} onChange={event => setCategory(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">{categories.map(group => <optgroup key={group.group} label={group.group}>{group.values.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</optgroup>)}</select></label>
          <label className="flex items-start gap-2 text-xs font-bold text-slate-300"><input className="mt-0.5" type="checkbox" checked={copyright} onChange={event => setCopyright(event.target.checked)} /><span>I confirm the client or agency has the rights needed to store and use this file.</span></label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-300"><input type="checkbox" checked={publicUse} onChange={event => setPublicUse(event.target.checked)} />Allow public website use</label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-300"><input type="checkbox" checked={aiUse} onChange={event => setAiUse(event.target.checked)} />Allow as AI design/generation input</label>
          <button type="button" className={primary} disabled={!file || !copyright || busy} onClick={() => void upload()}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" />Uploading…</> : <><UploadCloud className="h-4 w-4" />Upload privately</>}</button>
        </div>
      </div>
    </section> : null}
    {data ? <div className="space-y-8">{grouped.map(group => <section key={group.group}>
      <div className="mb-3 flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl border border-slate-800 bg-slate-900 text-violet-300">{group.group === 'Brand' ? <ShieldCheck className="h-4 w-4" /> : group.group === 'Photography' ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</div><div><h2 className="font-black text-white">{group.group}</h2><p className="text-xs text-slate-500">{group.assets.length} asset{group.assets.length === 1 ? '' : 's'}</p></div></div>
      {group.assets.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{group.assets.map(asset => <AssetCard key={asset.reference} asset={asset} tenantReference={data.tenant.reference} canManage={canManage} onChanged={load} />)}</div> : <div className="rounded-2xl border border-dashed border-slate-800 p-6 text-sm text-slate-600">No {group.group.toLowerCase()} assets yet.</div>}
    </section>)}</div> : null}
  </div>;
}
