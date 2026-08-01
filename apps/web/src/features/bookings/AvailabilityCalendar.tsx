import { useEffect, useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

type BookingChannel = 'in_shop' | 'mobile';

type AvailabilityCalendarProps = {
  slug: string;
  serviceId: string;
  staffId: string;
  locationId?: string;
  bookingChannel: BookingChannel;
  value: string;
  minimumDate: string;
  maximumDate: string;
  primary: string;
  onChange: (date: string) => void;
};

type AvailabilityResponse = { availableDates?: string[] };

const localDate = (value: string) => new Date(`${value}T12:00:00`);
const monthKey = (value: Date) => format(value, 'yyyy-MM');

export function AvailabilityCalendar({
  slug,
  serviceId,
  staffId,
  locationId,
  bookingChannel,
  value,
  minimumDate,
  maximumDate,
  primary,
  onChange,
}: AvailabilityCalendarProps) {
  const minimum = localDate(minimumDate);
  const maximum = localDate(maximumDate);
  const selected = localDate(value);
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(selected));
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (monthKey(selected) !== monthKey(visibleMonth)) setVisibleMonth(startOfMonth(selected));
  }, [value]);

  const range = useMemo(() => {
    const from = isBefore(startOfMonth(visibleMonth), minimum) ? minimum : startOfMonth(visibleMonth);
    const to = isAfter(endOfMonth(visibleMonth), maximum) ? maximum : endOfMonth(visibleMonth);
    return { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') };
  }, [maximumDate, minimumDate, visibleMonth]);

  useEffect(() => {
    if (!serviceId || isAfter(localDate(range.from), localDate(range.to))) {
      setAvailableDates(new Set());
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadFailed(false);
    const query = new URLSearchParams({
      serviceId,
      staffId,
      bookingChannel,
      from: range.from,
      to: range.to,
    });
    if (locationId) query.set('locationId', locationId);
    fetch(`/api/v1/public/${encodeURIComponent(slug)}/available-dates?${query}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Availability calendar could not be loaded.');
        return response.json() as Promise<AvailabilityResponse>;
      })
      .then(body => {
        const dates = new Set(body.availableDates || []);
        setAvailableDates(dates);
        const selectedValue = format(selected, 'yyyy-MM-dd');
        if (isSameMonth(selected, visibleMonth) && !dates.has(selectedValue)) {
          const firstAvailable = [...dates].sort()[0];
          if (firstAvailable) onChange(firstAvailable);
        }
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadFailed(true);
        setAvailableDates(new Set());
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [bookingChannel, locationId, range.from, range.to, serviceId, slug, staffId]);

  const gridStart = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 1 });
  const calendarDays = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const canGoPrevious = isAfter(startOfMonth(visibleMonth), startOfMonth(minimum));
  const canGoNext = isBefore(startOfMonth(visibleMonth), startOfMonth(maximum));

  return (
    <section className="availability-calendar" aria-label="Appointment calendar">
      <header className="availability-calendar__header">
        <button
          type="button"
          aria-label="Show previous month"
          disabled={!canGoPrevious}
          onClick={() => setVisibleMonth(current => addMonths(current, -1))}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <div>
          <p>{format(visibleMonth, 'MMMM yyyy')}</p>
          <span>{loading ? 'Checking live availability…' : loadFailed ? 'Select a day to check availability' : 'Unavailable days are disabled'}</span>
        </div>
        <button
          type="button"
          aria-label="Show next month"
          disabled={!canGoNext}
          onClick={() => setVisibleMonth(current => addMonths(current, 1))}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </header>

      <div className="availability-calendar__weekdays" aria-hidden="true">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}
      </div>

      <div className="availability-calendar__grid">
        {calendarDays.map(day => {
          const dayValue = format(day, 'yyyy-MM-dd');
          const inMonth = isSameMonth(day, visibleMonth);
          const inRange = !isBefore(day, minimum) && !isAfter(day, maximum);
          const available = loadFailed || availableDates.has(dayValue);
          const disabled = !inMonth || !inRange || loading || !available;
          const active = dayValue === value;
          return (
            <button
              type="button"
              key={dayValue}
              disabled={disabled}
              aria-pressed={active}
              aria-label={`${format(day, 'EEEE d MMMM yyyy')}${disabled && inMonth && inRange && !loading ? ', no appointment times available' : ''}`}
              title={disabled && inMonth && inRange && !loading ? 'No appointment times available' : undefined}
              onClick={() => onChange(dayValue)}
              className={active ? 'is-selected' : undefined}
              style={active ? { backgroundColor: primary, borderColor: primary, color: 'var(--booking-primary-foreground)' } : undefined}
            >
              <span>{format(day, 'd')}</span>
              {inMonth && inRange && available && !loading ? <i aria-hidden="true" style={{ backgroundColor: primary }} /> : null}
            </button>
          );
        })}
      </div>

      <p className="availability-calendar__status" aria-live="polite">
        <CalendarDays aria-hidden="true" />
        {loading ? 'Loading available days.' : loadFailed ? 'Calendar availability could not be preloaded. You can still select a day and we will check it live.' : 'Only days with at least one live appointment time can be selected.'}
      </p>
    </section>
  );
}

export default AvailabilityCalendar;
