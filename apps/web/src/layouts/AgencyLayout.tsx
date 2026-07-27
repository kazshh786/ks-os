import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleHelp, DoorOpen, KeyRound, Plus, ShieldCheck, UserPlus } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { AccountMenu } from '../components/navigation/AccountMenu';
import { AppSidebar } from '../components/navigation/AppSidebar';
import { ManagedBusinessContext } from '../components/navigation/ManagedBusinessContext';
import { MobileNavigation } from '../components/navigation/MobileNavigation';
import { PageHeader } from '../components/navigation/PageHeader';
import { agencyFetch, useAgencyAuth } from '../features/agency/AgencyAuth';
import { ManualTenantUserDialog } from '../features/agency/ManualTenantUserDialog';
import { SupportSessionDialog } from '../features/agency/SupportSessionDialog';
import { agencyNavigation, managedBusinessNavigation } from '../navigation/agency-navigation';
import { findActiveNavigationItem, resolveNavigation } from '../navigation/navigation.utils';

interface AgencyBusiness { id: string; name: string; lifecycleStatus?: string }
interface BusinessUser { id: string; displayName: string; email: string; role: string; status: string }
const collapsedStorageKey = 'ks-os-agency-sidebar-collapsed';

export const AgencyLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, signOut } = useAgencyAuth();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [manualUserOpen, setManualUserOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryUsers, setRecoveryUsers] = useState<BusinessUser[]>([]);
  const [recoveryBusy, setRecoveryBusy] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(collapsedStorageKey) === 'true');
  const [businesses, setBusinesses] = useState<AgencyBusiness[]>([]);
  const [managedBusiness, setManagedBusiness] = useState<AgencyBusiness | null>(null);
  const tenantId = location.pathname.match(/^\/agency\/tenants\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
  const capabilities = session?.capabilities ?? [];
  const groups = useMemo(() => resolveNavigation(tenantId ? managedBusinessNavigation : agencyNavigation, {
    portal: tenantId ? 'managed-business' : 'agency', agencyCapabilities: capabilities,
  }), [capabilities, tenantId]);
  const parameters = tenantId ? { tenantId } : {};
  const activeItem = findActiveNavigationItem(groups, location.pathname, parameters);

  useEffect(() => {
    if (!tenantId) { setManagedBusiness(null); setBusinesses([]); return; }
    let active = true;
    void Promise.all([agencyFetch(`/tenants/${tenantId}`), agencyFetch('/tenants')]).then(([detail, rows]) => {
      if (!active) return;
      setManagedBusiness(detail.tenant);
      setBusinesses(rows.map((row: AgencyBusiness) => ({ id: row.id, name: row.name, lifecycleStatus: row.lifecycleStatus })));
    }).catch(() => { if (active) setManagedBusiness({ id: tenantId, name: 'Business' }); });
    return () => { active = false; };
  }, [tenantId]);

  useEffect(() => {
    if (!recoveryOpen || !tenantId) return;
    setRecoveryNotice('');
    void agencyFetch(`/tenants/${tenantId}/users`)
      .then(setRecoveryUsers)
      .catch((error: Error) => setRecoveryNotice(error.message));
  }, [recoveryOpen, tenantId]);

  const sendRecovery = async (user: BusinessUser) => {
    if (!tenantId || recoveryBusy) return;
    setRecoveryBusy(user.id);
    setRecoveryNotice('');
    try {
      const result = await agencyFetch(`/tenants/${tenantId}/users/${user.id}/password-reset`, { method: 'POST' });
      setRecoveryNotice(`Recovery link sent to ${result.email}. Their existing portal sessions were ended.`);
    } catch (error) {
      setRecoveryNotice(error instanceof Error ? error.message : 'The recovery link could not be sent.');
    } finally {
      setRecoveryBusy(null);
    }
  };

  const toggleCollapsed = () => setCollapsed(value => { localStorage.setItem(collapsedStorageKey, String(!value)); return !value; });
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const switchBusiness = (nextTenantId: string) => navigate(`/agency/tenants/${nextTenantId}`);
  const canStartSupport = capabilities.includes('support.session.start');
  const canManageUsers = capabilities.includes('tenants.manage');
  const tenantName = managedBusiness?.name ?? 'Business';
  const contextHeader = tenantId ? <ManagedBusinessContext tenantId={tenantId} tenantName={tenantName} status={managedBusiness?.lifecycleStatus} businesses={businesses} onSwitch={switchBusiness} /> : undefined;
  const supportAction = tenantId && canStartSupport ? <button type="button" onClick={() => setSupportOpen(true)} title={collapsed ? 'Open support workspace' : undefined} className={`flex min-h-11 w-full items-center justify-center rounded-xl bg-amber-400 font-black text-slate-950 hover:bg-amber-300 ${collapsed ? '' : 'gap-2 px-3 text-xs'}`}><DoorOpen aria-hidden="true" className="h-4 w-4" />{!collapsed && 'Open support workspace'}</button> : undefined;
  const footer = <div className="space-y-1"><a href="mailto:support@ks-os.com" className={`flex min-h-10 items-center rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-900 hover:text-white ${collapsed ? 'justify-center' : 'gap-3 px-3'}`} aria-label="Help and support" title={collapsed ? 'Help and support' : undefined}><CircleHelp aria-hidden="true" className="h-[18px] w-[18px]" />{!collapsed && 'Help and support'}</a><AccountMenu displayName={session?.user.displayName ?? 'Agency user'} email={session?.user.email} roleLabel={(session?.user.role ?? 'Agency user').replaceAll('_', ' ')} settingsHref="/agency/settings/security" tone="dark" compact={collapsed} onSignOut={() => void signOut()} /></div>;
  const sidebar = (isMobile = false) => <AppSidebar
    ariaLabel={tenantId ? 'Managed business navigation' : 'Agency navigation'}
    productName="Agency OS"
    productCaption="Kasim Shah LTD"
    groups={groups}
    pathname={location.pathname}
    parameters={parameters}
    collapsed={isMobile ? false : collapsed}
    collapsible={!isMobile}
    tone="dark"
    contextHeader={isMobile || !collapsed ? contextHeader : undefined}
    primaryAction={isMobile && tenantId && canStartSupport ? <button type="button" onClick={() => { setMobileOpen(false); setSupportOpen(true); }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-3 text-xs font-black text-slate-950"><DoorOpen aria-hidden="true" className="h-4 w-4" />Open support workspace</button> : supportAction}
    secondaryActions={!tenantId ? <div className="grid grid-cols-2 gap-2"><Link to="/agency/tenants/new" className="flex items-center justify-center gap-1 rounded-lg border border-slate-800 p-2 text-[10px] font-bold text-slate-400 hover:text-white"><Plus aria-hidden="true" className="h-3 w-3" />Business</Link>{capabilities.includes('agency.users.manage') && <Link to="/agency/users/new" className="flex items-center justify-center gap-1 rounded-lg border border-slate-800 p-2 text-[10px] font-bold text-slate-400 hover:text-white"><Plus aria-hidden="true" className="h-3 w-3" />Team member</Link>}</div> : <div className="space-y-2">{canManageUsers && <button type="button" onClick={() => { setMobileOpen(false); setManualUserOpen(true); }} className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 p-2 text-xs font-black text-white hover:bg-violet-500"><UserPlus aria-hidden="true" className="h-4 w-4" />Add user manually</button>}{canManageUsers && <button type="button" onClick={() => setRecoveryOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-800 p-2 text-xs font-bold text-slate-400 hover:text-white"><KeyRound aria-hidden="true" className="h-4 w-4" />User password recovery</button>}<Link to="/agency/tenants" className="flex items-center justify-center gap-2 rounded-lg border border-slate-800 p-2 text-xs font-bold text-slate-400 hover:text-white"><DoorOpen aria-hidden="true" className="h-4 w-4" />Exit business management</Link></div>}
    footer={isMobile ? <div className="space-y-1"><a href="mailto:support@ks-os.com" className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-xs font-bold text-slate-500 hover:bg-slate-900 hover:text-white"><CircleHelp aria-hidden="true" className="h-[18px] w-[18px]" />Help and support</a><AccountMenu displayName={session?.user.displayName ?? 'Agency user'} email={session?.user.email} roleLabel={(session?.user.role ?? 'Agency user').replaceAll('_', ' ')} settingsHref="/agency/settings/security" tone="dark" onSignOut={() => void signOut()} /></div> : footer}
    onToggleCollapsed={toggleCollapsed}
    onNavigate={isMobile ? closeMobile : undefined}
  />;

  return <div className="flex h-screen min-h-0 overflow-hidden bg-slate-950 font-sans text-white antialiased">
    <div className="hidden h-full shrink-0 lg:block">{sidebar()}</div>
    <MobileNavigation open={mobileOpen} title={tenantId ? 'Managed business navigation' : 'Agency navigation'} onClose={closeMobile} triggerRef={menuButtonRef}>{sidebar(true)}</MobileNavigation>
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title={activeItem?.label ?? (tenantId ? 'Business management' : 'Agency')} eyebrow={tenantId ? `Managing ${tenantName}` : 'Agency portal'} breadcrumbs={activeItem ? [tenantId ? tenantName : 'Agency', activeItem.label] : undefined} tone="dark" menuButtonRef={menuButtonRef} onOpenNavigation={() => setMobileOpen(true)} notificationHref={capabilities.includes('support.read') ? '/agency/support' : undefined} actions={<span className="hidden items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-violet-300 sm:flex"><ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />{session?.mfa.assuranceLevel.toUpperCase()}</span>} />
      <main id="main-content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-950 p-4 text-slate-100 sm:p-6 lg:p-8"><Outlet /></main>
    </div>
    {tenantId && <SupportSessionDialog open={supportOpen} tenantId={tenantId} tenantName={tenantName} onClose={() => setSupportOpen(false)} />}
    {tenantId && <ManualTenantUserDialog open={manualUserOpen} tenantId={tenantId} tenantName={tenantName} onClose={() => setManualUserOpen(false)} onCreated={() => window.location.reload()} />}
    {recoveryOpen && tenantId && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="password-recovery-title" className="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 id="password-recovery-title" className="text-xl font-black">User password recovery</h2><p className="mt-1 text-sm text-slate-400">Send a secure reset link and end the selected user’s existing portal sessions.</p></div><button type="button" onClick={() => setRecoveryOpen(false)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold">Close</button></div>{recoveryNotice && <p role="status" className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200">{recoveryNotice}</p>}<div className="mt-5 space-y-2">{recoveryUsers.length === 0 ? <p className="text-sm text-slate-500">No active portal users were found.</p> : recoveryUsers.map(user => <div key={user.id} className="flex flex-col gap-3 rounded-xl bg-slate-950 p-4 sm:flex-row sm:items-center sm:justify-between"><span><strong className="block text-sm">{user.displayName}</strong><small className="text-slate-500">{user.email} · {user.role.replaceAll('_', ' ')}</small></span><button type="button" disabled={recoveryBusy !== null || user.status !== 'ACTIVE'} onClick={() => void sendRecovery(user)} className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black disabled:opacity-50">{recoveryBusy === user.id ? 'Sending…' : 'Send reset link'}</button></div>)}</div></section></div>}
  </div>;
};

export default AgencyLayout;
