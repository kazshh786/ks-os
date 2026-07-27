import type {
  BrowserAuditPageResult,
  SiteQualityViewport,
} from './contracts.js';

export interface SiteQualityBrowserPage {
  pageReference: string;
  path: string;
}

export interface SecureQualityPreview {
  qualityRunReference: string;
  siteReference: string;
  versionReference: string;
  contentDigestSha256: string;
  previewBaseUrl: string;
  bearerToken: string;
  expiresAt: Date;
}

export interface SiteQualityBrowserAdapter {
  readonly adapterKey: string;
  readonly toolVersion: string;
  auditPage(input: {
    preview: SecureQualityPreview;
    page: SiteQualityBrowserPage;
    viewport: SiteQualityViewport;
    signal: AbortSignal;
  }): Promise<BrowserAuditPageResult>;
  close?(): Promise<void>;
}

export class DisabledSiteQualityBrowserAdapter
implements SiteQualityBrowserAdapter {
  readonly adapterKey = 'DISABLED';
  readonly toolVersion = 'DISABLED';

  async auditPage(): Promise<never> {
    throw Object.assign(
      new Error('Rendered browser auditing is not configured.'),
      { code: 'QUALITY_BROWSER_UNAVAILABLE' },
    );
  }
}

export class FakeSiteQualityBrowserAdapter
implements SiteQualityBrowserAdapter {
  readonly adapterKey = 'FAKE_DETERMINISTIC';
  readonly toolVersion = 'FAKE_BROWSER_V1';

  constructor(
    private readonly resolve: (input: {
      page: SiteQualityBrowserPage;
      viewport: SiteQualityViewport;
    }) => BrowserAuditPageResult,
  ) {}

  async auditPage(input: {
    page: SiteQualityBrowserPage;
    viewport: SiteQualityViewport;
  }): Promise<BrowserAuditPageResult> {
    return this.resolve({ page: input.page, viewport: input.viewport });
  }
}
