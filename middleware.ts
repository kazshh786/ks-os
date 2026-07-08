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
  let customDomainLookup = '';

  // 1. Handle development subdomains on localhost
  if (hostname.includes('.localhost:')) {
    subdomain = hostname.split('.localhost:')[0];
  } else if (hostname.includes('localhost:')) {
    subdomain = '';
  } else {
    // 2. Production: Check if it ends with a known root domain (e.g. salon.kasimshah.com)
    const rootDomain = rootDomains.find((d) => hostname.endsWith(d));
    
    if (rootDomain) {
      if (hostname !== rootDomain) {
        subdomain = hostname.replace(`.${rootDomain}`, '');
      }
    } else {
      // 3. Custom Domain Strategy: If the host starts with 'admin.', e.g., admin.salonname.com
      if (hostname.toLowerCase().startsWith('admin.')) {
        isCustomDomain = true;
        customDomainLookup = hostname.replace(/^admin\./i, ''); // extract 'salonname.com'
      } else {
        // If it's a root custom domain (salonname.com) pointed to us, we can direct it to the booking widget
        isCustomDomain = true;
        customDomainLookup = hostname;
      }
    }
  }

  // Query database matching custom_domain (the stripped root domain)
  if (isCustomDomain && customDomainLookup) {
    try {
      const cleanLookup = customDomainLookup.toLowerCase();
      const res = await fetch(
        `${supabaseUrl}/rest/v1/tenants?custom_domain=eq.${encodeURIComponent(cleanLookup)}&select=subdomain`,
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
          
          // If the customer visits the root custom domain directly (e.g. salonname.com/bookings mapping to us),
          // or if they go to admin.salonname.com/book, let it route to the booking subpath page.
          // Otherwise, if they visit admin.salonname.com, route them to the dashboard portal.
          if (!hostname.toLowerCase().startsWith('admin.') && url.pathname === '/') {
            // Rewrite root visits on their custom website mapping to book directly
            const rewritePath = `/_tenants/${subdomain}/book`;
            return NextResponse.rewrite(new URL(rewritePath, req.url));
          }
        }
      }
    } catch (err) {
      console.error('Custom domain lookup failed:', err);
    }
  }

  // If there is no subdomain resolved, or if it resolves to 'www' or 'app', route to primary root landing/admin portal
  if (!subdomain || subdomain === 'www' || subdomain === 'app') {
    return NextResponse.next();
  }

  // Rewrite the request to the dynamic tenant folder
  const path = url.pathname;
  const searchParams = url.searchParams.toString();
  const rewritePath = `/_tenants/${subdomain}${path}${searchParams ? `?${searchParams}` : ''}`;

  return NextResponse.rewrite(new URL(rewritePath, req.url));
}
