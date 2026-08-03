import React, { useMemo, useState } from 'react';
import {
  CircleAlert,
  KeyRound,
  MailPlus,
  RefreshCw,
  Search,
  ShieldOff,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useParams } from 'react-router';
import { AdminPasswordDialog } from './AdminPasswordDialog';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';
import { ManualTenantUserDialog } from './ManualTenantUserDialog';

type WorkspaceUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  lastLoginAt?: string | null;
  createdAt?: string | null;
};

type TenantDetail = {
  tenant: {
    id: string;
    name: string;
    subdomain: string;
  };
};

const surface = 'rounded-3xl border border-slate-800/90 bg-slate-900/80 shadow-[0_24px_80px_rgba(2,6,23,0.28)]';

const statusTone = (value: string) => {
  const normalised = value.toUpperCase();
  if (normalised === 'ACTIVE') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
  if (normalised === 'SUSPENDED') return 'border-rose-400/30 bg-rose-400/10 text-rose-200';
  return 'border-slate-700 bg-slate-800/70 text-slate-300';
};

const StatusBadge = ({ value }: { value: string }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusTone(value)}`}>
    {value.replaceAll('_', ' ')}
  </span>
);

const roleTone = (role: string) => role.toLowerCase() === 'owner'
  ? 'border-violet-400/30 bg-violet-400/10 text-violet-200'
  : 'border-sky-400/30 bg-sky-400/10 text-sky-200';

const RoleBadge = ({ value }: { value: string }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${roleTone(value)}`}>
    {value}
  </span>
);

const formatDateTime = (value?: string | null) => value
  ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  : 'Never';

