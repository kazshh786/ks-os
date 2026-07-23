import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { agencyFetch } from './AgencyAuth';

interface SupportSessionDialogProps {
  open: boolean;
  tenantId: string;
  tenantName: string;
  onClose: () => void;
}

export const SupportSessionDialog: React.FC<SupportSessionDialogProps> = ({ open, tenantId, tenantName, onClose }) => {
  const [reason, setReason] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [scope, setScope] = useState<'READ_ONLY' | 'STANDARD_SUPPORT'>('STANDARD_SUPPORT');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [busy, onClose, open]);
  if (!open) return null;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 12) { setError('Enter a specific reason of at least 12 characters for the audit log.'); return; }
    setBusy(true); setError('');
    try {
      const result = await agencyFetch('/support-sessions', { method: 'POST', body: JSON.stringify({ tenantId, reason: reason.trim(), durationMinutes, scope }) });
      sessionStorage.setItem('ks-os-support-session', result.token);
      sessionStorage.setItem('ks-os-support-metadata', JSON.stringify({ tenantId, tenantName, reason: result.reason, expiresAt: result.expiresAt }));
      window.location.assign('/app/calendar?support=1');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Support access could not be started.'); setBusy(false); }
  };
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="support-session-title">
    <form onSubmit={submit} className="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-6 text-white shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div className="flex gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-400 text-slate-950"><ShieldCheck aria-hidden="true" className="h-5 w-5" /></span><div><h2 id="support-session-title" className="text-xl font-black">Open support workspace</h2><p className="mt-1 text-sm text-slate-400">You are requesting audited access to {tenantName}.</p></div></div><button ref={closeButtonRef} type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"><X aria-hidden="true" className="h-5 w-5" /></button></div>
      <div className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">Changes affect the live business workspace. High-risk financial, team, integration and agency actions remain blocked by the server.</div>
      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-200">{error}</p>}
      <label className="mt-4 block text-xs font-bold text-slate-300">Reason for access<textarea autoFocus value={reason} onChange={event => setReason(event.target.value)} required minLength={12} maxLength={500} rows={4} placeholder="Describe the customer issue and intended investigation" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white" /></label>
      <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-slate-300">Access level<select value={scope} onChange={event => setScope(event.target.value as typeof scope)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white"><option value="READ_ONLY">Read only</option><option value="STANDARD_SUPPORT">Standard support</option></select></label><label className="text-xs font-bold text-slate-300">Expires after<select value={durationMinutes} onChange={event => setDurationMinutes(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white"><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></select></label></div>
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-bold text-slate-300">Cancel</button><button disabled={busy} className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-black text-slate-950 disabled:opacity-50">{busy ? 'Opening…' : 'Confirm and open workspace'}</button></div>
    </form>
  </div>;
};
