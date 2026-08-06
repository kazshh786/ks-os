import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundPage } from './NotFoundPage.js';

vi.mock('./PublicWorkspaceFormPage.js', () => ({
  default: () => <div>Workspace consent form</div>,
  PublicWorkspaceFormLegalPage: () => <div>Legal document</div>,
}));

vi.mock('./ConsentFormSuccessPage.js', () => ({
  WorkspaceConsentFormSuccessPage: () => <div>Workspace consent success</div>,
}));

vi.mock('./BookingWizardPage.js', () => ({ default: () => <div>Booking wizard</div> }));
vi.mock('./book/PaymentSuccess.js', () => ({ default: () => <div>Payment success</div> }));
vi.mock('./book/PaymentCancel.js', () => ({ default: () => <div>Payment cancelled</div> }));

function SubmitNavigation() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/form/client-consent/success')}>Submit consent form</button>;
}

describe('workspace catch-all routes', () => {
  it('re-renders the success page when submission changes the pathname', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/form/client-consent']}>
        <SubmitNavigation />
        <Routes>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Workspace consent form')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit consent form' }));
    expect(await screen.findByText('Workspace consent success')).toBeInTheDocument();
    expect(screen.queryByText('Workspace consent form')).not.toBeInTheDocument();
  });
});
