import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - _static (files in public directory)
     * - favicon.ico, sitemap.xml, robots.txt, etc.
     */
    '/((?!api|_next/static|_next/image|_static|_vercel|[\\w-]+\\.\\w+).*)',
  ],
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = req.headers.get('host') || '';

  // Define hostnames to ignore (root domains)
  const rootDomains = ['kasimshah.com', 'growthos.com', 'localhost:3000', 'localhost:3001'];
  
  let subdomain = '';
  let isCustomDomain = false;
  
  // 1. Handle development environments (subdomains on localhost)
  if (hostname.includes('.localhost:')) {
    subdomain = hostname.split('.localhost:')[0];
  } else if (hostname.includes('localhost:')) {
    subdomain = '';
  } else {
    // 2. Production: Check if it ends with a known root domain (e.g. *.kasimshah.com)
    const rootDomain = rootDomains.find((d) => hostname.endsWith(d));
    if (rootDomain && hostname !== rootDomain) {
      subdomain = hostname.replace(`.${rootDomain}`, '');
    } else if (!rootDomain) {
      // 3. Custom Domain Mapping check (e.g. hairlounge.com)
      isCustomDomain = true;
    }
  }

  // If it's a custom domain, query Supabase PostgREST endpoint directly
  // Using native fetch instead of @supabase/supabase-js client prevents Edge Runtime build warnings
  if (isCustomDomain && hostname) {
    try {
      const cleanHost = hostname.toLowerCase();
      const res = await fetch(
        `${supabaseUrl}/rest/v1/tenants?custom_domain=eq.${encodeURIComponent(cleanHost)}&select=subdomain`,
        {
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`,
          },
          next: { revalidate: 300 } // Cache results for 5 minutes at edge
        }
      );

      if (res.ok) {
        const matchedTenants = await res.json();
        if (matchedTenants && matchedTenants.length > 0) {
          subdomain = matchedTenants[0].subdomain;
        }
      }
    } catch (err) {
      console.error('Custom domain lookup failed:', err);
    }
  }

  // If there is no subdomain, or if it resolves to 'www' or 'app', route to primary root landing/admin portal
  if (!subdomain || subdomain === 'www' || subdomain === 'app') {
    return NextResponse.next();
  }

  // Rewrite the request to the dynamic tenant folder
  const path = url.pathname;
  const searchParams = url.searchParams.toString();
  const rewritePath = `/_tenants/${subdomain}${path}${searchParams ? `?${searchParams}` : ''}`;

  return NextResponse.rewrite(new URL(rewritePath, req.url));
}
