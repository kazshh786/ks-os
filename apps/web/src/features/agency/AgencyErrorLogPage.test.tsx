import { describe, expect, it } from 'vitest';
import { explainAgencyIssue } from './AgencyErrorLogPage';

describe('Agency system issue language', () => {
  it('turns Search Intelligence blueprint guards into a prerequisite explanation', () => {
    expect(explainAgencyIssue({
      errorCode: 'SEARCH_INTELLIGENCE_BLUEPRINT_NOT_APPROVED',
      message: 'Approve the exact blueprint revision before creating Search Intelligence.',
      statusCode: 409,
      retryable: false,
    })).toEqual(expect.objectContaining({
      title: 'Approve the website structure first',
      kind: 'prerequisite',
    }));
  });

  it('explains published-snapshot guards as a post-launch prerequisite', () => {
    const result = explainAgencyIssue({
      errorCode: 'PUBLISHED_SNAPSHOT_REQUIRED',
      message: 'Impact analysis requires a published snapshot.',
      statusCode: 409,
      retryable: false,
    });
    expect(result.title).toBe('Available after the website goes live');
    expect(result.nextStep).toContain('No action is needed');
  });

  it('distinguishes unexpected server failures from workflow prerequisites', () => {
    const result = explainAgencyIssue({
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'Failed query',
      statusCode: 500,
      retryable: true,
    });
    expect(result.kind).toBe('problem');
    expect(result.title).toBe('KS OS could not complete this action');
    expect(result.nextStep).toContain('Retry');
  });
});
