import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgencyLayout } from './AgencyLayout';

const tenantOne = '11111111-1111-4111-8111-111111111111';
const tenantTwo = '22222222-2222-4222-8222-222222222222';
const agencyFetch = vi.fn(async (path: string) => path === '/tenants'
  ? [{ id: tenantOne, name: 'North Star Studio', lifecycleStatus: 'ACTIVE' }, { id: tenantTwo, name: 'Second Studio', lifecycleStatus: 'ONBOARDING' }]
  : { tenant: { id: path.includes(tenantTwo) ? tenantTwo : tenantOne, name: path.includes(tenantTwo) ? 'Second Studio' : 'North Star Studio', lifecycleStatus: 'ACTIVE' } });
const session = {
  authenticated: true, context: 'AGENCY', user: { email: 'operator@example.com', displayName: 'Agency Operator', role: 'PLATFORM_OWNER' },
  capabilities: ['agency.users.manage', 'tenants.read', 'tenants.manage', 'plans.read', 'plans.manage', 'billing.read', 'billing.manage', 'support.read', 'support.session.start', 'support.retry', 'fulfilment.read', 'fulfilment.manage', 'analytics.read', 'audit.read'],
  mfa: { required: false, assuranceLevel: 'aal2' }, expiresAt: '2099-01-01T00:00:00.000Z',
};
vi.mock('../features/agency/AgencyAuth', () => ({ useAgencyAuth: () => ({ session, signOut: vi.fn() }), agencyFetch: (path: string) => agencyFetch(path) }));
vi.mock('../features/agency/SupportSessionDialog', () => ({ SupportSessionDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">Support access</div> : null }));

function LocationProbe() { const location = useLocation(); return <output aria-label="Current route">{location.pathname}</output>; }
function renderLayout(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/agency" element={<AgencyLayout />}><Route path="*" element={<><div>Agency page</div><LocationProbe /></>} /></Route></Routes></MemoryRouter>);
}

describe('AgencyLayout', () => {
  beforeEach(() => { localStorage.clear(); agencyFetch.mockClear(); });

  it('renders grouped global agency navigation with approved labels', () => {
    renderLayout('/agency/overview');
    expect(screen.getByRole('navigation', { name: 'Agency navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Services' })).toHaveAttribute('href', '/agency/fulfilment');
    expect(screen.getByRole('link', { name: 'Audit Logs' })).toHaveAttribute('href', '/agency/audit');
    expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute('href', '/agency/users');
  });

  it('moves tenant management into the sidebar with identity, exit, switching, and support entry', async () => {
    const user = userEvent.setup();
    renderLayout(`/agency/tenants/${tenantOne}/billing`);
    expect(await screen.findByText('Managing business')).toBeInTheDocument();
    expect(screen.getAllByText('North Star Studio').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Back to Businesses' })).toHaveAttribute('href', '/agency/tenants');
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('href', `/agency/tenants/${tenantOne}/entitlements`);
    expect(screen.getByRole('link', { name: 'System Health' })).toHaveAttribute('href', `/agency/tenants/${tenantOne}/health`);
    expect(screen.queryByRole('navigation', { name: /tenant tabs/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open support workspace' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Switch managed business' }), tenantTwo);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent(`/agency/tenants/${tenantTwo}`));
  });
});
