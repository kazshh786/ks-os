import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const { signInWithPassword, fetchWithAuth } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(), fetchWithAuth: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({ supabase: { auth: { signInWithPassword } } }));
vi.mock('../api/client', () => ({ fetchWithAuth }));

import { Login } from '../pages/Login';
import { AgencyLoginPage } from '../features/agency/AgencyLoginPage';

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe.each([
  ['business', Login], ['agency', AgencyLoginPage],
] as const)('%s sign-in', (_portal, Page) => {
  it.each([
    [402, undefined, 'authentication service is restricted'],
    [429, undefined, 'Too many sign-in attempts'],
    [503, undefined, 'authentication service'],
    [400, 'invalid_credentials', 'didn’t match'],
  ])('shows the right error for provider status %s', async (status, code, expected) => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { status, code } });
    render(<MemoryRouter><Page /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'test@example.invalid' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'test-password' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(fetchWithAuth).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
});
