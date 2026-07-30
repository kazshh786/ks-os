import React, { useCallback, useMemo, useRef, useState } from 'react';
import { CircleHelp, Clipboard, ExternalLink, Plus, Store } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { AccountMenu } from '../components/navigation/AccountMenu';
import { AppSidebar } from '../components/navigation/AppSidebar';
import { MobileNavigation } from '../components/navigation/MobileNavigation';
import { PageHeader } from '../components/navigation/PageHeader';
import { useAuth } from '../auth/useAuth';
import { SupportModeBanner } from '../features/agency/SupportModeBanner';
import { useOperationsSummary } from '../features/operations/useOperationsSummary';
import { useWorkspacePlan } from '../features/plans/WorkspacePlanContext';
import { businessNavigation } from '../navigation/business-navigation';
import { findActiveNavigationItem, resolveNavigation } from '../navigation/navigation.utils';

const collapsedStorageKey = 'ks-os-business-sidebar-collapsed';

export const StaffWorkspaceLayout: React.FC = () => {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(collapsedStorageKey) === 'true');
  const [copyMessage, setCopyMessage] = useState('');
  const { summary: planSummary } = useWorkspacePlan();
  const groups = useMemo(() => resolveNavigation(businessNavigation, {
    portal: 'business', role: auth.role, permissions: auth.permissions, entitlements: planSummary?.entitlements,
  }), [auth.permissions, auth.role, planSummary?.entitlements]);
  const activeItem = findActiveNavigationItem(groups, location.pathname);
  const operationsCount = useOperationsSummary(groups.some(group => group.items.some(item => item.id === 'operations')));
  const canCreateBooking = auth.role === 'owner' || auth.permissions.includes('BOOKINGS_CREATE');
  const publicBookingUrl = `${window.location.origin}/book/${auth.tenantSubdomain}`;
  const accountName = auth.email?.split('@')[0] || 'Business account';
  const isCalendarWorkspace = location.pathname === '/app/calendar';

  const toggleCollapsed = () => {
    setCollapsed(value => {
      localStorage.setItem(collapsedStorageKey, String(!value));
      return !value;
    });
  };
  const copyBookingLink = useCallback(() => {
    void navigator.clipboard.writeText(publicBookingUrl).then(() => {
      setCopyMessage('Booking link copied');
    });
  }, [publicBookingUrl]);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const switchWorkspace = async (businessReference: string) => {
    if (businessReference === auth.businessReference) return;
    await auth.selectWorkspace(businessReference);
    navigate('/app/calendar', { replace: true });
  };

  const primaryAction = canCreateBooking
    ? <div className="space-y-2"><Link to="/app/calendar?create=1" className={`flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 font-black text-white shadow-sm hover:bg-indigo-700 ${collapsed ? 'px-0' : 'gap-2 px-4 text-sm'}`} title={collapsed ? 'Create booking' : undefined}><Plus aria-hidden="true" className="h-5 w-5" />{!collapsed && 'Create booking'}</Link>{auth.role === 'owner' && !collapsed && <Link to="/app/services?add=1" className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-700 hover:bg-slate-50"><Plus aria-hidden="true" className="h-4 w-4" />Add service</Link>}</div>
    : auth.role === 'owner' ? <Link to="/app/services?add=1" className={`flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white font-black text-slate-700 shadow-sm hover:bg-slate-50 ${collapsed ? 'px-0' : 'gap-2 px-4 text-sm'}`} title={collapsed ? 'Add service' : undefined}><Plus aria-hidden="true" className="h-5 w-5" />{!collapsed && 'Add service'}</Link> : undefined;
  const secondaryActions = <div className="space-y-1">
    {auth.role === 'owner' && planSummary && <div className={`mb-3 rounded-xl border p-3 ${planSummary.usage.bookings.warning ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{planSummary.plan.name} plan</p><span className="text-[10px] font-black text-slate-600">{Math.min(100, planSummary.usage.bookings.percentage)}%</span></div>
      <p className="mt-1 text-xs font-black text-slate-800">{planSummary.usage.bookings.used.toLocaleString()} of {planSummary.usage.bookings.limit.toLocaleString()} bookings this month</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><span className={`block h-full rounded-full ${planSummary.usage.bookings.warning ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min(100, planSummary.usage.bookings.percentage)}%` }} /></div>
      {planSummary.usage.bookings.warning && <><p className="mt-2 text-[10px] leading-4 text-amber-900">{planSummary.usage.bookings.atLimit ? 'New bookings continue under the audited overage policy.' : 'You have used at least 80% of this month’s booking allowance.'}</p><a href="mailto:support@ks-os.com?subject=Upgrade%20KS%20OS%20plan" className="mt-1 inline-block text-[10px] font-black text-indigo-700">Upgrade plan</a></>}
    </div>}
    <a href={publicBookingUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-950"><ExternalLink aria-hidden="true" className="h-4 w-4" />View booking page</a>
    <button type="button" onClick={copyBookingLink} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-950"><Clipboard aria-hidden="true" className="h-4 w-4" />Copy booking link</button>
    <p aria-live="polite" className="sr-only">{copyMessage}</p>
  </div>;
  const account = <div className="space-y-1"><a href="mailto:support@ks-os.com" className={`flex min-h-10 items-center rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-950 ${collapsed ? 'justify-center' : 'gap-3 px-3'}`} aria-label="Help and support" title={collapsed ? 'Help and support' : undefined}><CircleHelp aria-hidden="true" className="h-[18px] w-[18px]" />{!collapsed && 'Help and support'}</a><AccountMenu displayName={accountName} email={auth.email} roleLabel={auth.role === 'owner' ? 'Business owner' : 'Team member'} settingsHref="/app/settings/security" compact={collapsed} onSignOut={() => void auth.signOut()} /></div>;
  const sidebar = (isMobile = false) => <AppSidebar
    ariaLabel="Business navigation"
    productName={auth.tenantName || 'Business workspace'}
    productCaption="KS OS"
    groups={groups}
    pathname={location.pathname}
    collapsed={isMobile ? false : collapsed}
    collapsible={!isMobile}
    badges={{ operations: operationsCount }}
    primaryAction={isMobile && canCreateBooking ? <div className="space-y-2"><Link to="/app/calendar?create=1" onClick={() => setMobileOpen(false)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white"><Plus aria-hidden="true" className="h-5 w-5" />Create booking</Link>{auth.role === 'owner' && <Link to="/app/services?add=1" onClick={() => setMobileOpen(false)} className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-700"><Plus aria-hidden="true" className="h-4 w-4" />Add service</Link>}</div> : primaryAction}
    secondaryActions={secondaryActions}
    footer={isMobile ? <div className="space-y-1"><a href="mailto:support@ks-os.com" className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-xs font-bold text-slate-500 hover:bg-slate-100"><CircleHelp aria-hidden="true" className="h-[18px] w-[18px]" />Help and support</a><AccountMenu displayName={accountName} email={auth.email} roleLabel={auth.role === 'owner' ? 'Business owner' : 'Team member'} settingsHref="/app/settings/security" onSignOut={() => void auth.signOut()} /></div> : account}
    onToggleCollapsed={toggleCollapsed}
    onNavigate={isMobile ? closeMobile : undefined}
  />;

  const workspaceHeader = <PageHeader
    title={activeItem?.label ?? 'Workspace'}
    eyebrow={auth.tenantName}
    breadcrumbs={activeItem ? [auth.tenantName, activeItem.label] : [auth.tenantName]}
    compact={isCalendarWorkspace}
    menuButtonRef={menuButtonRef}
    onOpenNavigation={() => setMobileOpen(true)}
    notificationHref={groups.some(group => group.items.some(item => item.id === 'operations')) ? '/app/operations' : undefined}
    actions={<>{auth.memberships.length > 1 && <label className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 sm:flex"><Store aria-hidden="true" className="h-4 w-4 text-slate-500" /><span className="sr-only">Switch business</span><select value={auth.businessReference} onChange={event => void switchWorkspace(event.target.value)} className="max-w-40 border-0 bg-transparent py-2 text-xs font-bold focus:shadow-none">{auth.memberships.map(membership => <option key={membership.businessReference} value={membership.businessReference}>{membership.businessName}</option>)}</select></label>}</>}
  />;

  return <div
    className="flex h-screen min-h-0 overflow-hidden bg-slate-50 font-sans text-slate-950 antialiased"
    style={{ '--workspace-sidebar-width': collapsed ? '76px' : '272px' } as React.CSSProperties}
  >
    <div className="hidden h-full shrink-0 lg:block">{sidebar()}</div>
    <MobileNavigation open={mobileOpen} title="Business navigation" onClose={closeMobile} triggerRef={menuButtonRef}>{sidebar(true)}</MobileNavigation>
    <div className="flex min-w-0 flex-1 flex-col">
      <SupportModeBanner />
      {isCalendarWorkspace ? <div className="lg:hidden">{workspaceHeader}</div> : workspaceHeader}
      <main id="main-content" className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${isCalendarWorkspace ? 'p-0' : 'p-4 sm:p-6 lg:p-8'}`}><Outlet /></main>
    </div>
  </div>;
};

export default StaffWorkspaceLayout;
