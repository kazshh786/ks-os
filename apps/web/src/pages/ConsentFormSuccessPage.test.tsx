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

  it('shows the configured message and website return action', () => {
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
    expect(screen.getByRole('link', { name: /Back to Client Salon/i })).toHaveAttribute('href', 'https://client.example.com/');
  });

  it('does not render an unsafe return link from stored data', () => {
    sessionStorage.setItem(`form-success-${token}`, JSON.stringify({
      salonName: 'Client Salon',
      redirectUrl: 'javascript:alert(1)',
    }));

    renderAssignedSuccess();

    expect(screen.queryByRole('link', { name: /Back to/i })).not.toBeInTheDocument();
    expect(screen.getByText('You may now safely close this page.')).toBeInTheDocument();
  });
});
