import { CalendarDays, Clock3, ConciergeBell, X } from 'lucide-react';
import { useModalDialog } from '../../components/overlays/useModalDialog.js';

export type CalendarCreateType = 'booking' | 'walk-in' | 'block';

interface CalendarCreateMenuDialogProps {
  open: boolean;
  onClose: () => void;
  onChoose: (type: CalendarCreateType) => void;
}

const options: Array<{
  type: CalendarCreateType;
  title: string;
  description: string;
  icon: typeof CalendarDays;
}> = [
  {
    type: 'booking',
    title: 'Appointment',
    description: 'Book a customer into an available service and team slot.',
    icon: CalendarDays,
  },
  {
    type: 'walk-in',
    title: 'Walk-in',
    description: 'Check in a customer who has arrived without an appointment.',
    icon: ConciergeBell,
  },
  {
    type: 'block',
    title: 'Block time',
    description: 'Reserve time for breaks, admin, training or other commitments.',
    icon: Clock3,
  },
];

export function CalendarCreateMenuDialog({ open, onClose, onChoose }: CalendarCreateMenuDialogProps) {
  const dialogRef = useModalDialog<HTMLElement>(open, onClose);

  if (!open) return null;

  return <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6" role="presentation" data-calendar-dialog-layer="true" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="calendar-create-title" tabIndex={-1} className="flex max-h-dvh w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-3xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b p-4 sm:p-6">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Calendar action</p>
          <h2 id="calendar-create-title" className="mt-1 text-2xl font-black text-slate-950">Add to calendar</h2>
          <p className="mt-1 text-sm text-slate-500">Choose what you want to add. Existing availability and conflict checks still apply.</p>
        </div>
        <button data-dialog-initial-focus type="button" onClick={onClose} aria-label="Close add to calendar" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-slate-600 hover:bg-slate-50"><X className="h-5 w-5" /></button>
      </header>

      <div className="grid min-h-0 gap-3 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:grid-cols-3 sm:p-6">
        {options.map(option => {
          const Icon = option.icon;
          return <button
            key={option.type}
            type="button"
            aria-label={option.title}
            onClick={() => onChoose(option.type)}
            className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700 group-hover:bg-indigo-100 group-hover:text-indigo-700"><Icon className="h-5 w-5" /></span>
            <strong className="mt-4 block text-base text-slate-950">{option.title}</strong>
            <span className="mt-1 block text-sm leading-5 text-slate-500">{option.description}</span>
          </button>;
        })}
      </div>
    </section>
  </div>;
}
