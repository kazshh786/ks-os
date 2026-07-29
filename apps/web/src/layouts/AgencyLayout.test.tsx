import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgencyLayout } from './AgencyLayout';

const tenantOne = '11111111-1111-4111-8111-111111111111';
const tenantTwo = '22222222-2222-4222-8222-222222222222';
const tenants = [
  { id: tenantOne, name: 'North Star Studio', subdomain: 'north-star-studio', lifecycleStatus: 'ACTIVE' },
  { id: tenantTwo, name: 'Second Studio', subdomain: 'second-studio', lifecycleStatus: 'ONBOARDING' },
];
const agencyFetch = vi.fn(async (path: string) => {
  if (path === '/tenants') return tenants;
  if (path.endsWith('/users')) return [];
  return {
    tenant: tenants.find(tenant => path.includes(tenant.id)) ?? tenants[0],
    onboarding: [],
    deliverables: [],
  };
});
const session = {
  authenticated: true, context: 'AGENCY', user: { email: 'operator@example.com', displayName: 'Agency Operator', role: 'PLATFORM_OWNER' },
  capabilities: ['agency.users.manage', 'tenants.read', 'tenants.manage', 'plans.read', 'plans.manage', 'billing.read', 'billing.manage', 'support.read', 'support.session.start', 'support.retry', 'fulfilment.read', 'fulfilment.manage', 'analytics.read', 'audit.read'],
  mfa: { required: false, assuranceLevel: 'aal2' }, expiresAt: '2099-01-01T00:00:00.000Z',
};
vi.mock('../features/agency/AgencyAuth', () => ({ useAgencyAuth: () => ({ session, signOut: vi.fn() }), agencyFetch: (path: string) => agencyFetch(path) }));
vi.mock('../features/agency/AgencyOperatingConsole', () => ({
  AgencyHomePage: () => <div>Agency home dashboard</div>,
  AgencyClientsPage: () => <div>Client portfolio</div>,
  AgencyOnboardingPage: () => <div>Onboarding board</div>,
  AgencyClientWorkspacePage: () => <div>Client workspace hub</div>,
}));
vi.mock('../features/agency/AgencyWorkspaceOnboardingPage', () => ({ default: () => <div>Editable onboarding workspace</div> }));
vi.mock('../features/agency/SupportSessionDialog', () => ({ SupportSessionDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">Support access</div> : null }));

function LocationProbe() { const location = useLocation(); return <output aria-label="Current route">{location.pathname}</output>; }
function renderLayout(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><LocationProbe /><Routes><Route path="/agency" element={<AgencyLayout />}><Route path="*" element={<div>Agency page</div>} /></Route></Routes></MemoryRouter>);
}

describe('AgencyLayout', () => {
  beforeEach(() => { localStorage.clear(); agencyFetch.mockClear(); });

  it('renders task-led global agency navigation with approved labels', async () => {
    renderLayout('/agency/overview');
    expect(screen.getByRole('navigation', { name: 'Agency navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Managed services' })).toHaveAttribute('href', '/agency/fulfilment');
    expect(screen.getByRole('link', { name: 'Audit trail' })).toHaveAttribute('href', '/agency/audit');
    expect(screen.getByRole('link', { name: 'Agency team' })).toHaveAttribute('href', '/agency/users');
    expect(await screen.findByText('Agency home dashboard')).toBeInTheDocument();
  });

  it('moves client management into the sidebar with identity, users, exit, switching, and support entry', async () => {
    const user = userEvent.setup();
    renderLayout(`/agency/tenants/${tenantOne}/billing`);
    expect(await screen.findByText('Managing business')).toBeInTheDocument();
    expect(screen.getAllByText('North Star Studio').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Back to all clients' })).toHaveAttribute('href', '/agency/tenants');
    expect(screen.getByRole('link', { name: 'Users and access' })).toHaveAttribute('href', `/agency/tenants/${tenantOne}/users`);
    expect(screen.getByRole('link', { name: 'Billing and subscription' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Package and features' })).toHaveAttribute('href', `/agency/tenants/${tenantOne}/entitlements`);
    expect(screen.getByRole('link', { name: 'Technical health' })).toHaveAttribute('href', `/agency/tenants/${tenantOne}/health`);
    expect(screen.queryByRole('navigation', { name: /tenant tabs/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open support workspace' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Switch managed business' }), tenantTwo);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent(`/agency/tenants/${tenantTwo}`));
  });

  it('renders the editable setup and launch workspace on the onboarding route', async () => {
    renderLayout(`/agency/tenants/${tenantOne}/onboarding`);
    expect(await screen.findByText('Editable onboarding workspace')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Setup and launch' })).toHaveAttribute('aria-current', 'page');
  });
});
