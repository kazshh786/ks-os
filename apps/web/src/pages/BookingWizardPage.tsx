import { useParams, useSearchParams } from 'react-router';
import { PublicBookingFlow } from '../features/bookings/PublicBookingFlow.js';
import { currentWorkspaceSlug } from '../lib/workspace-hostname.js';

export function BookingWizardPage() {
  const { subdomain } = useParams();
  const [search] = useSearchParams();
  const workspaceSlug = subdomain || currentWorkspaceSlug();

  if (!workspaceSlug) {
    return (
      <section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-black text-slate-950">Booking page unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This address is not connected to a business workspace.
        </p>
      </section>
    );
  }

  return <PublicBookingFlow slug={workspaceSlug} preview={search.get('preview') === '1'} />;
}

export default BookingWizardPage;
