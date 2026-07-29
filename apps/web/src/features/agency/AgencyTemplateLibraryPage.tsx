import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronRight,
  FileArchive,
  FileCheck2,
  FileImage,
  FileText,
  Filter,
  LayoutTemplate,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import type {
  TemplateImportAssetKind,
  TemplateImportSummary,
  TemplateImportUploadTarget,
} from '@ks-os/contracts';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';

interface TemplateImportDetail extends TemplateImportSummary {
  analysis?: {
    reference: string;
    status: string;
    files: Array<{ reference: string; relativePath: string; category: string; byteSize: number; requiresAgencyReview: boolean }>;
    layouts: Array<{
      reference: string;
      name: string;
      sourceFile: string | null;
      detectedPageType: string;
      recommendedPageType: string | null;
      classificationConfidence: number;
      requiresAgencyReview: boolean;
    }>;
    findings: Array<{
      reference: string;
      severity: string;
      category: string;
      code: string;
      filePath: string | null;
      message: string;
      resolvedAt: string | null;
    }>;
  } | null;
}

const statusStyles: Record<string, string> = {
  AWAITING_UPLOAD: 'border-sky-800 bg-sky-950/50 text-sky-200',
  VERIFYING: 'border-cyan-800 bg-cyan-950/50 text-cyan-200',
  ANALYSING: 'border-violet-800 bg-violet-950/50 text-violet-200',
  REVIEW_REQUIRED: 'border-amber-800 bg-amber-950/50 text-amber-200',
  READY_FOR_APPROVAL: 'border-emerald-800 bg-emerald-950/50 text-emerald-200',
  APPROVED: 'border-emerald-700 bg-emerald-900/60 text-emerald-100',
  FAILED: 'border-rose-800 bg-rose-950/50 text-rose-200',
};

const readableStatus = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
const formatBytes = (value: number) => value < 1024 * 1024
  ? `${Math.max(1, Math.round(value / 1024))} KB`
  : `${(value / (1024 * 1024)).toFixed(1)} MB`;

async function fileDigest(file: File) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function asset(file: File) {
  return {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    byteSize: file.size,
    digestSha256: await fileDigest(file),
  };
}

