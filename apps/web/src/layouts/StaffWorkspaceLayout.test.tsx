import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffWorkspaceLayout } from './StaffWorkspaceLayout';

let auth = makeAuth('owner', []);
vi.mock('../auth/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../features/operations/useOperationsSummary', () => ({ useOperationsSummary: () => 3 }));
vi.mock('../features/agency/SupportModeBanner', () => ({ SupportModeBanner: () => null }));

function makeAuth(role: 'owner' | 'staff', permissions: string[]) {
  return {
    authUserId: 'membership-1', email: 'alex@example.com', tenantId: 'business-1', tenantName: 'North Star Studio', tenantSubdomain: 'north-star',
    role, permissions, membershipReference: 'membership-1', businessReference: 'business-1', workspaceSelectionRequired: false,
    memberships: [{ membershipReference: 'membership-1', businessReference: 'business-1', businessName: 'North Star Studio', businessSlug: 'north-star', role, selected: true }],
    reload: vi.fn(), selectWorkspace: vi.fn(), signOut: vi.fn(), signOutAll: vi.fn(), isLoading: false,
  } as any;
}

function renderLayout(path = '/app/calendar') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/app" element={<StaffWorkspaceLayout />}><Route path="*" element={<div>Page content</div>} /></Route></Routes></MemoryRouter>);
}

describe('StaffWorkspaceLayout', () => {
  beforeEach(() => { localStorage.clear(); auth = makeAuth('owner', []); });

  it('renders the owner sidebar without any agency route or control-plane wording', () => {
    renderLayout();
    expect(screen.getByRole('navigation', { name: 'Business navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Booking Calendar' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Finance' })).toBeInTheDocument();
    expect(screen.queryByText(/control plane/i)).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="/agency"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'View booking page' })).toHaveAttribute('target', '_blank');
  });

  it('filters owner-only destinations for staff using capabilities', () => {
    auth = makeAuth('staff', ['BOOKINGS_VIEW_OWN', 'TASKS_VIEW_OWN']);
    renderLayout();
    expect(screen.getByRole('link', { name: 'Booking Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Finance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Point of Sale' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create booking' })).not.toBeInTheDocument();
  });

  it('persists the desktop collapse preference', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(localStorage.getItem('ks-os-business-sidebar-collapsed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Booking Calendar' })).toHaveAttribute('title', 'Booking Calendar');
  });
});
