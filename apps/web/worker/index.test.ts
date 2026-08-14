import { describe, expect, it, vi } from 'vitest';
import worker from './index';

function createEnv(response: Response) {
  const assetFetch = vi.fn(async (_request: Request) => response);
  const env = {
    API_ORIGIN: 'https://api.kasimshah.com',
    ASSETS: { fetch: assetFetch },
  } as unknown as Cloudflare.Env;

  return { env, assetFetch };
}

describe('Cloudflare web worker', () => {
  it('serves HTML navigation with cache disabled and validators removed', async () => {
    const { env, assetFetch } = createEnv(
      new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=UTF-8',
          etag: 'old-shell',
        },
      }),
    );

    const response = await worker.fetch(
      new Request('https://kasimshah.com/packages', {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'if-none-match': 'old-shell',
          'if-modified-since': 'Tue, 04 Aug 2026 10:00:00 GMT',
        },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate, max-age=0');
    expect(response.headers.get('cloudflare-cdn-cache-control')).toBe('no-store');
    expect(response.headers.get('etag')).toBeNull();
    expect(response.headers.get('x-ks-os-shell')).toBe('fresh');

    const forwardedRequest = assetFetch.mock.calls[0]?.[0] as Request;
    expect(forwardedRequest.headers.get('if-none-match')).toBeNull();
    expect(forwardedRequest.headers.get('if-modified-since')).toBeNull();
    expect(forwardedRequest.headers.get('cache-control')).toBe('no-cache');
  });

  it('does not alter non-HTML asset responses', async () => {
    const { env } = createEnv(
      new Response('console.log("asset")', {
        headers: {
          'content-type': 'application/javascript',
          'cache-control': 'public, max-age=31536000, immutable',
          etag: 'asset-hash',
        },
      }),
    );

    const response = await worker.fetch(
      new Request('https://kasimshah.com/manifest.webmanifest', {
        headers: { accept: 'application/manifest+json' },
      }),
      env,
    );

    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('etag')).toBe('asset-hash');
    expect(response.headers.get('x-ks-os-shell')).toBeNull();
  });
});
