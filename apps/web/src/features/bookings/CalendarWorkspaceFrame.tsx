import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const calendarWorkspaceStyles = `
  .ks-calendar-workspace-frame {
    --ks-calendar-toolbar-height: 0px;
    height: 100%;
    min-height: 0;
    min-width: 0;
    max-width: 100%;
    overflow-x: clip;
    overflow-y: visible;
    background: #f5f6f8;
  }

  .ks-calendar-workspace-frame > main {
    min-height: 100%;
    min-width: 0;
    max-width: 100%;
    overflow: visible;
    padding-bottom: 0 !important;
    background: #f5f6f8;
  }

  .ks-calendar-workspace-frame > main > div {
    min-width: 0;
    max-width: 100%;
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
    min-width: 0;
    max-width: 100%;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] {
    min-height: calc(100% - var(--ks-calendar-toolbar-height));
    min-width: 0;
    max-width: 100%;
    overflow: visible;
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
    max-width: 100%;
    min-width: 0;
    overflow-x: hidden !important;
    overflow-y: hidden !important;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .ks-calendar-workspace-frame [data-calendar-column-header='true']::-webkit-scrollbar {
    display: none;
  }

  .ks-calendar-workspace-frame [data-calendar-grid-scroll='true'] {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    overscroll-behavior-x: contain;
    scrollbar-gutter: auto;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-x pan-y;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] > footer {
    display: none;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] [aria-label='Calendar times'],
  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] [role='gridcell'] {
    box-sizing: border-box;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] [role='gridcell'] {
    background-color: #f5f6f8 !important;
    background-position: top left !important;
    background-origin: border-box;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] [aria-label^='At-business availability'] {
    border-color: #dbe2ea !important;
    background-color: rgba(255, 255, 255, 0.58) !important;
    color: #334155 !important;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] [aria-label^='At-business availability'] > span {
    border: 1px solid #e2e8f0;
    background: rgba(255, 255, 255, 0.96) !important;
    color: #475569 !important;
    box-shadow: none !important;
  }

  .ks-calendar-workspace-frame [data-calendar-toolbar-row='true'] {
    display: flex !important;
    flex-flow: row wrap !important;
    align-items: center !important;
    justify-content: flex-start !important;
    gap: 0.5rem !important;
    min-width: 0;
  }

  .ks-calendar-workspace-frame [data-calendar-toolbar-row='true'] > :first-child {
    min-width: 0;
  }

  .ks-calendar-workspace-frame [data-calendar-refresh='true'] {
    margin-left: auto !important;
    align-self: center !important;
  }

  @media (max-width: 767px) {
    .ks-calendar-workspace-frame > main {
      padding-bottom: calc(env(safe-area-inset-bottom) + 5rem) !important;
    }

    .ks-calendar-workspace-frame > main > header {
      padding: 0.5rem !important;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08) !important;
    }

    .ks-calendar-workspace-frame > main > header > div {
      gap: 0.5rem !important;
    }

    .ks-calendar-workspace-frame > main > header > div > div:first-child {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center !important;
      gap: 0.5rem !important;
    }

    .ks-calendar-workspace-frame > main > header > div > div:first-child > div:first-child {
      width: auto !important;
      min-width: 0;
    }

    .ks-calendar-workspace-frame > main > header > div > div:first-child > div:first-child h1 {
      font-size: 1rem !important;
      line-height: 1.2 !important;
    }

    .ks-calendar-workspace-frame > main > header > div > div:first-child > div:first-child p {
      margin-top: 0.125rem;
      font-size: 0.6875rem !important;
      line-height: 1rem !important;
    }

    .ks-calendar-workspace-frame > main > header > div > div:first-child > form {
      display: none !important;
      grid-column: 1 / -1;
      order: 3;
      width: 100%;
    }

    .ks-calendar-workspace-frame[data-mobile-search-open='true'] > main > header > div > div:first-child > form {
      display: flex !important;
    }

    .ks-calendar-workspace-frame > main > header > div > div:first-child > div:last-child {
      display: flex !important;
      flex-wrap: nowrap !important;
      justify-content: flex-end !important;
      gap: 0.25rem !important;
      min-width: 0;
    }

    .ks-calendar-workspace-frame > main > header > div > div:first-child > div:last-child > button:first-of-type {
      min-width: 2.75rem !important;
      width: 2.75rem;
      padding-left: 0 !important;
      padding-right: 0 !important;
      font-size: 0 !important;
      justify-content: center !important;
    }

    .ks-calendar-workspace-frame > main > header > div > div:first-child > div:last-child > div:first-of-type,
    .ks-calendar-workspace-frame > main > header > div > div:first-child > div:last-child > button:nth-of-type(2) {
      display: none !important;
    }

    .ks-calendar-workspace-frame [data-mobile-calendar-search] {
      order: -1;
    }

    .ks-calendar-workspace-frame [data-calendar-toolbar-row='true'] {
      flex-flow: row nowrap !important;
      gap: 0.25rem !important;
      padding-top: 0.5rem !important;
    }

    .ks-calendar-workspace-frame [data-calendar-toolbar-row='true'] > :first-child {
      flex: 1 1 100%;
      width: 100%;
      display: grid !important;
      grid-template-columns: 2.5rem auto 2.5rem minmax(0, 1fr);
      align-items: center;
      gap: 0.25rem !important;
    }

    .ks-calendar-workspace-frame [data-calendar-toolbar-row='true'] > :first-child > button,
    .ks-calendar-workspace-frame [data-calendar-refresh='true'] {
      min-width: 2.5rem !important;
      min-height: 2.5rem !important;
      padding: 0.5rem !important;
      justify-content: center !important;
    }

    .ks-calendar-workspace-frame [data-calendar-toolbar-row='true'] > :first-child > button:nth-child(2) {
      width: auto;
      padding-left: 0.75rem !important;
      padding-right: 0.75rem !important;
    }

    .ks-calendar-workspace-frame [data-calendar-toolbar-row='true'] > :first-child > label {
      margin-left: 0 !important;
      min-width: 0;
    }

    .ks-calendar-workspace-frame [data-calendar-toolbar-row='true'] > :first-child > label input {
      width: 100%;
      min-width: 0;
    }

    .ks-calendar-workspace-frame [data-calendar-refresh='true'] {
      margin-left: 0 !important;
      width: 2.5rem;
      overflow: hidden;
      font-size: 0 !important;
      gap: 0 !important;
    }

    .ks-calendar-workspace-frame section[aria-label='Booking filters'] {
      max-height: min(55vh, 28rem);
      overflow-y: auto;
      border-radius: 0.875rem !important;
      padding: 0.625rem !important;
      -webkit-overflow-scrolling: touch;
    }

    .ks-calendar-workspace-frame > main > div {
      padding-top: 0 !important;
    }

    .ks-calendar-workspace-frame > main > footer[data-anchored='viewport-bottom'] {
      display: none !important;
    }

    .ks-calendar-workspace-frame [data-calendar-column-header='true'],
    .ks-calendar-workspace-frame [data-calendar-grid-scroll='true'] {
      grid-template-columns: 3.25rem minmax(0, 1fr) !important;
      min-width: 100% !important;
      width: 100% !important;
    }

    .ks-calendar-workspace-frame [data-calendar-column-header='true'] header {
      min-height: 3.25rem !important;
      padding: 0.5rem 0.625rem !important;
    }

    .ks-calendar-workspace-frame [data-calendar-column-header='true'] header button > span:last-child,
    .ks-calendar-workspace-frame [data-calendar-column-header='true'] header button > span:nth-last-child(2) {
      margin-top: 0.125rem !important;
    }

    .ks-calendar-workspace-frame section[aria-label='Booking schedule'] [aria-label='Calendar times'] span {
      right: 0.375rem !important;
      font-size: 0.625rem !important;
    }
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

    const syncLayout = () => {
      syncToolbarHeight();
      syncHorizontalScroll();
    };

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncLayout);

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
    window.addEventListener('resize', syncLayout);
    const mutationObserver = new MutationObserver(bindCalendarElements);
    mutationObserver.observe(frame, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncLayout);
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
