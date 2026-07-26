import type { BusinessTenant } from '../data/types.js';
import { PublicBookingFlow, type PublicBookingSuccessPayload } from '../features/bookings/PublicBookingFlow.js';

interface BookingWizardProps {
  tenant: BusinessTenant;
  onBookingSuccess: (payload: PublicBookingSuccessPayload) => void;
}

export default function BookingWizard({ tenant, onBookingSuccess }: BookingWizardProps) {
  return <PublicBookingFlow slug={tenant.subdomain} onBookingSuccess={onBookingSuccess} />;
}
