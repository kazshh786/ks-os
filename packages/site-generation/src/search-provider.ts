import type { SearchResearchEvidence, SerpAnalysis } from './search-intelligence.js';

export type SearchResearchProviderKey = 'DISABLED' | 'FAKE_TEST_PROVIDER';

export interface SearchResearchRequest {
  query: string;
  market: string;
  locale: string;
  location: string;
  language: string;
  device: 'DESKTOP' | 'MOBILE';
  capturedAt: string;
}

export interface SearchResearchResult {
  evidence: readonly SearchResearchEvidence[];
  serpAnalyses: readonly SerpAnalysis[];
}

export interface SearchResearchProvider {
  readonly providerKey: SearchResearchProviderKey;
  readonly enabled: boolean;
  research(request: SearchResearchRequest): Promise<SearchResearchResult>;
}

export class DisabledSearchResearchProvider implements SearchResearchProvider {
  readonly providerKey = 'DISABLED' as const;
  readonly enabled = false;

  async research(_request: SearchResearchRequest): Promise<SearchResearchResult> {
    throw new Error('SEARCH_RESEARCH_DISABLED');
  }
}

export class FakeSearchResearchProvider implements SearchResearchProvider {
  readonly providerKey = 'FAKE_TEST_PROVIDER' as const;
  readonly enabled = true;

  constructor(private readonly fixtures: ReadonlyMap<string, SearchResearchResult>) {}

  async research(request: SearchResearchRequest): Promise<SearchResearchResult> {
    return this.fixtures.get([
      request.market,
      request.locale,
      request.location,
      request.language,
      request.device,
      request.query,
    ].join(':')) ?? { evidence: [], serpAnalyses: [] };
  }
}

export function createSearchResearchProvider(input: {
  providerKey?: SearchResearchProviderKey;
  fixtures?: ReadonlyMap<string, SearchResearchResult>;
} = {}): SearchResearchProvider {
  if (!input.providerKey || input.providerKey === 'DISABLED') {
    return new DisabledSearchResearchProvider();
  }
  return new FakeSearchResearchProvider(input.fixtures ?? new Map());
}
