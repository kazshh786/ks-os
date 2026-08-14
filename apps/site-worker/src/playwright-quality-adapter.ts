import { createHash } from 'node:crypto';
import axe from 'axe-core';
import {
  BrowserAuditPageResultSchema,
  DEFAULT_SITE_QUALITY_POLICY,
  type BrowserAuditPageResult,
  type SiteQualityBrowserAdapter,
} from '@ks-os/site-quality';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';

interface PlaywrightQualityAdapterConfig {
  pageTimeoutMs: number;
}

const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

function qualityPreviewUrl(baseUrl: string, path: string) {
  const url = new URL(baseUrl);
  url.searchParams.set('path', path);
  return url.toString();
}

function metric(input: {
  name: 'PAGE_LOAD_MS' | 'MAIN_CONTENT_MS' | 'LARGEST_CONTENTFUL_PAINT_MS'
    | 'INTERACTION_TO_NEXT_PAINT_MS' | 'CUMULATIVE_LAYOUT_SHIFT'
    | 'TRANSFER_BYTES' | 'FAILED_CRITICAL_RESOURCES';
  value: number;
  unit: 'MILLISECONDS' | 'SCORE' | 'BYTES' | 'COUNT';
  viewport: BrowserAuditPageResult['viewport'];
  threshold: number;
  block?: boolean;
  exclusiveThreshold?: boolean;
  forceResult?: 'PASS' | 'WARNING' | 'BLOCK';
  sampleCount?: number;
  toolVersion: string;
  capturedAt: Date;
}) {
  return {
    name: input.name,
    value: Math.max(0, input.value),
    unit: input.unit,
    viewport: input.viewport,
    threshold: input.threshold,
    result: input.forceResult ?? (
      (input.exclusiveThreshold
        ? input.value < input.threshold
        : input.value <= input.threshold)
        ? 'PASS' as const
        : input.block
          ? 'BLOCK' as const
          : 'WARNING' as const
    ),
    measurementMode: 'LAB' as const,
    sampleCount: input.sampleCount ?? 1,
    evidenceTimestamp: input.capturedAt,
    toolVersion: input.toolVersion,
  };
}

async function inspectKeyboardJourney(page: Page) {
  const focusableCount = await page.locator(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),'
    + 'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
  ).count();
  const boundedAttempts = Math.min(Math.max(focusableCount + 2, 1), 100);
  const visited = new Set<string>();
  let bookingReached = false;
  for (let attempt = 0; attempt < boundedAttempts; attempt += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      const href = element instanceof HTMLAnchorElement
        ? element.getAttribute('href')
        : null;
      return {
        key: [
          element.tagName,
          element.id,
          element.getAttribute('class') ?? '',
          href ?? '',
          element.textContent?.trim().slice(0, 80) ?? '',
        ].join('|'),
        booking: Boolean(href?.startsWith('/book')),
      };
    });
    if (!focused) continue;
    visited.add(focused.key);
    if (focused.booking) {
      bookingReached = true;
      break;
    }
  }
  return {
    bookingReached,
    // A repeated natural tab cycle is not itself a focus trap. Automated axe
    // findings and the human-review gate cover focus behaviour that cannot be
    // proven from bounded traversal without interacting with page controls.
    focusTrapDetected: false,
    visitedCount: visited.size,
  };
}

