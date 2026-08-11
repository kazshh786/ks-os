import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WaitlistPage } from './WaitlistPage.js';

const serviceReference = '10000000-0000-4000-8000-000000000001';
const mocks = vi.hoisted(() => ({
  getPublicCatalog: vi.fn(),
  getPublicWaitlistEligibility: vi.fn(),
  createPublicWaitlistRequest: vi.fn(),
}));

vi.mock('../data/data-provider.js', () => ({
  getDataProvider: () => mocks,
}));

function renderPage(path = `/waitlist/north-star?service=${serviceReference}&campaign=summer-2026`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/waitlist/:subdomain" element={<WaitlistPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WaitlistPage', () => {
  beforeEach(() => {
    mocks.getPublicCatalog.mockReset().mockResolvedValue({
      tenant: { name: 'North Star Studio' },
      services: [{ id: 'internal-service-id', publicReference: serviceReference, name: 'Consultation' }],
      staff: [],
      locations: [],
    });
    mocks.createPublicWaitlistRequest.mockReset().mockResolvedValue({
      status: 'PENDING',
      message: "You're on the waitlist. We'll contact you if a suitable appointment becomes available.",
    });
    mocks.getPublicWaitlistEligibility.mockReset().mockResolvedValue({ waitlistEligible: true });
  });

  it('submits controlled waitlist context and shows the bounded confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Join the Consultation waitlist' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Private Person');
    await user.type(screen.getByLabelText('Email'), 'person@example.com');
    await user.click(screen.getByRole('button', { name: 'Join waitlist' }));

    expect(await screen.findByRole('heading', { name: "You're on the waitlist." })).toBeInTheDocument();
    expect(screen.getByText("We'll contact you if a suitable appointment becomes available.")).toBeInTheDocument();
    expect(mocks.createPublicWaitlistRequest).toHaveBeenCalledWith('north-star', {
      serviceReference,
      campaignReference: 'summer-2026',
      customer: { name: 'Private Person', email: 'person@example.com' },
      idempotencyKey: '12345678-1234-1234-1234-123456789abc',
    });
  });

  it('does not display Join waitlist when the server says the current context is ineligible', async () => {
    mocks.getPublicWaitlistEligibility.mockResolvedValue({ waitlistEligible: false });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Waitlist unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join waitlist' })).not.toBeInTheDocument();
  });
});
