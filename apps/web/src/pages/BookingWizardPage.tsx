import React from 'react';
import { useWorkspace } from '../context/WorkspaceContext.js';
import BookingWizard from '../components/BookingWizard.js';

export const BookingWizardPage: React.FC = () => {
  const { activeTenant } = useWorkspace();

  if (!activeTenant) return null;

  return (
    <BookingWizard
      tenant={activeTenant}
      onBookingSuccess={() => {}}
    />
  );
};
export default BookingWizardPage;
