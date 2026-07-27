import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { agencyFetch } from './AgencyAuth';

type Mode = 'OFFBOARD' | 'RESET' | 'DELETE';

type WorkspaceDataControlsProps = {
  tenantId: string;
  tenantName: string;
  lifecycleStatus: string;
  canManage: boolean;
  isPlatformOwner: boolean;
  onDeleted: () => void;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

const buttonBase = 'rounded-xl px-4 py-3 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-40';

function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return <li className={`flex items-start gap-2 text-xs ${met ? 'text-emerald-300' : 'text-slate-400'}`}>
    {met ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-slate-600" />}
    <span>{children}</span>
  </li>;
}

function CountGrid({ values }: { values?: Record<string, number> }) {
  if (!values) return null;
  return <dl className="grid gap-2 sm:grid-cols-2">
    {Object.entries(values).map(([key, value]) => <div key={key} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
      <dt className="text-[10px] font-black uppercase tracking-wide text-slate-500">{key.replaceAll(/([A-Z])/g, ' $1')}</dt>
      <dd className="mt-1 text-lg font-black text-white">{value}</dd>
    </div>)}
  </dl>;
}

export function WorkspaceDataControls({
  tenantId,
  tenantName,
  lifecycleStatus,
  canManage,
  isPlatformOwner,
  onDeleted,
  onRefresh,
  onNotice,
  onError,
}: WorkspaceDataControlsProps) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState('');

  const action = async (name: string, request: () => Promise<unknown>, success: string) => {
    setBusy(name);
    onError('');
    try {
      await request();
      onNotice(success);
      await onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'We could not complete this action. Try again.');
    } finally {
      setBusy('');
    }
  };

  return <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-xl shadow-slate-950/20 sm:p-6">
    <div className="border-b border-slate-800 pb-4">
      <h2 className="text-base font-black text-white">Workspace controls</h2>
      <p className="mt-1 max-w-[50ch] text-xs leading-5 text-slate-400">Pause access, clear test activity or remove the workspace. Each action explains what changes before you confirm it.</p>
    </div>

    <div className="grid gap-3 pt-5 sm:grid-cols-2">
      <button type="button" disabled={!canManage || Boolean(busy) || lifecycleStatus === 'SUSPENDED'} onClick={() => void action('suspend', () => agencyFetch(`/tenants/${tenantId}/suspend`, { method: 'POST', body: JSON.stringify({ reason: 'Workspace paused from client delivery.' }) }), 'Workspace paused.')} className={`${buttonBase} border border-amber-800 text-amber-200`}>
        {busy === 'suspend' ? 'Pausing…' : 'Pause workspace'}
      </button>
      <button type="button" disabled={!canManage || Boolean(busy) || lifecycleStatus !== 'SUSPENDED'} onClick={() => void action('reactivate', () => agencyFetch(`/tenants/${tenantId}/reactivate`, { method: 'POST', body: JSON.stringify({ reason: 'Workspace resumed from client delivery.' }) }), 'Workspace resumed.')} className={`${buttonBase} border border-emerald-800 text-emerald-200`}>
        {busy === 'reactivate' ? 'Resuming…' : 'Resume workspace'}
      </button>
      <button type="button" disabled={!canManage || Boolean(busy)} onClick={() => setMode('OFFBOARD')} className={`${buttonBase} border border-rose-900 text-rose-300`}>
        Start offboarding
      </button>
      {isPlatformOwner && <button type="button" disabled={Boolean(busy)} onClick={() => setMode('RESET')} className={`${buttonBase} inline-flex items-center justify-center gap-2 border border-violet-700 text-violet-200`}>
        <RotateCcw className="h-4 w-4" />Reset test data
      </button>}
      {isPlatformOwner && <button type="button" disabled={Boolean(busy)} onClick={() => setMode('DELETE')} className={`${buttonBase} inline-flex items-center justify-center gap-2 bg-rose-700 text-white sm:col-span-2`}>
        <Trash2 className="h-4 w-4" />Delete workspace
      </button>}
    </div>

    {mode && <WorkspaceActionDialog
      tenantId={tenantId}
      tenantName={tenantName}
      mode={mode}
      onClose={() => setMode(null)}
      onComplete={async deleted => {
        setMode(null);
        if (deleted) onDeleted();
        else await onRefresh();
      }}
      onNotice={onNotice}
    />}
  </section>;
}

