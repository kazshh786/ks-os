import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck2, CheckCircle2, LockKeyhole, ReceiptText, Sparkles } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router';
import { PublicBookingFlow } from '../features/bookings/PublicBookingFlow.js';
import { getDataProvider } from '../data/data-provider.js';
import { currentPublicBookingIdentifier } from '../lib/workspace-hostname.js';
import './BookingWizardPage.css';

type CatalogueService = { category?: string | null };
type Catalogue = { services?: CatalogueService[] };

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
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);

  useEffect(() => {
    if (!bookingIdentifier) return;
    let active = true;
    getDataProvider().getPublicCatalog(bookingIdentifier)
      .then((data: Catalogue) => {
        if (active) setCatalogue(data);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [bookingIdentifier]);

  const categories = useMemo(() => {
    const values = (catalogue?.services || [])
      .map(service => service.category?.trim())
      .filter((category): category is string => Boolean(category));
    return [...new Set(values)];
  }, [catalogue]);

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
    <div className="booking-page-shell mx-auto w-full max-w-[1440px]">
      <a
        href="#booking-flow"
        className="sr-only rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
      >
        Skip to booking options
      </a>

      {preview ? (
        <div role="status" className="booking-preview-banner">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Preview mode is active. You can test the journey, but no real booking or payment will be created.
        </div>
      ) : null}

      <div className="booking-page-grid">
        <aside className="booking-story-panel" aria-labelledby="booking-page-title">
          <div>
            <div className="booking-story-kicker">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Secure online booking
            </div>
            <h1 id="booking-page-title">Book the right service in a few clear steps.</h1>
            <p className="booking-story-copy">
              Choose a service, view live appointment times, see the full price and confirm without creating an account.
            </p>
          </div>

          {categories.length > 0 ? (
            <section className="booking-category-panel" aria-labelledby="service-category-title">
              <p id="service-category-title">Available service categories</p>
              <div className="booking-category-list">
                {categories.map(category => <span key={category}>{category}</span>)}
              </div>
            </section>
          ) : null}

          <ul className="booking-promise-list" aria-label="Booking benefits">
            {conversionPromises.map(item => (
              <li key={item.title}>
                <span className="booking-promise-icon"><item.icon aria-hidden="true" /></span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
              </li>
            ))}
          </ul>

          <p className="booking-story-footnote">
            Your information is only used to manage this appointment securely.
          </p>
        </aside>

        <section id="booking-flow" tabIndex={-1} className="booking-flow-panel scroll-mt-4 outline-none">
          <PublicBookingFlow slug={bookingIdentifier} preview={preview} />
        </section>
      </div>
    </div>
  );
}

export default BookingWizardPage;
