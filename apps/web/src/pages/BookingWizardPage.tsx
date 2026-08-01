import { CheckCircle2 } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router';
import { PublicBookingFlow } from '../features/bookings/PublicBookingFlow.js';
import { ensurePublicCatalogCategoryEnrichment } from '../features/bookings/public-catalog-category-enrichment.js';
import { ensurePublicServiceStaffReveal } from '../features/bookings/public-service-staff-reveal.js';
import { ensurePublicServiceTeamFlow } from '../features/bookings/public-service-team-flow.js';
import { currentPublicBookingIdentifier } from '../lib/workspace-hostname.js';
import './BookingWizardPage.css';
import './BookingServiceList.css';
import './BookingServiceStaffReveal.css';
import './BookingServiceTeamMotion.css';
import './BookingWorkspaceViewport.css';
import './BookingCheckoutLayout.css';

export function BookingWizardPage() {
  const { subdomain } = useParams();
  const [search] = useSearchParams();
  const bookingIdentifier = subdomain || currentPublicBookingIdentifier();
  const preview = search.get('preview') === '1';

  ensurePublicCatalogCategoryEnrichment();
  ensurePublicServiceStaffReveal(bookingIdentifier);
  ensurePublicServiceTeamFlow();

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
    <div className="booking-page-shell booking-checkout-shell mx-auto w-full max-w-[1380px]">
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

      <section id="booking-flow" tabIndex={-1} className="booking-flow-panel scroll-mt-4 outline-none">
        <PublicBookingFlow slug={bookingIdentifier} preview={preview} />
      </section>
    </div>
  );
}

export default BookingWizardPage;