function WorkspaceActionDialog({
  tenantId,
  tenantName,
  mode,
  onClose,
  onComplete,
  onNotice,
}: {
  tenantId: string;
  tenantName: string;
  mode: Mode;
  onClose: () => void;
  onComplete: (deleted: boolean) => void;
  onNotice: (message: string) => void;
}) {
  const [preview, setPreview] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [confirmationName, setConfirmationName] = useState('');
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isReset = mode === 'RESET';
  const isDelete = mode === 'DELETE';
  const title = isReset ? 'Reset test data' : isDelete ? 'Delete workspace' : 'Start offboarding';
  const phrase = isReset ? 'RESET TEST DATA' : isDelete ? 'DELETE NOW' : '';
  const endpoint = isReset ? 'test-data-preview' : 'hard-delete-preview';

  useEffect(() => {
    if (mode === 'OFFBOARD') return;
    setPreview(null);
    setError('');
    void agencyFetch(`/tenants/${tenantId}/${endpoint}`)
      .then(setPreview)
      .catch((cause: Error) => setError(cause.message));
  }, [endpoint, mode, tenantId]);

  const requirements = useMemo(() => ({
    reason: reason.trim().length >= 20,
    name: !isDelete || confirmationName.trim() === tenantName,
    phrase: mode === 'OFFBOARD' || confirmationPhrase.trim() === phrase,
    preview: mode === 'OFFBOARD' || Boolean(preview),
  }), [confirmationName, confirmationPhrase, isDelete, mode, phrase, preview, reason, tenantName]);
  const ready = Object.values(requirements).every(Boolean);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (mode === 'OFFBOARD') {
        await agencyFetch(`/tenants/${tenantId}/offboard`, {
          method: 'POST',
          body: JSON.stringify({ reason: reason.trim() }),
        });
        onNotice('Offboarding started.');
        onComplete(false);
        return;
      }
      if (isReset) {
        await agencyFetch(`/tenants/${tenantId}/reset-test-data`, {
          method: 'POST',
          body: JSON.stringify({ reason: reason.trim(), confirmationPhrase: confirmationPhrase.trim() }),
        });
        onNotice('Test data cleared. Your setup is unchanged.');
        onComplete(false);
        return;
      }
      await agencyFetch(`/tenants/${tenantId}/hard-delete`, {
        method: 'POST',
        body: JSON.stringify({
          reason: reason.trim(),
          confirmationName: confirmationName.trim(),
          confirmationPhrase: confirmationPhrase.trim(),
        }),
      });
      onNotice('Workspace deleted.');
      onComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not complete this action. Check the details and try again.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/85 p-4 backdrop-blur-sm">
    <section role="dialog" aria-modal="true" aria-labelledby="workspace-action-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="workspace-action-title" className="text-lg font-black text-white">{title}</h2>
          <p className="mt-1 max-w-[50ch] text-xs leading-5 text-slate-400">
            {isReset && 'Clear booking tests and their related activity. Keep the configured booking system and website.'}
            {isDelete && 'Permanently remove this workspace and every tenant-owned record. This cannot be undone.'}
            {mode === 'OFFBOARD' && 'End operational access while keeping records needed for finance, reporting and compliance.'}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs font-black text-slate-400 hover:text-white">Close</button>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-800 bg-rose-950/35 p-3 text-xs text-rose-200">{error}</p>}

      {mode !== 'OFFBOARD' && !preview ? <p className="mt-5 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Checking what this action will remove…</p> : <>
        {preview && <div className="mt-5 space-y-4">
          <div className={`rounded-xl border p-4 text-xs leading-5 ${isDelete ? 'border-rose-800 bg-rose-950/30 text-rose-200' : 'border-violet-800 bg-violet-950/30 text-violet-200'}`}>
            <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{isDelete ? preview.warning : 'The records below will return to zero. Services, staff, availability, booking settings and website content will stay in place.'}</p></div>
          </div>
          <CountGrid values={preview.removes} />
          {isReset && preview.keeps?.length > 0 && <div><h3 className="text-xs font-black text-white">What stays</h3><ul className="mt-2 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">{preview.keeps.map((item: string) => <li key={item}>• {item}</li>)}</ul></div>}
        </div>}

        {isDelete && <label className="mt-5 block text-xs font-bold text-slate-300">Workspace name
          <span className="mt-1 block font-normal text-slate-500">Type <strong className="text-slate-300">{tenantName}</strong> exactly.</span>
          <input value={confirmationName} onChange={event => setConfirmationName(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white" />
        </label>}

        {mode !== 'OFFBOARD' && <label className="mt-5 block text-xs font-bold text-slate-300">Confirmation phrase
          <span className="mt-1 block font-normal text-slate-500">Type <strong className="text-slate-300">{phrase}</strong> exactly.</span>
          <input value={confirmationPhrase} onChange={event => setConfirmationPhrase(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white" />
        </label>}

        <label className="mt-5 block text-xs font-bold text-slate-300">Reason
          <span className="mt-1 block font-normal text-slate-500">Explain why you are taking this action. Use at least 20 characters.</span>
          <textarea rows={3} minLength={20} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white" placeholder={isReset ? 'Example: Clear the bookings created during client acceptance testing.' : isDelete ? 'Example: Remove a duplicate workspace created during setup.' : 'Example: The client ended their service agreement.'} />
        </label>

        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-black text-white">Ready to continue?</h3><span className="text-[10px] font-black text-slate-500">{Object.values(requirements).filter(Boolean).length}/{Object.keys(requirements).length}</span></div>
          <ul className="mt-3 space-y-2">
            <Requirement met={requirements.preview}>Impact reviewed</Requirement>
            {isDelete && <Requirement met={requirements.name}>Workspace name matches</Requirement>}
            {mode !== 'OFFBOARD' && <Requirement met={requirements.phrase}>Confirmation phrase matches</Requirement>}
            <Requirement met={requirements.reason}>Reason has 20 characters</Requirement>
          </ul>
        </div>

        <button type="button" disabled={!ready || busy} onClick={() => void submit()} className="mt-5 w-full rounded-xl bg-rose-700 px-4 py-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? 'Working…' : title}
        </button>
      </>}
    </section>
  </div>;
}

export default WorkspaceDataControls;
