import { Navigate } from 'react-router';

export default function AvailabilityPage() {
  return <Navigate to="/app/calendar?availability=1" replace />;
}
