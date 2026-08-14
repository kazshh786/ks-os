import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { AssignedConsentFormSuccessPage } from './ConsentFormSuccessPage.js';

const token = 'test-token';

function renderAssignedSuccess() {
  return render(
    <MemoryRouter initialEntries={[`/forms/complete/${token}/success`]}>
      <Routes>
        <Route path="/forms/complete/:token/success" element={<AssignedConsentFormSuccessPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('consent form success page', () => {
  beforeEach(() => sessionStorage.clear());

  it('shows a clear return-to-site action for a business website', () => {
    sessionStorage.setItem(`form-success-${token}`, JSON.stringify({
      salonName: 'Client Salon',
      message: 'Thank you. Your consent is ready for your appointment.',
      redirectUrl: 'https://client.example.com/',
      primaryColor: '#059669',
      accentColor: '#4f46e5',
    }));

    renderAssignedSuccess();

    expect(screen.getByRole('heading', { name: 'Form submitted' })).toBeInTheDocument();
    expect(screen.getByText('Thank you. Your consent is ready for your appointment.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Return to site/i })).toHaveAttribute('href', 'https://client.example.com/');
  });

  it('shows a booking action when the configured destination is a booking page', () => {
    sessionStorage.setItem(`form-success-${token}`, JSON.stringify({
      salonName: 'Client Salon',
      redirectUrl: 'https://client.example.com/manage/secure-booking',
    }));

    renderAssignedSuccess();

    expect(screen.getByRole('link', { name: /Take me to my booking/i })).toHaveAttribute('href', 'https://client.example.com/manage/secure-booking');
  });

  it('does not render an unsafe return link from stored data', () => {
    sessionStorage.setItem(`form-success-${token}`, JSON.stringify({
      salonName: 'Client Salon',
      redirectUrl: 'javascript:alert(1)',
    }));

    renderAssignedSuccess();

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('You may now safely close this page.')).toBeInTheDocument();
  });
});
