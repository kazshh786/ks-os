/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar as CalendarIcon, Users, Sliders, CheckCircle2, AlertTriangle, Play, RefreshCw, Plus, Clock, Eye, Trash2, ShieldAlert, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { fromZonedTime } from 'date-fns-tz';
import { BusinessTenant, Service, Staff, Booking, Resource, AppointmentStatus, OutboxEvent } from '../data/types.js';
import { getDataProvider } from '../data/data-provider.js';


interface StaffCalendarProps {
  tenant: BusinessTenant;
  onLaunchManualBooking: () => void;
  onLaunchCheckout: (booking: Booking) => void;
}

export default function StaffCalendar({ tenant, onLaunchManualBooking, onLaunchCheckout }: StaffCalendarProps) {
  const [viewMode, setViewMode] = useState<'weekly' | 'staff-columns' | 'resources'>('staff-columns');
  const [selectedDate, setSelectedDate] = useState<string>('2026-07-16'); // Anchor around metadata date
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(2026);
  const [pickerMonth, setPickerMonth] = useState(6); // July (0-indexed)

  const formatFriendlyDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  };
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  
  // Selected appointment details modal
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);
  
  // Busy time blocks (local persistence)
  const [busyBlocks, setBusyBlocks] = useState<Array<{ id: string; staffId: string; label: string; startTime: string; endTime: string }>>([
    { id: 'bb-1', staffId: 'st-kasim', label: 'Lunch Break', startTime: '13:00', endTime: '14:00' },
    { id: 'bb-2', staffId: 'st-sarah', label: 'Equipment Cleaning', startTime: '12:00', endTime: '12:30' }
  ]);

  // Conflict validation settings
  const [forceDoubleBook, setForceDoubleBook] = useState(false);
  const [showOverlapWarning, setShowOverlapWarning] = useState(false);

  // Drag and drop / Click scheduling states
  const [draggedBooking, setDraggedBooking] = useState<Booking | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [dragOverTime, setDragOverTime] = useState<string | null>(null);
  const [quickBookData, setQuickBookData] = useState<{
    isOpen: boolean;
    date: string;
    startTime: string;
    staffId?: string;
    resourceId?: string;
    serviceId: string;
    clientName: string;
    clientPhone: string;
    clientEmail: string;
    visitType: 'Shop' | 'Mobile';
  } | null>(null);

  const [isMutating, setIsMutating] = useState(false);

  const handleDragStart = (e: React.DragEvent, bk: Booking) => {
    setDraggedBooking(bk);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', bk.id);
  };

  const handleDragEnd = () => {
    setDraggedBooking(null);
    setDragOverColumn(null);
    setDragOverTime(null);
  };

  const handleDrop = (e: React.DragEvent, columnType: 'staff' | 'resource' | 'weekly', columnId: string, slotTime: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    setDragOverTime(null);

    const bookingId = e.dataTransfer.getData('text/plain') || draggedBooking?.id;
    if (!bookingId) return;

    const original = bookings.find(b => b.id === bookingId);
    if (!original) return;

    let updates: Partial<Booking> = {
      startTime: slotTime,
    };

    if (columnType === 'staff') {
      updates.staffId = columnId;
    } else if (columnType === 'resource') {
      updates.resourceId = columnId;
    } else if (columnType === 'weekly') {
      updates.date = columnId;
    }

    // Attempt parameters update with validation
    updateBookingParam(bookingId, updates);
  };

  const handleSlotClick = (columnType: 'staff' | 'resource' | 'weekly', columnId: string, slotTime: string) => {
    setQuickBookData({
      isOpen: true,
      date: columnType === 'weekly' ? columnId : selectedDate,
      startTime: slotTime,
      staffId: columnType === 'staff' ? columnId : (staffList[0]?.id || ''),
      resourceId: columnType === 'resource' ? columnId : undefined,
      serviceId: services[0]?.id || '',
      clientName: '',
      clientPhone: '',
      clientEmail: '',
      visitType: 'Shop',
    });
  };

  const handleQuickBookSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickBookData || !quickBookData.clientName || !quickBookData.clientPhone) return;

    const srv = services.find(s => s.id === quickBookData.serviceId);
    
    setIsMutating(true);
    try {
      const provider = getDataProvider();

      // Assuming quickBookData.date is YYYY-MM-DD and startTime is HH:MM
      const startTimeStr = `${quickBookData.date}T${quickBookData.startTime}:00`;
      const startTime = fromZonedTime(startTimeStr, tenant.timezone).toISOString();
      
      const requestPayload = {
        serviceId: quickBookData.serviceId!,
        staffId: quickBookData.staffId || staffList[0]?.id || '',
        startTime,
        client: {
          name: quickBookData.clientName,
          phone: quickBookData.clientPhone,
          email: quickBookData.clientEmail
        },
        bookingChannel: quickBookData.visitType === 'Shop' ? 'in_shop' : 'mobile' as any,
        mobileAddress: quickBookData.visitType === 'Mobile' ? {
          line1: '123 Baker Street', // Dummy for now since staff calendar doesn't have address fields
          city: 'London',
          postcode: 'NW1 6XE',
          accessNotes: ''
        } : null,
        paymentMode: 'pay_later' as const, // Staff usually book pay later
        payNow: false,
        resourceId: quickBookData.resourceId || (srv?.requiresResource ? 'res-chair-1' : null)
      };

      const result = await provider.createStaffBooking(requestPayload);

      // Reload all bookings after creation to get the generated end times and IDs
      await loadData();
      
      setQuickBookData(null);
      window.dispatchEvent(new CustomEvent('ks-bookings-updated'));
    } catch (err) {
      console.error('Quick book error:', err);
      alert('Failed to create booking: ' + (err as Error).message);
    } finally {
      setIsMutating(false);
    }
  };

  useEffect(() => {
    loadData();
    // Listen for manual booking completions
    const handler = () => { loadData(); };
    window.addEventListener('ks-bookings-updated', handler);
    window.addEventListener('ks-events-updated', handler);
    return () => {
      window.removeEventListener('ks-bookings-updated', handler);
      window.removeEventListener('ks-events-updated', handler);
    };
  }, [tenant, selectedDate]);

  const loadData = async () => {
    const provider = getDataProvider();
    const bList = await provider.getBookings();
    const list = bList.filter(b => b.tenantId === tenant.id);
    setBookings(list);
    
    const staffListFetched = await provider.getStaff(tenant.id);
    setStaffList(staffListFetched);
    
    const sList = await provider.getServices(tenant.id);
    setServices(sList);
    
    setResources(sList.reduce((acc: Resource[], s) => {
      return acc;
    }, []));
  };

  // Helper: get bookings on selected date
  const dateBookings = bookings.filter(b => b.date === selectedDate);

  // Time grid layout definitions (09:00 - 18:00)
  const hours = Array.from({ length: 10 }, (_, i) => 9 + i);

  // Helper to convert time "HH:MM" to row offset percentage
  const getTimeStyles = (startTime: string, durationMin: number) => {
    const [h, m] = startTime.split(':').map(Number);
    const startOffsetMinutes = (h - 9) * 60 + m;
    const totalGridMinutes = 10 * 60; // 9 AM to 7 PM is 10 hours
    const topPercent = (startOffsetMinutes / totalGridMinutes) * 100;
    const heightPercent = (durationMin / totalGridMinutes) * 100;
    
    return {
      top: `${Math.max(0, Math.min(100, topPercent))}%`,
      height: `${Math.max(5, Math.min(100, heightPercent))}%`
    };
  };

  // Check resource or staff conflicts for an active/edited booking
  const checkConflicts = (booking: Booking, newStart: string, newDuration: number, newStaffId: string) => {
    const newEnd = calculateEndTime(newStart, newDuration);
    
    // 1. Staff double booking check
    const staffConflict = bookings.some(b => 
      b.id !== booking.id &&
      b.tenantId === tenant.id &&
      b.date === booking.date &&
      b.staffId === newStaffId &&
      b.status !== 'Cancelled' &&
      isOverlapping(newStart, newEnd, b.startTime, b.endTime)
    );

    // 2. Resource conflict check
    const resourceConflict = booking.resourceId ? bookings.some(b => 
      b.id !== booking.id &&
      b.tenantId === tenant.id &&
      b.date === booking.date &&
      b.resourceId === booking.resourceId &&
      b.status !== 'Cancelled' &&
      isOverlapping(newStart, newEnd, b.startTime, b.endTime)
    ) : false;

    return { staffConflict, resourceConflict };
  };

  const isOverlapping = (start1: string, end1: string, start2: string, end2: string) => {
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const s1 = toMin(start1);
    const e1 = toMin(end1);
    const s2 = toMin(start2);
    const e2 = toMin(end2);
    return Math.max(s1, s2) < Math.min(e1, e2);
  };

  const calculateEndTime = (start: string, duration: number) => {
    const [h, m] = start.split(':').map(Number);
    const totalMinutes = h * 60 + m + duration;
    const finalH = Math.floor(totalMinutes / 60) % 24;
    const finalM = totalMinutes % 60;
    return `${finalH.toString().padStart(2, '0')}:${finalM.toString().padStart(2, '0')}`;
  };

  // Quick Action: Update booking parameters
  const updateBookingParam = async (
    bookingId: string, 
    updates: Partial<Booking>, 
    forceOverride: boolean = false
  ) => {
    const original = bookings.find(b => b.id === bookingId);
    if (!original) return;
    
    setIsMutating(true);
    try {
      const provider = getDataProvider();

      // Check for conflicts locally before issuing API request
      const merged = { ...original, ...updates };
      const conflicts = checkConflicts(original, merged.startTime, merged.duration, merged.staffId);

      if ((conflicts.staffConflict || conflicts.resourceConflict) && !forceOverride && !forceDoubleBook) {
        setShowOverlapWarning(true);
        return;
      }
      setShowOverlapWarning(false);

      if (updates.status) {
        // Upper case enum value required by DB, handle mapping
        let apiStatus = 'CONFIRMED';
        if (updates.status === 'Completed') apiStatus = 'COMPLETED';
        if (updates.status === 'NoShow') apiStatus = 'NO_SHOW';
        if (updates.status === 'Cancelled') apiStatus = 'CANCELLED';
        if (updates.status === 'Confirmed') apiStatus = 'CONFIRMED';
        
        await provider.updateBookingStatus(bookingId, apiStatus);
      }

      if (updates.startTime || updates.staffId || updates.date) {
        // Time or staff change implies reschedule
        const targetDate = updates.date || original.date;
        const targetTime = updates.startTime || original.startTime;
        const targetStaff = updates.staffId || original.staffId;
        
        const newStartTimeStr = fromZonedTime(`${targetDate}T${targetTime}:00`, tenant.timezone).toISOString();
        
        await provider.rescheduleBooking(bookingId, {
          startTime: newStartTimeStr,
          staffId: targetStaff
        });
      }

      // Reload to ensure UI is in sync with truth
      await loadData();
      
      // If active modal is the one updated, sync it with new data
      setBookings(prevBookings => {
        const syncedActive = prevBookings.find(b => b.id === bookingId);
        if (syncedActive) setActiveBooking(syncedActive);
        return prevBookings;
      });

    } catch (err: any) {
      if (err.message === 'SLOT_UNAVAILABLE') {
        setShowOverlapWarning(true);
      } else {
        alert('Failed to update booking: ' + err.message);
      }
    } finally {
      setIsMutating(false);
    }
  };

  const deleteBooking = async (bookingId: string) => {
    setIsMutating(true);
    try {
      const provider = getDataProvider();
      await provider.cancelBooking(bookingId);
      setActiveBooking(null);
      await loadData();
    } catch (err: any) {
      alert('Failed to cancel booking: ' + err.message);
    } finally {
      setIsMutating(false);
    }
  };

  // Quick Block Out Time Creator
  const addBusyBlock = (staffId: string) => {
    const label = prompt('Enter busy time label (e.g. Break, Staff Training):', 'Busy Time Block');
    if (!label) return;
    const startTime = prompt('Enter start time (HH:MM):', '14:00');
    if (!startTime) return;
    const endTime = prompt('Enter end time (HH:MM):', '15:00');
    if (!endTime) return;

    setBusyBlocks([
      ...busyBlocks,
      {
        id: `bb-${Date.now()}`,
        staffId,
        label,
        startTime,
        endTime
      }
    ]);
  };

  const slots = hours.flatMap(h => {
    const hr = h.toString().padStart(2, '0');
    return [
      { time: `${hr}:00`, index: (h - 9) * 2 },
      { time: `${hr}:30`, index: (h - 9) * 2 + 1 }
    ];
  });

  return (
    <div className="space-y-6">
      {/* Calendar Control Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-2.5 w-full md:w-auto">
          {/* Previous Day Arrow */}
          <button
            onClick={() => {
              const prev = new Date(selectedDate);
              prev.setDate(prev.getDate() - 1);
              setSelectedDate(prev.toISOString().split('T')[0]);
            }}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 border border-slate-200/50 bg-white shadow-3xs transition cursor-pointer flex items-center justify-center active:scale-95"
            title="Previous Day"
          >
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>

          {/* Today Button - Styled Modern with Icon */}
          <button
            onClick={() => setSelectedDate('2026-07-16')}
            className={`text-xs font-black px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1 active:scale-95 ${
              selectedDate === '2026-07-16'
                ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-500/20'
                : 'bg-white text-slate-700 border border-slate-200/60 hover:bg-slate-50'
            }`}
          >
            <RefreshCw className={`w-3 h-3 ${selectedDate === '2026-07-16' ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
            <span>Today</span>
          </button>

          {/* Next Day Arrow */}
          <button
            onClick={() => {
              const next = new Date(selectedDate);
              next.setDate(next.getDate() + 1);
              setSelectedDate(next.toISOString().split('T')[0]);
            }}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 border border-slate-200/50 bg-white shadow-3xs transition cursor-pointer flex items-center justify-center active:scale-95"
            title="Next Day"
          >
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>

          {/* Divider */}
          <div className="h-6 w-[1px] bg-slate-200 mx-1 hidden sm:block"></div>

          {/* Custom Modern Dropdown Date Selector */}
          <div className="relative">
            <button
              onClick={() => {
                setShowDatePicker(!showDatePicker);
                const [y, m] = selectedDate.split('-').map(Number);
                if (y && m) {
                  setPickerYear(y);
                  setPickerMonth(m - 1);
                }
              }}
              className="flex items-center gap-2 font-black text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200/60 px-4 py-2 rounded-xl text-xs transition shadow-3xs cursor-pointer select-none"
            >
              <CalendarIcon className="w-3.5 h-3.5 text-indigo-600" />
              <span>{formatFriendlyDate(selectedDate)}</span>
            </button>

            {showDatePicker && (
              <>
                {/* Click outside backdrop to close */}
                <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
                <div className="absolute left-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 w-72 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                  
                  {/* Calendar Month Selector Header */}
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
                      className="p-1 hover:bg-slate-100 rounded-lg text-slate-500 transition cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-black text-slate-800 tracking-tight">
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
                      className="p-1 hover:bg-slate-100 rounded-lg text-slate-500 transition cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Weekday Labels */}
                  <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black text-slate-400 uppercase mb-1">
                    <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
                  </div>

                  {/* Days of Month grid */}
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {/* Empty padding days */}
                    {Array.from({ length: new Date(pickerYear, pickerMonth, 1).getDay() }).map((_, i) => (
                      <div key={`empty-${i}`} className="w-8 h-8" />
                    ))}
                    
                    {/* Dynamic days */}
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
                          className={`w-8 h-8 rounded-lg text-xs font-bold transition flex items-center justify-center cursor-pointer ${
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

                  {/* Bottom jump control */}
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex justify-between items-center text-[10px]">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDate('2026-07-16');
                        setPickerYear(2026);
                        setPickerMonth(6);
                        setShowDatePicker(false);
                      }}
                      className="font-black uppercase text-indigo-600 hover:text-indigo-800 transition flex items-center gap-1 cursor-pointer"
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

        {/* View togglers */}
        <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl w-full md:w-auto">
          <button
            onClick={() => setViewMode('weekly')}
            className={`flex-1 md:flex-none px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${viewMode === 'weekly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Clock className="w-3.5 h-3.5" /> Weekly
          </button>
          <button
            onClick={() => setViewMode('staff-columns')}
            className={`flex-1 md:flex-none px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${viewMode === 'staff-columns' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Users className="w-3.5 h-3.5" /> Staff View
          </button>
          <button
            onClick={() => setViewMode('resources')}
            className={`flex-1 md:flex-none px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${viewMode === 'resources' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Sliders className="w-3.5 h-3.5" /> Resource View
          </button>
        </div>

        <button
          onClick={onLaunchManualBooking}
          className="w-full md:w-auto bg-slate-950 text-white font-bold text-xs px-4 py-2.5 rounded-xl hover:opacity-90 flex items-center justify-center gap-1.5 transition"
        >
          <Plus className="w-4 h-4" /> New Desk Booking
        </button>
      </div>

      {/* Double Book Config Warning */}
      <div className="flex items-center justify-between bg-amber-50 border border-amber-200/50 rounded-2xl p-3.5 text-xs">
        <div className="flex gap-2 items-center">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="text-amber-800 font-medium">
            Overbooking & Resource Control: {forceDoubleBook ? '⚠️ Overrides Active (Double bookings are permitted)' : '🔒 Conflicts Blocked (Strict staff & equipment schedules enforced)'}
          </span>
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={forceDoubleBook}
            onChange={(e) => setForceDoubleBook(e.target.checked)}
            className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
          />
          <span className="font-bold text-amber-900">Permit Overbooking</span>
        </label>
      </div>

      {/* Grid Container */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col md:flex-row h-[550px] relative">
        {isMutating && (
          <div className="absolute inset-0 bg-white/40 backdrop-blur-sm z-50 flex items-center justify-center">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
          </div>
        )}
        
        {/* Left Side: Time column marker */}
        <div className="w-16 border-r border-slate-100 bg-slate-50/50 flex flex-col select-none pt-12 text-right pr-2">
          {hours.map((h) => (
            <div key={h} className="h-[50px] text-[10px] font-bold text-slate-400">
              {h.toString().padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* Dynamic Column Grid based on view mode */}
        <div className="flex-1 flex overflow-x-auto relative">
          
          {/* View Mode 1: Staff Columns */}
          {viewMode === 'staff-columns' && (
            <div className="flex-1 min-w-[500px] flex">
              {staffList.map((st) => {
                const staffBookings = dateBookings.filter(b => b.staffId === st.id);
                const staffBusy = busyBlocks.filter(b => b.staffId === st.id);

                return (
                  <div key={st.id} className="flex-1 border-r border-slate-100 last:border-0 relative h-full flex flex-col">
                    {/* Column Header */}
                    <div className="h-12 border-b border-slate-100 flex items-center justify-between px-3 bg-slate-50/40 select-none">
                      <div className="flex items-center gap-1.5">
                        <img src={st.avatarUrl} alt={st.name} className="w-6 h-6 rounded-full object-cover border" />
                        <span className="text-xs font-bold text-slate-800 truncate">{st.name.split(' ')[0]}</span>
                      </div>
                      <button
                        onClick={() => addBusyBlock(st.id)}
                        className="p-1 hover:bg-slate-200 rounded-md text-[10px] font-bold text-slate-500"
                        title="Block Out Busy Time"
                      >
                        + Block
                      </button>
                    </div>

                    {/* Column Slots stage */}
                    <div className="flex-1 relative bg-white min-h-[500px]">
                      {/* Interactive Drag/Drop clickable slots in background */}
                      <div className="absolute inset-0 z-0">
                        {slots.map((slot) => {
                          const isDragOver = dragOverColumn === st.id && dragOverTime === slot.time;
                          return (
                            <div
                              key={slot.time}
                              onDragOver={(e) => {
                                e.preventDefault();
                                setDragOverColumn(st.id);
                                setDragOverTime(slot.time);
                              }}
                              onDragLeave={() => {
                                setDragOverColumn(null);
                                setDragOverTime(null);
                              }}
                              onDrop={(e) => handleDrop(e, 'staff', st.id, slot.time)}
                              onClick={() => handleSlotClick('staff', st.id, slot.time)}
                              className={`absolute left-0 right-0 border-b border-dashed border-slate-100 cursor-pointer group flex items-center justify-center transition-all ${
                                isDragOver 
                                  ? 'bg-indigo-50/70 border-indigo-300 border-y-2' 
                                  : 'hover:bg-slate-50/50'
                              }`}
                              style={{
                                top: `${slot.index * 25}px`,
                                height: '25px',
                              }}
                            >
                              <span className="hidden group-hover:inline-flex items-center gap-1 text-[9px] font-black text-indigo-600 bg-white shadow-xs px-2 py-0.5 rounded-full border border-indigo-100">
                                <Plus className="w-2.5 h-2.5 text-indigo-500 animate-pulse" /> {slot.time} Quick Book
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Render Busy blocks */}
                      {staffBusy.map((bb) => {
                        const style = getTimeStyles(bb.startTime, 60); // assumes 1hr block
                        return (
                          <div
                            key={bb.id}
                            className="absolute left-1 right-1 rounded-xl bg-slate-100 border border-slate-200 text-slate-500 p-2 text-[10px] font-medium flex flex-col justify-center overflow-hidden pointer-events-none opacity-85 z-10"
                            style={style}
                          >
                            <span className="font-bold">⛔ {bb.label}</span>
                            <span>{bb.startTime} - {bb.endTime}</span>
                          </div>
                        );
                      })}

                      {/* Render bookings cards */}
                      {staffBookings.map((bk) => {
                        const style = getTimeStyles(bk.startTime, bk.duration);
                        const srv = services.find(s => s.id === bk.serviceId);
                        const isCurrentlyDragged = draggedBooking?.id === bk.id;
                        
                        return (
                          <div
                            key={bk.id}
                            onClick={() => setActiveBooking(bk)}
                            draggable={bk.status !== 'Cancelled'}
                            onDragStart={(e) => handleDragStart(e, bk)}
                            onDragEnd={handleDragEnd}
                            className={`absolute left-1.5 right-1.5 rounded-2xl p-2.5 text-xs flex flex-col justify-between overflow-hidden cursor-grab active:cursor-grabbing border-l-4 shadow-sm hover:translate-y-[-1px] transition-all duration-300 z-20 ${
                              isCurrentlyDragged ? 'opacity-30 border-dashed scale-95' : ''
                            } ${
                              bk.isBlockedTime ? 'bg-indigo-50 border-indigo-600 text-indigo-950 shadow-xs' :
                              bk.status === 'Completed' ? 'bg-emerald-50/70 border-emerald-500 text-emerald-900' :
                              bk.status === 'Cancelled' ? 'bg-rose-50/50 border-rose-400 text-rose-800 line-through opacity-60' :
                              bk.status === 'NoShow' ? 'bg-slate-100 border-slate-400 text-slate-700' :
                              'bg-amber-50/70 border-amber-600 text-amber-950'
                            }`}
                            style={{
                              ...style,
                              ...(bk.isBlockedTime ? { backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(99, 102, 241, 0.05) 10px, rgba(99, 102, 241, 0.05) 20px)' } : {})
                            }}
                          >
                            <div>
                              <div className="flex justify-between items-start">
                                <span className="font-extrabold truncate text-[11px] flex items-center gap-1 text-slate-900">
                                  {bk.isBlockedTime && <Lock className="w-3 h-3 text-indigo-600 shrink-0" />}
                                  {bk.clientName}
                                </span>
                                <span className="text-[9px] font-semibold bg-white/60 px-1.5 py-0.5 rounded uppercase">
                                  {bk.isBlockedTime ? 'HOLD' : bk.visitType}
                                </span>
                              </div>
                              <p className="text-[10px] opacity-90 font-medium truncate mt-0.5 text-slate-700">
                                {bk.isBlockedTime ? (bk.blockReason || 'Calendar Block') : (srv?.name || 'Custom Grooming')}
                              </p>
                            </div>
                            <div className="flex justify-between items-end text-[9px] font-bold opacity-80 pt-1 text-slate-600">
                              <span>{bk.startTime} ({bk.duration}m)</span>
                              <span>{bk.isBlockedTime ? '🔒 EXCLUSIVE' : `£${bk.price}`}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* View Mode 2: Resource Columns */}
          {viewMode === 'resources' && (
            <div className="flex-1 min-w-[500px] flex">
              {['Private Facial & Lash Suite', 'Standard Barber Chair 1', 'Standard Barber Chair 2'].map((resourceName, idx) => {
                const resourceId = idx === 0 ? 'res-facial-suite' : idx === 1 ? 'res-chair-1' : 'res-chair-2';
                const resourceBookings = dateBookings.filter(b => b.resourceId === resourceId);

                return (
                  <div key={resourceName} className="flex-1 border-r border-slate-100 last:border-0 relative h-full flex flex-col">
                    {/* Header */}
                    <div className="h-12 border-b border-slate-100 flex items-center px-4 bg-slate-50/40 select-none text-xs font-bold text-slate-700">
                      🏢 {resourceName}
                    </div>

                    {/* Column stage */}
                    <div className="flex-1 relative bg-white min-h-[500px]">
                      {/* Interactive Drag/Drop clickable slots in background */}
                      <div className="absolute inset-0 z-0">
                        {slots.map((slot) => {
                          const isDragOver = dragOverColumn === resourceId && dragOverTime === slot.time;
                          return (
                            <div
                              key={slot.time}
                              onDragOver={(e) => {
                                e.preventDefault();
                                setDragOverColumn(resourceId);
                                setDragOverTime(slot.time);
                              }}
                              onDragLeave={() => {
                                setDragOverColumn(null);
                                setDragOverTime(null);
                              }}
                              onDrop={(e) => handleDrop(e, 'resource', resourceId, slot.time)}
                              onClick={() => handleSlotClick('resource', resourceId, slot.time)}
                              className={`absolute left-0 right-0 border-b border-dashed border-slate-100 cursor-pointer group flex items-center justify-center transition-all ${
                                isDragOver 
                                  ? 'bg-indigo-50/70 border-indigo-300 border-y-2' 
                                  : 'hover:bg-slate-50/50'
                              }`}
                              style={{
                                top: `${slot.index * 25}px`,
                                height: '25px',
                              }}
                            >
                              <span className="hidden group-hover:inline-flex items-center gap-1 text-[9px] font-black text-indigo-600 bg-white shadow-xs px-2 py-0.5 rounded-full border border-indigo-100">
                                <Plus className="w-2.5 h-2.5 text-indigo-500 animate-pulse" /> {slot.time} Book
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {resourceBookings.map((bk) => {
                        const style = getTimeStyles(bk.startTime, bk.duration);
                        const srv = services.find(s => s.id === bk.serviceId);
                        const staffMember = staffList.find(s => s.id === bk.staffId);
                        const isCurrentlyDragged = draggedBooking?.id === bk.id;

                        return (
                          <div
                            key={bk.id}
                            onClick={() => setActiveBooking(bk)}
                            draggable={bk.status !== 'Cancelled'}
                            onDragStart={(e) => handleDragStart(e, bk)}
                            onDragEnd={handleDragEnd}
                            className={`absolute left-1.5 right-1.5 rounded-2xl p-2.5 text-xs flex flex-col justify-between overflow-hidden cursor-grab active:cursor-grabbing border-l-4 shadow-sm z-20 transition-all duration-300 ${
                              isCurrentlyDragged ? 'opacity-30 border-dashed scale-95' : ''
                            } bg-slate-50 border-indigo-500 text-slate-900`}
                            style={style}
                          >
                            <div>
                              <div className="flex justify-between items-start">
                                <span className="font-extrabold truncate text-[11px]">{bk.clientName}</span>
                                <span className="text-[9px] bg-indigo-100 text-indigo-800 font-bold px-1.5 py-0.5 rounded">
                                  {staffMember?.name.split(' ')[0]}
                                </span>
                              </div>
                              <p className="text-[10px] font-medium truncate mt-0.5">
                                {srv?.name}
                              </p>
                            </div>
                            <div className="flex justify-between items-end text-[9px] font-bold opacity-80 pt-1">
                              <span>{bk.startTime} - {bk.endTime}</span>
                              <span>£{bk.price}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* View Mode 3: Weekly Calendar Overview */}
          {viewMode === 'weekly' && (
            <div className="flex-1 min-w-[500px] flex">
              {Array.from({ length: 7 }, (_, dayIdx) => {
                const curr = new Date(selectedDate);
                const first = curr.getDate() - curr.getDay() + 1;
                const dayObj = new Date(curr.setDate(first + dayIdx));
                const dayStr = dayObj.toISOString().split('T')[0];
                const dayBookings = bookings.filter(b => b.date === dayStr);

                return (
                  <div key={dayIdx} className="flex-1 border-r border-slate-100 last:border-0 relative h-full flex flex-col">
                    {/* Header */}
                    <div className="h-12 border-b border-slate-100 flex flex-col justify-center items-center px-2 bg-slate-50/40 select-none text-center">
                      <span className="text-[10px] font-bold text-slate-400">
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dayIdx]}
                      </span>
                      <span className="text-xs font-bold text-slate-800">
                        {dayObj.getDate()}
                      </span>
                    </div>

                    {/* Column stage */}
                    <div className="flex-1 relative bg-white min-h-[500px]">
                      {/* Interactive Drag/Drop clickable slots in background */}
                      <div className="absolute inset-0 z-0">
                        {slots.map((slot) => {
                          const isDragOver = dragOverColumn === dayStr && dragOverTime === slot.time;
                          return (
                            <div
                              key={slot.time}
                              onDragOver={(e) => {
                                e.preventDefault();
                                setDragOverColumn(dayStr);
                                setDragOverTime(slot.time);
                              }}
                              onDragLeave={() => {
                                setDragOverColumn(null);
                                setDragOverTime(null);
                              }}
                              onDrop={(e) => handleDrop(e, 'weekly', dayStr, slot.time)}
                              onClick={() => handleSlotClick('weekly', dayStr, slot.time)}
                              className={`absolute left-0 right-0 border-b border-dashed border-slate-100 cursor-pointer group flex items-center justify-center transition-all ${
                                isDragOver 
                                  ? 'bg-indigo-50/70 border-indigo-300 border-y-2' 
                                  : 'hover:bg-slate-50/50'
                              }`}
                              style={{
                                top: `${slot.index * 25}px`,
                                height: '25px',
                              }}
                            >
                              <span className="hidden group-hover:inline-flex items-center gap-1 text-[9px] font-black text-indigo-600 bg-white shadow-xs px-2 py-0.5 rounded-full border border-indigo-100">
                                <Plus className="w-2.5 h-2.5 text-indigo-500 animate-pulse" /> {slot.time} Book
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {dayBookings.map((bk) => {
                        const style = getTimeStyles(bk.startTime, bk.duration);
                        const isCurrentlyDragged = draggedBooking?.id === bk.id;
                        return (
                          <div
                            key={bk.id}
                            onClick={() => { setSelectedDate(bk.date); setViewMode('staff-columns'); setActiveBooking(bk); }}
                            draggable={bk.status !== 'Cancelled'}
                            onDragStart={(e) => handleDragStart(e, bk)}
                            onDragEnd={handleDragEnd}
                            className={`absolute left-1 right-1 rounded-xl p-1.5 text-[10px] overflow-hidden cursor-grab active:cursor-grabbing border-l-2 shadow-sm z-20 transition-all duration-300 ${
                              isCurrentlyDragged ? 'opacity-30 border-dashed scale-95' : ''
                            } bg-slate-100/80 border-slate-600 text-slate-900`}
                            style={style}
                          >
                            <p className="font-bold truncate leading-tight">{bk.clientName}</p>
                            <p className="text-[9px] opacity-75 truncate leading-tight">{bk.startTime}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>

      {/* Appointment Action Modal / Sidebar detail */}
      {activeBooking && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-xs">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start border-b pb-4 mb-4">
              <div>
                <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full uppercase">
                  {activeBooking.status}
                </span>
                <h3 className="text-lg font-extrabold text-slate-900 mt-1">{activeBooking.clientName}</h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">Ref: {activeBooking.reference}</p>
                {activeBooking.clientId && (
                  <Link to={`/app/clients/${activeBooking.clientId}`} className="inline-block mt-2 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition">
                    View client profile &rarr;
                  </Link>
                )}
              </div>
              <button
                onClick={() => { setActiveBooking(null); setShowOverlapWarning(false); }}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold p-1 bg-slate-50 hover:bg-slate-100 rounded-lg transition"
              >
                ✕
              </button>
            </div>

            {/* Overlap Alarm Indicator */}
            {showOverlapWarning && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-2xl text-xs flex gap-2 items-start mb-4">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">⚠️ Dynamic Booking Overlap Warning!</p>
                  <p className="mt-0.5 opacity-90">
                    A clash is detected with existing staff schedules or private suite reservations. Toggle "Permit Overbooking" above to deliberately override this rule.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-4 text-sm mb-6">
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Service</label>
                  <p className="font-bold text-slate-800">
                    {services.find(s => s.id === activeBooking.serviceId)?.name || 'Custom Grooming'}
                  </p>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Assigned Professional</label>
                  <select
                    value={activeBooking.staffId}
                    onChange={(e) => updateBookingParam(activeBooking.id, { staffId: e.target.value })}
                    className="w-full font-bold text-slate-800 bg-transparent border-b border-dashed border-slate-300 focus:outline-none focus:border-slate-800 cursor-pointer text-sm"
                  >
                    {staffList.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block">Start Time</label>
                  <select
                    value={activeBooking.startTime}
                    onChange={(e) => updateBookingParam(activeBooking.id, { startTime: e.target.value })}
                    className="font-bold text-slate-800 bg-transparent border-b border-dashed border-slate-300 focus:outline-none focus:border-slate-800 cursor-pointer text-sm"
                  >
                    {hours.map(h => {
                      const hr1 = `${h.toString().padStart(2, '0')}:00`;
                      const hr2 = `${h.toString().padStart(2, '0')}:30`;
                      return (
                        <React.Fragment key={h}>
                          <option value={hr1}>{hr1}</option>
                          <option value={hr2}>{hr2}</option>
                        </React.Fragment>
                      );
                    })}
                  </select>
                </div>
                <div className="mt-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block">Duration Adjuster</label>
                  <div className="flex items-center gap-1.5 mt-1">
                    <button
                      onClick={() => updateBookingParam(activeBooking.id, { duration: Math.max(15, activeBooking.duration - 15) })}
                      className="px-2 py-0.5 bg-slate-200 text-slate-800 font-extrabold text-xs rounded-md hover:bg-slate-300"
                    >
                      -15m
                    </button>
                    <span className="font-extrabold text-slate-800 text-xs">{activeBooking.duration} mins</span>
                    <button
                      onClick={() => updateBookingParam(activeBooking.id, { duration: activeBooking.duration + 15 })}
                      className="px-2 py-0.5 bg-slate-200 text-slate-800 font-extrabold text-xs rounded-md hover:bg-slate-300"
                    >
                      +15m
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Contact Details</label>
                <p className="text-slate-800 mt-1">{activeBooking.clientPhone} • {activeBooking.clientEmail}</p>
              </div>

              {activeBooking.visitType === 'Mobile' && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Travel Address</label>
                  <p className="text-slate-800 mt-1">📍 {activeBooking.streetAddress}, {activeBooking.city}, {activeBooking.postcode}</p>
                  {activeBooking.accessInstructions && (
                    <p className="text-xs text-slate-500 italic mt-1 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      🗝️ Instructions: {activeBooking.accessInstructions}
                    </p>
                  )}
                </div>
              )}

              {activeBooking.internalNotes && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Internal Notes</label>
                  <p className="text-xs text-slate-600 mt-1 italic">{activeBooking.internalNotes}</p>
                </div>
              )}

              {/* Status Manager Row */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Update Diary Status</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {(['Pending', 'Confirmed', 'Completed', 'Cancelled', 'NoShow'] as AppointmentStatus[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => updateBookingParam(activeBooking.id, { status: st })}
                      className={`py-1.5 px-1 rounded-xl text-[10px] font-extrabold border transition-all ${
                        activeBooking.status === st 
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs' 
                          : 'border-slate-100 text-slate-600 hover:bg-slate-50 bg-slate-50/50'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Bottom Actions */}
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-100">
              {activeBooking.status !== 'Cancelled' && activeBooking.paymentStatus !== 'FullyPaid' ? (
                <Link
                  to={`/app/pos?appointmentId=${activeBooking.id}`}
                  className="flex-1 bg-emerald-600 text-white font-extrabold text-xs py-2.5 rounded-xl shadow-md hover:bg-emerald-700 transition flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" /> Take payment
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={true}
                  className="flex-1 bg-slate-200 text-slate-400 font-extrabold text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5 cursor-not-allowed"
                >
                  <CheckCircle2 className="w-4 h-4" /> Payment Not Required
                </button>
              )}
              
              <button
                type="button"
                onClick={() => deleteBooking(activeBooking.id)}
                className="px-3 py-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100 font-bold text-xs flex items-center justify-center gap-1 transition"
                title="Delete Booking"
              >
                <Trash2 className="w-4 h-4" /> Cancel Booking
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Booking Modal */}
      {quickBookData && quickBookData.isOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 backdrop-blur-xs">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start border-b pb-4 mb-4">
              <div>
                <span className="text-[10px] font-bold bg-indigo-100 text-indigo-800 px-2.5 py-1 rounded-full uppercase tracking-wider">
                  ⚡ Quick Scheduler
                </span>
                <h3 className="text-lg font-extrabold text-slate-900 mt-1.5">New Appointment</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Scheduled for {quickBookData.date} @ {quickBookData.startTime}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQuickBookData(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold p-1 bg-slate-50 hover:bg-slate-100 rounded-lg transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleQuickBookSubmit} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">
                  Client Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Brad Pitt"
                  value={quickBookData.clientName}
                  onChange={(e) => setQuickBookData({ ...quickBookData, clientName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:border-indigo-500 font-bold text-slate-800 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">
                    Contact Phone *
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. +44 7123 456789"
                    value={quickBookData.clientPhone}
                    onChange={(e) => setQuickBookData({ ...quickBookData, clientPhone: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:border-indigo-500 font-bold text-slate-800 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">
                    Email Address (Optional)
                  </label>
                  <input
                    type="email"
                    placeholder="e.g. client@example.com"
                    value={quickBookData.clientEmail}
                    onChange={(e) => setQuickBookData({ ...quickBookData, clientEmail: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:border-indigo-500 font-bold text-slate-800 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">
                  Selected Treatment/Service
                </label>
                <select
                  value={quickBookData.serviceId}
                  onChange={(e) => setQuickBookData({ ...quickBookData, serviceId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:border-indigo-500 font-bold text-slate-800 text-sm cursor-pointer"
                >
                  {services.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} (£{s.price} • {s.durationMin}m)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">
                    Groomer / Specialist
                  </label>
                  <select
                    value={quickBookData.staffId || ''}
                    onChange={(e) => setQuickBookData({ ...quickBookData, staffId: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:border-indigo-500 font-bold text-slate-800 text-sm cursor-pointer"
                  >
                    {staffList.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">
                    Fulfillment Type
                  </label>
                  <select
                    value={quickBookData.visitType}
                    onChange={(e) => setQuickBookData({ ...quickBookData, visitType: e.target.value as 'Shop' | 'Mobile' })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:border-indigo-500 font-bold text-slate-800 text-sm cursor-pointer"
                  >
                    <option value="Shop">At Shop Studio</option>
                    <option value="Mobile">Mobile Home Visit</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setQuickBookData(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-100 transition"
                >
                  Schedule Instantly
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
