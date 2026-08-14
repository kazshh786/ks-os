const API_PREFIX = '/api';
const HTML_CACHE_CONTROL = 'no-store, no-cache, must-revalidate, max-age=0';

function isApiRequest(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

function isHtmlNavigation(request: Request, pathname: string): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const accept = request.headers.get('accept')?.toLowerCase() ?? '';
  const finalSegment = pathname.split('/').filter(Boolean).at(-1) ?? '';
  const hasFileExtension = finalSegment.includes('.');

  return accept.includes('text/html') || !hasFileExtension;
}

function createFreshShellRequest(request: Request): Request {
  const headers = new Headers(request.headers);

  headers.delete('if-none-match');
  headers.delete('if-modified-since');
  headers.set('cache-control', 'no-cache');
  headers.set('pragma', 'no-cache');

  return new Request(request, { headers });
}

function createFreshShellResponse(response: Response): Response {
  const headers = new Headers(response.headers);

  headers.set('cache-control', HTML_CACHE_CONTROL);
  headers.set('cdn-cache-control', 'no-store');
  headers.set('cloudflare-cdn-cache-control', 'no-store');
  headers.set('expires', '0');
  headers.set('pragma', 'no-cache');
  headers.set('x-ks-os-shell', 'fresh');
  headers.delete('etag');
  headers.delete('last-modified');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetchAsset(request: Request, env: Cloudflare.Env, pathname: string): Promise<Response> {
  const expectsHtml = isHtmlNavigation(request, pathname);
  const assetResponse = await env.ASSETS.fetch(expectsHtml ? createFreshShellRequest(request) : request);
  const contentType = assetResponse.headers.get('content-type')?.toLowerCase() ?? '';

  if (!expectsHtml || !contentType.includes('text/html')) {
    return assetResponse;
  }

  return createFreshShellResponse(assetResponse);
}

function getApiOrigin(value: string): URL {
  const origin = new URL(value);

  if (origin.protocol !== 'https:') {
    throw new Error('API_ORIGIN must use HTTPS.');
  }

  return origin;
}

function createUpstreamRequest(request: Request, apiOrigin: URL): Request {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, apiOrigin);
  const headers = new Headers(request.headers);
  const clientIp = request.headers.get('CF-Connecting-IP');

  headers.delete('host');
  headers.set('x-forwarded-host', incomingUrl.host);
  headers.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''));
  headers.set('x-forwarded-port', incomingUrl.port || (incomingUrl.protocol === 'https:' ? '443' : '80'));
  headers.set('x-ks-edge-provider', 'cloudflare');

  if (clientIp) {
    headers.set('x-forwarded-for', clientIp);
  }

  return new Request(upstreamUrl, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);

    if (!isApiRequest(url.pathname)) {
      return fetchAsset(request, env, url.pathname);
    }

    try {
      const upstreamRequest = createUpstreamRequest(request, getApiOrigin(env.API_ORIGIN));
      const upstreamResponse = await fetch(upstreamRequest);

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: upstreamResponse.headers,
      });
    } catch (error) {
      console.error('Cloudflare API proxy failed', {
        message: error instanceof Error ? error.message : String(error),
        path: url.pathname,
        rayId: request.headers.get('CF-Ray'),
      });

      return Response.json(
        {
          error: 'API_UNAVAILABLE',
          message: 'The application service is temporarily unavailable.',
        },
        {
          status: 502,
          headers: {
            'cache-control': 'no-store',
          },
        },
      );
    }
  },
};
