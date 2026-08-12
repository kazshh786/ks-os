import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgencyClientWebsiteWorkspacePage,
  AgencyLaunchJourneyV3,
  humanWorkStateLabel,
} from './AgencyClientExperienceV3';

const tenantId = '11111111-1111-4111-8111-111111111111';
const agencyReference = '22222222-2222-4222-8222-222222222222';
const siteReference = '33333333-3333-4333-8333-333333333333';
const blueprintReference = '44444444-4444-4444-8444-444444444444';

const tenant = {
  id: tenantId,
  agencyReference,
  businessReference: '55555555-5555-4555-8555-555555555555',
  name: 'North Star Studio',
  lifecycleStatus: 'ONBOARDING',
};
const detail = { tenant };
const context = {
  tenant,
  productionBrief: { status: 'LOCKED_FOR_PROVISIONING' },
  draft: { reference: 'draft-1' },
  site: { reference: siteReference },
  run: null,
  canonical: { services: [{ reference: 'service-1' }] },
};
const booking = { readiness: { readyForBuild: true }, services: [{}], locations: [{}] };
const discovery = { reference: 'disc-1', version: 1, status: 'SUBMITTED', approvedAssetCount: 2 };
const blueprint = { reference: blueprintReference, revision: 3, status: 'APPROVED' };
const studio = { pages: [{ reference: 'page-1', title: 'Home', pageType: 'HOME', path: '/', status: 'DRAFT' }] };
const session = { capabilities: ['sites.manage', 'sites.studio.read', 'fulfilment.read'] };
const agencyFetch = vi.fn();

vi.mock('./AgencyAuth', () => ({
  useAgencyAuth: () => ({ session }),
  agencyFetch: (path: string, options?: RequestInit) => agencyFetch(path, options),
}));
vi.mock('./AgencyLaunchCommandCenter', () => ({
  AgencyLaunchCommandCenter: () => <div>Legacy governed controls</div>,
}));

function baseResponse(path: string) {
  if (path === `/tenants/${agencyReference}/delivery-context`) return context;
  if (path === `/tenants/${agencyReference}/onboarding-booking`) return booking;
  if (path === `/fact-finding/questionnaires?tenantReference=${agencyReference}`) return [discovery];
  if (path === `/sites/${siteReference}/blueprints`) return [blueprint];
  if (path === `/sites/${siteReference}/generation-runs`) return [];
  if (path === `/sites/${siteReference}/quality-runs`) return [];
  if (path === `/sites/${siteReference}/domains`) return [];
  if (path === `/sites/${siteReference}/publications`) return [];
  if (path === `/tenants/${tenantId}`) return detail;
  if (path === `/sites/${siteReference}/studio`) return studio;
  throw new Error(`Unexpected agency request: ${path}`);
}

describe('Agency client UX V3', () => {
  beforeEach(() => { agencyFetch.mockReset(); });

  it('uses human work-state language instead of exposing state-machine labels', () => {
    expect(humanWorkStateLabel('NEEDS_YOU')).toBe('Needs you');
    expect(humanWorkStateLabel('WAITING')).toBe('Waiting');
    expect(humanWorkStateLabel('IN_PROGRESS')).toBe('In progress');
    expect(humanWorkStateLabel('COMPLETE')).toBe('Complete');
    expect(humanWorkStateLabel('PROBLEM')).toBe('Problem');
  });

  it('makes the next launch action primary and keeps legacy controls hidden until requested', async () => {
    agencyFetch.mockImplementation(async (path: string) => {
      if (path === `/sites/${siteReference}/search-intelligence`) {
        return { status: 'DRAFT', researchReadiness: { status: 'RESEARCH_REQUIRED' }, researchFreshness: { evidenceCount: 0 } };
      }
      return baseResponse(path);
    });
    const user = userEvent.setup();
    render(<MemoryRouter><AgencyLaunchJourneyV3 tenantReference={agencyReference} tenantDetail={detail} onBack={() => undefined} /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Add real search research' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open research inbox/ })).toHaveAttribute('href', `/agency/tenants/${tenantId}/fulfilment?view=research`);
    expect(screen.queryByText('Legacy governed controls')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show controls' }));
    expect(screen.getByText('Legacy governed controls')).toBeInTheDocument();
  });

  it('blocks search planning in the UI until the exact website structure is approved', async () => {
    agencyFetch.mockImplementation(async (path: string) => {
      if (path === `/sites/${siteReference}/blueprints`) return [{ ...blueprint, status: 'REVIEW_REQUIRED' }];
      if (path === `/sites/${siteReference}/search-intelligence`) {
        const error = Object.assign(new Error('No search strategy was found.'), { status: 404 });
        throw error;
      }
      return baseResponse(path);
    });

    render(
      <MemoryRouter initialEntries={[`/agency/tenants/${tenantId}/fulfilment?view=search`]}>
        <Routes><Route path="/agency/tenants/:tenantId/fulfilment" element={<AgencyClientWebsiteWorkspacePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Approve the website structure first' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create search planning draft' })).not.toBeInTheDocument();
    expect(agencyFetch.mock.calls.some(([path, options]) => path === `/sites/${siteReference}/search-intelligence/create-draft` && options?.method === 'POST')).toBe(false);
  });

  it('surfaces the research inbox from Website → Search after blueprint approval', async () => {
    agencyFetch.mockImplementation(async (path: string) => {
      if (path === `/sites/${siteReference}/search-intelligence`) return {
        status: 'DRAFT',
        strategy: {
          reference: '66666666-6666-4666-8666-666666666666',
          strategyVersion: 1,
          targetAudience: { segments: [{ key: 'local', name: 'Local clients' }] },
          searchMarket: { locale: 'en-GB', countryCode: 'GB' },
          provenance: { providerKey: 'ks-os-governed-draft', modelKey: 'blueprint-context-v1' },
        },
        briefs: [{ reference: 'brief-1', pageReference: 'page-1', pageType: 'HOME', primaryTopic: 'Home', primaryKeyword: 'beauty clinic', primarySearchIntent: 'LOCAL', status: 'DRAFT' }],
        researchReadiness: { status: 'RESEARCH_REQUIRED' },
        researchFreshness: { evidenceCount: 0, staleCount: 0 },
      };
      return baseResponse(path);
    });

    render(
      <MemoryRouter initialEntries={[`/agency/tenants/${tenantId}/fulfilment?view=search`]}>
        <Routes><Route path="/agency/tenants/:tenantId/fulfilment" element={<AgencyClientWebsiteWorkspacePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Add real search research before approval' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open research inbox' })).toHaveAttribute('href', `/agency/tenants/${tenantId}/fulfilment?view=research`);
    expect(screen.getByRole('heading', { name: 'Page search briefs' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Home')).toBeInTheDocument());
  });
});
