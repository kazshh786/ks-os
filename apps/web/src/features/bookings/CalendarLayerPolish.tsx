const calendarLayerPolishStyles = `
  .ks-calendar-workspace-frame > main > header {
    z-index: 70 !important;
    isolation: isolate;
  }

  .ks-calendar-workspace-frame > main > header .absolute {
    z-index: 80 !important;
  }

  .ks-calendar-workspace-frame [data-calendar-column-header='true'] {
    z-index: 40 !important;
  }

  .ks-calendar-workspace-frame [data-calendar-column-header='true'] header:has(.text-indigo-700) {
    border-color: #818cf8 !important;
    background: linear-gradient(180deg, #eef2ff 0%, #ffffff 100%) !important;
    box-shadow:
      inset 0 -4px 0 #4f46e5,
      inset 0 0 0 1px rgba(99, 102, 241, 0.22),
      0 8px 18px rgba(79, 70, 229, 0.12) !important;
  }

  .ks-calendar-workspace-frame [data-calendar-column-header='true'] header:has(button[aria-pressed='true']) button > span:first-child > span.rounded-full {
    border-color: #4f46e5 !important;
    background: #4f46e5 !important;
    color: #ffffff !important;
  }

  .ks-calendar-workspace-frame section[aria-label='Booking schedule'] [role='gridcell'][aria-selected='true'] {
    background-color: #eef2ff !important;
    box-shadow:
      inset 2px 0 0 rgba(99, 102, 241, 0.45),
      inset -2px 0 0 rgba(99, 102, 241, 0.45) !important;
  }
`;

export function CalendarLayerPolish() {
  return <style data-calendar-layer-polish>{calendarLayerPolishStyles}</style>;
}
