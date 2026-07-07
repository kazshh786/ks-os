import React from 'react';
import OnboardingWizard from '@/components/admin/OnboardingWizard';

export default function AdminOnboardPage() {
  return (
    <div style={{
      padding: '40px 20px',
      background: '#f8fafc',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <OnboardingWizard />
    </div>
  );
}
