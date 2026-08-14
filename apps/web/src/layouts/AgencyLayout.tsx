import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CircleHelp, DoorOpen, KeyRound, Plus, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { AccountMenu } from '../components/navigation/AccountMenu';
import { AppSidebar } from '../components/navigation/AppSidebar';
import { ManagedBusinessContext } from '../components/navigation/ManagedBusinessContext';
import { MobileNavigation } from '../components/navigation/MobileNavigation';
import { PageHeader } from '../components/navigation/PageHeader';
import { AdminPasswordDialog } from '../features/agency/AdminPasswordDialog';
import { agencyFetch, useAgencyAuth } from '../features/agency/AgencyAuth';
import AgencyClientSearchResearchPage from '../features/agency/AgencyClientSearchResearchPage';
import AgencyClientWorkspaceOverviewPage from '../features/agency/AgencyClientWorkspaceOverviewPage';
import {
  AgencyClientAccountPage,
  AgencyClientOperationsPage,
  AgencyClientWebsiteWorkspacePage,
} from '../features/agency/AgencyClientExperienceV3';
import { AgencyClientsPage, AgencyHomePage, AgencyOnboardingPage } from '../features/agency/AgencyOperatingConsole';
import AgencyWorkspaceOnboardingPage from '../features/agency/AgencyWorkspaceOnboardingPage';
import { DeploymentControl } from '../features/agency/DeploymentControl';
import { ManualTenantUserDialog } from '../features/agency/ManualTenantUserDialog';
import { SupportSessionDialog } from '../features/agency/SupportSessionDialog';
import { agencyNavigation, managedBusinessNavigation } from '../navigation/agency-navigation';
import { findActiveNavigationItem, resolveNavigation } from '../navigation/navigation.utils';

interface AgencyBusiness { id: string; name: string; lifecycleStatus?: string }
const collapsedStorageKey = 'ks-os-agency-sidebar-collapsed';

