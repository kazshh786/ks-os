export const BARE_BEAUTY_PRIMARY_HOSTNAME = 'barebeautykeighley.co.uk';
export const BARE_BEAUTY_WWW_HOSTNAME = `www.${BARE_BEAUTY_PRIMARY_HOSTNAME}`;
export const BARE_BEAUTY_LEGACY_HOSTNAME = 'barebeautykeighley.kasimshah.com';

function requestHostname(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwarded || request.headers.get('host') || new URL(request.url).host;
  return host.toLowerCase().replace(/:\d+$/, '');
}

function redirectToPrimary(request: Request): Response {
  const url = new URL(request.url);
  url.protocol = 'https:';
  url.hostname = BARE_BEAUTY_PRIMARY_HOSTNAME;
  url.port = '';
  return Response.redirect(url, 308);
}

function remapToLegacyHost(request: Request): Request {
  const url = new URL(request.url);
  url.protocol = 'https:';
  url.hostname = BARE_BEAUTY_LEGACY_HOSTNAME;
  url.port = '';

  const headers = new Headers(request.headers);
  headers.set('host', BARE_BEAUTY_LEGACY_HOSTNAME);
  headers.set('x-forwarded-host', BARE_BEAUTY_LEGACY_HOSTNAME);

  return new Request(url, {
    method: request.method,
    headers,
    redirect: request.redirect,
    signal: request.signal,
  });
}

async function rewriteCanonicalHost(response: Response): Promise<Response> {
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  const textual = contentType.includes('text/html')
    || contentType.includes('application/xml')
    || contentType.includes('text/xml')
    || contentType.includes('text/plain');
  if (!textual) return response;

  const body = (await response.text()).replaceAll(
    BARE_BEAUTY_LEGACY_HOSTNAME,
    BARE_BEAUTY_PRIMARY_HOSTNAME,
  );
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function maybeHandleBareBeautyProductionDomain(
  request: Request,
  handler: (remappedRequest: Request) => Promise<Response | null>,
): Promise<Response | null> {
  const hostname = requestHostname(request);
  if (hostname === BARE_BEAUTY_WWW_HOSTNAME) return redirectToPrimary(request);
  if (hostname !== BARE_BEAUTY_PRIMARY_HOSTNAME) return null;

  const response = await handler(remapToLegacyHost(request));
  return response ? rewriteCanonicalHost(response) : null;
}
