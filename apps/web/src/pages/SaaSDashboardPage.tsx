import React from 'react';
import { DashboardOverview } from '../features/dashboard/DashboardOverview.js';
import { BookingOperationsSummary } from '../features/dashboard/BookingOperationsSummary.js';

export const SaaSDashboardPage: React.FC = () => {
  return <div className="space-y-8"><BookingOperationsSummary /><DashboardOverview /></div>;
};
export default SaaSDashboardPage;
