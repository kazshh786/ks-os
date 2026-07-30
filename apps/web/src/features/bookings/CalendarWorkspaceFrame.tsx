import { useEffect, useRef, type ReactNode } from 'react';

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
    min-height: calc(100vh - var(--ks-calendar-toolbar-height));
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] {
    min-height: calc(100vh - var(--ks-calendar-toolbar-height));
    border-left: 0 !important;
    border-right: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] > div {
    max-height: none !important;
    overflow-y: visible !important;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] > div > div > div:first-child {
    top: var(--ks-calendar-toolbar-height) !important;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] > footer {
    display: none;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] [role='gridcell'] {
    background-color: #f5f6f8 !important;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] [aria-label^='At-business availability'] {
    border-color: #e2e8f0 !important;
    background-color: #ffffff !important;
    color: #334155 !important;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] [aria-label^='At-business availability'] > span {
    border: 1px solid #e2e8f0;
    background: rgba(255, 255, 255, 0.96) !important;
    color: #475569 !important;
    box-shadow: none !important;
  }
`;

export function CalendarWorkspaceFrame({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const calendarMain = frame?.querySelector(':scope > main') as HTMLElement | null;
    const toolbar = calendarMain?.querySelector(':scope > header') as HTMLElement | null;
    if (!frame || !toolbar) return;

    const syncToolbarHeight = () => {
      frame.style.setProperty('--ks-calendar-toolbar-height', `${Math.ceil(toolbar.getBoundingClientRect().height)}px`);
    };

    const animationFrame = window.requestAnimationFrame(syncToolbarHeight);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncToolbarHeight);
    observer?.observe(toolbar);
    window.addEventListener('resize', syncToolbarHeight);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener('resize', syncToolbarHeight);
    };
  }, []);

  return <div ref={frameRef} className="ks-calendar-workspace-frame" data-calendar-workspace-frame>
    <style>{calendarWorkspaceStyles}</style>
    {children}
  </div>;
}
