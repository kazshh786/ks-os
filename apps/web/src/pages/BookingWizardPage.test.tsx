import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingWizardPage } from './BookingWizardPage';

const mocks = vi.hoisted(() => ({
  getPublicCatalog: vi.fn(),
}));

vi.mock('../data/data-provider.js', () => ({
  getDataProvider: () => ({ getPublicCatalog: mocks.getPublicCatalog }),
}));

vi.mock('../features/bookings/PublicBookingFlow.js', () => ({
  PublicBookingFlow: ({ slug, preview }: { slug: string; preview?: boolean }) => (
    <div data-testid="public-booking-flow" data-slug={slug} data-preview={String(Boolean(preview))}>
      Booking flow
    </div>
  ),
}));

const catalog = {
  page: { title: 'North Star bookings', description: 'Book online', logoUrl: null },
  tenant: { name: 'North Star Studio', currency: 'GBP' },
  services: [
    {
      id: 'service-1',
      publicReference: '11111111-1111-4111-8111-111111111111',
      name: 'Classic cut',
      description: 'A tailored cut and finish.',
      duration: 45,
      price: 3500,
      category: 'Hair',
    },
    {
      id: 'service-2',
      publicReference: '22222222-2222-4222-8222-222222222222',
      name: 'Gel manicure',
      description: 'Long-lasting gel colour.',
      duration: 60,
      price: 4200,
      category: 'Nails',
    },
  ],
};

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
  beforeEach(() => {
    mocks.getPublicCatalog.mockReset();
    mocks.getPublicCatalog.mockResolvedValue(catalog);
  });

  it('keeps the conversion information while placing the booking flow in the main workspace', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Choose a service and book a live appointment time' })).toBeInTheDocument();
    expect(screen.getAllByText('Live availability').length).toBeGreaterThan(0);
    expect(screen.getByText('Clear total and commitment')).toBeInTheDocument();
    expect(screen.getByText('No account required')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to booking options' })).toHaveAttribute('href', '#booking-flow');

    const flow = screen.getByTestId('public-booking-flow');
    expect(flow).toHaveAttribute('data-slug', 'north-star');
    expect(flow).toHaveAttribute('data-preview', 'false');

    await waitFor(() => expect(screen.getByText('North Star Studio')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'All services' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hair' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nails' })).toBeInTheDocument();
  });

  it('filters assigned service categories and preselects a chosen service', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Nails' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Nails' }));

    expect(screen.queryByRole('button', { name: /Select Classic cut/ })).not.toBeInTheDocument();
    const manicure = screen.getByRole('button', { name: /Select Gel manicure/ });
    fireEvent.click(manicure);

    await waitFor(() => expect(screen.getByRole('button', { name: /Select Gel manicure/ })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('makes preview limitations explicit and passes preview mode into the flow', () => {
    renderPage('/book/north-star?preview=1');

    expect(screen.getByRole('status')).toHaveTextContent('Preview mode is active');
    expect(screen.getByTestId('public-booking-flow')).toHaveAttribute('data-preview', 'true');
  });
});
