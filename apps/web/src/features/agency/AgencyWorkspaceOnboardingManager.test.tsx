import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgencyWorkspaceOnboardingManager } from './AgencyWorkspaceOnboardingManager';

const tenantId = '11111111-1111-4111-8111-111111111111';
const onboarding = {
  id: '22222222-2222-4222-8222-222222222222',
  status: 'IN_PROGRESS',
  currentStage: 'SALE_HANDOVER',
  completionPercentage: 0,
  targetLaunchAt: null,
  nextAction: null,
  internalNotes: null,
  clientVisibleNotes: null,
  missingInformation: [],
  checks: [],
  stages: [
    { id: '33333333-3333-4333-8333-333333333333', stageKey: 'SALE_HANDOVER', sequence: 1, status: 'IN_PROGRESS', blockerNote: null, dueAt: null, notes: null },
    { id: '44444444-4444-4444-8444-444444444444', stageKey: 'CONTRACT', sequence: 2, status: 'NOT_STARTED', blockerNote: null, dueAt: null, notes: null },
    { id: '55555555-5555-4555-8555-555555555555', stageKey: 'LAUNCH', sequence: 12, status: 'NOT_STARTED', blockerNote: null, dueAt: null, notes: null },
  ],
};

const agencyFetch = vi.fn(async (path: string, options?: RequestInit) => {
  if (path === `/tenants/${tenantId}`) return { tenant: { id: tenantId, name: 'KS TEST', lifecycleStatus: 'ONBOARDING', subdomain: 'kstest' } };
  if (path === `/tenants/${tenantId}/onboarding` && !options) return onboarding;
  if (path === `/tenants/${tenantId}/launch-checks`) return {
    ready: false,
    checks: [
      { key: 'OWNER_ACTIVE', ok: true, detail: 'An active owner account is required.' },
      { key: 'LOCATION_ACTIVE', ok: false, detail: 'At least one active location is required.' },
    ],
  };
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

function renderPage() {
  return render(<MemoryRouter initialEntries={[`/agency/tenants/${tenantId}/onboarding`]}><Routes><Route path="/agency/tenants/:tenantId/onboarding" element={<AgencyWorkspaceOnboardingManager />} /></Routes></MemoryRouter>);
}

describe('AgencyWorkspaceOnboardingManager', () => {
  beforeEach(() => agencyFetch.mockClear());

  it('shows the full stage journey and current manual action', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Setup and launch' })).toBeInTheDocument();
    expect(screen.getAllByText('Sales handover').length).toBeGreaterThan(0);
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete and continue' })).toBeInTheDocument();
  });

  it('completes the selected stage through the onboarding API', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Setup and launch' });
    await user.type(screen.getByLabelText('Stage notes'), 'Scope and primary contact confirmed.');
    await user.click(screen.getByRole('button', { name: 'Complete and continue' }));

    await waitFor(() => expect(agencyFetch).toHaveBeenCalledWith(
      `/tenants/${tenantId}/onboarding/SALE_HANDOVER`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'COMPLETE',
          dueAt: null,
          notes: 'Scope and primary contact confirmed.',
          blockerCode: null,
          blockerNote: null,
        }),
      },
    ));
  });

  it('requires an explanation before a stage can be blocked', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Setup and launch' });
    await user.selectOptions(screen.getByLabelText('Stage status'), 'BLOCKED');

    const blockerField = screen.getByLabelText('What is blocking this stage?');
    expect(blockerField).toBeRequired();
    await user.click(screen.getByRole('button', { name: 'Save stage' }));

    expect(blockerField).toBeInvalid();
    expect(agencyFetch).not.toHaveBeenCalledWith(expect.stringContaining('/onboarding/SALE_HANDOVER'), expect.objectContaining({ method: 'PATCH' }));
  });

  it('normalises live launch-check results for the readiness list', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Setup and launch' });
    await user.click(screen.getByRole('button', { name: 'Run launch checks' }));

    expect(await screen.findByText('OWNER ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('LOCATION ACTIVE')).toBeInTheDocument();
    expect(screen.getAllByText('PASS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('FAIL').length).toBeGreaterThan(0);
  });

  it('saves the overall onboarding plan separately from stage progress', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Setup and launch' });
    await user.type(screen.getByLabelText('Next action'), 'Confirm signed agreement');
    await user.type(screen.getByLabelText(/Missing information/), 'Trading address\nLogo files');
    await user.click(screen.getByRole('button', { name: 'Save onboarding plan' }));

    await waitFor(() => expect(agencyFetch).toHaveBeenCalledWith(
      `/tenants/${tenantId}/onboarding`,
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('Confirm signed agreement'),
      }),
    ));
  });
});