function FilePicker({
  label,
  description,
  accept,
  file,
  required,
  icon: Icon,
  onChange,
}: {
  label: string;
  description: string;
  accept: string;
  file: File | null;
  required?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  onChange: (file: File | null) => void;
}) {
  return <label className={`group block cursor-pointer rounded-2xl border border-dashed p-4 transition ${file ? 'border-violet-500 bg-violet-950/30' : 'border-slate-700 bg-slate-950/50 hover:border-violet-600 hover:bg-violet-950/20'}`}>
    <input type="file" accept={accept} required={required} className="sr-only" onChange={event => onChange(event.target.files?.[0] || null)} />
    <span className="flex items-start gap-3">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${file ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300 group-hover:text-violet-200'}`}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-3"><span className="text-sm font-black text-white">{label}{required ? <span className="ml-1 text-rose-400">*</span> : null}</span>{file ? <span className="text-[10px] font-black uppercase tracking-wide text-violet-300">Selected</span> : null}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-400">{file ? `${file.name} · ${formatBytes(file.size)}` : description}</span>
      </span>
    </span>
  </label>;
}

export default function AgencyTemplateLibraryPage() {
  const { session } = useAgencyAuth();
  const canManage = session?.capabilities.includes('sites.templates.manage') ?? false;
  const [rows, setRows] = useState<TemplateImportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detail, setDetail] = useState<TemplateImportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await agencyFetch('/site-template-imports'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The template library could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter(item => {
    const matchesStatus = status === 'ALL' || item.importStatus === status;
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || `${item.name} ${item.industryTags.join(' ')} ${item.archiveFileName}`.toLowerCase().includes(needle);
    return matchesStatus && matchesQuery;
  }), [query, rows, status]);

  const metrics = useMemo(() => ({
    total: rows.length,
    reviewing: rows.filter(item => item.importStatus === 'REVIEW_REQUIRED').length,
    ready: rows.filter(item => ['READY_FOR_APPROVAL', 'APPROVED'].includes(item.importStatus)).length,
    layouts: rows.reduce((total, item) => total + item.layoutCount, 0),
  }), [rows]);

  const openDetail = async (item: TemplateImportSummary) => {
    setDetailLoading(true);
    setError('');
    try {
      setDetail(await agencyFetch(`/site-template-imports/${item.versionReference}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Template details could not be loaded.');
    } finally {
      setDetailLoading(false);
    }
  };

  return <div className="space-y-6">
    <section className="overflow-hidden rounded-[28px] border border-slate-800 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.22),transparent_42%),linear-gradient(145deg,#111827,#020617)] p-6 shadow-2xl sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-violet-300"><Sparkles className="h-4 w-4" />Template intelligence</div>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">Your organised design library</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Upload an Envato ZIP once. KS OS verifies it privately, inventories every file, detects page layouts and surfaces anything that needs human review.</p>
        </div>
        {canManage ? <button type="button" onClick={() => setWizardOpen(true)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 text-sm font-black text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-500"><Plus className="h-5 w-5" />Import template</button> : null}
      </div>
      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Templates', metrics.total, Archive],
          ['Needs review', metrics.reviewing, AlertTriangle],
          ['Ready to use', metrics.ready, CheckCircle2],
          ['Layouts detected', metrics.layouts, LayoutTemplate],
        ].map(([label, value, Icon]) => <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur"><div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-400">{String(label)}</span><Icon className="h-4 w-4 text-violet-300" /></div><p className="mt-2 text-2xl font-black text-white">{String(value)}</p></div>)}
      </div>
    </section>

    {error ? <p role="alert" className="rounded-2xl border border-rose-900 bg-rose-950/40 p-4 text-sm font-bold text-rose-200">{error}</p> : null}

    <section className="rounded-[28px] border border-slate-800 bg-slate-900/70 shadow-xl">
      <div className="flex flex-col gap-3 border-b border-slate-800 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="relative flex-1 sm:max-w-md"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search templates or industries" className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-4 text-sm text-white outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-950" /></div>
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-bold text-slate-300"><Filter className="h-4 w-4" /><select value={status} onChange={event => setStatus(event.target.value)} className="bg-transparent outline-none"><option value="ALL">All statuses</option><option value="REVIEW_REQUIRED">Needs review</option><option value="READY_FOR_APPROVAL">Ready for approval</option><option value="APPROVED">Approved</option><option value="FAILED">Failed</option></select></label>
      </div>

      {loading ? <div className="grid min-h-64 place-items-center"><div className="flex items-center gap-3 text-sm font-bold text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-violet-400" />Loading template library…</div></div> : filtered.length === 0 ? <div className="grid min-h-64 place-items-center p-8 text-center"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-800 text-slate-400"><FileArchive className="h-7 w-7" /></div><h2 className="mt-4 text-lg font-black text-white">{rows.length ? 'No templates match these filters' : 'Import your first template'}</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-400">{rows.length ? 'Try another search or status.' : 'Upload the Envato ZIP and KS OS will organise the package into layouts, files and findings.'}</p>{!rows.length && canManage ? <button type="button" onClick={() => setWizardOpen(true)} className="mt-5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-black text-white">Import template</button> : null}</div></div> : <div className="grid gap-4 p-4 md:grid-cols-2 2xl:grid-cols-3 sm:p-5">{filtered.map(item => <article key={item.importReference} className="group overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/80 transition hover:border-violet-700 hover:shadow-xl hover:shadow-violet-950/20">
        <div className="relative grid h-36 place-items-center overflow-hidden border-b border-slate-800 bg-[radial-gradient(circle_at_20%_10%,rgba(139,92,246,0.38),transparent_34%),radial-gradient(circle_at_80%_90%,rgba(14,165,233,0.22),transparent_34%),#0f172a]"><LayoutTemplate className="h-12 w-12 text-white/70" /><span className="absolute left-4 top-4 rounded-full border border-white/15 bg-slate-950/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-200 backdrop-blur">Envato HTML</span>{item.previewAvailable ? <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-slate-950/70 px-2.5 py-1 text-[10px] font-bold text-slate-300"><FileImage className="h-3 w-3" />Preview supplied</span> : null}</div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-lg font-black text-white">{item.name}</h2><p className="mt-1 truncate text-xs text-slate-500">{item.archiveFileName}</p></div><span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusStyles[item.importStatus] || 'border-slate-700 bg-slate-800 text-slate-300'}`}>{readableStatus(item.importStatus)}</span></div>
          <div className="mt-4 flex flex-wrap gap-1.5">{item.industryTags.slice(0, 4).map(tag => <span key={tag} className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-bold text-slate-300">{tag}</span>)}</div>
          <div className="mt-5 grid grid-cols-3 divide-x divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70 py-3 text-center"><div><p className="text-lg font-black text-white">{item.fileCount}</p><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Files</p></div><div><p className="text-lg font-black text-white">{item.layoutCount}</p><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Layouts</p></div><div><p className={`text-lg font-black ${item.blockingFindingCount ? 'text-amber-300' : 'text-white'}`}>{item.findingCount}</p><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Findings</p></div></div>
          {item.failureCode ? <p className="mt-4 rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-xs font-bold text-rose-200">{item.failureCode.replaceAll('_', ' ')}</p> : null}
          <button type="button" onClick={() => void openDetail(item)} className="mt-4 flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-700 px-3 text-sm font-black text-slate-200 transition hover:border-violet-600 hover:bg-violet-950/30"><span>{item.layoutCount ? 'Review analysis' : 'View import'}</span>{detailLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}</button>
        </div>
      </article>)}</div>}
    </section>

    {wizardOpen ? <TemplateImportWizard onClose={() => setWizardOpen(false)} onImported={async () => { setWizardOpen(false); await load(); }} /> : null}
    {detail ? <TemplateDetailPanel detail={detail} onClose={() => setDetail(null)} /> : null}
  </div>;
}

function TemplateImportWizard({ onClose, onImported }: { onClose: () => void; onImported: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [envatoItemUrl, setEnvatoItemUrl] = useState('');
  const [industryTags, setIndustryTags] = useState('');
  const [agencyNotes, setAgencyNotes] = useState('');
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [licenceFile, setLicenceFile] = useState<File | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!archiveFile) { setError('Choose the Envato ZIP file.'); return; }
    setBusy(true); setError('');
    try {
      setProgress('Checking file fingerprints…');
      const [sourceArchive, licenceEvidence, previewImage] = await Promise.all([
        asset(archiveFile),
        licenceFile ? asset(licenceFile) : Promise.resolve(undefined),
        previewFile ? asset(previewFile) : Promise.resolve(undefined),
      ]);
      setProgress('Creating the private import…');
      const initiated: { versionReference: string; uploads: TemplateImportUploadTarget[] } = await agencyFetch('/site-template-imports', {
        method: 'POST',
        body: JSON.stringify({
          name,
          ...(envatoItemUrl.trim() ? { envatoItemUrl: envatoItemUrl.trim() } : {}),
          industryTags: industryTags.split(',').map(tag => tag.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean),
          ...(agencyNotes.trim() ? { agencyNotes: agencyNotes.trim() } : {}),
          sourceArchive,
          ...(licenceEvidence ? { licenceEvidence } : {}),
          ...(previewImage ? { previewImage } : {}),
        }),
      });
      const filesByKind: Partial<Record<TemplateImportAssetKind, File>> = {
        SOURCE_ARCHIVE: archiveFile,
        ...(licenceFile ? { LICENCE_EVIDENCE: licenceFile } : {}),
        ...(previewFile ? { PREVIEW_IMAGE: previewFile } : {}),
      };
      for (const [index, target] of initiated.uploads.entries()) {
        const file = filesByKind[target.kind];
        if (!file) throw new Error(`The ${target.kind.toLowerCase().replaceAll('_', ' ')} file is missing.`);
        setProgress(`Uploading ${target.fileName} (${index + 1} of ${initiated.uploads.length})…`);
        const transferred = await fetch(target.signedUploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
        if (!transferred.ok) throw new Error(`${target.fileName} could not be transferred to private storage.`);
      }
      setProgress('Verifying and organising the template…');
      await agencyFetch(`/site-template-imports/${initiated.versionReference}/complete`, { method: 'POST', body: '{}' });
      setProgress('Template organised successfully.');
      await onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The template import could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm sm:p-8" role="dialog" aria-modal="true" aria-labelledby="template-import-title">
    <form onSubmit={submit} className="my-auto w-full max-w-3xl overflow-hidden rounded-[30px] border border-slate-700 bg-slate-900 shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-slate-800 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.22),transparent_45%),#0f172a] p-6 sm:p-7"><div><div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-violet-300"><UploadCloud className="h-4 w-4" />Private import</div><h2 id="template-import-title" className="mt-2 text-2xl font-black text-white">Import an Envato template</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">The original files stay private. KS OS verifies the package and analyses HTML and CSS without executing scripts.</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close import" className="rounded-xl border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40"><X className="h-5 w-5" /></button></header>
      <div className="space-y-6 p-6 sm:p-7">
        {error ? <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-3 text-sm font-bold text-rose-200">{error}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-slate-200">Template name<input required value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Belleza Beauty Salon" className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-950" /></label><label className="text-sm font-bold text-slate-200">Envato item URL <span className="font-normal text-slate-500">Optional</span><input type="url" value={envatoItemUrl} onChange={event => setEnvatoItemUrl(event.target.value)} placeholder="https://themeforest.net/item/…" className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-950" /></label></div>
        <label className="block text-sm font-bold text-slate-200">Industry tags <span className="font-normal text-slate-500">Comma-separated</span><input value={industryTags} onChange={event => setIndustryTags(event.target.value)} placeholder="beauty, salon, spa" className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-950" /></label>
        <div className="grid gap-3"><FilePicker label="Envato source ZIP" description="Required · Maximum 100 MB" accept=".zip,application/zip,application/x-zip-compressed" file={archiveFile} required icon={FileArchive} onChange={setArchiveFile} /><div className="grid gap-3 sm:grid-cols-2"><FilePicker label="Licence evidence" description="Optional · PDF or TXT" accept=".pdf,.txt,application/pdf,text/plain" file={licenceFile} icon={FileText} onChange={setLicenceFile} /><FilePicker label="Preview image" description="Optional · JPG, PNG or WebP" accept="image/jpeg,image/png,image/webp" file={previewFile} icon={FileImage} onChange={setPreviewFile} /></div></div>
        <label className="block text-sm font-bold text-slate-200">Internal notes <span className="font-normal text-slate-500">Optional</span><textarea value={agencyNotes} onChange={event => setAgencyNotes(event.target.value)} rows={3} placeholder="Why this template was selected, intended sectors or conversion notes" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-950" /></label>
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-900/70 bg-emerald-950/20 p-4"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" /><div><p className="text-sm font-black text-emerald-100">Safe import boundary</p><p className="mt-1 text-xs leading-5 text-emerald-100/70">Paths, file counts, extracted sizes, fingerprints and file signatures are checked. JavaScript, PHP and build tools are inventoried but never executed.</p></div></div>
      </div>
      <footer className="flex flex-col-reverse gap-3 border-t border-slate-800 bg-slate-950/60 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-7"><p aria-live="polite" className="min-h-5 text-xs font-bold text-violet-300">{progress}</p><div className="flex gap-2"><button type="button" onClick={onClose} disabled={busy} className="min-h-11 rounded-xl border border-slate-700 px-4 text-sm font-black text-slate-300 disabled:opacity-40">Cancel</button><button type="submit" disabled={busy || !archiveFile || !name.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-black text-white shadow-lg shadow-violet-950/40 disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}{busy ? 'Importing…' : 'Upload and organise'}</button></div></footer>
    </form>
  </div>;
}

function TemplateDetailPanel({ detail, onClose }: { detail: TemplateImportDetail; onClose: () => void }) {
  const analysis = detail.analysis;
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/75 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="template-detail-title"><div className="h-full w-full max-w-2xl overflow-y-auto border-l border-slate-700 bg-slate-900 shadow-2xl"><header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900/95 p-6 backdrop-blur"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-300">Template analysis</p><h2 id="template-detail-title" className="mt-2 text-2xl font-black text-white">{detail.name}</h2><div className="mt-3 flex flex-wrap gap-2"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusStyles[detail.importStatus] || 'border-slate-700 bg-slate-800 text-slate-300'}`}>{readableStatus(detail.importStatus)}</span>{detail.licenceEvidenceAvailable ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-900 bg-emerald-950/40 px-2.5 py-1 text-[10px] font-bold text-emerald-200"><FileCheck2 className="h-3 w-3" />Licence supplied</span> : null}</div></div><button type="button" onClick={onClose} aria-label="Close template details" className="rounded-xl border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button></header>
    <div className="space-y-6 p-6">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Files', detail.fileCount], ['Layouts', detail.layoutCount], ['Findings', detail.findingCount], ['Blocking', detail.blockingFindingCount]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"><p className="text-xs font-bold text-slate-500">{String(label)}</p><p className={`mt-1 text-2xl font-black ${label === 'Blocking' && Number(value) ? 'text-amber-300' : 'text-white'}`}>{String(value)}</p></div>)}</section>
      <section><div className="flex items-center justify-between"><div><h3 className="text-lg font-black text-white">Detected layouts</h3><p className="mt-1 text-xs text-slate-500">Recommended page roles remain subject to agency approval.</p></div><LayoutTemplate className="h-5 w-5 text-violet-400" /></div><div className="mt-4 space-y-3">{analysis?.layouts.length ? analysis.layouts.map(layout => <article key={layout.reference} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate font-black text-white">{layout.name}</h4><p className="mt-1 truncate text-xs text-slate-500">{layout.sourceFile || 'Source file unavailable'}</p></div><span className="rounded-full bg-violet-950 px-2.5 py-1 text-[10px] font-black text-violet-200">{Math.round(layout.classificationConfidence * 100)}% confidence</span></div><div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-lg border border-slate-700 px-2.5 py-1 text-slate-300">Detected: {readableStatus(layout.detectedPageType)}</span><span className="rounded-lg border border-violet-800 bg-violet-950/30 px-2.5 py-1 font-bold text-violet-200">Recommended: {layout.recommendedPageType ? readableStatus(layout.recommendedPageType) : 'Needs review'}</span></div></article>) : <p className="rounded-2xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">No inspectable HTML layouts were detected.</p>}</div></section>
      <section><div className="flex items-center justify-between"><div><h3 className="text-lg font-black text-white">Review findings</h3><p className="mt-1 text-xs text-slate-500">Blocking items must be resolved before approval.</p></div><AlertTriangle className="h-5 w-5 text-amber-400" /></div><div className="mt-4 space-y-3">{analysis?.findings.length ? analysis.findings.map(finding => <article key={finding.reference} className={`rounded-2xl border p-4 ${finding.severity === 'BLOCKING' ? 'border-amber-900 bg-amber-950/20' : 'border-slate-800 bg-slate-950/60'}`}><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${finding.severity === 'BLOCKING' ? 'bg-amber-900 text-amber-100' : 'bg-slate-800 text-slate-300'}`}>{finding.severity}</span><span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{finding.category}</span>{finding.resolvedAt ? <span className="ml-auto text-[10px] font-black uppercase text-emerald-400">Resolved</span> : null}</div><h4 className="mt-3 text-sm font-black text-white">{finding.code.replaceAll('_', ' ')}</h4><p className="mt-1 text-xs leading-5 text-slate-400">{finding.message}</p>{finding.filePath ? <p className="mt-2 truncate font-mono text-[10px] text-slate-600">{finding.filePath}</p> : null}</article>) : <div className="flex items-center gap-3 rounded-2xl border border-emerald-900 bg-emerald-950/20 p-4 text-sm font-bold text-emerald-200"><CheckCircle2 className="h-5 w-5" />No findings were reported.</div>}</div></section>
    </div></div></div>;
}
