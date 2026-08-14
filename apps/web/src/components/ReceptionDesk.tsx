/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { Search, Plus, UserPlus, Sliders, Calendar, Clock, AlertTriangle, CheckCircle2, User, Sparkles, ChevronLeft, ChevronRight, RefreshCw, Lock } from 'lucide-react';
import { fromZonedTime } from 'date-fns-tz';
import { BusinessTenant, Service, Staff, ClientProfile, Booking, Resource } from '../data/types.js';
import { getDataProvider } from '../data/data-provider.js';


interface ReceptionDeskProps {
  tenant: BusinessTenant;
  onBookingCompleted: () => void;
}

export default function ReceptionDesk({ tenant, onBookingCompleted }: ReceptionDeskProps) {
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);

  // Search/Lookup
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<ClientProfile | null>(null);
  const [isCreatingClient, setIsCreatingClient] = useState(false);

  // Block time / Exclusivity simulation states
  const [isPersonalBlock, setIsPersonalBlock] = useState(false);
  const [blockReason, setBlockReason] = useState('Personal Break');
  const [blockDuration, setBlockDuration] = useState(30);

  // New Client fields
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');

  // Booking selections
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [selectedDate, setSelectedDate] = useState('2026-07-16');
  const [selectedTime, setSelectedTime] = useState('11:00');
  const [selectedResource, setSelectedResource] = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(2026);
  const [pickerMonth, setPickerMonth] = useState(6); // July (0-indexed)

  const [showTimePicker, setShowTimePicker] = useState(false);

  const parseTime12h = (time24: string) => {
    if (!time24) return { hour12: '11', minute: '00', isPM: false };
    const [hStr, mStr] = time24.split(':');
    const h = parseInt(hStr) || 11;
    const minute = mStr || '00';
    const isPM = h >= 12;
    let hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return {
      hour12: hour12.toString().padStart(2, '0'),
      minute: minute.padStart(2, '0'),
      isPM
    };
  };

  const formatTime24h = (hour12: string, minute: string, isPM: boolean) => {
    let h = parseInt(hour12) || 9;
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
    return `${h.toString().padStart(2, '0')}:${minute}`;
  };

  const formatTimeFriendly = (time24: string) => {
    const { hour12, minute, isPM } = parseTime12h(time24);
    return `${hour12}:${minute} ${isPM ? 'PM' : 'AM'}`;
  };

  const formatFriendlyDate = (dateStr: string) => {
    if (!dateStr) return 'Select Date';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  };

  // Conflict state
  const [hasStaffConflict, setHasStaffConflict] = useState(false);
  const [hasResourceConflict, setHasResourceConflict] = useState(false);
  const [overrideAllowed, setOverrideAllowed] = useState(false);

  const [isSuccess, setIsSuccess] = useState(false);
  const [newBookingRef, setNewBookingRef] = useState('');

  useEffect(() => {
    const loadReceptionData = async () => {
      const provider = getDataProvider();
      let cList = [];
      try {
        cList = await provider.getClients(tenant.id);
      } catch (err) {
        // Fallback or ignore if not implemented in Phase 3
        cList = [];
      }
      const sList = await provider.getServices(tenant.id);
      const stList = await provider.getStaff(tenant.id);
      
      setClients(cList);
      setServices(sList);
      setStaffList(stList);
      
      // Seed default resources
      if (tenant.id === 'sovereign-gents') {
        setResources([
          { id: 'res-chair-1', name: 'Barber Chair 1', type: 'Chair', capacity: 1 },
          { id: 'res-chair-2', name: 'Barber Chair 2', type: 'Chair', capacity: 1 }
        ]);
      } else {
        setResources([
          { id: 'res-facial-suite', name: 'Private Room A - Facial Suite', type: 'Room', capacity: 1 },
          { id: 'res-nail-station-1', name: 'Nail Station 1', type: 'Chair', capacity: 1 }
        ]);
      }
    };
    
    loadReceptionData();
  }, [tenant]);

  // Handle Dynamic Collision Checking
  useEffect(() => {
    if (!selectedService || !selectedStaff) return;

    const checkConflicts = async () => {
      const provider = getDataProvider();
      const bList = await provider.getBookings();
      const allBookings = bList.filter(b => 
        b.tenantId === tenant.id && 
        b.date === selectedDate && 
        b.status !== 'Cancelled'
      );

      const bookingStart = selectedTime;
      const duration = selectedService.durationMin;
      const bookingEnd = calculateEndTime(selectedTime, duration);

      // 1. Check if staff is already booked
      const staffBooked = allBookings.some(b => 
        b.staffId === selectedStaff.id &&
        isOverlapping(bookingStart, bookingEnd, b.startTime, b.endTime)
      );

      // 2. Check if resource is already booked
      const resourceIdToCheck = selectedResource || selectedService.requiresResource;
      const resourceBooked = resourceIdToCheck ? allBookings.some(b => 
        b.resourceId === resourceIdToCheck &&
        isOverlapping(bookingStart, bookingEnd, b.startTime, b.endTime)
      ) : false;

      setHasStaffConflict(staffBooked);
      setHasResourceConflict(resourceBooked);
    };

    checkConflicts();
  }, [selectedService, selectedStaff, selectedDate, selectedTime, selectedResource, tenant]);

  const isOverlapping = (start1: string, end1: string, start2: string, end2: string) => {
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    return Math.max(toMin(start1), toMin(start2)) < Math.min(toMin(end1), toMin(end2));
  };

  const calculateEndTime = (start: string, duration: number) => {
    const [h, m] = start.split(':').map(Number);
    const total = h * 60 + m + duration;
    return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
  };

  // Filter client search
  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone.includes(searchQuery)
  );

  const handleQuickClientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName || !newClientPhone) return;

    const newClientObj: ClientProfile = {
      id: `cl-${Date.now()}`,
      name: newClientName,
      email: newClientEmail || `${newClientName.toLowerCase().replace(/\s+/g, '')}@example.com`,
      phone: newClientPhone,
      loyaltyPoints: 0,
      walletBalance: 0,
      giftCardBalance: 0,
      packages: [],
      formSubmissions: []
    };

    const updated = [...clients, newClientObj];
    const provider = getDataProvider();
    await provider.saveClients(tenant.id, updated);
    setClients(updated);
    setSelectedClient(newClientObj);
    
    // reset fields
    setNewClientName('');
    setNewClientEmail('');
    setNewClientPhone('');
    setIsCreatingClient(false);
  };

  const handleCompleteManualBooking = async () => {
    const provider = getDataProvider();
    
    if (isPersonalBlock) {
      if (!selectedStaff) {
        alert('Please select a Specialist / Staff member.');
        return;
      }
      
      const requestPayload = {
        serviceId: 'personal-block',
        staffId: selectedStaff.id,
        startTime: fromZonedTime(`${selectedDate}T${selectedTime}:00`, tenant.timezone).toISOString(),
        client: {
          name: `🔒 Block: ${blockReason}`,
          email: 'personal@block.internal',
          phone: 'N/A'
        },
        bookingChannel: 'in_shop',
        mobileAddress: null,
        paymentMode: 'pay_later',
        payNow: false,
        resourceId: null,
        internalNotes: `Calendar time blocked: ${blockReason}`
      };

      try {
        const result = await provider.createStaffBooking(requestPayload);
        onBookingCompleted();
        setIsPersonalBlock(false);
      } catch (err) {
        alert('Failed to block calendar: ' + (err as Error).message);
      }
      return;
    }

    if (!selectedClient || !selectedService || !selectedStaff) return;

    if ((hasStaffConflict || hasResourceConflict) && !overrideAllowed) {
      alert('Cannot book due to schedules conflict. Please toggle "Permit Overbooking Override" if authorized.');
      return;
    }

    const requestPayload = {
      serviceId: selectedService.id,
      staffId: selectedStaff.id,
      startTime: fromZonedTime(`${selectedDate}T${selectedTime}:00`, tenant.timezone).toISOString(),
      client: {
        name: selectedClient.name,
        email: selectedClient.email,
        phone: selectedClient.phone
      },
      bookingChannel: 'in_shop',
      mobileAddress: null,
      paymentMode: 'pay_later',
      payNow: false,
      resourceId: selectedResource || selectedService.requiresResource || null,
      internalNotes: internalNotes || 'Created via physical reception desk.'
    };

    try {
      const result = await provider.createStaffBooking(requestPayload);
      setNewBookingRef(result.booking.reference);
      setIsSuccess(true);
    } catch (err) {
      alert('Failed to create booking: ' + (err as Error).message);
      return;
    }

    setTimeout(() => {
      setIsSuccess(false);
      setSelectedClient(null);
      setSelectedService(null);
      setInternalNotes('');
      onBookingCompleted();
      // Notify components to update
      window.dispatchEvent(new CustomEvent('ks-bookings-updated'));
    }, 2000);
  };

  return (
    <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-slate-100 bg-white font-sans shadow-xl sm:rounded-3xl">
      {/* Header */}
      <div className="flex flex-col gap-3 bg-slate-950 p-4 text-white sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold tracking-tight">Reception Booking Desk</h2>
          <p className="text-xs text-slate-400 mt-1">
            Log telephone walk-ins, manage client files, and allocate salon resources.
          </p>
        </div>
        <div className="w-fit rounded-full bg-white/10 px-3 py-1.5 font-mono text-xs font-bold text-slate-200">
          Operator Console
        </div>
      </div>

      {/* Dynamic Booking/Block Type Selector */}
      <div className="mx-3 mt-4 grid max-w-lg grid-cols-2 rounded-2xl border border-slate-200 bg-slate-100 p-1 sm:mx-8 sm:mt-6">
        <button
          type="button"
          onClick={() => {
            setIsPersonalBlock(false);
          }}
          className={`flex min-h-14 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-center text-xs font-bold transition cursor-pointer select-none ${
            !isPersonalBlock
              ? 'bg-white text-slate-900 shadow-sm font-extrabold'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <User className="w-3.5 h-3.5 text-indigo-600" /> Standard Customer Appointment
        </button>
        <button
          type="button"
          onClick={() => {
            setIsPersonalBlock(true);
            setSelectedClient(null);
          }}
          className={`flex min-h-14 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-center text-xs font-bold transition cursor-pointer select-none ${
            isPersonalBlock
              ? 'bg-slate-900 text-white shadow-sm font-extrabold'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Lock className="w-3.5 h-3.5 text-amber-400 animate-pulse" /> 🔒 Block Personal / Time Hold
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 p-4 pt-4 sm:p-6 md:grid-cols-2 md:gap-8 lg:p-8 lg:pt-4">
        {/* Left Side: Client Search & Quick Client Setup OR Personal Block */}
        <div className="space-y-6">
          {isPersonalBlock ? (
            <div className="border-b pb-4 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-indigo-600" /> 1. Configure Calendar Block / Time Hold
              </h3>
              
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Block Reason / Label</label>
                <input
                  type="text"
                  placeholder="e.g. Lunch Break, Staff Training, Personal Appointment..."
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
                
                {/* Preset quick buttons */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {['Personal Break', 'Lunch Break', 'Staff Training', 'Buffer Time', 'Exclusivity Guard (Fake Busy)'].map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setBlockReason(preset)}
                      className={`min-h-11 rounded-lg border px-2.5 py-1 text-[10px] font-bold transition cursor-pointer select-none ${
                        blockReason === preset
                          ? 'bg-slate-900 text-white border-slate-900 font-black'
                          : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Block Duration</label>
                <select
                  value={blockDuration}
                  onChange={(e) => setBlockDuration(Number(e.target.value))}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs font-bold text-slate-800 focus:outline-none"
                >
                  <option value={15}>15 Minutes</option>
                  <option value={30}>30 Minutes</option>
                  <option value={45}>45 Minutes</option>
                  <option value={60}>1 Hour</option>
                  <option value={90}>1.5 Hours</option>
                  <option value={120}>2 Hours</option>
                  <option value={240}>4 Hours</option>
                  <option value={480}>All Day (8 Hours)</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="border-b pb-4">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-1.5">
                <Search className="w-4 h-4 text-slate-400" /> 1. Client Search & Directory
              </h3>
            
            {!selectedClient ? (
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search existing client by name or phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-950"
                  />
                </div>

                {searchQuery && (
                  <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-xl divide-y bg-white">
                    {filteredClients.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedClient(c)}
                        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 p-3 text-left text-xs hover:bg-slate-50"
                      >
                        <div>
                          <p className="font-bold text-slate-800">{c.name}</p>
                          <p className="text-slate-400 mt-0.5">{c.phone}</p>
                        </div>
                        <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-full font-bold text-slate-500">
                          {c.loyaltyPoints} pts
                        </span>
                      </button>
                    ))}
                    {filteredClients.length === 0 && (
                      <div className="p-4 text-center text-xs text-slate-400 font-medium">No clients found</div>
                    )}
                  </div>
                )}

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => setIsCreatingClient(!isCreatingClient)}
                    className="mx-auto flex min-h-11 items-center justify-center gap-1 text-xs font-bold text-slate-950 hover:underline"
                  >
                    <UserPlus className="w-4 h-4" /> Or Register Walk-in Client Instantly
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="min-w-0">
                    <h4 className="font-bold text-slate-950 text-sm">{selectedClient.name}</h4>
                    <p className="mt-0.5 break-all text-xs text-slate-500">{selectedClient.phone} • {selectedClient.email}</p>
                    <p className="text-[10px] text-indigo-600 font-bold mt-1.5">★ {selectedClient.loyaltyPoints} Loyalty Balance</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedClient(null)}
                    className="min-h-11 shrink-0 rounded-xl bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-500 hover:bg-rose-100"
                  >
                    Change
                  </button>
                </div>

                {bookings.filter(b => b.clientName === selectedClient.name && b.paymentStatus !== 'FullyPaid' && b.status !== 'Cancelled').length > 0 && (
                  <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl">
                    <h5 className="text-xs font-bold text-amber-800 mb-2">Unpaid Appointments</h5>
                    <div className="space-y-2">
                      {bookings.filter(b => b.clientName === selectedClient.name && b.paymentStatus !== 'FullyPaid' && b.status !== 'Cancelled').map(b => (
                        <div key={b.id} className="flex justify-between items-center bg-white p-2 rounded-xl border border-amber-200">
                          <div>
                            <p className="text-[10px] font-bold text-slate-800">{b.date} • {b.startTime}</p>
                            <p className="text-[10px] text-slate-500">Amount: £{b.price}</p>
                          </div>
                          <Link to={`/app/pos?appointmentId=${b.id}`} className="inline-flex min-h-11 items-center text-[10px] font-bold text-indigo-600 hover:underline">
                            Take payment &rarr;
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {/* Quick Client Creator Dialog */}
          {isCreatingClient && (
            <form onSubmit={handleQuickClientSubmit} className="bg-slate-50 border border-slate-200/50 p-5 rounded-2xl space-y-3.5">
              <h4 className="text-xs font-extrabold text-slate-800 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Quick CRM Client Profile Setup
              </h4>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Client Full Name (Required)"
                  required
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  className="min-h-11 w-full rounded-xl border bg-white p-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-950"
                />
                <input
                  type="tel"
                  placeholder="Mobile Phone Number (Required)"
                  required
                  value={newClientPhone}
                  onChange={(e) => setNewClientPhone(e.target.value)}
                  className="min-h-11 w-full rounded-xl border bg-white p-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-950"
                />
                <input
                  type="email"
                  placeholder="Email Address (Optional)"
                  value={newClientEmail}
                  onChange={(e) => setNewClientEmail(e.target.value)}
                  className="min-h-11 w-full rounded-xl border bg-white p-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-950"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-bold sm:flex sm:justify-end">
                <button
                  type="button"
                  onClick={() => setIsCreatingClient(false)}
                  className="min-h-11 px-3 py-1.5 text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-11 rounded-lg bg-slate-950 px-4 py-1.5 text-white shadow-sm hover:opacity-90"
                >
                  Create & Select
                </button>
              </div>
            </form>
          )}

          {/* Service & Staff Selectors */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-indigo-600 animate-spin" style={{ animationDuration: '4s' }} /> 2. Booking Service & Specialist
            </h3>

            {!isPersonalBlock ? (
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Select Service</label>
                <select
                  value={selectedService?.id || ''}
                  onChange={(e) => setSelectedService(services.find(s => s.id === e.target.value) || null)}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs font-bold text-slate-800 focus:outline-none"
                >
                  <option value="">-- Choose service catalog --</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>{s.name} (£{s.price} - {s.durationMin} mins)</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200/50 p-3 rounded-xl">
                <span className="text-[10px] font-bold text-indigo-600 block mb-0.5">🔒 Activity Action Type</span>
                <p className="text-xs font-extrabold text-slate-800">🔒 Personal Calendar Hold (No Service Required)</p>
              </div>
            )}

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                {isPersonalBlock ? 'Block Calendar of Specialist' : 'Assign Specialist'}
              </label>
              <select
                value={selectedStaff?.id || ''}
                onChange={(e) => setSelectedStaff(staffList.find(s => s.id === e.target.value) || null)}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs font-bold text-slate-800 focus:outline-none"
              >
                <option value="">-- Choose professional --</option>
                {staffList.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Right Side: Appointment Timers, Resources, and Collision Alerts */}
        <div className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-slate-500" /> 3. Calendar & Date/Time
            </h3>

            <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Target Date</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDatePicker(!showDatePicker);
                      const [y, m] = selectedDate.split('-').map(Number);
                      if (y && m) {
                        setPickerYear(y);
                        setPickerMonth(m - 1);
                      }
                    }}
                    className="flex min-h-11 w-full cursor-pointer select-none items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs font-black text-slate-800 shadow-3xs transition hover:bg-slate-100"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span className="truncate">{formatFriendlyDate(selectedDate)}</span>
                    </div>
                  </button>

                  {showDatePicker && (
                    <>
                      {/* Backdrop */}
                      <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
                      <div className="fixed inset-x-0 bottom-0 z-50 w-full animate-in rounded-t-3xl border border-slate-200 bg-white p-3 shadow-xl duration-150 fade-in slide-in-from-bottom-1 sm:absolute sm:bottom-auto sm:left-0 sm:mt-2 sm:w-72 sm:rounded-2xl sm:p-4 sm:slide-in-from-top-1">
                        
                        {/* Month Navigation */}
                        <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (pickerMonth === 0) {
                                setPickerMonth(11);
                                setPickerYear(pickerYear - 1);
                              } else {
                                setPickerMonth(pickerMonth - 1);
                              }
                            }}
                            className="grid h-11 w-11 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <span className="text-xs font-black text-slate-800">
                            {new Date(pickerYear, pickerMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (pickerMonth === 11) {
                                setPickerMonth(0);
                                setPickerYear(pickerYear + 1);
                              } else {
                                setPickerMonth(pickerMonth + 1);
                              }
                            }}
                            className="grid h-11 w-11 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Weekday labels */}
                        <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-black uppercase text-slate-400 sm:gap-1">
                          <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
                        </div>

                        {/* Days Grid */}
                        <div className="grid grid-cols-7 gap-0.5 text-center sm:gap-1">
                          {Array.from({ length: new Date(pickerYear, pickerMonth, 1).getDay() }).map((_, i) => (
                            <div key={`empty-${i}`} className="h-11 w-full" />
                          ))}

                          {Array.from({ length: new Date(pickerYear, pickerMonth + 1, 0).getDate() }).map((_, i) => {
                            const dayNum = i + 1;
                            const dateStr = `${pickerYear}-${(pickerMonth + 1).toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
                            const isSelected = selectedDate === dateStr;
                            const isToday = '2026-07-16' === dateStr;

                            return (
                              <button
                                key={`day-${dayNum}`}
                                type="button"
                                onClick={() => {
                                  setSelectedDate(dateStr);
                                  setShowDatePicker(false);
                                }}
                                className={`flex h-11 w-full cursor-pointer items-center justify-center rounded-lg text-xs font-bold transition ${
                                  isSelected
                                    ? 'bg-slate-900 text-white font-black'
                                    : isToday
                                      ? 'bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100'
                                      : 'hover:bg-slate-100 text-slate-700'
                                }`}
                              >
                                {dayNum}
                              </button>
                            );
                          })}
                        </div>

                        {/* Preset to Today */}
                        <div className="mt-3 pt-2.5 border-t border-slate-100 flex justify-between items-center text-[10px]">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDate('2026-07-16');
                              setPickerYear(2026);
                              setPickerMonth(6);
                              setShowDatePicker(false);
                            }}
                            className="flex min-h-11 cursor-pointer items-center gap-1 font-black uppercase text-indigo-600 transition hover:text-indigo-800"
                          >
                            <RefreshCw className="w-3 h-3 text-indigo-500 animate-spin" style={{ animationDuration: '6s' }} /> Go to Today
                          </button>
                          <span className="font-mono text-slate-400 font-semibold">2026-07-16</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Start Time</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowTimePicker(!showTimePicker)}
                    className="flex min-h-11 w-full cursor-pointer select-none items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs font-black text-slate-800 shadow-3xs transition hover:bg-slate-100"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Clock className="w-3.5 h-3.5 text-indigo-600 shrink-0 animate-pulse" />
                      <span className="truncate">{formatTimeFriendly(selectedTime)}</span>
                    </div>
                  </button>

                  {showTimePicker && (() => {
                    const { hour12, minute, isPM } = parseTime12h(selectedTime);
                    const hours = Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0'));
                    const minutes = ['00', '15', '30', '45'];
                    return (
                      <>
                        {/* Backdrop */}
                        <div className="fixed inset-0 z-40" onClick={() => setShowTimePicker(false)} />
                        <div className="fixed inset-x-0 bottom-0 z-50 w-full animate-in rounded-t-3xl border border-slate-200 bg-white p-4 shadow-xl duration-150 fade-in slide-in-from-bottom-1 sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:mt-2 sm:w-64 sm:rounded-2xl sm:p-3 sm:slide-in-from-top-1">
                          <div className="text-center font-bold text-[10px] uppercase text-slate-400 tracking-wider mb-2 pb-1.5 border-b border-slate-100">
                            Select Time Slot
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {/* Hours Column */}
                            <div>
                              <div className="text-[9px] font-bold text-slate-400 text-center uppercase mb-1">Hr</div>
                              <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                                {hours.map((h) => (
                                  <button
                                    key={h}
                                    type="button"
                                    onClick={() => {
                                      const newTime = formatTime24h(h, minute, isPM);
                                      setSelectedTime(newTime);
                                    }}
                                    className={`block min-h-11 w-full cursor-pointer rounded-lg py-1 text-center text-xs font-bold transition ${
                                      hour12 === h
                                        ? 'bg-slate-900 text-white font-black'
                                        : 'hover:bg-slate-100 text-slate-700'
                                    }`}
                                  >
                                    {h}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Minutes Column */}
                            <div>
                              <div className="text-[9px] font-bold text-slate-400 text-center uppercase mb-1">Min</div>
                              <div className="space-y-1">
                                {minutes.map((m) => (
                                  <button
                                    key={m}
                                    type="button"
                                    onClick={() => {
                                      const newTime = formatTime24h(hour12, m, isPM);
                                      setSelectedTime(newTime);
                                    }}
                                    className={`block min-h-11 w-full cursor-pointer rounded-lg py-1 text-center text-xs font-bold transition ${
                                      minute === m
                                        ? 'bg-slate-900 text-white font-black'
                                        : 'hover:bg-slate-100 text-slate-700'
                                    }`}
                                  >
                                    {m}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* AM/PM Period Column */}
                            <div>
                              <div className="text-[9px] font-bold text-slate-400 text-center uppercase mb-1">Period</div>
                              <div className="space-y-1">
                                {[false, true].map((pm) => (
                                  <button
                                    key={pm ? 'PM' : 'AM'}
                                    type="button"
                                    onClick={() => {
                                      const newTime = formatTime24h(hour12, minute, pm);
                                      setSelectedTime(newTime);
                                    }}
                                    className={`block min-h-11 w-full cursor-pointer rounded-lg py-1.5 text-center text-xs font-bold transition ${
                                      isPM === pm
                                        ? 'bg-indigo-600 text-white font-black'
                                        : 'hover:bg-slate-100 text-slate-700 border border-slate-100'
                                    }`}
                                  >
                                    {pm ? 'PM' : 'AM'}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Quick selection presets footer */}
                          <div className="mt-2.5 pt-2 border-t border-slate-100 grid grid-cols-2 gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedTime('09:00');
                                setShowTimePicker(false);
                              }}
                              className="min-h-11 cursor-pointer rounded bg-slate-50 py-1 text-center text-xs font-bold text-slate-500 transition hover:bg-slate-100"
                            >
                              9:00 AM (Open)
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedTime('13:00');
                                setShowTimePicker(false);
                              }}
                              className="min-h-11 cursor-pointer rounded bg-slate-50 py-1 text-center text-xs font-bold text-slate-500 transition hover:bg-slate-100"
                            >
                              1:00 PM (Lunch)
                            </button>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Room / Chair Equipment Allocation (Resource)
              </label>
              <select
                value={selectedResource}
                onChange={(e) => setSelectedResource(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs font-bold text-slate-800 focus:outline-none"
              >
                <option value="">-- Use service default equipment --</option>
                {resources.map(r => (
                  <option key={r.id} value={r.id}>{r.name} ({r.type})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Internal Operator Notes</label>
              <textarea
                placeholder="e.g. Client called from mobile. Requests quiet corner, wants extra hot towel treatment."
                rows={2}
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none text-slate-700"
              />
            </div>
          </div>

          {/* Conflict Warnings Panel */}
          {(hasStaffConflict || hasResourceConflict) && (
            <div className="bg-rose-50 border border-rose-200 text-rose-950 p-4 rounded-2xl text-xs space-y-2">
              <div className="flex gap-2 items-start">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-extrabold text-rose-900">🔒 System Overlap Validation Blocked Booking!</p>
                  <p className="mt-0.5 opacity-90 font-medium">
                    {hasStaffConflict && '• The requested staff member is already booked at this time.'}
                    {hasResourceConflict && ' • The allocated private room/equipment has a conflict.'}
                  </p>
                </div>
              </div>
              
              <label className="flex items-center gap-1.5 cursor-pointer mt-2 bg-rose-100 p-2 rounded-xl text-rose-900 select-none">
                <input
                  type="checkbox"
                  checked={overrideAllowed}
                  onChange={(e) => setOverrideAllowed(e.target.checked)}
                  className="rounded border-rose-300 text-rose-700 focus:ring-rose-500"
                />
                <span className="font-bold">Authorized Override (Permit double booking anyway)</span>
              </label>
            </div>
          )}

          {isSuccess && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-2xl text-xs flex gap-2 items-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="font-extrabold">Manual Booking Logged!</p>
                <p className="mt-0.5 opacity-90">Reference: {newBookingRef}. Client points updated.</p>
              </div>
            </div>
          )}

          <div className="pt-4">
            <button
              type="button"
              onClick={handleCompleteManualBooking}
              disabled={
                isPersonalBlock
                  ? !selectedStaff
                  : (!selectedClient || !selectedService || !selectedStaff || ((hasStaffConflict || hasResourceConflict) && !overrideAllowed))
              }
              className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-2xl bg-slate-950 py-3 text-xs font-bold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isPersonalBlock ? (
                <>
                  <Lock className="w-4 h-4 text-amber-400" />
                  Lock Time Block & Make "Overbooked"
                </>
              ) : (
                'Add Booking to Operating Calendar'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
