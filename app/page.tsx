import { redirect } from 'next/navigation';

export default function RootPage() {
  // Redirect to the Master Admin Dashboard / Login portal directly
  redirect('/admin');
}
