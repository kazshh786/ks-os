import React, { useEffect, useState } from 'react';
import { Check, Copy, UserPlus } from 'lucide-react';
import { agencyFetch } from './AgencyAuth';

type ManualUserResult = {
  id: string;
  email: string;
  displayName: string;
  role: 'owner' | 'staff';
  status: string;
  bookingEnabled: boolean;
  identityMode: 'NEW_IDENTITY' | 'EXISTING_IDENTITY';
  temporaryPassword: string | null;
};

export const ManualTenantUserDialog: React.FC<{
  open: boolean;
  tenantId: string;
  tenantName: string;
  onClose: () => void;
}> = ({ open, tenantId, tenantName, onClose }) => {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'staff'>('staff');
  const [bookingEnabled, setBookingEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ManualUserResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDisplayName('');
    setEmail('');
    setRole('staff');
    setBookingEnabled(false);
    setBusy(false);
    setError('');
    setResult(null);
    setCopied(false);
  }, [open]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const created = await agencyFetch(`/tenants/${tenantId}/users`, {
        method: 'POST',
        body: JSON.stringify({
          displayName: displayName.trim(),
          email: email.trim(),
          role,
          bookingEnabled: role === 'staff' && bookingEnabled,
        }),
      });
      setResult(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The user could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const copyPassword = async () => {
    if (!result?.temporaryPassword) return;
    await navigator.clipboard.writeText(result.temporaryPassword);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };

  const finish = () => {
    onClose();
    window.location.reload();
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
    <section role="dialog" aria-modal="true" aria-labelledby="manual-user-title" className="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="manual-user-title" className="flex items-center gap-2 text-xl font-black"><UserPlus className="h-5 w-5 text-violet-300" aria-hidden="true" />Add user manually</h2>
          <p className="mt-1 text-sm text-slate-400">Create direct portal access for {tenantName}. No invitation email will be sent.</p>
        </div>
        <button type="button" onClick={result ? finish : onClose} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold">Close</button>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}

      {result ? <div className="mt-5 space-y-4">
        <div className="rounded-2xl border border-emerald-800 bg-emerald-950/30 p-4">
          <p className="font-black text-emerald-200">User access created</p>
          <p className="mt-1 text-sm text-emerald-100">{result.displayName} now has {result.role} access to {tenantName}.</p>
        </div>
        {result.temporaryPassword ? <div className="rounded-2xl border border-amber-700 bg-amber-950/30 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-amber-300">Temporary password — shown once</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white">{result.temporaryPassword}</code>
            <button type="button" onClick={() => void copyPassword()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-400 px-4 text-xs font-black text-slate-950">
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-3 text-xs text-amber-200">Transfer this password securely. It is not emailed, stored in KS OS, or shown again.</p>
        </div> : <div className="rounded-2xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-300">
          This email already had a verified Supabase login. KS OS linked that existing identity without changing its password or sending an email.
        </div>}
        <button type="button" onClick={finish} className="w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-black text-white">Done and refresh user list</button>
      </div> : <form onSubmit={submit} className="mt-5 space-y-4">
        <div className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-400">
          The user will be activated immediately. For a new login identity, KS OS generates a one-time temporary password instead of sending an email.
        </div>
        <label className="block text-sm text-slate-300">Display name
          <input required minLength={2} maxLength={255} value={displayName} onChange={event => setDisplayName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white" />
        </label>
        <label className="block text-sm text-slate-300">Email address
          <input required type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white" />
        </label>
        <label className="block text-sm text-slate-300">Workspace role
          <select value={role} onChange={event => { const next = event.target.value as 'owner' | 'staff'; setRole(next); if (next === 'owner') setBookingEnabled(false); }} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white">
            <option value="owner">Owner</option>
            <option value="staff">Staff</option>
          </select>
        </label>
        {role === 'staff' && <label className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-300">
          <input type="checkbox" checked={bookingEnabled} onChange={event => setBookingEnabled(event.target.checked)} className="mt-1 h-4 w-4" />
          <span><strong className="block text-white">Enable booking access</strong><small className="text-slate-500">Leave this off until services, schedules and locations have been configured.</small></span>
        </label>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300">Cancel</button>
          <button disabled={busy} className="rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-black text-white disabled:opacity-50">{busy ? 'Creating user…' : 'Create user without email'}</button>
        </div>
      </form>}
    </section>
  </div>;
};

export default ManualTenantUserDialog;
