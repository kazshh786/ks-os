import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarWorkspaceFrame } from './CalendarWorkspaceFrame.js';

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

describe('CalendarWorkspaceFrame', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
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

  it('pins the date row below the complete toolbar and applies the neutral availability palette', () => {
    render(<CalendarWorkspaceFrame>
      <main>
        <header>Filters and calendar controls</header>
        <div>
          <section aria-label="Calendar workspace">
            <section aria-label="Booking schedule">
              <div><div><div>Sticky dates</div></div></div>
              <div role="gridcell">
                <div aria-label="At-business availability 09:00 to 17:00"><span>Shop hours</span></div>
              </div>
              <footer>Calendar help</footer>
            </section>
          </section>
        </div>
      </main>
    </CalendarWorkspaceFrame>);

    const frame = document.querySelector<HTMLElement>('[data-calendar-workspace-frame]');
    const styles = document.querySelector('style')?.textContent || '';

    expect(frame).toHaveStyle({ '--ks-calendar-toolbar-height': '184px' });
    expect(styles).toContain('top: var(--ks-calendar-toolbar-height) !important');
    expect(styles).toContain('overflow-y: visible !important');
    expect(styles).toContain('background-color: #ffffff !important');
    expect(styles).toContain('background-color: #f5f6f8 !important');
    expect(screen.getByText('Sticky dates')).toBeInTheDocument();
  });
});
