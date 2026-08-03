const API_PREFIX = '/api';

function isApiRequest(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
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
      return env.ASSETS.fetch(request);
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
