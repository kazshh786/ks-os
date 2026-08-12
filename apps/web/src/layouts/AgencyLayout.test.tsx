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
  return {
    tenant: tenants.find(tenant => path.includes(tenant.id)) ?? tenants[0],
    onboarding: [],
    deliverables: [],
  };
});
const session = {
  authenticated: true, context: 'AGENCY', user: { email: 'operator@example.com', displayName: 'Agency Operator', role: 'PLATFORM_OWNER' },
  capabilities: ['agency.users.manage', 'tenants.read', 'tenants.manage', 'plans.read', 'plans.manage', 'billing.read', 'billing.manage', 'support.read', 'support.session.start', 'support.retry', 'fulfilment.read', 'fulfilment.manage', 'sites.studio.read', 'analytics.read', 'audit.read', 'sites.templates.read', 'sites.templates.manage'],
  mfa: { required: false, assuranceLevel: 'aal2' }, expiresAt: '2099-01-01T00:00:00.000Z',
};
vi.mock('../features/agency/AgencyAuth', () => ({ useAgencyAuth: () => ({ session, signOut: vi.fn() }), agencyFetch: (path: string) => agencyFetch(path) }));
vi.mock('../features/agency/AgencyOperatingConsole', () => ({
  AgencyHomePage: () => <div>Agency home dashboard</div>,
  AgencyClientsPage: () => <div>Client portfolio</div>,
  AgencyOnboardingPage: () => <div>Work queue board</div>,
}));
vi.mock('../features/agency/AgencyClientWorkspaceOverviewPage', () => ({ default: () => <div>Client next action overview</div> }));
vi.mock('../features/agency/AgencyWorkspaceOnboardingPage', () => ({ default: () => <div>Guided launch workspace</div> }));
vi.mock('../features/agency/AgencyClientExperienceV3', () => ({
  AgencyClientWebsiteWorkspacePage: () => <div>Website workspace</div>,
  AgencyClientOperationsPage: () => <div>Operations workspace</div>,
  AgencyClientAccountPage: () => <div>Account workspace</div>,
}));
vi.mock('../features/agency/SupportSessionDialog', () => ({ SupportSessionDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">Support access</div> : null }));

function LocationProbe() { const location = useLocation(); return <output aria-label="Current route">{location.pathname}</output>; }
function renderLayout(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><LocationProbe /><Routes><Route path="/agency" element={<AgencyLayout />}><Route path="*" element={<div>Agency page</div>} /></Route></Routes></MemoryRouter>);
}

describe('AgencyLayout UX V3', () => {
  beforeEach(() => { localStorage.clear(); agencyFetch.mockClear(); });

  it('uses a simplified agency information architecture', async () => {
    renderLayout('/agency/overview');
    expect(screen.getByRole('navigation', { name: 'Agency navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Clients' })).toHaveAttribute('href', '/agency/tenants');
    expect(screen.getByRole('link', { name: 'Work queue' })).toHaveAttribute('href', '/agency/onboarding');
    expect(screen.getByRole('link', { name: 'Design library' })).toHaveAttribute('href', '/agency/design-studio');
    expect(screen.getByRole('link', { name: 'System issues' })).toHaveAttribute('href', '/agency/errors');
    expect(await screen.findByText('Agency home dashboard')).toBeInTheDocument();
  });

  it('uses one consistent five-item client workspace navigation', async () => {
    const user = userEvent.setup();
    renderLayout(`/agency/tenants/${tenantOne}/billing`);
    expect(await screen.findByText('Managing business')).toBeInTheDocument();
    expect(screen.getAllByText('North Star Studio').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', `/agency/tenants/${tenantOne}`);
    expect(screen.getByRole('link', { name: 'Launch' })).toHaveAttribute('href', `/agency/tenants/${tenantOne}/onboarding`);
    expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute('href', `/agency/tenants/${tenantOne}/fulfilment`);
    expect(screen.getByRole('link', { name: 'Operations' })).toHaveAttribute('href', `/agency/tenants/${tenantOne}/health`);
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Back to all clients' })).toHaveAttribute('href', '/agency/tenants');
    expect(screen.getByRole('button', { name: 'Support access' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Switch managed business' }), tenantTwo);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent(`/agency/tenants/${tenantTwo}`));
  });

  it('routes client jobs through the consolidated workspace surfaces', async () => {
    const { unmount } = renderLayout(`/agency/tenants/${tenantOne}`);
    expect(await screen.findByText('Client next action overview')).toBeInTheDocument();
    unmount();

    const website = renderLayout(`/agency/tenants/${tenantOne}/fulfilment`);
    expect(await screen.findByText('Website workspace')).toBeInTheDocument();
    website.unmount();

    const operations = renderLayout(`/agency/tenants/${tenantOne}/health`);
    expect(await screen.findByText('Operations workspace')).toBeInTheDocument();
    operations.unmount();

    renderLayout(`/agency/tenants/${tenantOne}/billing`);
    expect(await screen.findByText('Account workspace')).toBeInTheDocument();
  });

  it('preserves direct access to advanced technical and billing detail routes', async () => {
    const technical = renderLayout(`/agency/tenants/${tenantOne}/health?technical=1`);
    expect(await screen.findByText('Agency page')).toBeInTheDocument();
    technical.unmount();

    renderLayout(`/agency/tenants/${tenantOne}/billing?details=1`);
    expect(await screen.findByText('Agency page')).toBeInTheDocument();
  });

  it('renders the guided launch workspace on onboarding', async () => {
    renderLayout(`/agency/tenants/${tenantOne}/onboarding`);
    expect(await screen.findByText('Guided launch workspace')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Launch' })).toHaveAttribute('aria-current', 'page');
  });
});
