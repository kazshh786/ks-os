import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PaymentCancel from './PaymentCancel';
import PaymentSuccess from './PaymentSuccess';

function renderRoute(path: string, routePath: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('public booking payment recovery', () => {
  it('explains that a cancelled payment retry keeps the same booking', () => {
    renderRoute(
      '/book/north-star/payment-cancel?reference=KS-1234',
      '/book/:subdomain/payment-cancel',
      <PaymentCancel />,
    );

    expect(screen.getByRole('heading', { name: 'Your appointment still needs payment' })).toBeInTheDocument();
    expect(screen.getByText('KS-1234')).toBeInTheDocument();
    expect(screen.getByText(/does not submit the booking form again/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry secure payment' })).toBeEnabled();
  });

  it('shows a confirmed state only after the server reports successful payment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ paymentStatus: 'PAID' }),
    }));

    renderRoute(
      '/book/north-star/payment-success?reference=KS-5678',
      '/book/:subdomain/payment-success',
      <PaymentSuccess />,
    );

    expect(screen.getByRole('heading', { name: 'Confirming your payment' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your booking is confirmed' })).toBeInTheDocument());
    expect(screen.getByText('KS-5678')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/v1/public/north-star/bookings/KS-5678/payment-status');
  });

  it('keeps a pending payment on the reassuring confirmation screen for two minutes', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ paymentStatus: 'OPEN' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderRoute(
      '/book/north-star/payment-success?reference=KS-9012',
      '/book/:subdomain/payment-success',
      <PaymentSuccess />,
    );

    expect(screen.getByRole('heading', { name: 'Confirming your payment' })).toBeInTheDocument();
    expect(screen.getByText('Please stay on this page')).toBeInTheDocument();
    expect(screen.getByText(/can take up to 2 minutes/i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(119_999);
    });

    expect(screen.getByRole('heading', { name: 'Confirming your payment' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "Your payment wasn't completed" })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(screen.getByRole('heading', { name: "We're still confirming your payment" })).toBeInTheDocument();
    expect(screen.getByText(/please don't make another payment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check payment again' })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(60);
  });

  it('shows failure messaging only when the server reports an explicit failed state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ paymentStatus: 'FAILED' }),
    }));

    renderRoute(
      '/book/north-star/payment-success?reference=KS-3456',
      '/book/:subdomain/payment-success',
      <PaymentSuccess />,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: "Your payment wasn't completed" })).toBeInTheDocument());
    expect(screen.queryByText(/verification delayed/i)).not.toBeInTheDocument();
    expect(screen.getByText('KS-3456')).toBeInTheDocument();
  });
});
