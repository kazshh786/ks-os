import { useEffect, useState } from 'react';
import { CalendarDays, ExternalLink, X } from 'lucide-react';
import {
  buildCalendarProviderUrl,
  calendarProviderLabel,
  inferCalendarProvider,
  parseCalendarDataUrl,
  type CalendarEventDetails,
  type CalendarProvider,
} from './calendar-actions.js';

const CALENDAR_SELECTOR = 'a[download$=".ics"][href^="data:text/calendar"], a[data-calendar-action="true"]';
const PROVIDERS: CalendarProvider[] = ['google', 'outlook', 'microsoft365', 'yahoo', 'native'];

function findCustomerEmail(anchor: HTMLAnchorElement) {
  const container = anchor.closest('main') || anchor.closest('section') || document.body;
  const confirmation = [...container.querySelectorAll('p')]
    .find(item => item.textContent?.toLowerCase().includes('will be sent to'));
  return confirmation?.textContent?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null;
}

function enhanceCalendarAnchor(anchor: HTMLAnchorElement) {
  if (anchor.dataset.calendarAction === 'true') return;
  anchor.dataset.calendarAction = 'true';
  anchor.dataset.calendarData = anchor.href;
  anchor.removeAttribute('download');
  anchor.href = '#';
  anchor.setAttribute('aria-haspopup', 'dialog');
  anchor.title = 'Open this appointment in your calendar';
}

function openProvider(event: CalendarEventDetails, provider: CalendarProvider) {
  const url = buildCalendarProviderUrl(event, provider);
  if (provider === 'native') {
    window.location.assign(url);
    return;
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) window.location.assign(url);
}

export function CalendarActionEnhancer() {
  const [pendingEvent, setPendingEvent] = useState<CalendarEventDetails | null>(null);

  useEffect(() => {
    const enhanceAll = () => {
      document.querySelectorAll<HTMLAnchorElement>(CALENDAR_SELECTOR).forEach(enhanceCalendarAnchor);
    };

    enhanceAll();
    const observer = new MutationObserver(enhanceAll);
    observer.observe(document.body, { childList: true, subtree: true });

    const handleClick = (domEvent: MouseEvent) => {
      const target = domEvent.target instanceof Element ? domEvent.target : null;
      const anchor = target?.closest<HTMLAnchorElement>(CALENDAR_SELECTOR);
      if (!anchor) return;

      domEvent.preventDefault();
      domEvent.stopPropagation();

      try {
        const event = parseCalendarDataUrl(anchor.dataset.calendarData || '');
        const email = findCustomerEmail(anchor);
        const provider = inferCalendarProvider(
          email,
          navigator.userAgent,
          navigator.platform || '',
        );

        if (provider) {
          openProvider(event, provider);
          return;
        }

        setPendingEvent(event);
      } catch {
        setPendingEvent(null);
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', handleClick, true);
    };
  }, []);

  useEffect(() => {
    if (!pendingEvent) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingEvent(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingEvent]);

  if (!pendingEvent) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={event => {
        if (event.target === event.currentTarget) setPendingEvent(null);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-provider-title"
        className="w-full max-w-md rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-700">
              <CalendarDays className="h-5 w-5" />
            </span>
            <div>
              <h2 id="calendar-provider-title" className="text-lg font-black text-slate-950">Choose your calendar</h2>
              <p className="mt-1 text-sm leading-5 text-slate-600">The appointment will open ready to save. No calendar file download is required.</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close calendar options"
            onClick={() => setPendingEvent(null)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-2">
          {PROVIDERS.map(provider => (
            <button
              key={provider}
              type="button"
              onClick={() => {
                openProvider(pendingEvent, provider);
                setPendingEvent(null);
              }}
              className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-left text-sm font-black text-slate-900 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
            >
              <span>Add to {calendarProviderLabel(provider)}</span>
              <ExternalLink className="h-4 w-4 text-slate-400" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export default CalendarActionEnhancer;
