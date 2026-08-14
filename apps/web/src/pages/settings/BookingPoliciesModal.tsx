import { X } from 'lucide-react';
import { useModalDialog } from '../../components/overlays/useModalDialog.js';
import CustomerBookingManagementSettings from './CustomerBookingManagementSettings.js';

export function BookingPoliciesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useModalDialog<HTMLElement>(open, onClose);

  if (!open) return null;

  return <div
    className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
    role="presentation"
    onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}
  >
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-policies-modal-title"
      tabIndex={-1}
      className="flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b bg-white px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-600">Booking page</p>
          <h2 id="booking-policies-modal-title" className="mt-1 text-xl font-black text-slate-950">Customer booking policies</h2>
          <p className="mt-1 text-sm text-slate-500">Control online cancellation and rescheduling without leaving the booking-page workspace.</p>
        </div>
        <button data-dialog-initial-focus type="button" onClick={onClose} aria-label="Close booking policies" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
        <CustomerBookingManagementSettings embedded />
      </div>
    </section>
  </div>;
}

export default BookingPoliciesModal;
