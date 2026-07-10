'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminOnboardRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    // Standalone onboarding page redirects back to the full dashboard directory
    router.replace('/admin');
  }, [router]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#090d16',
      color: '#94a3b8',
      fontFamily: 'sans-serif',
      fontSize: '14px'
    }}>
      Redirecting to Master Admin Control Panel...
    </div>
  );
}