export const AgencyLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, signOut } = useAgencyAuth();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [manualUserOpen, setManualUserOpen] = useState(false);
  const [passwordControlOpen, setPasswordControlOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(collapsedStorageKey) === 'true');
  const [businesses, setBusinesses] = useState<AgencyBusiness[]>([]);
  const [managedBusiness, setManagedBusiness] = useState<AgencyBusiness | null>(null);

  const tenantId = location.pathname.match(/^\/agency\/tenants\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
  const capabilities = session?.capabilities ?? [];
  const groups = useMemo(() => resolveNavigation(tenantId ? managedBusinessNavigation : agencyNavigation, {
    portal: tenantId ? 'managed-business' : 'agency',
    agencyCapabilities: capabilities,
  }), [capabilities, tenantId]);
  const parameters = tenantId ? { tenantId } : {};
  const activeItem = findActiveNavigationItem(groups, location.pathname, parameters);

  useEffect(() => {
    if (!tenantId) {
      setManagedBusiness(null);
      setBusinesses([]);
      return;
    }
    let active = true;
    void Promise.all([agencyFetch(`/tenants/${tenantId}`), agencyFetch('/tenants')]).then(([detail, rows]) => {
      if (!active) return;
      setManagedBusiness(detail.tenant);
      setBusinesses(rows.map((row: AgencyBusiness) => ({ id: row.id, name: row.name, lifecycleStatus: row.lifecycleStatus })));
    }).catch(() => {
      if (active) setManagedBusiness({ id: tenantId, name: 'Client workspace' });
    });
    return () => { active = false; };
  }, [tenantId]);

  const toggleCollapsed = () => setCollapsed(value => {
    localStorage.setItem(collapsedStorageKey, String(!value));
    return !value;
  });
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const switchBusiness = (nextTenantId: string) => navigate(`/agency/tenants/${nextTenantId}`);
  const openPasswordControl = () => {
    setMobileOpen(false);
    setPasswordControlOpen(true);
  };

  const canStartSupport = capabilities.includes('support.session.start');
  const canManageUsers = capabilities.includes('tenants.manage');
  const canManageAgencyUsers = capabilities.includes('agency.users.manage') && session?.user.role === 'PLATFORM_OWNER';
  const tenantName = managedBusiness?.name ?? 'Client workspace';
  const contextHeader = tenantId
    ? <ManagedBusinessContext tenantId={tenantId} tenantName={tenantName} status={managedBusiness?.lifecycleStatus} businesses={businesses} onSwitch={switchBusiness} />
    : undefined;

  const agencyPrimaryAction = capabilities.includes('tenants.manage')
    ? <Link to="/agency/tenants/new" className={`flex min-h-11 w-full items-center justify-center rounded-xl bg-violet-600 font-black text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-500 ${collapsed ? '' : 'gap-2 px-3 text-xs'}`} title={collapsed ? 'Add client' : undefined}><Plus aria-hidden="true" className="h-4 w-4" />{!collapsed && 'Add client'}</Link>
    : undefined;

  const managedPrimaryAction = tenantId
    ? <Link to={`/agency/tenants/${tenantId}/onboarding`} className={`flex min-h-11 w-full items-center justify-center rounded-xl bg-violet-600 font-black text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-500 ${collapsed ? '' : 'gap-2 px-3 text-xs'}`} title={collapsed ? 'Continue launch' : undefined}>{!collapsed && 'Continue launch'}</Link>
    : undefined;

  const agencySecondaryActions = <div className="space-y-2">
    <Link to="/agency/onboarding" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 text-xs font-bold text-slate-300 transition hover:border-slate-700 hover:text-white">Open work queue</Link>
    {canManageAgencyUsers ? <button type="button" onClick={openPasswordControl} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-800 px-3 text-xs font-bold text-slate-400 transition hover:text-white"><KeyRound aria-hidden="true" className="h-4 w-4" />Agency password control</button> : null}
  </div>;

  const managedBusinessSecondaryActions = <div className="space-y-2">
    {canStartSupport ? <button type="button" onClick={() => { setMobileOpen(false); setSupportOpen(true); }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-700/70 bg-amber-950/20 px-3 text-xs font-bold text-amber-100 transition hover:bg-amber-950/40"><DoorOpen aria-hidden="true" className="h-4 w-4" />Support access</button> : null}
    {canManageUsers ? <button type="button" onClick={() => { setMobileOpen(false); setManualUserOpen(true); }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 text-xs font-bold text-slate-200 transition hover:border-violet-700 hover:text-white"><UserPlus aria-hidden="true" className="h-4 w-4" />Add workspace user</button> : null}
    {canManageUsers ? <button type="button" onClick={openPasswordControl} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-800 px-3 text-xs font-bold text-slate-400 transition hover:text-white"><KeyRound aria-hidden="true" className="h-4 w-4" />User password control</button> : null}
    <Link to="/agency/tenants" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-800 px-3 text-xs font-bold text-slate-400 transition hover:text-white"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Back to all clients</Link>
  </div>;

  const footer = <div className="space-y-1">
    <a href="mailto:support@ks-os.com" className={`flex min-h-11 items-center rounded-xl text-xs font-bold text-slate-500 transition hover:bg-slate-900 hover:text-white ${collapsed ? 'justify-center' : 'gap-3 px-3'}`} aria-label="Help and support" title={collapsed ? 'Help and support' : undefined}><CircleHelp aria-hidden="true" className="h-[18px] w-[18px]" />{!collapsed && 'Help and support'}</a>
    <AccountMenu displayName={session?.user.displayName ?? 'Agency user'} email={session?.user.email} roleLabel={(session?.user.role ?? 'Agency user').replaceAll('_', ' ')} settingsHref="/agency/settings/security" tone="dark" compact={collapsed} onSignOut={() => void signOut()} />
  </div>;

  const sidebar = (isMobile = false) => <AppSidebar
    ariaLabel={tenantId ? 'Client workspace navigation' : 'Agency navigation'}
    productName="KS Agency"
    productCaption={tenantId ? 'Client workspace' : 'Client operations'}
    groups={groups}
    pathname={location.pathname}
    parameters={parameters}
    collapsed={isMobile ? false : collapsed}
    collapsible={!isMobile}
    tone="dark"
    contextHeader={isMobile || !collapsed ? contextHeader : undefined}
    primaryAction={tenantId ? managedPrimaryAction : agencyPrimaryAction}
    secondaryActions={tenantId ? managedBusinessSecondaryActions : agencySecondaryActions}
    footer={isMobile ? <div className="space-y-1"><a href="mailto:support@ks-os.com" className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-xs font-bold text-slate-500 hover:bg-slate-900 hover:text-white"><CircleHelp aria-hidden="true" className="h-[18px] w-[18px]" />Help and support</a><AccountMenu displayName={session?.user.displayName ?? 'Agency user'} email={session?.user.email} roleLabel={(session?.user.role ?? 'Agency user').replaceAll('_', ' ')} settingsHref="/agency/settings/security" tone="dark" onSignOut={() => void signOut()} /></div> : footer}
    onToggleCollapsed={toggleCollapsed}
    onNavigate={isMobile ? closeMobile : undefined}
  />;

  const query = new URLSearchParams(location.search);
  const onWebsite = Boolean(tenantId && location.pathname === `/agency/tenants/${tenantId}/fulfilment`);
  const headerActions = <div className="flex items-center gap-2">
    {onWebsite && query.get('view') !== 'research' ? <Link to={`/agency/tenants/${tenantId}/fulfilment?view=research`} className="hidden min-h-10 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs font-black text-slate-200 transition hover:border-violet-500 sm:inline-flex"><Search className="h-4 w-4" />Search research</Link> : null}
    {session?.user.role === 'PLATFORM_OWNER' ? <DeploymentControl /> : null}
    {!tenantId && capabilities.includes('tenants.manage') ? <Link to="/agency/tenants/new" className="hidden min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-3 text-xs font-black text-white shadow-lg shadow-violet-950/30 transition hover:bg-violet-500 sm:inline-flex"><Plus className="h-4 w-4" />Add client</Link> : null}
    {tenantId && canStartSupport ? <button type="button" onClick={() => setSupportOpen(true)} className="hidden min-h-10 items-center gap-2 rounded-xl bg-amber-400 px-3 text-xs font-black text-slate-950 transition hover:bg-amber-300 sm:inline-flex"><DoorOpen className="h-4 w-4" />Support access</button> : null}
    <span className="hidden items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-violet-300 md:flex"><ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />{session?.mfa.assuranceLevel.toUpperCase()}</span>
  </div>;

  const tenantWorkspaceMatch = location.pathname.match(/^\/agency\/tenants\/[0-9a-f-]{36}(?:\/(onboarding|fulfilment|health|billing))?\/?$/i);
  const tenantWorkspaceMode = tenantWorkspaceMatch?.[1];
  const redesignedContent = (location.pathname === '/agency' || location.pathname === '/agency/overview') && capabilities.includes('analytics.read')
    ? <AgencyHomePage />
    : location.pathname === '/agency/tenants' && capabilities.includes('tenants.read')
      ? <AgencyClientsPage />
      : location.pathname === '/agency/onboarding' && capabilities.includes('tenants.read')
        ? <AgencyOnboardingPage />
        : tenantWorkspaceMatch && capabilities.includes('tenants.read')
          ? tenantWorkspaceMode === 'onboarding'
            ? <AgencyWorkspaceOnboardingPage />
            : tenantWorkspaceMode === 'fulfilment'
              ? query.get('view') === 'research'
                ? <AgencyClientSearchResearchPage />
                : <AgencyClientWebsiteWorkspacePage />
              : tenantWorkspaceMode === 'health' && query.get('technical') !== '1'
                ? <AgencyClientOperationsPage />
                : tenantWorkspaceMode === 'billing' && query.get('details') !== '1'
                  ? <AgencyClientAccountPage />
                  : tenantWorkspaceMode === undefined
                    ? <AgencyClientWorkspaceOverviewPage />
                    : <Outlet />
          : <Outlet />;

  return <div className="flex h-dvh min-h-0 overflow-hidden bg-slate-950 font-sans text-white antialiased">
    <div className="hidden h-full shrink-0 lg:block">{sidebar()}</div>
    <MobileNavigation open={mobileOpen} title={tenantId ? 'Client workspace' : 'Agency navigation'} onClose={closeMobile} triggerRef={menuButtonRef}>{sidebar(true)}</MobileNavigation>
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        title={query.get('view') === 'research' && tenantWorkspaceMode === 'fulfilment' ? 'Search research' : activeItem?.label ?? (tenantId ? 'Client workspace' : 'Agency home')}
        eyebrow={tenantId ? tenantName : 'KS Agency'}
        breadcrumbs={query.get('view') === 'research' && tenantWorkspaceMode === 'fulfilment' ? [tenantName, 'Website', 'Search research'] : activeItem ? [tenantId ? tenantName : 'Agency', activeItem.label] : undefined}
        tone="dark"
        menuButtonRef={menuButtonRef}
        onOpenNavigation={() => setMobileOpen(true)}
        notificationHref={capabilities.includes('support.read') ? '/agency/support' : undefined}
        actions={headerActions}
      />
      <main id="main-content" className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.08),transparent_28%),#020617] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-slate-100 sm:p-6 lg:p-8"><div className="mx-auto w-full max-w-[1600px]">{redesignedContent}</div></main>
    </div>
    {tenantId ? <SupportSessionDialog open={supportOpen} tenantId={tenantId} tenantName={tenantName} onClose={() => setSupportOpen(false)} /> : null}
    {tenantId ? <ManualTenantUserDialog open={manualUserOpen} tenantId={tenantId} tenantName={tenantName} onClose={() => setManualUserOpen(false)} onCreated={() => window.location.reload()} /> : null}
    <AdminPasswordDialog open={passwordControlOpen} scope={tenantId ? 'TENANT' : 'AGENCY'} tenantId={tenantId} tenantName={tenantId ? tenantName : undefined} onClose={() => setPasswordControlOpen(false)} />
  </div>;
};

export default AgencyLayout;
