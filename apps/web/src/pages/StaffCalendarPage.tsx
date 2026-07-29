import { Clock3 } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../auth';
import { useWorkspace } from '../context/WorkspaceContext.js';
import { BookingOperationsCalendar } from '../features/bookings/BookingOperationsCalendar.js';
import { CalendarAvailabilityDialog } from '../features/bookings/CalendarAvailabilityDialog.js';

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
    else next.delete('availability');
    setParams(next, { replace: true });
  };

  return <>
    <BookingOperationsCalendar />
    {role === 'owner' && <button type="button" onClick={() => setAvailabilityOpen(true)} className="fixed bottom-20 right-4 z-[60] inline-flex min-h-11 items-center gap-2 rounded-2xl border border-indigo-200 bg-white px-4 text-sm font-black text-indigo-800 shadow-xl hover:bg-indigo-50 sm:right-6"><Clock3 className="h-4 w-4" />Availability</button>}
    <CalendarAvailabilityDialog open={availabilityOpen} initialDate={selectedDate} onClose={() => setAvailabilityOpen(false)} />
  </>;
}
export default StaffCalendarPage;
