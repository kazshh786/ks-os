/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  TrendingUp, Users, Calendar, ShoppingBag, 
  ArrowUpRight, Clock, Star, Zap, 
  Sparkles, CheckCircle2, ChevronRight, MessageSquare, AlertCircle, Play
} from 'lucide-react';
import { BusinessTenant, Booking, Service, Staff, ClientProfile, OutboxEvent } from '../data/types.js';
import { getDataProvider } from '../data/data-provider.js';


interface SaaSDashboardProps {
  tenant: BusinessTenant;
  onNavigateToTab: (tab: 'calendar' | 'reception' | 'crm' | 'checkout' | 'settings') => void;
  onLaunchManualBooking: () => void;
}

export default function SaaSDashboard({ tenant, onNavigateToTab, onLaunchManualBooking }: SaaSDashboardProps) {
  const [timeRange, setTimeRange] = useState<'today' | '7days' | '30days'>('7days');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [events, setEvents] = useState<OutboxEvent[]>([]);

  React.useEffect(() => {
    const loadDashboardData = async () => {
      const provider = getDataProvider();
      const bList = await provider.getBookings();
      const cList = await provider.getClients(tenant.id);
      const sList = await provider.getServices(tenant.id);
      const stList = await provider.getStaff(tenant.id);
      const eList = await provider.getEvents();

      setBookings(bList.filter(b => b.tenantId === tenant.id));
      setClients(cList);
      setServices(sList);
      setStaff(stList);
      setEvents(eList.filter(e => e.clientName !== 'System'));
    };

    loadDashboardData();
  }, [tenant]);

  // Compute stats
  const totalRevenue = bookings
    .filter(b => b.status === 'Completed' || b.status === 'Confirmed')
    .reduce((sum, b) => sum + b.price, 0);

  const completedCount = bookings.filter(b => b.status === 'Completed').length;
  const activeCount = bookings.filter(b => b.status === 'Confirmed' || b.status === 'Pending').length;
  const occupancyRate = staff.length > 0 ? Math.min(100, Math.floor((activeCount / (staff.length * 8)) * 100)) : 0;

  // Revenue trend data for last 7 days
  const revenueTrend = [
    { day: 'Mon', amount: 320, bookings: 4 },
    { day: 'Tue', amount: 480, bookings: 6 },
    { day: 'Wed', amount: 560, bookings: 7 },
    { day: 'Thu', amount: 620, bookings: 8 },
    { day: 'Fri', amount: 790, bookings: 10 },
    { day: 'Sat', amount: 950, bookings: 12 },
    { day: 'Sun', amount: 150, bookings: 2 }
  ];

  // Max value for line chart scaling
  const maxTrendVal = Math.max(...revenueTrend.map(r => r.amount));

  // Popular services distribution
  const serviceDistribution = services.map((s, idx) => {
    const count = bookings.filter(b => b.serviceId === s.id).length;
    const colors = ['bg-indigo-500', 'bg-amber-500', 'bg-rose-500', 'bg-emerald-500', 'bg-violet-500'];
    return {
      name: s.name,
      count,
      percentage: bookings.length > 0 ? Math.floor((count / bookings.length) * 100) : 0,
      color: colors[idx % colors.length]
    };
  }).sort((a, b) => b.count - a.count).slice(0, 4);

  return (
    <div className="space-y-6">
      
      {/* Welcome Hero / SaaS Overview Banner */}
      <div className="bg-slate-900 rounded-3xl p-6 text-white relative overflow-hidden border border-slate-800 shadow-xl">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-radial from-indigo-500/10 to-transparent pointer-events-none"></div>
        <div className="absolute -right-12 -top-12 w-48 h-48 bg-indigo-500/20 rounded-full blur-3xl"></div>
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                SaaS Dashboard Hub
              </span>
              <span className="text-[10px] bg-amber-500/20 border border-amber-500/30 text-amber-300 font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                <Star className="w-2.5 h-2.5 fill-current" /> live operations
              </span>
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight">
              Good evening, {tenant.name} Desk Admin
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-xl">
              Track real-time specialist utilization, incoming digital intake completions, and retail checkout values from your centralized cloud terminal.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 shrink-0">
            <button 
              onClick={onLaunchManualBooking}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-4.5 py-2.5 rounded-xl transition shadow-lg shadow-indigo-500/10 flex items-center gap-1.5 cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-indigo-200" /> Fast Walk-In
            </button>
            <button 
              onClick={() => onNavigateToTab('calendar')}
              className="bg-white/10 hover:bg-white/15 text-white font-extrabold text-xs px-4.5 py-2.5 rounded-xl transition border border-white/10 flex items-center gap-1.5 cursor-pointer"
            >
              <Calendar className="w-3.5 h-3.5 text-slate-300" /> Go to Diary
            </button>
          </div>
        </div>

        {/* Dynamic Micro KPIs Row inside Hero */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-slate-800 text-left">
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Gross Booking Value</span>
            <p className="text-xl font-extrabold text-white mt-1">£{totalRevenue.toFixed(2)}</p>
            <span className="text-[9px] text-emerald-400 font-bold flex items-center gap-0.5 mt-0.5">
              <TrendingUp className="w-2.5 h-2.5" /> +14.2% vs last week
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Occupancy Utilization</span>
            <p className="text-xl font-extrabold text-white mt-1">{occupancyRate}%</p>
            <div className="w-24 bg-slate-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
              <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${occupancyRate}%` }}></div>
            </div>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Active Schedules</span>
            <p className="text-xl font-extrabold text-white mt-1">{activeCount} Pending</p>
            <span className="text-[9px] text-slate-400 font-mono mt-0.5 block">{completedCount} completed today</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Loyal CRM Roster</span>
            <p className="text-xl font-extrabold text-white mt-1">{clients.length} Clients</p>
            <span className="text-[9px] text-indigo-400 font-bold mt-0.5 block hover:underline cursor-pointer" onClick={() => onNavigateToTab('crm')}>
              Open Directory →
            </span>
          </div>
        </div>
      </div>

      {/* Main Grid: Analytical Visualizers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Columns: Revenue and Performance Trends */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Revenue Chart Section */}
          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs">
            <div className="flex justify-between items-center mb-6">
              <div>
                <span className="text-[10px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">Financial Graph</span>
                <h3 className="text-base font-extrabold text-slate-800 mt-1">Earnings & Bookings Stream</h3>
              </div>
              <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                <button 
                  onClick={() => setTimeRange('today')}
                  className={`px-3 py-1 rounded-lg transition ${timeRange === 'today' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Today
                </button>
                <button 
                  onClick={() => setTimeRange('7days')}
                  className={`px-3 py-1 rounded-lg transition ${timeRange === '7days' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  7 Days
                </button>
                <button 
                  onClick={() => setTimeRange('30days')}
                  className={`px-3 py-1 rounded-lg transition ${timeRange === '30days' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  30 Days
                </button>
              </div>
            </div>

            {/* Custom SVG Line Chart */}
            <div className="relative h-48 w-full mt-2 select-none">
              {/* Grid backgrounds */}
              <div className="absolute left-0 right-0 top-0 border-b border-slate-50 h-0"></div>
              <div className="absolute left-0 right-0 top-1/4 border-b border-slate-50 h-0"></div>
              <div className="absolute left-0 right-0 top-2/4 border-b border-slate-100 border-dashed h-0"></div>
              <div className="absolute left-0 right-0 top-3/4 border-b border-slate-50 h-0"></div>
              <div className="absolute left-0 right-0 bottom-0 border-b border-slate-200 h-0"></div>

              {/* Chart Line drawing */}
              <svg className="w-full h-full overflow-visible" viewBox="0 0 700 160">
                <defs>
                  <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.25"/>
                    <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0"/>
                  </linearGradient>
                </defs>

                {/* Draw filled area first */}
                <path
                  d={`M 10 150 
                     L 10 ${150 - (revenueTrend[0].amount / maxTrendVal) * 120} 
                     L 110 ${150 - (revenueTrend[1].amount / maxTrendVal) * 120} 
                     L 210 ${150 - (revenueTrend[2].amount / maxTrendVal) * 120} 
                     L 310 ${150 - (revenueTrend[3].amount / maxTrendVal) * 120} 
                     L 410 ${150 - (revenueTrend[4].amount / maxTrendVal) * 120} 
                     L 510 ${150 - (revenueTrend[5].amount / maxTrendVal) * 120} 
                     L 610 ${150 - (revenueTrend[6].amount / maxTrendVal) * 120} 
                     L 610 150 Z`}
                  fill="url(#chartGrad)"
                />

                {/* Draw path line */}
                <path
                  d={`M 10 ${150 - (revenueTrend[0].amount / maxTrendVal) * 120} 
                     L 110 ${150 - (revenueTrend[1].amount / maxTrendVal) * 120} 
                     L 210 ${150 - (revenueTrend[2].amount / maxTrendVal) * 120} 
                     L 310 ${150 - (revenueTrend[3].amount / maxTrendVal) * 120} 
                     L 410 ${150 - (revenueTrend[4].amount / maxTrendVal) * 120} 
                     L 510 ${150 - (revenueTrend[5].amount / maxTrendVal) * 120} 
                     L 610 ${150 - (revenueTrend[6].amount / maxTrendVal) * 120}`}
                  fill="none"
                  stroke="#4f46e5"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Draw data points */}
                {revenueTrend.map((r, idx) => {
                  const x = 10 + idx * 100;
                  const y = 150 - (r.amount / maxTrendVal) * 120;
                  return (
                    <g key={r.day} className="cursor-pointer group/node">
                      <circle 
                        cx={x} 
                        cy={y} 
                        r="5.5" 
                        className="fill-white stroke-indigo-600 stroke-2 hover:fill-indigo-600 hover:r-7 transition-all duration-150"
                      />
                      {/* Floating Tooltip inside SVG */}
                      <rect 
                        x={x - 30} 
                        y={y - 32} 
                        width="60" 
                        height="20" 
                        rx="5" 
                        className="fill-slate-900 opacity-0 group-hover/node:opacity-100 transition-opacity duration-150"
                      />
                      <text 
                        x={x} 
                        y={y - 18} 
                        textAnchor="middle" 
                        className="fill-white text-[9px] font-black opacity-0 group-hover/node:opacity-100 transition-opacity duration-150 pointer-events-none"
                      >
                        £{r.amount}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Day Labels */}
              <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 text-[10px] font-extrabold text-slate-400 mt-1 uppercase">
                {revenueTrend.map(r => (
                  <span key={r.day}>{r.day}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Action Bento Grid & Recommendations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Quick Action Bento */}
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">Quick Controls</span>
                <h3 className="text-base font-extrabold text-slate-800 mt-1">Terminal Shortcuts</h3>
                <p className="text-xs text-slate-400 mt-0.5">Instant redirection shortcuts around operations.</p>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4">
                <button 
                  onClick={() => onNavigateToTab('calendar')}
                  className="p-3.5 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-950 rounded-2xl border border-slate-100 hover:border-indigo-200 transition text-left flex flex-col justify-between h-24 group cursor-pointer"
                >
                  <Calendar className="w-5 h-5 text-indigo-500 group-hover:scale-110 transition duration-200" />
                  <span className="text-xs font-black text-slate-800 block">Diary Room</span>
                </button>
                <button 
                  onClick={() => onNavigateToTab('reception')}
                  className="p-3.5 bg-slate-50 hover:bg-amber-50 hover:text-amber-950 rounded-2xl border border-slate-100 hover:border-amber-200 transition text-left flex flex-col justify-between h-24 group cursor-pointer"
                >
                  <Clock className="w-5 h-5 text-amber-500 group-hover:scale-110 transition duration-200" />
                  <span className="text-xs font-black text-slate-800 block">Desk Walk-in</span>
                </button>
                <button 
                  onClick={() => onNavigateToTab('crm')}
                  className="p-3.5 bg-slate-50 hover:bg-rose-50 hover:text-rose-950 rounded-2xl border border-slate-100 hover:border-rose-200 transition text-left flex flex-col justify-between h-24 group cursor-pointer"
                >
                  <Users className="w-5 h-5 text-rose-500 group-hover:scale-110 transition duration-200" />
                  <span className="text-xs font-black text-slate-800 block">Client Files</span>
                </button>
                <button 
                  onClick={() => onNavigateToTab('checkout')}
                  className="p-3.5 bg-slate-50 hover:bg-emerald-50 hover:text-emerald-950 rounded-2xl border border-slate-100 hover:border-emerald-200 transition text-left flex flex-col justify-between h-24 group cursor-pointer"
                >
                  <ShoppingBag className="w-5 h-5 text-emerald-500 group-hover:scale-110 transition duration-200" />
                  <span className="text-xs font-black text-slate-800 block">Checkout Till</span>
                </button>
              </div>
            </div>

            {/* AI Optimization / Recommendations Card */}
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider flex items-center gap-1 w-max">
                  <Sparkles className="w-3 h-3 fill-current" /> OS Optimization
                </span>
                <h3 className="text-base font-extrabold text-slate-800 mt-1">Smart Desk Insights</h3>
                <p className="text-xs text-slate-400 mt-0.5">Autonomous recommendations computed just now.</p>
              </div>

              <div className="space-y-3 mt-4 flex-1">
                <div className="flex gap-2.5 items-start text-xs bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100/50">
                  <Star className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5 fill-current" />
                  <div>
                    <p className="font-extrabold text-indigo-950">High Utilization Today</p>
                    <p className="text-[10px] text-indigo-800/80 mt-0.5">Kasim has 92% occupancy. Shift some standard grooming treatments to Sarah for better load distribution.</p>
                  </div>
                </div>

                <div className="flex gap-2.5 items-start text-xs bg-amber-50/50 p-2.5 rounded-xl border border-amber-100/50">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-extrabold text-amber-950">Overbooking Safety Net</p>
                    <p className="text-[10px] text-amber-800/80 mt-0.5">Permit Overbooking is off. This strictly prevents calendar double scheduling unless manually overridden.</p>
                  </div>
                </div>
              </div>
            </div>

          </div>

        </div>

        {/* Right 1 Column: Service Mix & Live Operations Feed */}
        <div className="space-y-6">
          
          {/* Service Mix (Popular Treatments) */}
          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs">
            <span className="text-[10px] text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">Service Mix</span>
            <h3 className="text-base font-extrabold text-slate-800 mt-1">Popular Treatments</h3>
            <p className="text-xs text-slate-400 mt-0.5">Volume distribution of scheduled services.</p>

            <div className="space-y-4 mt-6">
              {serviceDistribution.map((sd) => (
                <div key={sd.name} className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-extrabold text-slate-700 truncate">{sd.name}</span>
                    <span className="font-mono text-slate-400 font-bold">{sd.percentage}% ({sd.count})</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div className={`${sd.color} h-full rounded-full`} style={{ width: `${sd.percentage}%` }}></div>
                  </div>
                </div>
              ))}
              {serviceDistribution.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">No treatments scheduled yet.</p>
              )}
            </div>
          </div>

          {/* Live Webhook Stream / Event Logs */}
          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs flex flex-col h-[280px]">
            <div className="flex justify-between items-center shrink-0 mb-3">
              <div>
                <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">Operations Log</span>
                <h3 className="text-base font-extrabold text-slate-800 mt-1">Live Activity Stream</h3>
              </div>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>

            <div className="flex-1 overflow-y-auto pr-0.5 space-y-3 mt-4">
              {events.slice(0, 8).map((evt) => (
                <div key={evt.id} className="flex gap-2.5 items-start text-xs border-b border-slate-50 pb-2.5 last:border-0 last:pb-0 animate-in fade-in duration-300">
                  <div className="w-6 h-6 bg-slate-50 rounded-lg flex items-center justify-center shrink-0 border border-slate-100 text-slate-600 font-extrabold text-[10px]">
                    {evt.eventType === 'Created' ? '📝' : evt.eventType === 'Completed' ? '✅' : evt.eventType === 'Cancelled' ? '❌' : '🔄'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-800 font-black truncate">{evt.clientName}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {evt.eventType === 'Created' ? 'Created new booking' : 
                       evt.eventType === 'Completed' ? 'Checked out via register' : 
                       evt.eventType === 'Cancelled' ? 'Booking cancelled' : 
                       'Booking parameters adjusted'}
                    </p>
                    <span className="text-[8px] text-slate-400 font-mono block mt-0.5">{evt.timestamp}</span>
                  </div>
                </div>
              ))}
              {events.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-8">Waiting for incoming workspace events...</p>
              )}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
