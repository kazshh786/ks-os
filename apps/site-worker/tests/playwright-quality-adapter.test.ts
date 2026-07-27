import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { SITE_QUALITY_VIEWPORTS } from '@ks-os/site-quality';
import { ProductionPlaywrightQualityAdapter } from '../src/playwright-quality-adapter.js';

const PAGE_REFERENCE = '11111111-1111-4111-8111-111111111111';
const SITE_REFERENCE = '22222222-2222-4222-8222-222222222222';
const VERSION_REFERENCE = '33333333-3333-4333-8333-333333333333';
const RUN_REFERENCE = '44444444-4444-4444-8444-444444444444';
const DIGEST = 'a'.repeat(64);
const TOKEN = 'local-browser-fixture-quality-token';

test(
  'production Playwright adapter audits a bearer-gated local preview and closes cleanly',
  { timeout: 60_000 },
  async () => {
    let authorizedRequestCount = 0;
    const server = createServer((request, response) => {
      if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        response.writeHead(401, { 'content-type': 'text/plain' });
        response.end('Unauthorized');
        return;
      }
      authorizedRequestCount += 1;
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const renderedPath = requestUrl.searchParams.get('path') ?? '/';
      const canonicalPath = renderedPath === '/' ? '' : renderedPath;
      response.writeHead(200, {
        'cache-control': 'private, no-store, max-age=0',
        'content-type': 'text/html; charset=utf-8',
        'x-robots-tag': 'noindex, nofollow, noarchive',
      });
      response.end(`<!doctype html>
        <html lang="en-GB">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Local quality fixture</title>
            <meta name="description" content="A deterministic local quality fixture.">
            <meta name="robots" content="noindex,nofollow,noarchive">
            <link rel="canonical" href="https://public.example.test${canonicalPath}">
            <script type="application/ld+json">
              {"@context":"https://schema.org","@type":"LocalBusiness","name":"Fixture"}
            </script>
            <style>
              body { background: #fff; color: #111; font: 16px/1.5 sans-serif; margin: 0; }
              main { margin: auto; max-width: 64rem; padding: 2rem; }
              a { color: #0645ad; display: inline-block; margin: .25rem; min-height: 24px; padding: .5rem; }
              a:focus { outline: 3px solid #111; outline-offset: 2px; }
            </style>
          </head>
          <body>
            <main id="main">
              <h1>Quality fixture</h1>
              <p>The browser audit remains entirely local and deterministic.</p>
              <a class="booking" href="/book">Book now</a>
              <a href="/services">Services</a>
              <img alt="A placeholder fixture" width="48" height="48"
                src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3C/svg%3E">
            </main>
          </body>
        </html>`);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const adapter = new ProductionPlaywrightQualityAdapter({
      pageTimeoutMs: 20_000,
    });
    try {
      const result = await adapter.auditPage({
        preview: {
          qualityRunReference: RUN_REFERENCE,
          siteReference: SITE_REFERENCE,
          versionReference: VERSION_REFERENCE,
          contentDigestSha256: DIGEST,
          previewBaseUrl: `http://127.0.0.1:${address.port}/preview`,
          bearerToken: TOKEN,
          expiresAt: new Date(Date.now() + 60_000),
        },
        page: {
          pageReference: PAGE_REFERENCE,
          path: '/',
        },
        viewport: SITE_QUALITY_VIEWPORTS[0],
        signal: new AbortController().signal,
      });

      assert.equal(result.httpStatus, 200);
      assert.equal(result.viewport, 'SMALL_MOBILE');
      assert.equal(result.canonicalUsesPreviewHostname, false);
      assert.match(result.cacheControl ?? '', /no-store/);
      assert.match(result.xRobotsTag ?? '', /noindex/);
      assert.equal(result.mainContentPresent, true);
      assert.equal(result.h1Count, 1);
      assert.equal(result.primaryBookingVisible, true);
      assert.equal(result.primaryBookingKeyboardReachable, true);
      assert.deepEqual(result.brokenInternalLinks, []);
      assert.ok(result.structuredDataTypes.includes('LocalBusiness'));
      assert.equal(result.browserVersion, 'PLAYWRIGHT_1_62_AXE_4_12_1');
      assert.match(result.evidenceDigestSha256, /^[a-f0-9]{64}$/);
      assert.ok(authorizedRequestCount >= 2);
    } finally {
      await adapter.close();
      await adapter.close();
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  },
);
