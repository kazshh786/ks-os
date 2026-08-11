import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgencyLaunchCommandCenter } from './AgencyLaunchCommandCenter';
import { AgencyProvisioningPage, requireAgencyLaunchReference } from './AgencyProvisioning';

const internalId = '11111111-1111-4111-8111-111111111111';
const agencyReference = '22222222-2222-4222-8222-222222222222';
const businessReference = '33333333-3333-4333-8333-333333333333';
const planVersionId = '44444444-4444-4444-8444-444444444444';

const tenant = {
  id: internalId,
  agencyReference,
  businessReference,
  name: 'North Star Studio',
  legalBusinessName: 'North Star Studio Ltd',
  lifecycleStatus: 'ONBOARDING',
  subdomain: 'north-star',
  timezone: 'Europe/London',
  currency: 'GBP',
  primaryContactName: 'Avery Owner',
  primaryContactEmail: 'owner@example.com',
};

const detail = { tenant, plan: null, onboarding: [], billing: null, subscription: null, deliverables: [] };
const context = {
  tenant,
  plan: { versionReference: planVersionId },
  productionBrief: null,
  websiteRequirements: { requestedPageTypes: [] },
  draft: null,
  site: null,
  run: null,
  knowledge: { ready: false },
  designLibrary: { nativeTemplateReady: false },
  generationProvider: { ready: false, providerKey: 'vertex-gemini', modelKey: 'gemini-3.6-flash' },
};
const booking = { readiness: { readyForBuild: false, blockingIssues: [] }, services: [], locations: [] };

const session = {
  authenticated: true,
  context: 'AGENCY',
  user: { email: 'operator@example.com', displayName: 'Agency Operator', role: 'PLATFORM_OWNER' },
  capabilities: ['tenants.read', 'tenants.manage', 'provisioning.read'],
  mfa: { required: false, assuranceLevel: 'aal2' },
  expiresAt: '2099-01-01T00:00:00.000Z',
};

const agencyFetch = vi.fn();

vi.mock('./AgencyAuth', () => ({
  useAgencyAuth: () => ({ session }),
  agencyFetch: (path: string, options?: RequestInit) => agencyFetch(path, options),
}));

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

function renderProvisioning(initialEntry = '/agency/provisioning') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/agency/provisioning" element={<><AgencyProvisioningPage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

function successfulResponse(path: string, options?: RequestInit) {
  if (path === '/tenants' && options?.method === 'POST') return tenant;
  if (path === '/tenants') return [tenant];
  if (path === '/plans') return [{ plan: { key: 'CORE', name: 'Core' }, version: { id: planVersionId, version: 1, status: 'ACTIVE' } }];
  if (path === `/tenants/${internalId}`) return detail;
  if (path === `/tenants/${agencyReference}/delivery-context`) return context;
  if (path === `/tenants/${agencyReference}/onboarding-booking`) return booking;
  if (path === `/fact-finding/questionnaires?tenantReference=${agencyReference}`) return [];
  throw new Error(`Unexpected agency request: ${path}`);
}

describe('Agency Launch tenant reference boundary', () => {
  beforeEach(() => {
    agencyFetch.mockReset().mockImplementation(successfulResponse);
  });

  it('opens an existing directory client with agencyReference rather than tenant.id', async () => {
    const user = userEvent.setup();
    renderProvisioning();

    await user.click(await screen.findByRole('button', { name: /North Star Studio/ }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`?tenant=${agencyReference}`));
    expect(screen.getByTestId('location')).not.toHaveTextContent(internalId);
  });

  it('prefers agencyReference from a newly created client and has no implicit id fallback', () => {
    expect(requireAgencyLaunchReference({ id: internalId, agencyReference })).toBe(agencyReference);
    expect(() => requireAgencyLaunchReference({ agencyReference: undefined })).toThrow(
      'The client was created but its agency reference was not returned.',
    );
  });

  it('normalizes a legacy internal-id URL before command-centre requests', async () => {
    renderProvisioning(`/agency/provisioning?tenant=${internalId}`);

    expect(await screen.findByRole('heading', { name: 'North Star Studio' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`?tenant=${agencyReference}`));

    const paths = agencyFetch.mock.calls.map(([path]) => path as string);
    const detailRequest = paths.indexOf(`/tenants/${internalId}`);
    const contextRequest = paths.indexOf(`/tenants/${agencyReference}/delivery-context`);
    expect(detailRequest).toBeGreaterThanOrEqual(0);
    expect(contextRequest).toBeGreaterThan(detailRequest);
    expect(paths).toContain(`/fact-finding/questionnaires?tenantReference=${agencyReference}`);
    expect(paths).not.toContain(`/fact-finding/questionnaires?tenantReference=${internalId}`);
    expect(paths).not.toContain(`/tenants/${internalId}/delivery-context`);
    expect(paths).not.toContain(`/tenants/${internalId}/onboarding-booking`);
  });

  it('shows an initial error and Retry recovers the command centre', async () => {
    const user = userEvent.setup();
    let contextFailures = 1;
    agencyFetch.mockImplementation((path: string, options?: RequestInit) => {
      if (path === `/tenants/${agencyReference}/delivery-context` && contextFailures > 0) {
        contextFailures -= 1;
        return Promise.reject(new Error('Launch context is temporarily unavailable.'));
      }
      return Promise.resolve(successfulResponse(path, options));
    });

    render(
      <MemoryRouter>
        <AgencyLaunchCommandCenter
          tenantReference={agencyReference}
          tenantDetail={detail}
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Launch context is temporarily unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('Loading governed launch workspace…')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'North Star Studio' })).toBeInTheDocument();
    expect(screen.queryByText('Launch context is temporarily unavailable.')).not.toBeInTheDocument();
    expect(agencyFetch).toHaveBeenCalledWith(
      `/fact-finding/questionnaires?tenantReference=${agencyReference}`,
      undefined,
    );
  });
});
