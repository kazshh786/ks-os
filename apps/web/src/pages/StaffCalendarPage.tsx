import { Clock3 } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../auth';
import { useWorkspace } from '../context/WorkspaceContext.js';
import { BookingOperationsCalendar } from '../features/bookings/BookingOperationsCalendar.js';
import { CalendarAvailabilityDialog } from '../features/bookings/CalendarAvailabilityDialog.js';
import { CalendarToolbarActionPortal, CalendarWorkspaceFrame } from '../features/bookings/CalendarWorkspaceFrame.js';

export function StaffCalendarPage() {
  const { role } = useAuth();
  const { activeTenant } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const availabilityOpen = role === 'owner' && params.get('availability') === '1';
  const selectedDate = params.get('date') || new Intl.DateTimeFormat('en-CA', {
    timeZone: activeTenant?.timezone || 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  const setAvailabilityOpen = (open: boolean) => {
    const next = new URLSearchParams(params);
    if (open) next.set('availability', '1');
    else {
      next.delete('availability');
      window.dispatchEvent(new CustomEvent('ks-availability-updated'));
    }
    setParams(next, { replace: true });
  };

  return <>
    <CalendarWorkspaceFrame>
      <BookingOperationsCalendar />
    </CalendarWorkspaceFrame>
    {role === 'owner' && <CalendarToolbarActionPortal>
      <button type="button" onClick={() => setAvailabilityOpen(true)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800"><Clock3 className="h-3.5 w-3.5" />Availability</button>
    </CalendarToolbarActionPortal>}
    <CalendarAvailabilityDialog open={availabilityOpen} initialDate={selectedDate} onClose={() => setAvailabilityOpen(false)} />
  </>;
}
export default StaffCalendarPage;
