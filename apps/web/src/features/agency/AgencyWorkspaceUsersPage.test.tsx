import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgencyWorkspaceUsersPage } from './AgencyWorkspaceUsersPage';

const tenantId = '11111111-1111-4111-8111-111111111111';
const users = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'Amina Owner', email: 'amina@example.com', role: 'owner', status: 'ACTIVE', lastLoginAt: '2026-07-28T10:00:00.000Z' },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', displayName: 'Bilal Staff', email: 'bilal@example.com', role: 'staff', status: 'SUSPENDED', lastLoginAt: null },
];
const agencyFetch = vi.fn(async (path: string, options?: RequestInit) => {
  if (path === `/tenants/${tenantId}`) return { tenant: { id: tenantId, name: 'North Star Studio', subdomain: 'north-star-studio' } };
  if (path === `/tenants/${tenantId}/users`) return users;
  if (path === `/tenants/${tenantId}/owner-invitations` && options?.method === 'POST') return { invitationReference: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
  return {};
});
const session = {
  authenticated: true,
  context: 'AGENCY',
  user: { email: 'operator@example.com', displayName: 'Agency Operator', role: 'PLATFORM_OWNER' },
  capabilities: ['tenants.read', 'tenants.manage'],
  mfa: { required: false, assuranceLevel: 'aal2' },
  expiresAt: '2099-01-01T00:00:00.000Z',
};

vi.mock('./AgencyAuth', () => ({
  useAgencyAuth: () => ({ session }),
  agencyFetch: (path: string, options?: RequestInit) => agencyFetch(path, options),
}));
vi.mock('./ManualTenantUserDialog', () => ({ ManualTenantUserDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">Add user directly</div> : null }));
vi.mock('./AdminPasswordDialog', () => ({ AdminPasswordDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">Password control</div> : null }));

function renderPage() {
  return render(<MemoryRouter initialEntries={[`/agency/tenants/${tenantId}/users`]}><Routes><Route path="/agency/tenants/:tenantId/users" element={<AgencyWorkspaceUsersPage />} /></Routes></MemoryRouter>);
}

describe('AgencyWorkspaceUsersPage', () => {
  beforeEach(() => {
    agencyFetch.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows every workspace user with role, status and management actions', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Users and access' })).toBeInTheDocument();
    expect(screen.getByText('Amina Owner')).toBeInTheDocument();
    expect(screen.getByText('amina@example.com')).toBeInTheDocument();
    expect(screen.getByText('Bilal Staff')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Suspend' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Reactivate' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Revoke sessions' })).toHaveLength(2);
  });

  it('suspends a workspace user and refreshes the directory', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Amina Owner');
    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(agencyFetch).toHaveBeenCalledWith(
      `/tenants/${tenantId}/users/${users[0].id}/suspend`,
      { method: 'POST' },
    ));
    expect(window.confirm).toHaveBeenCalledWith('Suspend Amina Owner? They will no longer be able to access this workspace.');
  });

  it('sends an initial owner invitation from the workspace', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Amina Owner');
    await user.click(screen.getByRole('button', { name: 'Invite owner' }));
    await user.type(screen.getByLabelText('Owner name'), 'Kasim Shah');
    await user.type(screen.getByLabelText('Email address'), 'kasim@example.com');
    await user.click(screen.getByRole('button', { name: 'Send owner invitation' }));
    await waitFor(() => expect(agencyFetch).toHaveBeenCalledWith(
      `/tenants/${tenantId}/owner-invitations`,
      {
        method: 'POST',
        body: JSON.stringify({ displayName: 'Kasim Shah', email: 'kasim@example.com' }),
      },
    ));
  });
});
