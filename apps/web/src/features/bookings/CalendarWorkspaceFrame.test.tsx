import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarToolbarActionPortal, CalendarWorkspaceFrame } from './CalendarWorkspaceFrame.js';

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

describe('CalendarWorkspaceFrame', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const height = this.tagName === 'HEADER' ? 184 : 0;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: height,
        width: 0,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses one vertical scroller and keeps the header, time grid and mobile controls aligned', () => {
    render(<>
      <CalendarWorkspaceFrame>
        <main>
          <header>
            <div data-testid="toolbar-row">
              <div>Calendar controls</div>
              <button type="button" aria-label="Refresh calendar"><svg className="lucide-refresh-cw" /></button>
            </div>
          </header>
          <div>
            <section aria-label="Calendar workspace">
              <section aria-label="Booking schedule">
                <div>
                  <div>
                    <div data-testid="column-header">Sticky dates</div>
                    <div data-testid="grid-scroll">
                      <aside aria-label="Calendar times"><span>09:00</span></aside>
                      <div role="gridcell">
                        <div aria-label="At-business availability 09:00 to 17:00"><span>Shop hours</span></div>
                      </div>
                    </div>
                  </div>
                </div>
                <footer>Calendar help</footer>
              </section>
            </section>
          </div>
        </main>
      </CalendarWorkspaceFrame>
      <CalendarToolbarActionPortal><button type="button">Availability</button></CalendarToolbarActionPortal>
    </>);

    const frame = document.querySelector<HTMLElement>('[data-calendar-workspace-frame]');
    const styles = document.querySelector('style')?.textContent || '';
    const columnHeader = screen.getByTestId('column-header');
    const gridScroll = screen.getByTestId('grid-scroll');
    const toolbarRow = screen.getByTestId('toolbar-row');
    const refreshButton = screen.getByRole('button', { name: 'Refresh calendar' });
    const availabilityButton = screen.getByRole('button', { name: 'Availability' });

    Object.defineProperty(gridScroll, 'scrollLeft', { configurable: true, writable: true, value: 280 });
    fireEvent.scroll(gridScroll);
    fireEvent(window, new Event('resize'));

    expect(frame).toHaveStyle({ '--ks-calendar-toolbar-height': '184px' });
    expect(columnHeader).toHaveAttribute('data-calendar-column-header', 'true');
    expect(gridScroll).toHaveAttribute('data-calendar-grid-scroll', 'true');
    expect(columnHeader.scrollLeft).toBe(280);
    expect(toolbarRow).toHaveAttribute('data-calendar-toolbar-row', 'true');
    expect(refreshButton).toHaveAttribute('data-calendar-refresh', 'true');
    expect(availabilityButton.parentElement).toBe(toolbarRow);
    expect(styles).toContain('top: var(--ks-calendar-toolbar-height) !important');
    expect(styles).toContain('overflow-x: clip');
    expect(styles).toContain('overflow-y: hidden !important');
    expect(styles).not.toContain('overflow-y: visible !important');
    expect(styles).toContain('background-position: top left !important');
    expect(styles).toContain('background-color: rgba(255, 255, 255, 0.58) !important');
    expect(styles).toContain('@media (max-width: 767px)');
    expect(styles).toContain('flex: 1 1 100%');
    expect(screen.getByText('Sticky dates')).toBeInTheDocument();
  });
});
