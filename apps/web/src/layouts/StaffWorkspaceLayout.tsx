import React, { useState, useEffect } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext.js';
import { useAuth } from '../auth/useAuth.js';
import ApiStatusIndicator from '../components/ApiStatusIndicator.js';
import { 
  Shield, Sparkles, Calendar, Users, ShoppingCart, Settings, 
  Monitor, Laptop, BarChart3, FileText, Lock, Wallet, Workflow, Bell, ListChecks, MessageSquareText
} from 'lucide-react';
import { useOperationsSummary } from '../features/operations/useOperationsSummary.js';
import { SupportModeBanner } from '../features/agency/SupportModeBanner.js';

export const StaffWorkspaceLayout: React.FC = () => {
  const { tenants, activeTenant, setActiveTenant, bookings } = useWorkspace();
  const { authUserId, role, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const operationsCount = useOperationsSummary(role === 'owner');

  // Find the next booking that is pending checkout
  const pendingCheckoutBookings = bookings.filter(
    (b) => b.tenantId === activeTenant?.id && b.status !== 'Cancelled' && b.status !== 'Completed'
  );
  const nextCheckout = pendingCheckoutBookings.length > 0 ? pendingCheckoutBookings[0] : null;

  if (!activeTenant) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white p-6 text-center font-sans">
        <div>
          <span className="animate-spin border-4 border-indigo-500 border-t-transparent rounded-full w-12 h-12 inline-block"></span>
          <p className="mt-4 font-bold text-slate-400">Loading KS OS Database...</p>
        </div>
      </div>
    );
  }

  const handleCheckoutClick = (booking: any) => {
    navigate('/app/pos', { state: { booking } });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans select-none antialiased selection:bg-slate-900 selection:text-white overflow-hidden">
      
      {/* Left Sidebar - Navigation (Compact, High Density) */}
      <aside className="w-16 flex flex-col items-center py-4 bg-slate-900 text-slate-400 border-r border-slate-800 shrink-0 h-screen justify-between">
        <div className="flex flex-col items-center w-full gap-8">
          {/* Logo */}
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black text-sm tracking-widest shadow-md">
            KS
          </div>

          {/* Navigation Items (Representing high level Role/Audience Switching) */}
          <nav className="flex flex-col gap-4 w-full px-2">
            <Link
              to="/book/demo"
              title="Client Booking Widget"
              className="p-2.5 rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center w-full relative group text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <Sparkles className="w-5 h-5" />
              <span className="absolute left-20 bg-slate-900 text-white text-[10px] font-bold px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                Client Widget
              </span>
            </Link>

            <Link
              to="/app/calendar"
              title="Staff Dashboard"
              className={`p-2.5 rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center w-full relative group ${
                location.pathname.startsWith('/app')
                  ? 'bg-indigo-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Monitor className="w-5 h-5" />
              <span className="absolute left-20 bg-slate-900 text-white text-[10px] font-bold px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                Staff Desk
              </span>
            </Link>

            <Link
              to="/agency/system"
              title="Agency Admin Portal"
              className="p-2.5 rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center w-full relative group text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <Shield className="w-5 h-5" />
              <span className="absolute left-20 bg-slate-900 text-white text-[10px] font-bold px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                Control Plane
              </span>
            </Link>
          </nav>
        </div>

        {/* User logout / Role indicator */}
        <div className="flex flex-col items-center gap-4">
          {authUserId && (
            <button
              onClick={() => void signOut()}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center text-[10px] font-bold cursor-pointer"
              title="Log Out Dev Session"
            >
              LO
            </button>
          )}
          <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center justify-center text-xs font-black">
            OS
          </div>
        </div>
      </aside>

      {/* Main Container - Right of Sidebar */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <SupportModeBanner />
        
        {/* Header - Compact High Density white header */}
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-30">
          <div className="flex items-center gap-4">
            <h1 className="text-sm md:text-base font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
              <Laptop className="w-4 h-4 text-indigo-600" />
              <span>{activeTenant.name}</span>
              <span className="text-slate-300 font-normal">|</span>
              <span className="text-slate-400 font-normal text-xs">{activeTenant.subdomain}</span>
            </h1>
            <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-black tracking-wider uppercase">
              {activeTenant.plan} Plan
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick tenant workspace selector */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 py-1 px-2.5 rounded-lg">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                Workspace:
              </span>
              <select
                value={activeTenant.id}
                onChange={(e) => {
                  const found = tenants.find((t) => t.id === e.target.value);
                  if (found) {
                    setActiveTenant(found);
                  }
                }}
                className="bg-transparent text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            
            <ApiStatusIndicator />
          </div>
        </header>

        {/* Sub-tab navigation under staff desk */}
        <div className="h-12 bg-white border-b border-slate-100 flex items-center px-6 shrink-0 z-20 overflow-x-auto scrollbar-none gap-2">
          {role === 'owner' && <Link to="/app/dashboard" className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${location.pathname==='/app/dashboard'?'bg-slate-900 text-white shadow-sm':'text-slate-600 hover:bg-slate-50'}`}><BarChart3 className="w-3.5 h-3.5"/> Overview</Link>}
          {role === 'owner' && <Link to="/app/reports" className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${location.pathname.startsWith('/app/reports')?'bg-slate-900 text-white shadow-sm':'text-slate-600 hover:bg-slate-50'}`}><FileText className="w-3.5 h-3.5"/> Reports</Link>}
          {role === 'owner' && <Link to="/app/analytics" className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${location.pathname.startsWith('/app/analytics')?'bg-slate-900 text-white shadow-sm':'text-slate-600 hover:bg-slate-50'}`}><BarChart3 className="w-3.5 h-3.5"/> Analytics</Link>}
          {role === 'owner' && <Link to="/app/reputation" className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${location.pathname.startsWith('/app/reputation')||location.pathname.startsWith('/app/settings/integrations/reviews')?'bg-slate-900 text-white shadow-sm':'text-slate-600 hover:bg-slate-50'}`}><MessageSquareText className="w-3.5 h-3.5"/> Reputation</Link>}
          <Link
            to="/app/calendar"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
              location.pathname === '/app/calendar' || location.pathname === '/app'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 border border-transparent hover:border-slate-200'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" /> Staff Diary
          </Link>
          <Link
            to="/app/reception"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
              location.pathname === '/app/reception'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 border border-transparent hover:border-slate-200'
            }`}
          >
            <Laptop className="w-3.5 h-3.5" /> Walk-in Desk
          </Link>
          <Link
            to="/app/clients"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
              location.pathname.startsWith('/app/clients')
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 border border-transparent hover:border-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" /> Client Files
          </Link>
          <Link
            to="/app/pos"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
              location.pathname === '/app/pos'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 border border-transparent hover:border-slate-200'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" /> Point of Sale
            {nextCheckout && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
            )}
          </Link>
          <Link
            to="/app/forms"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
              location.pathname === '/app/forms'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 border border-transparent hover:border-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Consent Forms
          </Link>
          <Link
            to="/app/settings"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
              location.pathname === '/app/settings'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 border border-transparent hover:border-slate-200'
            }`}
          >
            <Settings className="w-3.5 h-3.5" /> Brand Setup
          </Link>
          {role === 'owner' && <Link to="/app/settings/team" className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${location.pathname.startsWith('/app/settings/team')?'bg-slate-900 text-white shadow-sm':'text-slate-600 hover:bg-slate-50'}`}><Users className="w-3.5 h-3.5"/> Team</Link>}
          {role === 'owner' && <Link to="/app/settings/booking/customer-management" className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${location.pathname.startsWith('/app/settings/booking')?'bg-slate-900 text-white shadow-sm':'text-slate-600 hover:bg-slate-50'}`}><Calendar className="w-3.5 h-3.5"/> Booking Policies</Link>}
          <Link
            to="/app/payments"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
              location.pathname.startsWith('/app/payments')
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 border border-transparent hover:border-slate-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" /> Payments
          </Link>
          {role === 'owner' && (
            <Link to="/app/operations" className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${location.pathname.startsWith('/app/operations') ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}><Bell className="w-3.5 h-3.5"/> Operations{operationsCount>0&&<span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] text-white">{operationsCount>99?'99+':operationsCount}</span>}</Link>
          )}
          <Link to="/app/tasks/my" className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${location.pathname.startsWith('/app/tasks')?'bg-slate-900 text-white shadow-sm':'text-slate-600 hover:bg-slate-50'}`}><ListChecks className="w-3.5 h-3.5"/> Tasks</Link>
          {role === 'owner' && (
            <Link
              to="/app/automations"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${location.pathname.startsWith('/app/automation') ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 border border-transparent hover:border-slate-200'}`}
            >
              <Workflow className="w-3.5 h-3.5" /> Automations
            </Link>
          )}
          {role === 'owner' && (
            <Link
              to="/app/finance"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                location.pathname.startsWith('/app/finance')
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50 border border-transparent hover:border-slate-200'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" /> Finance
            </Link>
          )}
        </div>

        {/* Main Area */}
        <div className="flex-1 flex overflow-hidden relative bg-slate-50">
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
            <Outlet />
          </div>

          {/* Right Sidebar - POS / Client CRM Summary */}
          <aside className="w-72 bg-white border-l border-slate-200 flex flex-col shrink-0 overflow-y-auto hidden xl:flex text-slate-900 font-sans select-none">
            
            {/* Next Checkout Section */}
            <div className="p-4 border-b border-slate-200/60">
              <h2 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-3">Next Desk Checkout</h2>
              {nextCheckout ? (
                <div className="bg-indigo-950 rounded-2xl p-4 text-white shadow-md border border-indigo-900">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <div className="text-[9px] text-indigo-300 uppercase font-black tracking-wider mb-1">Active Booking</div>
                      <div className="text-xs font-black truncate text-white">{nextCheckout.clientName}</div>
                      <div className="text-[10px] text-indigo-200/80 truncate mt-0.5">{nextCheckout.startTime} ({nextCheckout.duration}m)</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-black text-white">£{nextCheckout.price}</div>
                      <span className="text-[8px] bg-indigo-800 text-indigo-200 font-bold px-1.5 py-0.5 rounded block mt-1 uppercase tracking-tight">
                        {nextCheckout.visitType}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-1.5">
                    <Link
                      to="/app/clients"
                      className="bg-indigo-900/60 hover:bg-indigo-800/80 text-[10px] py-1.5 px-2 rounded-lg text-indigo-200 font-bold border border-indigo-800/50 cursor-pointer transition text-center"
                    >
                      Open File
                    </Link>
                    <button
                      onClick={() => handleCheckoutClick(nextCheckout)}
                      className="bg-white hover:bg-slate-100 text-[10px] py-1.5 px-2 rounded-lg text-slate-900 font-black cursor-pointer transition text-center shadow-xs"
                    >
                      Till Checkout
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 bg-slate-50 border border-dashed rounded-2xl text-center">
                  <p className="text-[10px] text-slate-400 font-bold">No pending checkouts</p>
                </div>
              )}
            </div>

            {/* General Status details placeholder */}
            <div className="p-4 flex-1 text-xs">
              <h3 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-2">Live Logs Pipeline</h3>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                <span className="text-[8px] text-slate-400 block font-mono">Heartbeat: OK</span>
                <span className="text-[10px] font-bold text-slate-700 block mt-1">Tenant ID: {activeTenant.id}</span>
              </div>
            </div>

          </aside>
        </div>

        {/* Footer */}
        <footer className="h-8 bg-slate-50 border-t border-slate-200 flex items-center px-6 justify-between shrink-0 text-[9px] text-slate-400 font-bold uppercase tracking-wide select-none z-10">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
              <span>Workspace Server: Online</span>
            </span>
          </div>
          <div className="flex gap-3">
            <span>Help Desk</span>
            <span>v3.2-Workspace</span>
          </div>
        </footer>

      </div>
    </div>
  );
};
export default StaffWorkspaceLayout;
