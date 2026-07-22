/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, Sparkles, User, CreditCard, CheckCircle2, AlertTriangle, ArrowLeft, ArrowRight, ShieldCheck, Phone, Mail, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { fromZonedTime } from 'date-fns-tz';
import { BusinessTenant, Service, Staff, Booking, VisitType } from '../types';
import { getDataProvider } from '../data/data-provider';

interface BookingWizardProps {
  tenant: BusinessTenant;
  onBookingSuccess: (booking: Booking) => void;
}

export default function BookingWizard({ tenant, onBookingSuccess }: BookingWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [visitType, setVisitType] = useState<VisitType>('Shop');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  
  // Selections
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');
  
  // Customer info
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  
  // Mobile details
  const [streetAddress, setStreetAddress] = useState('');
  const [city, setCity] = useState('');
  const [postcode, setPostcode] = useState('');
  const [accessInstructions, setAccessInstructions] = useState('');
  
  // Payment info
  const [payNowOption, setPayNowOption] = useState<'Deposit' | 'Full' | 'Later'>('Later');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [isPaying, setIsPaying] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [bookingRef, setBookingRef] = useState('');
  const [finalBooking, setFinalBooking] = useState<Booking | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);

  // Time Slots
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(2026);
  const [pickerMonth, setPickerMonth] = useState(6); // July (0-indexed)

  const formatFriendlyDate = (dateStr: string) => {
    if (!dateStr) return 'Select Date';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  };

  // Idempotency key for this booking session
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  
  useEffect(() => {
    // Generate an idempotency key once per wizard load
    setIdempotencyKey(crypto.randomUUID());
  }, []);

  useEffect(() => {
    const provider = getDataProvider();
    
    // Set default date to today or tomorrow
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomStr = tomorrow.toISOString().split('T')[0];
    setSelectedDate(tomStr);
    setPickerYear(tomorrow.getFullYear());
    setPickerMonth(tomorrow.getMonth());

    let active = true;
    async function loadData() {
      setIsLoading(true);
      try {
        const catalog = await provider.getPublicCatalog(tenant.subdomain);
        if (active) {
          setServices(catalog.services);
          setStaffList(catalog.staff.map((s: any) => ({ ...s, servicesHandled: catalog.services.map((x: any) => x.id) }))); // Mock handles until API is extended
          setLoadError('');
        }
      } catch (err) {
        console.error('Error loading catalog in BookingWizard:', err);
        if (active) setLoadError('Error loading catalogue');
      } finally {
        if (active) setIsLoading(false);
      }
    }
    loadData();

    return () => {
      active = false;
    };
  }, [tenant]);

  // Set default payment option based on policy
  useEffect(() => {
    if (tenant.paymentPolicy === 'Deposit') {
      setPayNowOption('Deposit');
    } else if (tenant.paymentPolicy === 'FullPayment') {
      setPayNowOption('Full');
    } else {
      setPayNowOption('Later');
    }
  }, [tenant, selectedService]);

  // Generate Slots
  useEffect(() => {
    if (!selectedService || !selectedDate) return;
    
    let active = true;
    const provider = getDataProvider();

    async function loadAvailability() {
      try {
        const result = await provider.getPublicAvailability(tenant.subdomain, {
          tenantId: tenant.id,
          serviceId: selectedService!.id,
          staffId: selectedStaff?.id || 'any',
          date: selectedDate,
          bookingChannel: visitType === 'Shop' ? 'in_shop' : 'mobile'
        });

        if (active) {
          // Extract time strings from slots (e.g. "09:00")
          const uniqueTimes = Array.from(new Set(
            result.slots.map((s: any) => {
              const d = new Date(s.start);
              return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
            })
          )) as string[];
          setAvailableSlots(uniqueTimes);
        }
      } catch (err) {
        console.error('Error loading availability:', err);
        if (active) setAvailableSlots([]);
      }
    }

    loadAvailability();

    return () => {
      active = false;
    };
  }, [selectedService, selectedStaff, selectedDate, visitType, tenant]);

  // Pricing calculation
  const getServicePrice = () => {
    if (!selectedService) return 0;
    if (selectedStaff && selectedStaff.priceOverrides?.[selectedService.id]) {
      return selectedStaff.priceOverrides[selectedService.id];
    }
    return selectedService.price;
  };

  const getDepositAmount = () => {
    const base = getServicePrice();
    return Math.round((base * (tenant.depositPercentage / 100)) * 100) / 100;
  };

  const getAmountToPayNow = () => {
    if (payNowOption === 'Deposit') return getDepositAmount();
    if (payNowOption === 'Full') return getServicePrice();
    return 0;
  };

  const handleNext = () => {
    if (step === 1 && !selectedService) return;
    if (step === 2 && (!selectedDate || !selectedTime)) return;
    if (step === 3) {
      if (!clientName || !clientEmail || !clientPhone) return;
      if (visitType === 'Mobile' && (!streetAddress || !city || !postcode)) return;
    }
    setStep((prev) => (prev + 1) as any);
  };

  const handleBack = () => {
    setStep((prev) => (prev - 1) as any);
  };

  const submitBooking = async () => {
    if (!selectedService || !selectedDate || !selectedTime) return;

    // Use selected staff or first available (in reality, API handles staffId auto-assignment if null, but we pass any available)
    let assignedStaff = selectedStaff;
    if (!assignedStaff && staffList.length > 0) {
      assignedStaff = staffList[0];
    }
    if (!assignedStaff) return;

    setIsPaying(true);
    setPaymentError('');

    try {
      const provider = getDataProvider();

      // We need absolute start time
      // The API requires ISO 8601 string, representing the time in the tenant's timezone.
      // We convert the local selected time to UTC taking into account the tenant timezone.
      const startTimeStr = `${selectedDate}T${selectedTime}:00`;
      const utcDate = fromZonedTime(startTimeStr, tenant.timezone);

      const requestPayload = {
        serviceId: selectedService.id,
        staffId: assignedStaff.id,
        startTime: utcDate.toISOString(),
        client: {
          name: clientName,
          email: clientEmail,
          phone: clientPhone
        },
        bookingChannel: visitType === 'Shop' ? 'in_shop' : 'mobile',
        mobileAddress: visitType === 'Mobile' ? {
          line1: streetAddress,
          city,
          postcode,
          accessNotes: accessInstructions
        } : null,
        paymentMode: 'pay_later', // Only pay_later supported in Phase 3
        payNow: false,
        idempotencyKey,
        resourceId: selectedService.requiresResource || null
      };

      const result = await provider.createPublicBooking(tenant.subdomain, requestPayload);
      
      if (result.payment?.required && result.payment?.checkoutUrl) {
        window.location.href = result.payment.checkoutUrl;
        return;
      }

      setBookingRef(result.booking.reference);
      setFinalBooking(result.booking);
      setIsPaying(false);
      if (onBookingSuccess) onBookingSuccess(result.booking);
      
      // Reset idempotency key for next booking
      setIdempotencyKey(crypto.randomUUID());
    } catch (err: any) {
      console.error('Error saving booking:', err);
      if (err.message === 'SLOT_UNAVAILABLE') {
        setPaymentError('The selected slot is no longer available. Please select another time.');
        setStep(2); // Go back to slot selection
      } else {
        setPaymentError('Failed to complete booking. Please try again.');
      }
      setIsPaying(false);
    }
  };

  const calculateEndTime = (start: string, duration: number) => {
    const [h, m] = start.split(':').map(Number);
    const totalMinutes = h * 60 + m + duration;
    const finalH = Math.floor(totalMinutes / 60) % 24;
    const finalM = totalMinutes % 60;
    return `${finalH.toString().padStart(2, '0')}:${finalM.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return <div className="p-10 text-center font-bold text-slate-500">Loading...</div>;
  }

  if (loadError) {
    return <div className="p-10 text-center font-bold text-red-500">{loadError}</div>;
  }

  return (
    <div className="w-full max-w-3xl mx-auto bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden font-sans">
      {/* Header Panel */}
      <div 
        className="p-8 text-white relative overflow-hidden"
        style={{ backgroundColor: tenant.primaryColor }}
      >
        <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-64 h-64 rounded-full bg-white opacity-10 blur-xl"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="text-xs tracking-wider uppercase bg-white/20 px-3 py-1 rounded-full font-medium">
              Secure Online Booking
            </span>
            <h2 className="text-2xl font-bold mt-2 tracking-tight">{tenant.name}</h2>
            <p className="text-sm opacity-90 mt-1 flex items-center gap-1">
              <MapPin className="w-4 h-4" /> {tenant.address || 'London'}
            </p>
          </div>
          <div className="flex gap-2 bg-black/10 p-1.5 rounded-2xl w-fit">
            <button
              onClick={() => { setVisitType('Shop'); setSelectedService(null); }}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300 ${visitType === 'Shop' ? 'bg-white shadow-sm' : 'hover:bg-white/10'}`}
              style={{ color: visitType === 'Shop' ? tenant.primaryColor : '#ffffff' }}
            >
              In Salon
            </button>
            <button
              onClick={() => { setVisitType('Mobile'); setSelectedService(null); }}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300 ${visitType === 'Mobile' ? 'bg-white shadow-sm' : 'hover:bg-white/10'}`}
              style={{ color: visitType === 'Mobile' ? tenant.primaryColor : '#ffffff' }}
            >
              Mobile Travel
            </button>
          </div>
        </div>

        {/* Steps Tracker */}
        {!bookingRef && (
          <div className="flex justify-between items-center mt-8 pt-6 border-t border-white/20 text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 flex items-center justify-center rounded-full font-bold ${step >= 1 ? 'bg-white' : 'border border-white/40'}`} style={{ color: step >= 1 ? tenant.primaryColor : '#ffffff' }}>1</span>
              <span className={`font-medium ${step === 1 ? 'opacity-100 font-semibold' : 'opacity-60'}`}>Service</span>
            </div>
            <div className="h-0.5 flex-1 mx-2 bg-white/20"></div>
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 flex items-center justify-center rounded-full font-bold ${step >= 2 ? 'bg-white' : 'border border-white/40'}`} style={{ color: step >= 2 ? tenant.primaryColor : '#ffffff' }}>2</span>
              <span className={`font-medium ${step === 2 ? 'opacity-100 font-semibold' : 'opacity-60'}`}>Time</span>
            </div>
            <div className="h-0.5 flex-1 mx-2 bg-white/20"></div>
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 flex items-center justify-center rounded-full font-bold ${step >= 3 ? 'bg-white' : 'border border-white/40'}`} style={{ color: step >= 3 ? tenant.primaryColor : '#ffffff' }}>3</span>
              <span className={`font-medium ${step === 3 ? 'opacity-100 font-semibold' : 'opacity-60'}`}>Details</span>
            </div>
            <div className="h-0.5 flex-1 mx-2 bg-white/20"></div>
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 flex items-center justify-center rounded-full font-bold ${step >= 4 ? 'bg-white' : 'border border-white/40'}`} style={{ color: step >= 4 ? tenant.primaryColor : '#ffffff' }}>4</span>
              <span className={`font-medium ${step === 4 ? 'opacity-100 font-semibold' : 'opacity-60'}`}>Pay</span>
            </div>
          </div>
        )}
      </div>

      {/* Main Form Body */}
      <div className="p-8">
        {bookingRef ? (
          /* Confirmation Screen */
          <div className="text-center py-10">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner animate-bounce">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h3 className="text-2xl font-bold text-slate-800">Appointment Confirmed!</h3>
            <p className="text-slate-500 mt-2">
              Thank you for booking with us. Your reference is <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-1 rounded">{bookingRef}</span>.
            </p>

            <div className="mt-8 max-w-md mx-auto bg-slate-50 rounded-2xl p-6 border border-slate-100 text-left text-sm space-y-4">
              <h4 className="font-bold text-slate-800 border-b pb-2 mb-2">Booking Summary</h4>
              <div className="flex justify-between">
                <span className="text-slate-500">Service:</span>
                <span className="font-medium text-slate-800">{selectedService?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Duration:</span>
                <span className="font-medium text-slate-800">{selectedService?.durationMin} mins</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Professional:</span>
                <span className="font-medium text-slate-800">{selectedStaff?.name || 'Any Available Expert'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Date & Time:</span>
                <span className="font-medium text-slate-800">{selectedDate} @ {selectedTime}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Location Style:</span>
                <span className="font-medium text-slate-800">{visitType === 'Mobile' ? 'Mobile Home Visit' : 'At the Salon'}</span>
              </div>
              {visitType === 'Mobile' && (
                <div className="flex justify-between border-t pt-2 mt-2">
                  <span className="text-slate-500">Travel Address:</span>
                  <span className="font-medium text-slate-800 text-right">{streetAddress}, {city}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 mt-2 font-semibold">
                <span className="text-slate-800">Total Price:</span>
                <span className="text-slate-800">£{getServicePrice()}</span>
              </div>
              <div className="flex justify-between text-emerald-600 font-semibold">
                <span>Paid Now:</span>
                <span>£{getAmountToPayNow()}</span>
              </div>
            </div>

            <button
              onClick={() => {
                setStep(1);
                setSelectedService(null);
                setSelectedStaff(null);
                setSelectedTime('');
                setBookingRef('');
                setClientName('');
                setClientEmail('');
                setClientPhone('');
                setCardNumber('');
              }}
              className="mt-8 px-6 py-3 rounded-xl font-bold text-white shadow-md hover:opacity-90 transition-all duration-300"
              style={{ backgroundColor: tenant.primaryColor }}
            >
              Book Another Appointment
            </button>
          </div>
        ) : (
          <div>
            {/* Step 1: Choose Service and Specialist */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-amber-500" /> Choose a Service
                  </h3>
                  {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                      <RefreshCw className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
                      <p>Loading services...</p>
                    </div>
                  ) : services.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                      <AlertTriangle className="w-8 h-8 text-amber-500 mb-2" />
                      <p>No active services available.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {services.map((srv) => (
                        <div
                          key={srv.id}
                          onClick={() => setSelectedService(srv)}
                          className={`p-4 rounded-2xl border-2 cursor-pointer transition-all duration-300 flex justify-between items-start gap-4 ${selectedService?.id === srv.id ? 'border-slate-800 bg-slate-50/50' : 'border-slate-100 hover:border-slate-200'}`}
                        >
                          <div className="flex-1">
                            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                              {srv.category}
                            </span>
                            <h4 className="font-bold text-slate-800 mt-1">{srv.name}</h4>
                            <p className="text-xs text-slate-500 mt-1">{srv.description}</p>
                            <div className="flex items-center gap-3 mt-3 text-xs text-slate-400">
                              <span className="flex items-center gap-1 font-medium text-slate-600"><Clock className="w-3.5 h-3.5" /> {srv.durationMin} mins</span>
                              {srv.requiresResource && (
                                <span className="bg-amber-50 text-amber-700 font-semibold px-2 py-0.5 rounded-md text-[10px]">
                                  Requires Private Suite
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right flex flex-col justify-between h-full min-w-[70px]">
                            <span className="text-lg font-extrabold text-slate-800">£{srv.price}</span>
                            {selectedService?.id === srv.id && (
                              <span className="text-xs text-slate-700 font-semibold mt-2">Selected ✓</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Staff Choice */}
                <div className="border-t pt-6">
                  <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <User className="w-5 h-5 text-slate-600" /> Choose professional
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div
                      onClick={() => setSelectedStaff(null)}
                      className={`p-4 rounded-2xl border-2 cursor-pointer transition-all duration-300 text-center flex flex-col items-center justify-center h-full ${selectedStaff === null ? 'border-slate-800 bg-slate-50' : 'border-slate-100 hover:border-slate-200'}`}
                    >
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xl font-bold mb-2">
                        ?
                      </div>
                      <h4 className="font-bold text-slate-800 text-sm">Any Professional</h4>
                      <p className="text-xs text-slate-400 mt-1">Best availability</p>
                    </div>

                    {staffList
                      .filter(s => !selectedService || s.servicesHandled.includes(selectedService.id))
                      .map((st) => (
                        <div
                          key={st.id}
                          onClick={() => setSelectedStaff(st)}
                          className={`p-4 rounded-2xl border-2 cursor-pointer transition-all duration-300 text-center flex flex-col items-center justify-center ${selectedStaff?.id === st.id ? 'border-slate-800 bg-slate-50' : 'border-slate-100 hover:border-slate-200'}`}
                        >
                          <img src={st.avatarUrl} alt={st.name} className="w-12 h-12 rounded-full object-cover mb-2 border border-slate-100" />
                          <h4 className="font-bold text-slate-800 text-sm">{st.name}</h4>
                          <span className="text-[10px] text-amber-600 font-bold mt-1">★ {st.rating.toFixed(1)}</span>
                          <p className="text-xs text-slate-400 mt-0.5">{st.role}</p>
                          {selectedService && st.priceOverrides?.[selectedService.id] && (
                            <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded mt-1">
                              £{st.priceOverrides[selectedService.id]} Master pricing
                            </span>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Date & Time Picker */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-slate-700" /> Choose Date
                  </h3>
                  <div className="relative">
                    {/* Date Selector Trigger Button */}
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
                      className="w-full flex items-center justify-between font-black text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 p-3.5 rounded-xl text-xs transition shadow-3xs cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-indigo-600 animate-pulse" />
                        <span>{formatFriendlyDate(selectedDate)}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider bg-white px-2 py-0.5 rounded border border-slate-100">Click to change</span>
                    </button>

                    {showDatePicker && (
                      <>
                        {/* Backdrop to dismiss */}
                        <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
                        <div className="absolute left-0 right-0 mt-2 bg-white border border-slate-200/80 rounded-2xl shadow-xl p-4 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                          
                          {/* Month navigation */}
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
                              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition cursor-pointer"
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
                              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition cursor-pointer"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Week days labels */}
                          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black text-slate-400 uppercase mb-1">
                            <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
                          </div>

                          {/* Days grid */}
                          <div className="grid grid-cols-7 gap-1 text-center">
                            {Array.from({ length: new Date(pickerYear, pickerMonth, 1).getDay() }).map((_, i) => (
                              <div key={`empty-${i}`} className="w-8 h-8" />
                            ))}

                            {Array.from({ length: new Date(pickerYear, pickerMonth + 1, 0).getDate() }).map((_, i) => {
                              const dayNum = i + 1;
                              const dateStr = `${pickerYear}-${(pickerMonth + 1).toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
                              const isSelected = selectedDate === dateStr;
                              const todayStr = new Date().toISOString().split('T')[0];
                              const isPast = dateStr < todayStr;
                              const isToday = todayStr === dateStr;

                              return (
                                <button
                                  key={`day-${dayNum}`}
                                  type="button"
                                  disabled={isPast}
                                  onClick={() => {
                                    setSelectedDate(dateStr);
                                    setSelectedTime('');
                                    setShowDatePicker(false);
                                  }}
                                  className={`w-8 h-8 rounded-lg text-xs font-bold transition flex items-center justify-center cursor-pointer ${
                                    isSelected
                                      ? 'bg-slate-900 text-white font-black font-semibold'
                                      : isPast
                                        ? 'text-slate-200 cursor-not-allowed line-through font-normal'
                                        : isToday
                                          ? 'bg-indigo-50 text-indigo-600 border border-indigo-100'
                                          : 'hover:bg-slate-100 text-slate-700'
                                  }`}
                                >
                                  {dayNum}
                                </button>
                              );
                            })}
                          </div>

                          {/* Quick preset back to today */}
                          <div className="mt-3 pt-2.5 border-t border-slate-100 flex justify-between items-center text-[10px]">
                            <button
                              type="button"
                              onClick={() => {
                                const todayStr = new Date().toISOString().split('T')[0];
                                setSelectedDate(todayStr);
                                setSelectedTime('');
                                const d = new Date();
                                setPickerYear(d.getFullYear());
                                setPickerMonth(d.getMonth());
                                setShowDatePicker(false);
                              }}
                              className="font-black uppercase text-indigo-600 hover:text-indigo-800 transition flex items-center gap-1 cursor-pointer"
                            >
                              <RefreshCw className="w-3 h-3 text-indigo-500 animate-spin" style={{ animationDuration: '6s' }} /> Jump to Today
                            </button>
                            <span className="font-mono text-slate-400 font-semibold">{new Date().toISOString().split('T')[0]}</span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="border-t pt-6">
                  <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-slate-700" /> Available Times
                  </h3>

                  {availableSlots.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-sm bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                      <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto mb-2" />
                      No availability on this date. Please try another professional or date.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Morning slots */}
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Morning</h4>
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                          {availableSlots.filter(s => parseInt(s.split(':')[0]) < 12).map((slot) => (
                            <button
                              key={slot}
                              onClick={() => setSelectedTime(slot)}
                              className={`p-2 rounded-xl text-xs font-semibold border transition-all duration-300 ${selectedTime === slot ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'border-slate-100 hover:border-slate-200 bg-slate-50/50 text-slate-700'}`}
                            >
                              {slot}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Afternoon slots */}
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Afternoon</h4>
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                          {availableSlots.filter(s => {
                            const hr = parseInt(s.split(':')[0]);
                            return hr >= 12 && hr < 17;
                          }).map((slot) => (
                            <button
                              key={slot}
                              onClick={() => setSelectedTime(slot)}
                              className={`p-2 rounded-xl text-xs font-semibold border transition-all duration-300 ${selectedTime === slot ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'border-slate-100 hover:border-slate-200 bg-slate-50/50 text-slate-700'}`}
                            >
                              {slot}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Evening slots */}
                      {availableSlots.some(s => parseInt(s.split(':')[0]) >= 17) && (
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Evening</h4>
                          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                            {availableSlots.filter(s => parseInt(s.split(':')[0]) >= 17).map((slot) => (
                              <button
                                key={slot}
                                onClick={() => setSelectedTime(slot)}
                                className={`p-2 rounded-xl text-xs font-semibold border transition-all duration-300 ${selectedTime === slot ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'border-slate-100 hover:border-slate-200 bg-slate-50/50 text-slate-700'}`}
                              >
                                {slot}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 3: Client Contact details / Mobile Address validation */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <User className="w-5 h-5 text-slate-700" /> Client Contact Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Full Name</label>
                      <input
                        type="text"
                        placeholder="e.g. John Doe"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-800 focus:outline-none text-sm"
                      />
                      <p className="mt-2 text-xs text-slate-500">We may send transactional text messages about this booking, including confirmation, changes and reminders. Message charges may apply. You can opt out of non-essential reminders.</p>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Email Address</label>
                      <input
                        type="email"
                        placeholder="john@example.com"
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-800 focus:outline-none text-sm"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Mobile Number</label>
                      <input
                        type="tel"
                        placeholder="+44 7123 456789"
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-800 focus:outline-none text-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* If mobile, require addresses */}
                {visitType === 'Mobile' && (
                  <div className="border-t pt-6 space-y-4">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-amber-600" /> Mobile Appointment Details
                    </h3>
                    <p className="text-xs text-slate-400">
                      Our professional travels to your location. The system enforces strict address validation.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-3">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Street Address</label>
                        <input
                          type="text"
                          placeholder="e.g. Apartment 4, 15 London Road"
                          value={streetAddress}
                          onChange={(e) => setStreetAddress(e.target.value)}
                          className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-800 focus:outline-none text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">City</label>
                        <input
                          type="text"
                          placeholder="e.g. London"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-800 focus:outline-none text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Postcode</label>
                        <input
                          type="text"
                          placeholder="e.g. W11 3RE"
                          value={postcode}
                          onChange={(e) => setPostcode(e.target.value)}
                          className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-800 focus:outline-none text-sm"
                        />
                      </div>
                      <div className="md:col-span-3">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Access or Parking Instructions (Optional)</label>
                        <textarea
                          placeholder="e.g. Gate code is #1234. Free guest parking bays available at rear."
                          rows={2}
                          value={accessInstructions}
                          onChange={(e) => setAccessInstructions(e.target.value)}
                          className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-800 focus:outline-none text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 4: Stripe Payment and Policy Review */}
            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-slate-700" /> Stripe Secure Checkout
                  </h3>
                  <p className="text-xs text-slate-400 mb-4">
                    The business policy requires payment details. The platform executes standard Stripe security checks.
                  </p>

                  <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 space-y-4 text-sm mb-6">
                    {paymentError && (
                      <div className="p-3 mb-2 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" /> {paymentError}
                      </div>
                    )}
                    <div className="flex justify-between border-b pb-3 font-semibold text-slate-800">
                      <span>Service Total:</span>
                      <span>£{getServicePrice()}</span>
                    </div>

                    {/* Policy options */}
                    {tenant.paymentPolicy === 'CustomerChoice' ? (
                      <div className="space-y-2 py-2">
                        <label className="text-xs font-bold text-slate-400 uppercase block">Choose Payment Mode</label>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => setPayNowOption('Later')}
                            className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${payNowOption === 'Later' ? 'border-slate-800 bg-white shadow-sm' : 'border-slate-100 text-slate-500 bg-slate-100/50 hover:bg-slate-100'}`}
                          >
                            Pay at Salon (Later)
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayNowOption('Deposit')}
                            className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${payNowOption === 'Deposit' ? 'border-slate-800 bg-white shadow-sm' : 'border-slate-100 text-slate-500 bg-slate-100/50 hover:bg-slate-100'}`}
                          >
                            Pay 30% Deposit (£{getDepositAmount()})
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayNowOption('Full')}
                            className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${payNowOption === 'Full' ? 'border-slate-800 bg-white shadow-sm' : 'border-slate-100 text-slate-500 bg-slate-100/50 hover:bg-slate-100'}`}
                          >
                            Pay Full (£{getServicePrice()})
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-between text-slate-600 bg-white p-3 rounded-xl border border-slate-100">
                        <span>Payment Policy Enforcement:</span>
                        <span className="font-semibold text-slate-800">
                          {tenant.paymentPolicy === 'Deposit' ? `30% Mandatory Deposit` : tenant.paymentPolicy === 'FullPayment' ? '100% Prepayment Required' : 'No pre-payment required'}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between font-extrabold text-slate-900 pt-3 border-t text-base">
                      <span>Amount Due Now:</span>
                      <span className="text-lg" style={{ color: tenant.primaryColor }}>£{getAmountToPayNow()}</span>
                    </div>
                  </div>

                  {/* Render simulated Stripe details */}
                  {getAmountToPayNow() > 0 ? (
                    <div className="border border-slate-200 rounded-2xl p-5 space-y-4 bg-white shadow-sm">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                          <ShieldCheck className="w-4 h-4 text-emerald-500" /> Stripe Secure Field
                        </span>
                        <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-500">Demo Card</span>
                      </div>
                      
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">CARD NUMBER</label>
                        <input
                          type="text"
                          placeholder="4242 •••• •••• 4242"
                          value={cardNumber}
                          onChange={(e) => setCardNumber(e.target.value)}
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none"
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">EXPIRY DATE</label>
                          <input
                            type="text"
                            placeholder="MM/YY"
                            value={cardExpiry}
                            onChange={(e) => setCardExpiry(e.target.value)}
                            className="w-full p-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none text-center"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">CVC CODE</label>
                          <input
                            type="text"
                            placeholder="•••"
                            value={cardCvc}
                            onChange={(e) => setCardCvc(e.target.value)}
                            className="w-full p-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none text-center"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-amber-50 text-amber-800 rounded-2xl border border-amber-100 text-xs flex gap-3 items-start">
                      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                      <div>
                        <p className="font-bold">No-Show Protection & Authorization</p>
                        <p className="mt-0.5 opacity-90">
                          By confirming, you agree to our 24-hour cancellation policy. No card hold is captured immediately. Remaining payment is due in person.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Wizard Navigation Bar */}
            <div className="flex justify-between items-center mt-8 pt-6 border-t border-slate-100">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex items-center gap-1 px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
              ) : (
                <div />
              )}

              {step < 4 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={
                    (step === 1 && !selectedService) ||
                    (step === 2 && (!selectedDate || !selectedTime)) ||
                    (step === 3 && (!clientName || !clientEmail || !clientPhone || (visitType === 'Mobile' && (!streetAddress || !city || !postcode))))
                  }
                  className="flex items-center gap-1 px-6 py-3 text-sm font-bold text-white rounded-xl shadow-md hover:opacity-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ backgroundColor: tenant.primaryColor }}
                >
                  Next <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submitBooking}
                  disabled={isPaying || (getAmountToPayNow() > 0 && !cardNumber)}
                  className="flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold text-white rounded-xl shadow-md hover:opacity-95 transition disabled:opacity-40 disabled:cursor-not-allowed min-w-[140px]"
                  style={{ backgroundColor: tenant.primaryColor }}
                >
                  {isPaying ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin border-2 border-white border-t-transparent rounded-full w-4 h-4"></span>
                      Stripe Transacting...
                    </span>
                  ) : (
                    <span>Confirm & Pay £{getAmountToPayNow()}</span>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
