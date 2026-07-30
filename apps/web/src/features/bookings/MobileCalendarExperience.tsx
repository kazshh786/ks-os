import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router';

const mobileCalendarQuery = '(max-width: 767px)';

function calendarFrame() {
  return document.querySelector<HTMLElement>('[data-calendar-workspace-frame]');
}

function calendarActionHost() {
  const moreButton = calendarFrame()?.querySelector<HTMLButtonElement>("button[aria-label='More calendar actions']");
  return moreButton?.parentElement?.parentElement || null;
}

function clickCalendarButton(label: string) {
  const buttons = Array.from(calendarFrame()?.querySelectorAll<HTMLButtonElement>('button') || []);
  buttons.find(button => button.textContent?.trim() === label)?.click();
}

export function MobileCalendarExperience() {
  const [params, setParams] = useSearchParams();
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(mobileCalendarQuery).matches);
  const [actionHost, setActionHost] = useState<HTMLElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const previousView = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const media = window.matchMedia(mobileCalendarQuery);
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (isMobile) {
      if (previousView.current === undefined) previousView.current = params.get('view');
      if (params.get('view') !== 'day') {
        const next = new URLSearchParams(params);
        next.set('view', 'day');
        setParams(next, { replace: true });
      }
      return;
    }

    if (previousView.current !== undefined && params.get('view') === 'day') {
      const next = new URLSearchParams(params);
      if (previousView.current) next.set('view', previousView.current);
      else next.delete('view');
      previousView.current = undefined;
      setParams(next, { replace: true });
    }
  }, [isMobile, params, setParams]);

  useLayoutEffect(() => {
    const syncHost = () => setActionHost(calendarActionHost());
    syncHost();
    const observer = new MutationObserver(syncHost);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const frame = calendarFrame();
    if (!frame) return;
    if (isMobile && searchOpen) {
      frame.setAttribute('data-mobile-search-open', 'true');
      window.requestAnimationFrame(() => frame.querySelector<HTMLInputElement>("input[placeholder^='Search customer']")?.focus());
    } else {
      frame.removeAttribute('data-mobile-search-open');
    }
    return () => frame.removeAttribute('data-mobile-search-open');
  }, [isMobile, searchOpen]);

  if (!isMobile) return null;

  return <>
    {actionHost && createPortal(
      <button
        type="button"
        data-mobile-calendar-search
        aria-label={searchOpen ? 'Close booking search' : 'Search bookings'}
        aria-expanded={searchOpen}
        onClick={() => setSearchOpen(value => !value)}
        className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-slate-300 bg-white text-slate-700"
      >
        {searchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
      </button>,
      actionHost,
    )}

    <button
      type="button"
      data-mobile-calendar-create
      aria-label="New booking"
      onClick={() => clickCalendarButton('New booking')}
      className="fixed right-4 z-[90] grid h-14 w-14 place-items-center rounded-2xl bg-indigo-600 text-white shadow-[0_14px_32px_rgba(79,70,229,0.38)] transition active:scale-95"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
    >
      <Plus className="h-6 w-6" />
    </button>
  </>;
}
