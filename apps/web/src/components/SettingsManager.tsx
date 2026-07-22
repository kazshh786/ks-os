/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Settings, Save, Users, Sparkles, Clock, Globe, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { BusinessTenant, Service, Staff, StaffSchedule } from '../data/types.js';
import { getDataProvider } from '../data/data-provider.js';


interface SettingsManagerProps {
  tenant: BusinessTenant;
  onSettingsUpdated: () => void;
}

export default function SettingsManager({ tenant, onSettingsUpdated }: SettingsManagerProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'services' | 'staff'>('profile');
  
  // Profile settings
  const [tenantName, setTenantName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [currency, setCurrency] = useState('');
  const [policy, setPolicy] = useState('');

  // Services menu
  const [services, setServices] = useState<Service[]>([]);
  const [newSrvName, setNewSrvName] = useState('');
  const [newSrvPrice, setNewSrvPrice] = useState('');
  const [newSrvDuration, setNewSrvDuration] = useState('30');
  const [newSrvCategory, setNewSrvCategory] = useState('General');

  // Staff menu
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaffForRota, setSelectedStaffForRota] = useState<Staff | null>(null);

  const [notif, setNotif] = useState('');

  useEffect(() => {
    // Load state
    setTenantName(tenant.name);
    setAddress(tenant.address || '');
    setPhone(tenant.phone || '');
    setEmail(tenant.email || '');
    setPrimaryColor(tenant.primaryColor);
    setCurrency(tenant.currency);
    setPolicy(tenant.paymentPolicy);

    const loadSettingsData = async () => {
      const provider = getDataProvider();
      const srvList = await provider.getServices(tenant.id);
      const staffList = await provider.getStaff(tenant.id);
      
      setServices(srvList);
      setStaff(staffList);
      if (staffList.length > 0) setSelectedStaffForRota(staffList[0]);
    };
    
    loadSettingsData();
  }, [tenant]);

  // Save profile information
  const handleSaveProfile = async () => {
    const provider = getDataProvider();
    const tenantsList = await provider.getTenants();
    const updated = tenantsList.map(t => {
      if (t.id === tenant.id) {
        return {
          ...t,
          name: tenantName,
          address,
          phone,
          email,
          primaryColor,
          currency,
          paymentPolicy: policy as any
        };
      }
      return t;
    });

    await provider.saveTenants(updated);
    setNotif('Business Profile and Branding options updated successfully.');
    setTimeout(() => setNotif(''), 3000);
    onSettingsUpdated();
  };

  // Add Service catalog item
  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSrvName || !newSrvPrice) return;

    const newSrv: Service = {
      id: `srv-${Date.now()}`,
      name: newSrvName,
      description: 'Custom added salon menu option.',
      price: parseFloat(newSrvPrice),
      durationMin: parseInt(newSrvDuration),
      category: newSrvCategory
    };

    const updated = [...services, newSrv];
    const provider = getDataProvider();
    await provider.saveServices(tenant.id, updated);
    setServices(updated);

    setNewSrvName('');
    setNewSrvPrice('');
    
    setNotif(`Added new service: ${newSrvName}`);
    setTimeout(() => setNotif(''), 2500);
    onSettingsUpdated();
  };

  // Delete Service catalog item
  const handleDeleteService = async (id: string) => {
    const updated = services.filter(s => s.id !== id);
    const provider = getDataProvider();
    await provider.saveServices(tenant.id, updated);
    setServices(updated);
    onSettingsUpdated();
  };

  // Toggle Day Off on Staff schedule
  const handleToggleStaffSchedule = async (dayIdx: number, field: 'isOff' | 'shopStart' | 'shopEnd' | 'mobileStart' | 'mobileEnd' | 'shopActive' | 'mobileActive', value: any) => {
    if (!selectedStaffForRota) return;

    const updatedSchedules = selectedStaffForRota.schedules.map(sched => {
      if (sched.dayOfWeek === dayIdx) {
        return {
          ...sched,
          [field]: value
        };
      }
      return sched;
    });

    const updatedStaffList = staff.map(st => {
      if (st.id === selectedStaffForRota.id) {
        return {
          ...st,
          schedules: updatedSchedules
        };
      }
      return st;
    });

    const provider = getDataProvider();
    await provider.saveStaff(tenant.id, updatedStaffList);
    setStaff(updatedStaffList);
    setSelectedStaffForRota({
      ...selectedStaffForRota,
      schedules: updatedSchedules
    });

    setNotif(`Updated schedules configuration for ${selectedStaffForRota.name}.`);
    setTimeout(() => setNotif(''), 2500);
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden max-w-4xl mx-auto font-sans">
      {/* Header Tabs */}
      <div className="bg-slate-950 p-6 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold flex items-center gap-2"><Settings className="w-5 h-5 text-indigo-400" /> Business configuration</h2>
          <p className="text-xs text-slate-400 mt-1">Configure workspace rules, service menus, and staff rotas.</p>
        </div>

        <div className="flex gap-1.5 bg-white/10 p-1 rounded-xl text-xs font-bold w-full md:w-auto">
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex-1 md:flex-none px-4 py-2 rounded-lg transition ${activeTab === 'profile' ? 'bg-white text-slate-950 shadow' : 'hover:bg-white/5'}`}
          >
            🏢 Brand Profile
          </button>
          <button
            onClick={() => setActiveTab('services')}
            className={`flex-1 md:flex-none px-4 py-2 rounded-lg transition ${activeTab === 'services' ? 'bg-white text-slate-950 shadow' : 'hover:bg-white/5'}`}
          >
            ✂️ Menu Catalog
          </button>
          <button
            onClick={() => setActiveTab('staff')}
            className={`flex-1 md:flex-none px-4 py-2 rounded-lg transition ${activeTab === 'staff' ? 'bg-white text-slate-950 shadow' : 'hover:bg-white/5'}`}
          >
            📅 Staff Rota hours
          </button>
        </div>
      </div>

      {notif && (
        <div className="bg-emerald-50 border-b border-emerald-100 p-4 text-xs text-emerald-800 flex gap-2 items-center">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span className="font-bold">{notif}</span>
        </div>
      )}

      <div className="p-8">
        {/* Tab 1: Profile & Custom Branding */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <h3 className="text-sm font-black uppercase text-slate-400 tracking-wider">Workspace Profile & Brand styling</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs font-bold text-slate-600">
              <div>
                <label className="block mb-1 text-slate-400 uppercase tracking-wider">Trading Name</label>
                <input
                  type="text"
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border rounded-xl text-slate-800 focus:outline-none"
                />
              </div>

              <div>
                <label className="block mb-1 text-slate-400 uppercase tracking-wider">Business Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border rounded-xl text-slate-800 focus:outline-none"
                />
              </div>

              <div>
                <label className="block mb-1 text-slate-400 uppercase tracking-wider">Phone Line</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border rounded-xl text-slate-800 focus:outline-none"
                />
              </div>

              <div>
                <label className="block mb-1 text-slate-400 uppercase tracking-wider">Premises Street Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border rounded-xl text-slate-800 focus:outline-none"
                />
              </div>

              <div>
                <label className="block mb-1 text-slate-400 uppercase tracking-wider">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border rounded-xl text-slate-800 focus:outline-none"
                >
                  <option value="GBP">GBP (£)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>

              <div>
                <label className="block mb-1 text-slate-400 uppercase tracking-wider">Primary Theme Hex Color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-10 h-10 p-0.5 border rounded-xl cursor-pointer"
                  />
                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="flex-1 p-2 bg-slate-50 border rounded-xl text-center font-mono focus:outline-none"
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block mb-1 text-slate-400 uppercase tracking-wider">Global Online Booking Policy</label>
                <select
                  value={policy}
                  onChange={(e) => setPolicy(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border rounded-xl text-slate-800 focus:outline-none"
                >
                  <option value="NoPayment">Pay at checkout in person (Later)</option>
                  <option value="Deposit">30% Online pre-payment holding deposit</option>
                  <option value="FullPayment">100% Pre-payment required to book</option>
                  <option value="CustomerChoice">Customer Choice at booking step</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleSaveProfile}
              className="mt-4 bg-slate-950 text-white font-bold text-xs px-5 py-3 rounded-2xl flex items-center gap-1 hover:opacity-90 transition"
            >
              <Save className="w-4 h-4" /> Save Business Profile
            </button>
          </div>
        )}

        {/* Tab 2: Service Catalog Menu Management */}
        {activeTab === 'services' && (
          <div className="space-y-6">
            <h3 className="text-sm font-black uppercase text-slate-400 tracking-wider">Modify Service Menus & Catalog</h3>

            {/* List existing */}
            <div className="border border-slate-100 rounded-2xl divide-y max-h-60 overflow-y-auto">
              {services.map((srv) => (
                <div key={srv.id} className="p-3.5 flex justify-between items-center text-xs">
                  <div>
                    <span className="text-[9px] font-bold bg-slate-100 px-1.5 py-0.5 rounded uppercase text-slate-400">
                      {srv.category}
                    </span>
                    <p className="font-extrabold text-slate-800 mt-1">{srv.name}</p>
                    <p className="text-slate-400 mt-0.5">{srv.durationMin} mins duration</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-black text-slate-900 text-sm">£{srv.price}</span>
                    <button
                      onClick={() => handleDeleteService(srv.id)}
                      className="p-1 text-rose-500 hover:bg-rose-50 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add menu item */}
            <form onSubmit={handleAddService} className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-4">
              <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Add menu offering
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs font-bold text-slate-600">
                <div className="sm:col-span-2">
                  <label className="block mb-1 text-slate-400">Treatment / Service Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Skin Peel"
                    value={newSrvName}
                    onChange={(e) => setNewSrvName(e.target.value)}
                    className="w-full p-2.5 bg-white border rounded-xl text-slate-800 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-400">Category Tag</label>
                  <input
                    type="text"
                    value={newSrvCategory}
                    onChange={(e) => setNewSrvCategory(e.target.value)}
                    className="w-full p-2.5 bg-white border rounded-xl text-slate-800 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-400">Price (£)</label>
                  <input
                    type="number"
                    required
                    placeholder="45"
                    value={newSrvPrice}
                    onChange={(e) => setNewSrvPrice(e.target.value)}
                    className="w-full p-2.5 bg-white border rounded-xl text-slate-800 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-400">Duration (mins)</label>
                  <select
                    value={newSrvDuration}
                    onChange={(e) => setNewSrvDuration(e.target.value)}
                    className="w-full p-2.5 bg-white border rounded-xl text-slate-800 focus:outline-none"
                  >
                    <option value="15">15 mins</option>
                    <option value="30">30 mins</option>
                    <option value="45">45 mins</option>
                    <option value="60">60 mins</option>
                    <option value="90">90 mins</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="bg-slate-950 text-white font-bold text-xs px-4 py-2.5 rounded-xl hover:opacity-90 shadow"
              >
                Insert to Service Menu Catalog
              </button>
            </form>
          </div>
        )}

        {/* Tab 3: Staff Schedules & Rota Roster */}
        {activeTab === 'staff' && (
          <div className="space-y-6">
            <h3 className="text-sm font-black uppercase text-slate-400 tracking-wider">Configure Staff Operating schedules</h3>
            
            <div className="flex gap-4">
              <label className="text-xs font-bold text-slate-500 shrink-0 self-center">Select Employee profile:</label>
              <select
                value={selectedStaffForRota?.id || ''}
                onChange={(e) => setSelectedStaffForRota(staff.find(st => st.id === e.target.value) || null)}
                className="p-2 border rounded-xl font-bold text-slate-800 text-xs cursor-pointer focus:outline-none focus:ring-1"
              >
                {staff.map(st => (
                  <option key={st.id} value={st.id}>{st.name} ({st.role})</option>
                ))}
              </select>
            </div>

            {selectedStaffForRota && (
              <div className="border border-slate-100 rounded-3xl p-5 bg-slate-50/50 space-y-4 text-xs font-bold text-slate-600">
                <h4 className="text-xs font-black text-slate-800">Weekly Hours for {selectedStaffForRota.name}</h4>
                
                <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto space-y-2.5">
                  {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((dayName, idx) => {
                    const sched = selectedStaffForRota.schedules.find(s => s.dayOfWeek === idx) || { dayOfWeek: idx, isOff: true };

                    return (
                      <div key={idx} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="w-24">
                          <p className="text-slate-800 font-extrabold">{dayName}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-4">
                          {/* Day Off Switcher */}
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={sched.isOff}
                              onChange={(e) => handleToggleStaffSchedule(idx, 'isOff', e.target.checked)}
                              className="rounded focus:ring-slate-800"
                            />
                            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Roster Day Off</span>
                          </label>

                          {!sched.isOff && (
                            <React.Fragment>
                              {/* Shop hours */}
                              <div className="flex items-center gap-2 bg-white p-1.5 rounded-lg border">
                                <label className="flex items-center gap-1.5 cursor-pointer pr-1 border-r border-slate-100 mr-1">
                                  <input
                                    type="checkbox"
                                    checked={sched.shopActive !== false}
                                    onChange={(e) => handleToggleStaffSchedule(idx, 'shopActive', e.target.checked)}
                                    className="rounded focus:ring-slate-800"
                                  />
                                  <span className="text-[8px] text-slate-500 font-black uppercase">Salon/Shop:</span>
                                </label>
                                {(sched.shopActive !== false) ? (
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="text"
                                      value={sched.shopStart || '09:00'}
                                      onChange={(e) => handleToggleStaffSchedule(idx, 'shopStart', e.target.value)}
                                      className="w-11 text-center font-mono focus:outline-none border-b border-slate-200 focus:border-indigo-500 text-slate-800 font-bold"
                                    />
                                    <span className="text-[9px] text-slate-400">-</span>
                                    <input
                                      type="text"
                                      value={sched.shopEnd || '18:00'}
                                      onChange={(e) => handleToggleStaffSchedule(idx, 'shopEnd', e.target.value)}
                                      className="w-11 text-center font-mono focus:outline-none border-b border-slate-200 focus:border-indigo-500 text-slate-800 font-bold"
                                    />
                                  </div>
                                ) : (
                                  <span className="text-[9px] text-slate-400 italic">Not Offered Today</span>
                                )}
                              </div>

                              {/* Mobile travel hours */}
                              <div className="flex items-center gap-2 bg-indigo-50/50 p-1.5 rounded-lg border border-indigo-100">
                                <label className="flex items-center gap-1.5 cursor-pointer pr-1 border-r border-indigo-100 mr-1">
                                  <input
                                    type="checkbox"
                                    checked={sched.mobileActive !== false && (sched.mobileActive !== undefined || !!sched.mobileStart)}
                                    onChange={(e) => handleToggleStaffSchedule(idx, 'mobileActive', e.target.checked)}
                                    className="rounded focus:ring-indigo-600"
                                  />
                                  <span className="text-[8px] text-indigo-500 font-black uppercase">Mobile Travel:</span>
                                </label>
                                {(sched.mobileActive !== false && (sched.mobileActive !== undefined || !!sched.mobileStart)) ? (
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="text"
                                      value={sched.mobileStart || '10:00'}
                                      onChange={(e) => handleToggleStaffSchedule(idx, 'mobileStart', e.target.value)}
                                      className="w-11 text-indigo-700 font-mono focus:outline-none bg-transparent border-b border-indigo-200 focus:border-indigo-600 font-bold"
                                    />
                                    <span className="text-[9px] text-indigo-400">-</span>
                                    <input
                                      type="text"
                                      value={sched.mobileEnd || '17:00'}
                                      onChange={(e) => handleToggleStaffSchedule(idx, 'mobileEnd', e.target.value)}
                                      className="w-11 text-indigo-700 font-mono focus:outline-none bg-transparent border-b border-indigo-200 focus:border-indigo-600 font-bold"
                                    />
                                  </div>
                                ) : (
                                  <span className="text-[9px] text-indigo-400 italic">Not Offered Today</span>
                                )}
                              </div>
                            </React.Fragment>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
