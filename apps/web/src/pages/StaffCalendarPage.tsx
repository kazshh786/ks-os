import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { useSearchParams } from 'react-router';
import type { Service, Staff } from '../data/types.js';
import { useAuth } from '../auth';
import { useWorkspace } from '../context/WorkspaceContext.js';
import { getDataProvider } from '../data/data-provider.js';
import { BookingOperationsCalendar } from '../features/bookings/BookingOperationsCalendar.js';
import { CalendarAvailabilityDialog } from '../features/bookings/CalendarAvailabilityDialog.js';
import { CalendarLayerPolish } from '../features/bookings/CalendarLayerPolish.js';
import { CreateBookingDialog } from '../features/bookings/CreateBookingDialog.js';
import { MobileCalendarExperience } from '../features/bookings/MobileCalendarExperience.js';
import { CalendarToolbarActionPortal, CalendarWorkspaceFrame } from '../features/bookings/CalendarWorkspaceFrame.js';

export function StaffCalendarPage() {
  const { role } = useAuth();
  const { activeTenant } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const availabilityOpen = role === 'owner' && params.get('availability') === '1';
  const inboxClientId = params.get('clientId');
  const inboxBookingOpen = params.get('create') === 'booking' && Boolean(inboxClientId);
  const selectedDate = params.get('date') || new Intl.DateTimeFormat('en-CA', {
    timeZone: activeTenant?.timezone || 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  useEffect(() => {
    if (!activeTenant || !inboxBookingOpen) return;
    let active = true;
    Promise.all([
      getDataProvider().getServices(activeTenant.id),
      getDataProvider().getStaff(activeTenant.id),
    ]).then(([serviceRows, staffRows]) => {
      if (active) { setServices(serviceRows); setStaff(staffRows); }
    }).catch(() => {
      if (active) { setServices([]); setStaff([]); }
    });
    return () => { active = false; };
  }, [activeTenant, inboxBookingOpen]);

  const setAvailabilityOpen = (open: boolean) => {
    const next = new URLSearchParams(params);
    if (open) next.set('availability', '1');
    else {
      next.delete('availability');
      window.dispatchEvent(new CustomEvent('ks-availability-updated'));
    }
    setParams(next, { replace: true });
  };

  const closeInboxBooking = () => {
    const next = new URLSearchParams(params);
    next.delete('create');
    next.delete('clientId');
    setParams(next, { replace: true });
  };

  return <>
    <CalendarWorkspaceFrame>
      <CalendarLayerPolish />
      <MobileCalendarExperience />
      <BookingOperationsCalendar />
    </CalendarWorkspaceFrame>
    {role === 'owner' && <CalendarToolbarActionPortal>
      <button type="button" aria-label="Availability" onClick={() => setAvailabilityOpen(true)} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800 sm:px-3"><Clock3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Availability</span></button>
    </CalendarToolbarActionPortal>}
    <CalendarAvailabilityDialog open={availabilityOpen} initialDate={selectedDate} onClose={() => setAvailabilityOpen(false)} />
    {activeTenant && <CreateBookingDialog
      open={inboxBookingOpen}
      timezone={activeTenant.timezone}
      services={services}
      staff={staff}
      initialDate={selectedDate}
      initialClientId={inboxClientId}
      onClose={closeInboxBooking}
      onCreated={() => {
        closeInboxBooking();
        window.dispatchEvent(new CustomEvent('ks-bookings-updated'));
      }}
    />}
  </>;
}
export default StaffCalendarPage;
