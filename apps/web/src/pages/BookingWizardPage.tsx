import { CalendarCheck2, CheckCircle2, LockKeyhole, ReceiptText } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router';
import { PublicBookingFlow } from '../features/bookings/PublicBookingFlow.js';
import { currentPublicBookingIdentifier } from '../lib/workspace-hostname.js';
import './BookingWizardPage.css';

const conversionPromises = [
  {
    icon: CalendarCheck2,
    title: 'Live availability',
    description: 'Choose from appointment times checked by the booking system.',
  },
  {
    icon: ReceiptText,
    title: 'Clear total and commitment',
    description: 'See the total price and what is due before you confirm.',
  },
  {
    icon: LockKeyhole,
    title: 'No account required',
    description: 'Book as a guest and manage the appointment from your secure email link.',
  },
] as const;

export function BookingWizardPage() {
  const { subdomain } = useParams();
  const [search] = useSearchParams();
  const bookingIdentifier = subdomain || currentPublicBookingIdentifier();
  const preview = search.get('preview') === '1';

  if (!bookingIdentifier) {
    return (
      <section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-black text-slate-950">Booking page unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This address is not connected to a business workspace.
        </p>
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <a
        href="#booking-flow"
        className="sr-only rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
      >
        Skip to booking options
      </a>

      {preview ? (
        <div role="status" className="mb-4 flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Preview mode is active. You can test the journey, but no real booking or payment will be created.
        </div>
      ) : null}

      <section
        aria-labelledby="booking-page-title"
        className="mb-5 overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 px-5 py-7 text-white shadow-xl shadow-slate-300/30 sm:px-8 sm:py-9"
      >
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">Online booking</p>
          <h1 id="booking-page-title" className="mt-3 text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl">
            Choose a service and book a live appointment time
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
            Complete the booking in four clear steps. You will see availability, the full price and the exact payment commitment before confirming.
          </p>
        </div>

        <ul className="mt-7 grid gap-3 md:grid-cols-3" aria-label="Booking benefits">
          {conversionPromises.map(item => (
            <li key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm">
              <item.icon className="h-5 w-5 text-white" aria-hidden="true" />
              <p className="mt-3 text-sm font-black">{item.title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-300">{item.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <div id="booking-flow" tabIndex={-1} className="scroll-mt-4 outline-none">
        <PublicBookingFlow slug={bookingIdentifier} preview={preview} />
      </div>
    </div>
  );
}

export default BookingWizardPage;
