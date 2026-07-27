import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Eye, EyeOff, KeyRound, Mail } from 'lucide-react';
import { agencyFetch } from './AgencyAuth';

type PasswordScope = 'AGENCY' | 'TENANT';

type ManagedUser = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
};

export const AdminPasswordDialog: React.FC<{
  open: boolean;
  scope: PasswordScope;
  tenantId?: string;
  tenantName?: string;
  onClose: () => void;
}> = ({ open, scope, tenantId, tenantName, onClose }) => {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reason, setReason] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const title = scope === 'TENANT' ? 'Business user password control' : 'Agency user password control';
  const contextLabel = scope === 'TENANT' ? tenantName || 'this business' : 'the agency portal';
  const usersPath = scope === 'TENANT' ? `/tenants/${tenantId}/users` : '/users';

  const validationRules = useMemo(() => [
    { key: 'length', label: '12–128 characters', met: password.length >= 12 && password.length <= 128 },
    { key: 'lowercase', label: 'At least one lowercase letter', met: /[a-z]/.test(password) },
    { key: 'uppercase', label: 'At least one uppercase letter', met: /[A-Z]/.test(password) },
    { key: 'number', label: 'At least one number', met: /\d/.test(password) },
    { key: 'symbol', label: 'At least one symbol', met: /[^A-Za-z0-9]/.test(password) },
    { key: 'match', label: 'Both password fields match', met: password.length > 0 && password === confirmPassword },
    { key: 'reason', label: 'Administrative reason is at least 20 characters', met: reason.trim().length >= 20 },
  ], [password, confirmPassword, reason]);
  const completedRuleCount = validationRules.filter(rule => rule.met).length;
  const passwordValid = validationRules.slice(0, 5).every(rule => rule.met);
  const formReady = selectedUser !== null && validationRules.every(rule => rule.met) && busy === null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setUsers([]);
    setSelectedUser(null);
    setPassword('');
    setConfirmPassword('');
    setReason('');
    setError('');
    setNotice('');
    setShowPassword(false);
    void agencyFetch(usersPath)
      .then((rows: ManagedUser[]) => { if (active) setUsers(rows); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Users could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, usersPath]);

  if (!open) return null;

  const selectUser = (user: ManagedUser) => {
    setSelectedUser(user);
    setPassword('');
    setConfirmPassword('');
    setReason('');
    setError('');
    setNotice('');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedUser || busy) return;
    if (!passwordValid) {
      setError('Complete every password requirement shown below.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The password confirmation does not match.');
      return;
    }
    if (reason.trim().length < 20) {
      setError('Add an administrative reason of at least 20 characters.');
      return;
    }
    setBusy(selectedUser.id);
    setError('');
    setNotice('');
    const path = scope === 'TENANT'
      ? `/tenants/${tenantId}/users/${selectedUser.id}/password`
      : `/users/${selectedUser.id}/password`;
    try {
      await agencyFetch(path, {
        method: 'POST',
        body: JSON.stringify({
          password,
          confirmPassword,
          reason: reason.trim(),
          identityVerified: true,
        }),
      });
      setPassword('');
      setConfirmPassword('');
      setReason('');
      setNotice(`Password changed for ${selectedUser.displayName}. Their existing ${contextLabel} sessions were ended.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The password could not be changed.');
    } finally {
      setBusy(null);
    }
  };

  const sendRecovery = async (user: ManagedUser) => {
    if (scope !== 'TENANT' || !tenantId || busy) return;
    setBusy(user.id);
    setError('');
    setNotice('');
    try {
      const result = await agencyFetch(`/tenants/${tenantId}/users/${user.id}/password-reset`, { method: 'POST' });
      setNotice(`Recovery link sent to ${result.email}. Their existing business sessions were ended.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The recovery link could not be sent.');
    } finally {
      setBusy(null);
    }
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
    <section role="dialog" aria-modal="true" aria-labelledby="admin-password-title" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="admin-password-title" className="flex items-center gap-2 text-xl font-black"><KeyRound className="h-5 w-5 text-violet-300" aria-hidden="true" />{title}</h2>
          <p className="mt-1 text-sm text-slate-400">Choose any user regardless of role or name, set a new password, and immediately end their existing sessions.</p>
        </div>
        <button type="button" disabled={busy !== null} onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold disabled:opacity-50">Close</button>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{notice}</p>}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-400">Select user</h3>
          <div className="mt-3 space-y-2">
            {loading ? <p className="text-sm text-slate-500">Loading users…</p> : users.length === 0 ? <p className="text-sm text-slate-500">No users were found.</p> : users.map(user => <button
              key={user.id}
              type="button"
              onClick={() => selectUser(user)}
              className={`w-full rounded-xl border p-3 text-left transition ${selectedUser?.id === user.id ? 'border-violet-500 bg-violet-950/40' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`}
            >
              <strong className="block text-sm text-white">{user.displayName}</strong>
              <small className="block break-all text-slate-500">{user.email}</small>
              <span className="mt-2 inline-flex gap-2 text-[10px] font-black uppercase text-slate-400"><span>{user.role.replaceAll('_', ' ')}</span><span>·</span><span>{user.status.replaceAll('_', ' ')}</span></span>
            </button>)}
          </div>
        </div>

        <div>
          {selectedUser ? <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-violet-300">Changing password for</p>
              <p className="mt-1 font-black text-white">{selectedUser.displayName}</p>
              <p className="text-xs text-slate-500">{selectedUser.email} · {selectedUser.role.replaceAll('_', ' ')}</p>
            </div>

            <div className="rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-200">
              This takes effect immediately. Every existing portal session for this user will be revoked. The password is sent only to Supabase Auth and is never stored in KS OS.
            </div>

            <label className="block text-sm text-slate-300">New password
              <span className="relative mt-2 block">
                <input required minLength={12} maxLength={128} type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 pr-12 text-white" />
                <button type="button" onClick={() => setShowPassword(value => !value)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 hover:text-white" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}</button>
              </span>
            </label>

            <label className="block text-sm text-slate-300">Confirm password
              <input required minLength={12} maxLength={128} type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white" />
            </label>

            <label className="block text-sm text-slate-300">Administrative reason
              <textarea required minLength={20} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain why direct password administration is required." className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white" />
              <small className="mt-1 flex items-center justify-between gap-3 text-slate-500"><span>The reason is written to the append-only security audit. The password is not.</span><span className={reason.trim().length >= 20 ? 'text-emerald-400' : ''}>{reason.trim().length}/20 minimum</span></small>
            </label>

            <div aria-label="Password change requirements" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-300">Complete every requirement</p>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${completedRuleCount === validationRules.length ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{completedRuleCount}/{validationRules.length}</span>
              </div>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {validationRules.map(rule => <li key={rule.key} className={`flex items-start gap-2 text-xs ${rule.met ? 'text-emerald-300' : 'text-slate-500'}`}>
                  {rule.met ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                  <span>{rule.label}</span>
                </li>)}
              </ul>
              <p className={`mt-3 text-xs font-bold ${formReady ? 'text-emerald-300' : 'text-slate-500'}`}>
                {formReady ? 'Ready to change the password and revoke sessions.' : 'The action button becomes available when every item above is complete.'}
              </p>
            </div>

            <button disabled={!formReady} className="w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{busy === selectedUser.id ? 'Changing password…' : 'Change password and revoke sessions'}</button>

            {scope === 'TENANT' && <button type="button" disabled={busy !== null || selectedUser.status !== 'ACTIVE'} onClick={() => void sendRecovery(selectedUser)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 px-5 py-3 text-xs font-bold text-slate-300 disabled:opacity-50"><Mail className="h-4 w-4" aria-hidden="true" />{busy === selectedUser.id ? 'Working…' : 'Send recovery email instead'}</button>}
          </form> : <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-slate-800 bg-slate-950 p-6 text-center text-sm text-slate-500">Select a user to enter a new password.</div>}
        </div>
      </div>
    </section>
  </div>;
};

export default AdminPasswordDialog;
