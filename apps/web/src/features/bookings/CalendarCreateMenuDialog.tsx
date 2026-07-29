import { useEffect, useRef } from 'react';
import { CalendarDays, Clock3, ConciergeBell, X } from 'lucide-react';

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
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  if (!open) return null;

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="calendar-create-title" className="w-full max-w-2xl rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Calendar action</p>
          <h2 id="calendar-create-title" className="mt-1 text-2xl font-black text-slate-950">Add to calendar</h2>
          <p className="mt-1 text-sm text-slate-500">Choose what you want to add. Existing availability and conflict checks still apply.</p>
        </div>
        <button ref={closeButton} type="button" onClick={onClose} aria-label="Close add to calendar" className="rounded-lg border p-2 text-slate-600 hover:bg-slate-50"><X className="h-5 w-5" /></button>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {options.map(option => {
          const Icon = option.icon;
          return <button
            key={option.type}
            type="button"
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
