import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes, unless tenant-specific subdomains are required for APIs)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - _static (files in public directory)
     * - favicon.ico, sitemap.xml, robots.txt, etc.
     */
    '/((?!api|_next/static|_next/image|_static|_vercel|[\\w-]+\\.\\w+).*)',
  ],
};

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = req.headers.get('host') || '';

  // Define hostnames to ignore (root domains)
  const rootDomains = ['kasimshah.com', 'growthos.com', 'localhost:3000', 'localhost:3001'];
  
  // Extract subdomain
  let subdomain = '';
  
  // Handle development environments and production environments
  if (hostname.includes('.localhost:')) {
    // e.g. tenant.localhost:3000
    subdomain = hostname.split('.localhost:')[0];
  } else if (hostname.includes('localhost:')) {
    // e.g. localhost:3000 (no subdomain)
    subdomain = '';
  } else {
    // Production: extract subdomain from hostname (e.g., salon.growthos.com)
    const rootDomain = rootDomains.find((d) => hostname.endsWith(d));
    if (rootDomain && hostname !== rootDomain) {
      subdomain = hostname.replace(`.${rootDomain}`, '');
    }
  }

  // If there is no subdomain, or if the subdomain is 'www' or 'app', treat as root website (landing page, global login, etc.)
  if (!subdomain || subdomain === 'www' || subdomain === 'app') {
    return NextResponse.next();
  }

  // Rewrite the request to the dynamic tenant folder
  // Next.js App Router will map this to: app/_tenants/[subdomain]/[...path]
  const path = url.pathname;
  const searchParams = url.searchParams.toString();
  const rewritePath = `/_tenants/${subdomain}${path}${searchParams ? `?${searchParams}` : ''}`;

  return NextResponse.rewrite(new URL(rewritePath, req.url));
}
