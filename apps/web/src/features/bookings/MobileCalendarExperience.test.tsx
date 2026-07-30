import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarWorkspaceFrame } from './CalendarWorkspaceFrame.js';
import { MobileCalendarExperience } from './MobileCalendarExperience.js';

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

function QueryProbe() {
  const [params] = useSearchParams();
  return <output aria-label="Calendar query">{params.toString()}</output>;
}

describe('MobileCalendarExperience', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: true,
      media: '(max-width: 767px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses day view on phones and exposes focused search and create actions', async () => {
    const createBooking = vi.fn();
    render(<MemoryRouter initialEntries={['/app/calendar?view=week&date=2026-07-30']}>
      <CalendarWorkspaceFrame>
        <MobileCalendarExperience />
        <main>
          <header>
            <div>
              <div>
                <div><h1>Booking calendar</h1><p>Week</p></div>
                <form><input placeholder="Search customer, email, phone or booking reference" /></form>
                <div>
                  <button type="button">Filters</button>
                  <div><button type="button" aria-label="Change calendar view">Week</button></div>
                  <button type="button" onClick={createBooking}>New booking</button>
                  <div><button type="button" aria-label="More calendar actions">More</button></div>
                </div>
              </div>
              <div><div>Day navigation</div><button type="button"><svg className="lucide-refresh-cw" /></button></div>
            </div>
          </header>
        </main>
      </CalendarWorkspaceFrame>
      <QueryProbe />
    </MemoryRouter>);

    await waitFor(() => expect(screen.getByLabelText('Calendar query')).toHaveTextContent('view=day'));

    fireEvent.click(await screen.findByRole('button', { name: 'Search bookings' }));
    expect(document.querySelector('[data-calendar-workspace-frame]')).toHaveAttribute('data-mobile-search-open', 'true');

    const createButtons = screen.getAllByRole('button', { name: 'New booking' });
    fireEvent.click(createButtons[createButtons.length - 1]);
    expect(createBooking).toHaveBeenCalledOnce();
  });
});
