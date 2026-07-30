import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const calendarWorkspaceStyles = `
  .ks-calendar-workspace-frame {
    --ks-calendar-toolbar-height: 0px;
    height: 100%;
    min-height: 0;
    background: #f5f6f8;
  }

  .ks-calendar-workspace-frame > main {
    min-height: 100%;
    padding-bottom: 0 !important;
    background: #f5f6f8;
  }

  .ks-calendar-workspace-frame > main > div {
    padding: 0 !important;
  }

  .ks-calendar-workspace-frame > main > div > :not([hidden]) ~ :not([hidden]) {
    margin-top: 0 !important;
  }

  .ks-calendar-workspace-frame > main > div > [role='status']:not(.sr-only),
  .ks-calendar-workspace-frame > main > div > [role='alert'] {
    margin: 0.75rem;
  }

  .ks-calendar-workspace-frame section[aria-label='Calendar workspace'] {
    min-height: calc(100% - var(--ks-calendar-toolbar-height));
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] {
    min-height: calc(100% - var(--ks-calendar-toolbar-height));
    border-left: 0 !important;
    border-right: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] > div,
  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] > div > div {
    display: contents !important;
  }

  .ks-calendar-workspace-frame [data-calendar-column-header='true'] {
    position: sticky !important;
    top: var(--ks-calendar-toolbar-height) !important;
    width: 100%;
    min-width: 0;
    overflow-x: hidden !important;
    overflow-y: hidden !important;
    overscroll-behavior-x: contain;
  }

  .ks-calendar-workspace-frame [data-calendar-grid-scroll='true'] {
    width: 100%;
    min-width: 0;
    overflow-x: auto !important;
    overflow-y: visible !important;
    overscroll-behavior-x: contain;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] > footer {
    display: none;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] [role='gridcell'] {
    background-color: #f5f6f8 !important;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] [aria-label^='At-business availability'] {
    border-color: #dbe2ea !important;
    background-color: rgba(255, 255, 255, 0.7) !important;
    color: #334155 !important;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] [aria-label^='At-business availability'] > span {
    border: 1px solid #e2e8f0;
    background: rgba(255, 255, 255, 0.96) !important;
    color: #475569 !important;
    box-shadow: none !important;
  }

  .ks-calendar-workspace-frame [data-calendar-toolbar-row='true'] {
    flex-direction: row !important;
    align-items: center !important;
    justify-content: flex-start !important;
  }

  .ks-calendar-workspace-frame [data-calendar-refresh='true'] {
    margin-left: auto !important;
    align-self: center !important;
  }
`;

function findToolbarActionHost() {
  const refreshIcon = document.querySelector('.ks-calendar-workspace-frame svg.lucide-refresh-cw');
  const refreshButton = refreshIcon?.closest('button') as HTMLButtonElement | null;
  return refreshButton?.parentElement || null;
}

export function CalendarToolbarActionPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const syncHost = () => setHost(findToolbarActionHost());
    syncHost();

    const observer = new MutationObserver(syncHost);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return host ? createPortal(children, host) : null;
}

export function CalendarWorkspaceFrame({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    let toolbar: HTMLElement | null = null;
    let columnHeader: HTMLElement | null = null;
    let gridScroll: HTMLElement | null = null;

    const syncHorizontalScroll = () => {
      if (columnHeader && gridScroll) columnHeader.scrollLeft = gridScroll.scrollLeft;
    };

    const syncToolbarHeight = () => {
      if (toolbar) frame.style.setProperty('--ks-calendar-toolbar-height', `${Math.ceil(toolbar.getBoundingClientRect().height)}px`);
    };

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncToolbarHeight);

    const bindCalendarElements = () => {
      const calendarMain = frame.querySelector(':scope > main') as HTMLElement | null;
      const nextToolbar = calendarMain?.querySelector(':scope > header') as HTMLElement | null;
      if (nextToolbar !== toolbar) {
        if (toolbar) resizeObserver?.unobserve(toolbar);
        toolbar = nextToolbar;
        if (toolbar) resizeObserver?.observe(toolbar);
        syncToolbarHeight();
      }

      const schedule = frame.querySelector("section[aria-label='Booking schedule']") as HTMLElement | null;
      const canvas = schedule?.querySelector(':scope > div > div') as HTMLElement | null;
      const nextColumnHeader = canvas?.querySelector(':scope > div:first-child') as HTMLElement | null;
      const nextGridScroll = nextColumnHeader?.nextElementSibling as HTMLElement | null;

      if (nextGridScroll !== gridScroll || nextColumnHeader !== columnHeader) {
        gridScroll?.removeEventListener('scroll', syncHorizontalScroll);
        columnHeader?.removeAttribute('data-calendar-column-header');
        gridScroll?.removeAttribute('data-calendar-grid-scroll');

        columnHeader = nextColumnHeader;
        gridScroll = nextGridScroll;

        columnHeader?.setAttribute('data-calendar-column-header', 'true');
        gridScroll?.setAttribute('data-calendar-grid-scroll', 'true');
        gridScroll?.addEventListener('scroll', syncHorizontalScroll, { passive: true });
        syncHorizontalScroll();
      }

      const refreshIcon = frame.querySelector('svg.lucide-refresh-cw');
      const refreshButton = refreshIcon?.closest('button') as HTMLButtonElement | null;
      const toolbarRow = refreshButton?.parentElement;
      refreshButton?.setAttribute('data-calendar-refresh', 'true');
      toolbarRow?.setAttribute('data-calendar-toolbar-row', 'true');
    };

    bindCalendarElements();
    window.addEventListener('resize', syncToolbarHeight);
    const mutationObserver = new MutationObserver(bindCalendarElements);
    mutationObserver.observe(frame, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncToolbarHeight);
      gridScroll?.removeEventListener('scroll', syncHorizontalScroll);
      columnHeader?.removeAttribute('data-calendar-column-header');
      gridScroll?.removeAttribute('data-calendar-grid-scroll');
    };
  }, []);

  return <div ref={frameRef} className="ks-calendar-workspace-frame" data-calendar-workspace-frame>
    <style>{calendarWorkspaceStyles}</style>
    {children}
  </div>;
}
