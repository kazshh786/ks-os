import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSiteIntelligencePanel } from './LiveSiteIntelligencePanel';
import { SearchIntelligencePanel } from './SearchIntelligencePanel';

const siteReference = '11111111-1111-4111-8111-111111111111';
const agencyFetch = vi.fn();

vi.mock('./AgencyAuth', () => ({
  agencyFetch: (path: string, options?: RequestInit) => agencyFetch(path, options),
}));

const livePayload = (published: boolean, pendingEvents = 1) => ({
  dataClasses: { published: 'immutable', live: 'operational', personal: 'private' },
  published: published ? { snapshotReference: 'snapshot', versionReference: 'version', immutable: true, pageCount: 1 } : null,
  live: null,
  componentBindings: [],
  events: Array.from({ length: pendingEvents }, (_, index) => ({
    reference: `event-${index}`,
    entityType: 'SERVICE',
    kind: 'SERVICE_CHANGED',
    changedFields: ['bookingEligible'],
    occurredAt: '2026-08-11T12:00:00.000Z',
    processedAt: null,
  })),
  assessments: [],
  proposals: [],
  campaigns: [],
});

describe('Site Studio workflow guards', () => {
  beforeEach(() => agencyFetch.mockReset());

  it('blocks Search Intelligence creation until the current blueprint is approved', async () => {
    const user = userEvent.setup();
    agencyFetch.mockRejectedValueOnce({ status: 404, message: 'Not created' });

    render(<SearchIntelligencePanel
      siteReference={siteReference}
      siteName="North Star"
      canManage
      pageTitlesByReference={{}}
      blueprint={{ reference: 'blueprint-3', revision: 3, status: 'REVIEW_REQUIRED' }}
    />);

    expect(await screen.findByText('Approve blueprint revision 3 before creating Search Intelligence.')).toBeInTheDocument();
    const create = screen.getByRole('button', { name: 'Create planning draft' });
    expect(create).toBeDisabled();
    await user.click(create);
    expect(agencyFetch).not.toHaveBeenCalledWith(
      `/sites/${siteReference}/search-intelligence/create-draft`,
      expect.anything(),
    );
  });

  it('allows Search Intelligence creation only for the approved blueprint', async () => {
    const user = userEvent.setup();
    agencyFetch
      .mockRejectedValueOnce({ status: 404, message: 'Not created' })
      .mockResolvedValueOnce({ pageCount: 17 })
      .mockResolvedValueOnce({ strategy: {}, briefs: [], status: 'DRAFT' });

    render(<SearchIntelligencePanel
      siteReference={siteReference}
      siteName="North Star"
      canManage
      pageTitlesByReference={{}}
      blueprint={{ reference: 'blueprint-3', revision: 3, status: 'APPROVED' }}
    />);

    const create = await screen.findByRole('button', { name: 'Create planning draft' });
    expect(create).toBeEnabled();
    await user.click(create);
    expect(agencyFetch).toHaveBeenCalledWith(
      `/sites/${siteReference}/search-intelligence/create-draft`,
      { method: 'POST', body: '{}' },
    );
  });

  it('does not offer live impact processing before a first publication', async () => {
    const user = userEvent.setup();
    agencyFetch.mockResolvedValue(livePayload(false));

    render(<LiveSiteIntelligencePanel siteReference={siteReference} canManage canApprove={false} />);

    expect(await screen.findByText(/No published snapshot exists/)).toBeInTheDocument();
    const process = screen.getByRole('button', { name: 'Assess queued changes' });
    expect(process).toBeDisabled();
    await user.click(process);
    expect(agencyFetch).not.toHaveBeenCalledWith(
      `/sites/${siteReference}/live-intelligence/process-changes`,
      expect.anything(),
    );
  });

  it('allows live impact processing only with a published snapshot and queued events', async () => {
    const user = userEvent.setup();
    agencyFetch
      .mockResolvedValueOnce(livePayload(true))
      .mockResolvedValueOnce({ processedCount: 1 })
      .mockResolvedValueOnce(livePayload(true, 0));

    render(<LiveSiteIntelligencePanel siteReference={siteReference} canManage canApprove={false} />);

    const process = await screen.findByRole('button', { name: 'Assess queued changes' });
    expect(process).toBeEnabled();
    await user.click(process);
    expect(agencyFetch).toHaveBeenCalledWith(
      `/sites/${siteReference}/live-intelligence/process-changes`,
      { method: 'POST', body: '{}' },
    );
  });
});
