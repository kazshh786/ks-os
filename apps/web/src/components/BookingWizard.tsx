import type { Booking, BusinessTenant } from '../data/types.js';
import { PublicBookingFlow } from '../features/bookings/PublicBookingFlow.js';

interface BookingWizardProps {
  tenant: BusinessTenant;
  onBookingSuccess: (booking: Booking) => void;
}

export default function BookingWizard({ tenant, onBookingSuccess }: BookingWizardProps) {
  return <PublicBookingFlow slug={tenant.subdomain} onBookingSuccess={booking => onBookingSuccess(booking as unknown as Booking)} />;
}
