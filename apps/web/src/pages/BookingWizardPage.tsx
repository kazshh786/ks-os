import { useParams, useSearchParams } from 'react-router';
import { PublicBookingFlow } from '../features/bookings/PublicBookingFlow.js';

export function BookingWizardPage() {
  const { subdomain } = useParams();
  const [search] = useSearchParams();
  if (!subdomain) return null;
  return <PublicBookingFlow slug={subdomain} preview={search.get('preview') === '1'} />;
}
export default BookingWizardPage;