function useWorkspaceUsers(tenantId?: string) {
  const [tenant, setTenant] = useState<TenantDetail['tenant'] | null>(null);
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const [detail, rows] = await Promise.all([
        agencyFetch(`/tenants/${tenantId}`) as Promise<TenantDetail>,
        agencyFetch(`/tenants/${tenantId}/users`) as Promise<WorkspaceUser[]>,
      ]);
      setTenant(detail.tenant);
      setUsers(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Workspace users could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return { tenant, users, loading, error, reload };
}

export const AgencyWorkspaceUsersPage: React.FC = () => {
  const { tenantId } = useParams();
  const { session } = useAgencyAuth();
  const live = useWorkspaceUsers(tenantId);
  const [query, setQuery] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  const canManage = session?.capabilities.includes('tenants.manage') ?? false;
  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return live.users;
    return live.users.filter(user => `${user.displayName} ${user.email} ${user.role} ${user.status}`.toLowerCase().includes(needle));
  }, [live.users, query]);

  const owners = live.users.filter(user => user.role.toLowerCase() === 'owner').length;
  const activeUsers = live.users.filter(user => user.status === 'ACTIVE').length;

  const runUserAction = async (user: WorkspaceUser, action: 'suspend' | 'reactivate' | 'revoke-sessions') => {
    if (!tenantId || busy) return;
    const destructive = action === 'suspend' || action === 'revoke-sessions';
    const question = action === 'suspend'
      ? `Suspend ${user.displayName}? They will no longer be able to access this workspace.`
      : `End every active session for ${user.displayName}? They will need to sign in again.`;
    if (destructive && !window.confirm(question)) return;

    setBusy(`${user.id}:${action}`);
    setNotice('');
    setActionError('');
    try {
      await agencyFetch(`/tenants/${tenantId}/users/${user.id}/${action}`, { method: 'POST' });
      setNotice(action === 'reactivate'
        ? `${user.displayName} can access the workspace again.`
        : action === 'suspend'
          ? `${user.displayName} has been suspended.`
          : `All sessions for ${user.displayName} have been revoked.`);
      await live.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The account action could not be completed.');
    } finally {
      setBusy(null);
    }
  };

  const inviteOwner = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tenantId || busy) return;
    setBusy('invite');
    setNotice('');
    setActionError('');
    try {
      await agencyFetch(`/tenants/${tenantId}/owner-invitations`, {
        method: 'POST',
        body: JSON.stringify({ displayName: inviteName.trim(), email: inviteEmail.trim() }),
      });
      setInviteOpen(false);
      setInviteName('');
      setInviteEmail('');
      setNotice(`Owner invitation sent to ${inviteEmail.trim()}.`);
      await live.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The owner invitation could not be sent.');
    } finally {
      setBusy(null);
    }
  };

  if (live.loading) {
    return <section className={`${surface} p-8`}><div className="flex items-center gap-3 text-slate-400"><div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-violet-400" /><span className="text-sm font-bold">Loading workspace users…</span></div></section>;
  }

  if (live.error || !live.tenant) {
    return <section className={`${surface} p-8`}><div role="alert" className="flex items-start gap-3 text-rose-200"><CircleAlert className="mt-0.5 h-5 w-5" /><div><p className="font-black">Users could not be loaded</p><p className="mt-1 text-sm text-rose-200/70">{live.error}</p></div></div></section>;
  }

  return <div className="space-y-7">
    <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
      <div className="max-w-3xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-300">{live.tenant.name}</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Users and access</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">View every person with access to this workspace, add or invite users, control account status, end sessions and administer passwords.</p>
      </div>
      {canManage ? <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPasswordOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-bold text-slate-200 hover:bg-slate-800"><KeyRound className="h-4 w-4" />Password control</button>
        <button type="button" onClick={() => setManualOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 text-sm font-black text-violet-100 hover:bg-violet-500/20"><UserPlus className="h-4 w-4" />Add user directly</button>
        <button type="button" onClick={() => setInviteOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white shadow-lg shadow-violet-950/40 hover:bg-violet-500"><MailPlus className="h-4 w-4" />Invite owner</button>
      </div> : null}
    </div>

    {notice ? <p role="status" className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm font-bold text-emerald-100">{notice}</p> : null}
    {actionError ? <p role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">{actionError}</p> : null}

    <div className="grid gap-4 sm:grid-cols-3">
      <section className={`${surface} p-5`}><p className="text-xs font-black uppercase tracking-wider text-slate-500">All users</p><p className="mt-3 text-3xl font-black text-white">{live.users.length}</p><p className="mt-1 text-xs text-slate-500">Everyone linked to this workspace</p></section>
      <section className={`${surface} p-5`}><p className="text-xs font-black uppercase tracking-wider text-slate-500">Active access</p><p className="mt-3 text-3xl font-black text-emerald-200">{activeUsers}</p><p className="mt-1 text-xs text-slate-500">Users currently allowed to sign in</p></section>
      <section className={`${surface} p-5`}><p className="text-xs font-black uppercase tracking-wider text-slate-500">Owners</p><p className="mt-3 text-3xl font-black text-violet-200">{owners}</p><p className="mt-1 text-xs text-slate-500">Users with full workspace control</p></section>
    </div>

    <section className={`${surface} overflow-hidden`}>
      <div className="flex flex-col gap-4 border-b border-slate-800 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div><p className="text-xs font-black uppercase tracking-widest text-slate-500">Workspace directory</p><h2 className="mt-1 text-xl font-black text-white">Account access</h2></div>
        <label className="relative block w-full sm:max-w-sm"><span className="sr-only">Search workspace users</span><Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-500" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, email, role or status" className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-11 pr-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20" /></label>
      </div>

      {filteredUsers.length ? <div className="divide-y divide-slate-800">
        {filteredUsers.map(user => <article key={user.id} className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[1.2fr_0.7fr_0.8fr_auto] xl:items-center">
          <div className="flex min-w-0 items-center gap-4"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-500/15 text-violet-200"><Users className="h-5 w-5" /></div><div className="min-w-0"><p className="truncate font-black text-white">{user.displayName}</p><p className="mt-1 truncate text-sm text-slate-500">{user.email}</p></div></div>
          <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-600">Access</p><div className="mt-2 flex flex-wrap gap-2"><RoleBadge value={user.role} /><StatusBadge value={user.status} /></div></div>
          <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-600">Last login</p><p className="mt-2 text-sm font-bold text-slate-300">{formatDateTime(user.lastLoginAt)}</p></div>
          {canManage ? <div className="flex flex-wrap gap-2 xl:justify-end">
            <button type="button" disabled={busy !== null} onClick={() => void runUserAction(user, user.status === 'SUSPENDED' ? 'reactivate' : 'suspend')} className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-black disabled:opacity-50 ${user.status === 'SUSPENDED' ? 'border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10' : 'border-rose-500/40 text-rose-200 hover:bg-rose-500/10'}`}>{user.status === 'SUSPENDED' ? <UserCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}{user.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}</button>
            <button type="button" disabled={busy !== null} onClick={() => void runUserAction(user, 'revoke-sessions')} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 px-3 text-xs font-black text-slate-300 hover:bg-slate-800 disabled:opacity-50"><RefreshCw className="h-4 w-4" />Revoke sessions</button>
          </div> : null}
        </article>)}
      </div> : <div className="px-6 py-16 text-center"><Users className="mx-auto h-8 w-8 text-slate-600" /><p className="mt-3 font-black text-white">{live.users.length ? 'No users match your search' : 'No users have been added'}</p><p className="mt-1 text-sm text-slate-500">{live.users.length ? 'Try a different name, email, role or status.' : 'Invite the client owner or add a user directly to begin.'}</p></div>}
    </section>

    {canManage ? <section className="rounded-3xl border border-amber-400/20 bg-amber-400/10 p-5 sm:p-6"><div className="flex items-start gap-3"><KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" /><div><h2 className="font-black text-amber-100">Access changes are audited</h2><p className="mt-1 text-sm leading-6 text-amber-100/70">Suspending an account blocks workspace access. Revoking sessions signs the user out everywhere. Password changes require identity verification and an administrative reason.</p></div></div></section> : null}

    <ManualTenantUserDialog open={manualOpen} tenantId={tenantId!} tenantName={live.tenant.name} onClose={() => setManualOpen(false)} onCreated={live.reload} />
    <AdminPasswordDialog open={passwordOpen} scope="TENANT" tenantId={tenantId} tenantName={live.tenant.name} onClose={() => setPasswordOpen(false)} />

    {inviteOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm"><form onSubmit={inviteOwner} className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"><div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-500/15 text-violet-200"><MailPlus className="h-5 w-5" /></div><div><h2 className="text-xl font-black text-white">Invite workspace owner</h2><p className="mt-1 text-sm text-slate-400">Send a secure invitation so the client can create their password and access {live.tenant.name}.</p></div></div><div className="mt-6 space-y-4"><label className="block text-sm font-bold text-slate-300">Owner name<input required minLength={1} maxLength={255} value={inviteName} onChange={event => setInviteName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none focus:border-violet-400" /></label><label className="block text-sm font-bold text-slate-300">Email address<input required type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none focus:border-violet-400" /></label></div><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={busy !== null} onClick={() => setInviteOpen(false)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 disabled:opacity-50">Cancel</button><button disabled={busy !== null} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-5 text-xs font-black text-white hover:bg-violet-500 disabled:opacity-50"><MailPlus className="h-4 w-4" />{busy === 'invite' ? 'Sending invitation…' : 'Send owner invitation'}</button></div></form></div> : null}
  </div>;
};

export default AgencyWorkspaceUsersPage;
