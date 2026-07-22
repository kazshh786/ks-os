import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AccessDeniedPage, PasswordRecoveryPage, SessionExpiredPage } from './AuthPages.js';

afterEach(() => vi.restoreAllMocks());

describe('shared authentication states', () => {
  it('offers separate business and agency sign-in choices without technical identifiers', () => {
    render(<MemoryRouter><AccessDeniedPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Business sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Agency sign in' })).toHaveAttribute('href', '/agency/login');
    expect(document.body.textContent).not.toMatch(/tenant id|jwt|auth user/i);
  });

  it('explains an expired session and provides a safe sign-in route', () => {
    render(<MemoryRouter><SessionExpiredPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Your session has ended' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to sign in' })).toHaveAttribute('href', '/login');
  });

  it('keeps password reset responses neutral', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
    render(<MemoryRouter><PasswordRecoveryPage context="TENANT" mode="request" /></MemoryRouter>);
    await user.type(screen.getByLabelText('Email address'), 'unknown@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset instructions' }));
    expect(await screen.findByText(/If this address is eligible/)).toBeInTheDocument();
  });
});

