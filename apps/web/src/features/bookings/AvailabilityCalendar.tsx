import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
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
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import './AvailabilityCalendar.css';

type BookingChannel = 'in_shop' | 'mobile';
type CalendarView = 'calendar' | 'times';

type AvailabilityCalendarProps = {
  slug: string;
  serviceId: string;
  serviceIds?: string[];
  staffId: string;
  locationId?: string;
  bookingChannel: BookingChannel;
  value: string;
  minimumDate: string;
  maximumDate: string;
  primary: string;
  onChange: (date: string) => void;
};

type DateAvailability = { date: string; slotCount: number };
type AvailabilityResponse = {
  availableDates?: string[];
  availabilityByDate?: DateAvailability[];
};

const localDate = (value: string) => new Date(`${value}T12:00:00`);
const lowAvailabilityThreshold = 3;

export function AvailabilityCalendar({
  slug,
  serviceId,
  serviceIds,
  staffId,
  locationId,
  bookingChannel,
  value,
  minimumDate,
  maximumDate,
  primary,
  onChange,
}: AvailabilityCalendarProps) {
  const selectedServiceIds = useMemo(() => serviceIds?.length ? serviceIds : [serviceId], [serviceId, serviceIds]);
  // PublicBookingFlow historically passes tomorrow as its baseline date. Include the
  // preceding calendar day so same-day availability and date overrides are decided by
  // the live API's minimum-notice and availability rules rather than blocked in the UI.
  const minimum = useMemo(() => addDays(localDate(minimumDate), -1), [minimumDate]);
  const maximum = useMemo(() => localDate(maximumDate), [maximumDate]);
  const selected = useMemo(() => localDate(value), [value]);
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(selected));
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [availabilityByDate, setAvailabilityByDate] = useState<Map<string, number>>(new Map());
  const [view, setView] = useState<CalendarView>('calendar');
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setVisibleMonth(startOfMonth(selected));
  }, [selected]);

  useEffect(() => {
    setView('calendar');
  }, [bookingChannel, locationId, selectedServiceIds, serviceId, staffId]);

  const range = useMemo(() => {
    const from = isBefore(startOfMonth(visibleMonth), minimum) ? minimum : startOfMonth(visibleMonth);
    const to = isAfter(endOfMonth(visibleMonth), maximum) ? maximum : endOfMonth(visibleMonth);
    return { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') };
  }, [maximum, minimum, visibleMonth]);

  useEffect(() => {
    if (!serviceId || isAfter(localDate(range.from), localDate(range.to))) {
      setAvailableDates(new Set());
      setAvailabilityByDate(new Map());
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
    query.set('serviceIds', selectedServiceIds.join(','));
    if (locationId) query.set('locationId', locationId);

    fetch(`/api/v1/public/${encodeURIComponent(slug)}/available-dates?${query}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Availability calendar could not be loaded.');
        return response.json() as Promise<AvailabilityResponse>;
      })
      .then(body => {
        const dates = body.availableDates || [];
        const counts = new Map<string, number>(
          (body.availabilityByDate || []).map(item => [item.date, item.slotCount]),
        );
        for (const date of dates) {
          if (!counts.has(date)) counts.set(date, 1);
        }
        setAvailableDates(new Set(dates));
        setAvailabilityByDate(counts);
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadFailed(true);
        setAvailableDates(new Set());
        setAvailabilityByDate(new Map());
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [bookingChannel, locationId, range.from, range.to, selectedServiceIds, serviceId, slug, staffId]);

  const gridStart = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 1 });
  const calendarDays = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const canGoPrevious = isAfter(startOfMonth(visibleMonth), startOfMonth(minimum));
  const canGoNext = isBefore(startOfMonth(visibleMonth), startOfMonth(maximum));
  const selectedSlotCount = availabilityByDate.get(value) || 0;
  const selectedAvailabilityCopy = loadFailed
    ? 'Live times are loading below'
    : selectedSlotCount <= lowAvailabilityThreshold
      ? `${selectedSlotCount} ${selectedSlotCount === 1 ? 'time' : 'times'} left on this day`
      : `${selectedSlotCount} times available on this day`;

  return (
    <section className={`booking-date-picker is-${view}-view`} aria-label="Appointment calendar">
      {view === 'times' ? (
        <div className="booking-date-picker__time-header">
          <div className="booking-date-picker__selected-date">
            <span className="booking-date-picker__selected-icon" style={{ color: primary }}>
              <Clock3 aria-hidden="true" />
            </span>
            <div>
              <p>Selected day</p>
              <h3>{format(selected, 'EEEE, d MMMM yyyy')}</h3>
              <span>{selectedAvailabilityCopy}</span>
            </div>
          </div>
          <button type="button" onClick={() => setView('calendar')} className="booking-date-picker__change-date">
            <ArrowLeft aria-hidden="true" />
            Change date
          </button>
        </div>
      ) : (
        <>
          <header className="booking-date-picker__header">
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
              <span>{loading ? 'Checking live availability…' : loadFailed ? 'Select a day to check live times' : 'Choose a highlighted day'}</span>
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

          <div className="booking-date-picker__weekdays" aria-hidden="true">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}
          </div>

          <div className="booking-date-picker__grid">
            {calendarDays.map(day => {
              const dayValue = format(day, 'yyyy-MM-dd');
              const inMonth = isSameMonth(day, visibleMonth);
              const inRange = !isBefore(day, minimum) && !isAfter(day, maximum);
              const slotCount = availabilityByDate.get(dayValue) || 0;
              const available = loadFailed || availableDates.has(dayValue) || slotCount > 0;
              const disabled = !inMonth || !inRange || loading || !available;
              const active = dayValue === value;
              const limited = !loadFailed && slotCount > 0 && slotCount <= lowAvailabilityThreshold;
              const availabilityDescription = disabled
                ? 'no appointment times available'
                : loadFailed
                  ? 'select to check live appointment times'
                  : limited
                    ? `low availability, ${slotCount} ${slotCount === 1 ? 'time' : 'times'} left`
                    : `${slotCount} appointment times available`;
              const tooltipCopy = !inMonth || !inRange
                ? undefined
                : loading
                  ? 'Checking availability…'
                  : disabled
                    ? 'No times available'
                    : loadFailed
                      ? 'Check live times'
                      : limited
                        ? `Only ${slotCount} ${slotCount === 1 ? 'time' : 'times'} left`
                        : `${slotCount} times available`;
              const tooltipTone = disabled ? 'unavailable' : limited ? 'limited' : 'available';
              const className = [
                active ? 'is-selected' : '',
                !disabled && !loadFailed && limited ? 'is-limited' : '',
                !disabled && !loadFailed && !limited ? 'is-available' : '',
                disabled ? 'is-unavailable' : '',
                !disabled && loadFailed ? 'is-unverified' : '',
              ].filter(Boolean).join(' ');

              return (
                <button
                  type="button"
                  key={dayValue}
                  disabled={disabled}
                  aria-pressed={active}
                  aria-label={`${format(day, 'EEEE d MMMM yyyy')}, ${availabilityDescription}`}
                  data-tooltip={tooltipCopy}
                  data-tooltip-tone={tooltipTone}
                  onClick={() => {
                    setView('times');
                    onChange(dayValue);
                  }}
                  className={className}
                  style={active ? { borderColor: primary, boxShadow: `inset 0 0 0 1px ${primary}` } : undefined}
                >
                  <span>{format(day, 'd')}</span>
                  {!disabled && !loadFailed ? <i aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>

          <div className="booking-date-picker__legend" aria-label="Calendar availability key">
            <span><i className="is-available" aria-hidden="true" />Available</span>
            <span><i className="is-limited" aria-hidden="true" />Low availability</span>
            <span><i className="is-unavailable" aria-hidden="true" />Unavailable</span>
          </div>

          <p className="booking-date-picker__status" aria-live="polite">
            <CalendarDays aria-hidden="true" />
            {loading ? 'Loading available days.' : loadFailed ? 'Calendar availability could not be preloaded. Select a day and we will check it live.' : 'Only days with at least one live appointment time can be selected.'}
          </p>
        </>
      )}
    </section>
  );
}

export default AvailabilityCalendar;
