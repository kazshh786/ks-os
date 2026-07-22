import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicReviewInvitationPage } from './ReputationPages.js';

describe('public review invitation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offers Google and Trustpilot equally without asking for an internal rating', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          salonName: 'KS Salon',
          appointmentDate: '2026-07-20T12:00:00.000Z',
          message: 'Thank you for visiting. If you would like to share honest feedback, you can leave a review.',
          providers: [
            { provider: 'GOOGLE', label: 'Review on Google' },
            { provider: 'TRUSTPILOT', label: 'Review on Trustpilot' },
          ],
          privateContactUrl: 'https://example.com/contact',
        },
      }),
    }));

    render(
      <MemoryRouter initialEntries={['/review/test-token']}>
        <Routes><Route path="/review/:token" element={<PublicReviewInvitationPage />} /></Routes>
      </MemoryRouter>,
    );

    const google = await screen.findByRole('button', { name: /Review on Google/i });
    const trustpilot = screen.getByRole('button', { name: /Review on Trustpilot/i });
    expect(google).toHaveAttribute('class', trustpilot.getAttribute('class'));
    expect(screen.getByRole('link', { name: 'Contact the salon privately' })).toHaveAttribute('href', 'https://example.com/contact');
    expect(screen.getByText(/There is no obligation to leave a review/i)).toBeInTheDocument();
    expect(screen.queryByText(/stars?|rate your|rating/i)).not.toBeInTheDocument();
  });
});
