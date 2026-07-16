'use client';

import { use } from 'react';
import PublicBookingWidget from '@/components/booking/PublicBookingWidget';

export default function BookingPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = use(params);

  return <PublicBookingWidget subdomain={subdomain} />;
}