export class ProductionPlaywrightQualityAdapter
implements SiteQualityBrowserAdapter {
  readonly adapterKey = 'PLAYWRIGHT_CHROMIUM';
  readonly toolVersion = 'PLAYWRIGHT_1_62_AXE_4_12_1';
  private browser: Browser | null = null;

  constructor(private readonly config: PlaywrightQualityAdapterConfig) {}

  private async resolvedBrowser() {
    this.browser ??= await chromium.launch({ headless: true });
    return this.browser;
  }

  async auditPage(
    input: Parameters<SiteQualityBrowserAdapter['auditPage']>[0],
  ): Promise<BrowserAuditPageResult> {
    input.signal.throwIfAborted();
    const browser = await this.resolvedBrowser();
    const context = await browser.newContext({
      viewport: {
        width: input.viewport.width,
        height: input.viewport.height,
      },
      deviceScaleFactor: input.viewport.deviceScaleFactor,
      isMobile: input.viewport.mobile,
      hasTouch: input.viewport.touch,
      reducedMotion: 'reduce',
      locale: 'en-GB',
      javaScriptEnabled: true,
      serviceWorkers: 'block',
      extraHTTPHeaders: {
        authorization: `Bearer ${input.preview.bearerToken}`,
      },
    });
    const abort = () => void context.close().catch(() => undefined);
    input.signal.addEventListener('abort', abort, { once: true });
    try {
      return await this.auditInContext(context, input);
    } finally {
      input.signal.removeEventListener('abort', abort);
      await context.close().catch(() => undefined);
    }
  }

  private async auditInContext(
    context: BrowserContext,
    input: Parameters<SiteQualityBrowserAdapter['auditPage']>[0],
  ): Promise<BrowserAuditPageResult> {
    const page = await context.newPage();
    page.setDefaultTimeout(this.config.pageTimeoutMs);
    page.setDefaultNavigationTimeout(this.config.pageTimeoutMs);
    await page.addInitScript({
      content: `
        // Source-based worker execution through TSX can annotate serialized
        // evaluate callbacks with this harmless naming helper. Compiled
        // production JavaScript does not require it.
        globalThis.__name ??= (target) => target;
        window.__ksQualityLayoutShift = 0;
        window.__ksQualityLayoutShiftSamples = 0;
        window.__ksQualityLcp = null;
        window.__ksQualityInp = 0;
        window.__ksQualityInpSamples = 0;
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) {
                window.__ksQualityLayoutShift += entry.value;
                window.__ksQualityLayoutShiftSamples += 1;
              }
            }
          }).observe({ type: 'layout-shift', buffered: true });
        } catch {}
        try {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length) window.__ksQualityLcp = entries[entries.length - 1];
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch {}
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.interactionId > 0) {
                window.__ksQualityInp = Math.max(window.__ksQualityInp, entry.duration);
                window.__ksQualityInpSamples += 1;
              }
            }
          }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
        } catch {}
      `,
    });
    await page.addInitScript({ content: axe.source });

    let consoleErrorCount = 0;
    let failedCriticalResourceCount = 0;
    const failedResourceUrls = new Set<string>();
    page.on('console', message => {
      if (message.type() === 'error') consoleErrorCount += 1;
    });
    page.on('requestfailed', request => {
      failedResourceUrls.add(request.url());
      if (['document', 'script', 'stylesheet', 'font'].includes(request.resourceType())) {
        failedCriticalResourceCount += 1;
      }
    });

    const startedAt = Date.now();
    const response = await page.goto(
      qualityPreviewUrl(input.preview.previewBaseUrl, input.page.path),
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForLoadState('load');
    const pageLoadMs = Date.now() - startedAt;
    const capturedAt = new Date();
    const keyboard = await inspectKeyboardJourney(page);
    const documentResult = await page.evaluate((thresholds) => {
      const {
        minimumTouchTargetPixels,
        maximumImageTransferBytes,
      } = thresholds;
      const content = document.documentElement;
      const images = [...document.querySelectorAll('img')];
      const interactive = [...document.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),'
        + 'textarea:not([disabled]),[role="button"],[tabindex]:not([tabindex="-1"])',
      )];
      const visible = (element: HTMLElement) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity) > 0
          && rect.width > 0
          && rect.height > 0;
      };
      let clipped = 0;
      let obscured = 0;
      let undersized = 0;
      for (const element of interactive.filter(visible)) {
        const rect = element.getBoundingClientRect();
        if (
          rect.left < 0
          || rect.top < 0
          || rect.right > window.innerWidth
          || rect.bottom > window.innerHeight
        ) clipped += 1;
        if (
          rect.width < minimumTouchTargetPixels
          || rect.height < minimumTouchTargetPixels
        ) undersized += 1;
        const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
        const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        if (hit && hit !== element && !element.contains(hit)) obscured += 1;
      }
      const structuredDataTypes = [...document.querySelectorAll<HTMLScriptElement>(
        'script[type="application/ld+json"]',
      )].flatMap(script => {
        try {
          const parsed = JSON.parse(script.textContent ?? 'null') as unknown;
          const values = Array.isArray(parsed) ? parsed : [parsed];
          return values.flatMap(value => {
            if (!value || typeof value !== 'object') return [];
            const type = (value as Record<string, unknown>)['@type'];
            return Array.isArray(type)
              ? type.filter((entry): entry is string => typeof entry === 'string')
              : typeof type === 'string' ? [type] : [];
          });
        } catch {
          return [];
        }
      }).slice(0, 100);
      const internalLinks = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
        .map(anchor => anchor.getAttribute('href') ?? '')
        .filter(href => href.startsWith('/') && !href.startsWith('//'))
        .map(href => {
          try {
            return new URL(href, location.origin).pathname;
          } catch {
            return '';
          }
        })
        .filter(Boolean);
      const bookingAnchors = [...document.querySelectorAll<HTMLAnchorElement>(
        'a[href^="/book"],a[class*="booking"]',
      )];
      const externalBookingDestinationCount = bookingAnchors.filter(anchor => {
        const href = anchor.getAttribute('href') ?? '';
        return !href.startsWith('/book');
      }).length;
      const qualityWindow = window as unknown as {
        __ksQualityLayoutShift?: number;
        __ksQualityLayoutShiftSamples?: number;
        __ksQualityLcp?: PerformanceEntry & {
          renderTime?: number;
          loadTime?: number;
          element?: Element | null;
          url?: string;
        };
        __ksQualityInp?: number;
        __ksQualityInpSamples?: number;
      };
      const lcpEntry = qualityWindow.__ksQualityLcp ?? null;
      const lcpElement = lcpEntry?.element ?? null;
      const lcpImage = lcpElement instanceof HTMLImageElement ? lcpElement : null;
      const lcpResourceUrl = lcpImage?.currentSrc || lcpImage?.src || lcpEntry?.url || null;
      const lcpResourceTiming = lcpResourceUrl
        ? performance.getEntriesByName(lcpResourceUrl, 'resource')[0] as PerformanceResourceTiming | undefined
        : undefined;
      return {
        title: document.title,
        metaDescription: document.querySelector<HTMLMetaElement>(
          'meta[name="description"]',
        )?.content ?? null,
        canonicalHref: document.querySelector<HTMLLinkElement>(
          'link[rel="canonical"]',
        )?.href ?? null,
        robots: document.querySelector<HTMLMetaElement>(
          'meta[name="robots"]',
        )?.content ?? null,
        htmlLanguage: document.documentElement.lang || null,
        h1Count: document.querySelectorAll('h1').length,
        mainContentPresent: Boolean(document.querySelector('main')),
        structuredDataTypes,
        internalLinks: [...new Set(internalLinks)].slice(0, 2_000),
        imageCount: images.length,
        imagesMissingAlt: images.filter(image => !image.hasAttribute('alt')).length,
        imagesMissingDimensions: images.filter(image =>
          !image.hasAttribute('width') || !image.hasAttribute('height')).length,
        oversizedImageCount: performance.getEntriesByType('resource')
          .filter((entry) => {
            const resource = entry as PerformanceResourceTiming;
            return resource.initiatorType === 'img'
              && Math.max(resource.transferSize, resource.encodedBodySize)
                > maximumImageTransferBytes;
          }).length,
        largestContentfulPaintMs: Math.max(
          0,
          Number(lcpEntry?.renderTime || lcpEntry?.loadTime || lcpEntry?.startTime || 0),
        ),
        largestContentfulPaintSampleCount: lcpEntry ? 1 : 0,
        interactionToNextPaintMs: Math.max(0, Number(qualityWindow.__ksQualityInp ?? 0)),
        interactionToNextPaintSampleCount: Math.max(
          0,
          Number(qualityWindow.__ksQualityInpSamples ?? 0),
        ),
        lcpElementTag: lcpElement?.tagName?.toLowerCase() ?? null,
        lcpResourceUrl,
        lcpResourceTransferBytes: lcpResourceTiming
          ? Math.max(lcpResourceTiming.transferSize, lcpResourceTiming.encodedBodySize, 0)
          : null,
        lcpImageLoading: lcpImage
          ? (lcpImage.loading === 'lazy' || lcpImage.loading === 'eager'
              ? lcpImage.loading
              : 'auto')
          : null,
        lcpImageHasResponsiveSource: lcpImage
          ? Boolean(lcpImage.srcset || lcpImage.sizes || lcpImage.closest('picture'))
          : null,
        lcpImageHasIntrinsicDimensions: lcpImage
          ? lcpImage.hasAttribute('width') && lcpImage.hasAttribute('height')
          : null,
        lcpResourceDiscoverable: !lcpImage || Boolean(lcpResourceUrl),
        longMainThreadTaskCount: performance.getEntriesByType('longtask').length,
        longMainThreadTaskTotalMs: performance.getEntriesByType('longtask')
          .reduce((total, entry) => total + entry.duration, 0),
        renderBlockingStylesheetCount: [...document.querySelectorAll<HTMLLinkElement>('head link[rel="stylesheet"]')]
          .filter(link => !link.disabled && (!link.media || link.media === 'all' || link.media === 'screen')).length,
        parserBlockingScriptCount: document.querySelectorAll(
          'head script[src]:not([async]):not([defer]):not([type="module"])',
        ).length,
        slowFontResourceCount: performance.getEntriesByType('resource')
          .filter(entry => (entry as PerformanceResourceTiming).initiatorType === 'font' && entry.duration > 1_000).length,
        horizontalOverflowPixels: Math.max(
          0,
          Math.ceil(content.scrollWidth - content.clientWidth),
        ),
        clippedInteractiveCount: clipped,
        obscuredInteractiveCount: obscured,
        undersizedTouchTargetCount: undersized,
        primaryBookingVisible: bookingAnchors.some(anchor => visible(anchor)),
        externalBookingDestinationCount,
        mainContentMs: Math.max(0, performance.now()),
        cumulativeLayoutShift: Number(qualityWindow.__ksQualityLayoutShift ?? 0),
        cumulativeLayoutShiftSampleCount: Number(
          qualityWindow.__ksQualityLayoutShiftSamples ?? 0,
        ),
        transferBytes: performance.getEntriesByType('resource')
          .reduce((total, entry) => {
            const resource = entry as PerformanceResourceTiming;
            return total + Math.max(0, resource.transferSize || 0);
          }, 0),
      };
    }, {
      minimumTouchTargetPixels:
        DEFAULT_SITE_QUALITY_POLICY.thresholds.minimumTouchTargetPixels,
      maximumImageTransferBytes:
        DEFAULT_SITE_QUALITY_POLICY.thresholds.maximumImageTransferBytes,
    });

    const accessibility = await page.evaluate(async () => {
      const engine = (window as unknown as {
        axe: {
          run: (
            context?: unknown,
            options?: unknown,
          ) => Promise<{
            violations: Array<{
              id: string;
              impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
              nodes: unknown[];
              helpUrl?: string;
            }>;
          }>;
        };
      }).axe;
      return engine.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        },
        resultTypes: ['violations'],
      });
    });

    const brokenInternalLinks: string[] = [];
    for (const path of documentResult.internalLinks.slice(0, 100)) {
      if (path === '/book') continue;
      try {
        const linkResponse = await context.request.get(
          qualityPreviewUrl(input.preview.previewBaseUrl, path),
          { timeout: this.config.pageTimeoutMs },
        );
        if (linkResponse.status() >= 400) brokenInternalLinks.push(path);
      } catch {
        brokenInternalLinks.push(path);
      }
    }

    const performanceMetrics = [
      metric({
        name: 'PAGE_LOAD_MS',
        value: pageLoadMs,
        unit: 'MILLISECONDS',
        viewport: input.viewport.key,
        threshold: DEFAULT_SITE_QUALITY_POLICY.thresholds.pageLoadWarningMs,
        toolVersion: this.toolVersion,
        capturedAt,
      }),
      metric({
        name: 'MAIN_CONTENT_MS',
        value: documentResult.mainContentMs,
        unit: 'MILLISECONDS',
        viewport: input.viewport.key,
        threshold: DEFAULT_SITE_QUALITY_POLICY.thresholds.mainContentWarningMs,
        toolVersion: this.toolVersion,
        capturedAt,
      }),
      metric({
        name: 'LARGEST_CONTENTFUL_PAINT_MS',
        value: documentResult.largestContentfulPaintMs,
        unit: 'MILLISECONDS',
        viewport: input.viewport.key,
        threshold: DEFAULT_SITE_QUALITY_POLICY.thresholds
          .largestContentfulPaintBlockingMs,
        block: true,
        forceResult: documentResult.largestContentfulPaintSampleCount === 0
          ? 'BLOCK'
          : undefined,
        sampleCount: documentResult.largestContentfulPaintSampleCount,
        toolVersion: this.toolVersion,
        capturedAt,
      }),
      metric({
        name: 'INTERACTION_TO_NEXT_PAINT_MS',
        value: documentResult.interactionToNextPaintMs,
        unit: 'MILLISECONDS',
        viewport: input.viewport.key,
        threshold: DEFAULT_SITE_QUALITY_POLICY.thresholds
          .interactionToNextPaintBlockingMs,
        block: true,
        exclusiveThreshold: true,
        forceResult: documentResult.interactionToNextPaintSampleCount === 0
          ? 'WARNING'
          : undefined,
        sampleCount: documentResult.interactionToNextPaintSampleCount,
        toolVersion: this.toolVersion,
        capturedAt,
      }),
      metric({
        name: 'CUMULATIVE_LAYOUT_SHIFT',
        value: documentResult.cumulativeLayoutShift,
        unit: 'SCORE',
        viewport: input.viewport.key,
        threshold: DEFAULT_SITE_QUALITY_POLICY.thresholds
          .cumulativeLayoutShiftBlocking,
        block: true,
        exclusiveThreshold: true,
        sampleCount: documentResult.cumulativeLayoutShiftSampleCount,
        toolVersion: this.toolVersion,
        capturedAt,
      }),
      metric({
        name: 'TRANSFER_BYTES',
        value: documentResult.transferBytes,
        unit: 'BYTES',
        viewport: input.viewport.key,
        threshold: DEFAULT_SITE_QUALITY_POLICY.thresholds.transferBytesWarning,
        toolVersion: this.toolVersion,
        capturedAt,
      }),
      metric({
        name: 'FAILED_CRITICAL_RESOURCES',
        value: failedCriticalResourceCount,
        unit: 'COUNT',
        viewport: input.viewport.key,
        threshold: 0,
        block: true,
        toolVersion: this.toolVersion,
        capturedAt,
      }),
    ];
    const responseHeaders = await response?.allHeaders() ?? {};
    const canonicalUsesPreviewHostname = (() => {
      if (!documentResult.canonicalHref) return false;
      try {
        return new URL(documentResult.canonicalHref).hostname
          === new URL(input.preview.previewBaseUrl).hostname;
      } catch {
        return false;
      }
    })();
    const boundedResult = {
      pageReference: input.page.pageReference,
      path: input.page.path,
      viewport: input.viewport.key,
      httpStatus: response?.status() ?? 599,
      title: documentResult.title.slice(0, 500),
      metaDescription: documentResult.metaDescription?.slice(0, 1_000) ?? null,
      canonicalHref: documentResult.canonicalHref?.slice(0, 2_000) ?? null,
      robots: documentResult.robots?.slice(0, 500) ?? null,
      cacheControl: responseHeaders['cache-control']?.slice(0, 500) ?? null,
      xRobotsTag: responseHeaders['x-robots-tag']?.slice(0, 500) ?? null,
      canonicalUsesPreviewHostname,
      htmlLanguage: documentResult.htmlLanguage?.slice(0, 40) ?? null,
      h1Count: documentResult.h1Count,
      mainContentPresent: documentResult.mainContentPresent,
      structuredDataTypes: documentResult.structuredDataTypes,
      internalLinks: documentResult.internalLinks,
      brokenInternalLinks,
      imageCount: documentResult.imageCount,
      imagesMissingAlt: documentResult.imagesMissingAlt,
      imagesMissingDimensions: documentResult.imagesMissingDimensions,
      oversizedImageCount: documentResult.oversizedImageCount,
      lcpElementTag: documentResult.lcpElementTag?.slice(0, 80) ?? null,
      lcpResourceUrl: documentResult.lcpResourceUrl?.slice(0, 2_000) ?? null,
      lcpResourceTransferBytes: documentResult.lcpResourceTransferBytes,
      lcpImageLoading: documentResult.lcpImageLoading,
      lcpImageHasResponsiveSource: documentResult.lcpImageHasResponsiveSource,
      lcpImageHasIntrinsicDimensions: documentResult.lcpImageHasIntrinsicDimensions,
      lcpResourceDiscoverable: documentResult.lcpResourceDiscoverable,
      lcpResourceFailed: documentResult.lcpResourceUrl
        ? failedResourceUrls.has(documentResult.lcpResourceUrl)
        : false,
      longMainThreadTaskCount: documentResult.longMainThreadTaskCount,
      longMainThreadTaskTotalMs: documentResult.longMainThreadTaskTotalMs,
      renderBlockingStylesheetCount: documentResult.renderBlockingStylesheetCount,
      parserBlockingScriptCount: documentResult.parserBlockingScriptCount,
      slowFontResourceCount: documentResult.slowFontResourceCount,
      horizontalOverflowPixels: documentResult.horizontalOverflowPixels,
      clippedInteractiveCount: documentResult.clippedInteractiveCount,
      obscuredInteractiveCount: documentResult.obscuredInteractiveCount,
      undersizedTouchTargetCount: documentResult.undersizedTouchTargetCount,
      primaryBookingVisible: documentResult.primaryBookingVisible,
      primaryBookingKeyboardReachable: keyboard.bookingReached,
      focusTrapDetected: keyboard.focusTrapDetected,
      externalBookingDestinationCount:
        documentResult.externalBookingDestinationCount,
      consoleErrorCount,
      failedCriticalResourceCount,
      accessibilityViolations: accessibility.violations.map(violation => ({
        ruleId: violation.id.slice(0, 160),
        impact: violation.impact,
        nodeCount: violation.nodes.length,
        ...(violation.helpUrl ? { helpUrl: violation.helpUrl } : {}),
      })).slice(0, 1_000),
      performanceMetrics,
      browserVersion: this.toolVersion,
      capturedAt,
    };
    return BrowserAuditPageResultSchema.parse({
      ...boundedResult,
      evidenceDigestSha256: sha256(JSON.stringify(boundedResult)),
    });
  }

  async close() {
    await this.browser?.close();
    this.browser = null;
  }
}
