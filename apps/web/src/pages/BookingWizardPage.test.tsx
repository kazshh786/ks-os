import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { BookingWizardPage } from './BookingWizardPage';

vi.mock('../features/bookings/PublicBookingFlow.js', () => ({
  PublicBookingFlow: ({ slug, preview }: { slug: string; preview?: boolean }) => (
    <div data-testid="public-booking-flow" data-slug={slug} data-preview={String(Boolean(preview))}>
      Booking flow
    </div>
  ),
}));

function renderPage(path = '/book/north-star') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/book/:subdomain" element={<BookingWizardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BookingWizardPage', () => {
  it('renders one focused checkout workspace without a duplicate marketing panel', () => {
    const { container } = renderPage();

    expect(container.querySelector('.booking-checkout-shell')).toBeInTheDocument();
    expect(container.querySelector('.booking-story-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to booking options' })).toHaveAttribute('href', '#booking-flow');

    const flow = screen.getByTestId('public-booking-flow');
    expect(flow).toHaveAttribute('data-slug', 'north-star');
    expect(flow).toHaveAttribute('data-preview', 'false');
  });

  it('makes preview limitations explicit and passes preview mode into the flow', () => {
    renderPage('/book/north-star?preview=1');

    expect(screen.getByRole('status')).toHaveTextContent('Preview mode is active');
    expect(screen.getByTestId('public-booking-flow')).toHaveAttribute('data-preview', 'true');
  });
});
