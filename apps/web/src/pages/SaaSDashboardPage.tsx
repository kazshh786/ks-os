import React from 'react';
import { DashboardOverview } from '../features/dashboard/DashboardOverview.js';
import { BookingOperationsSummary } from '../features/dashboard/BookingOperationsSummary.js';
import { useBusinessProfile } from '../auth/useBusinessProfile';
export const SaaSDashboardPage: React.FC = () => {
  const profile=useBusinessProfile();
  return <div className="space-y-8">{profile.dashboard.includes('booking-summary')&&<BookingOperationsSummary />}<DashboardOverview /></div>;
};
export default SaaSDashboardPage;
