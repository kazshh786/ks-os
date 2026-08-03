import type { SiteQualityFindingInput } from './contracts.js';

export interface SiteQualityAiReviewInput {
  qualityRunReference: string;
  siteVersionDigestSha256: string;
  knowledgePackDigestSha256: string;
  policyVersion: string;
  selectedRuleIds: readonly string[];
  safePageSummaries: readonly {
    pageReference: string;
    pageType: string;
    sectionTypes: readonly string[];
    claimStatuses: readonly string[];
  }[];
}

export interface SiteQualityAiReviewResult {
  providerKey: string;
  modelKey: string;
  reviewVersion: string;
  inputDigestSha256: string;
  outputDigestSha256: string;
  findings: SiteQualityFindingInput[];
  humanReviewRequired: boolean;
}

export interface SiteQualityAiReviewProvider {
  readonly enabled: boolean;
  review(input: SiteQualityAiReviewInput): Promise<SiteQualityAiReviewResult>;
}

export class DisabledSiteQualityAiReviewProvider
implements SiteQualityAiReviewProvider {
  readonly enabled = false;

  async review(): Promise<never> {
    throw Object.assign(new Error('AI quality review is disabled.'), {
      code: 'QUALITY_AI_REVIEW_DISABLED',
    });
  }
}

export class FakeSiteQualityAiReviewProvider
implements SiteQualityAiReviewProvider {
  readonly enabled = true;

  constructor(private readonly result: SiteQualityAiReviewResult) {}

  async review(): Promise<SiteQualityAiReviewResult> {
    return structuredClone(this.result);
  }
}
