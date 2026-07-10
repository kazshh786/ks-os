import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  addDomainToVercel,
  removeDomainFromVercel,
  addCloudflareCname,
  removeCloudflareCname,
} from '@/utils/domain-service';

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({
        error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured.'
      }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // 1. Authenticate caller (Master Admin only)
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized: Missing session token.' }, { status: 401 });
    }

    const { data: { user }, error: verifyErr } = await supabaseAdmin.auth.getUser(token);
    if (verifyErr || !user || user.email !== 'kasimashah@gmail.com') {
      return NextResponse.json({ error: 'Unauthorized: Access restricted to Master Admin.' }, { status: 403 });
    }

    // 2. Parse parameters
    const { tenantId, customDomain } = await req.json();

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenantId parameter.' }, { status: 400 });
    }

    // 3. Fetch current tenant configuration
    const { data: tenant, error: fetchErr } = await supabaseAdmin
      .from('tenants')
      .select('subdomain, custom_domain')
      .eq('id', tenantId)
      .single();

    if (fetchErr || !tenant) {
      return NextResponse.json({ error: `Tenant not found: ${fetchErr?.message || ''}` }, { status: 404 });
    }

    const oldCustomDomain = tenant.custom_domain;
    const subdomain = tenant.subdomain;
    const newCustomDomain = customDomain ? customDomain.trim().toLowerCase() : null;

    // If new and old domains are identical, skip configuration, return existing config
    if (newCustomDomain === oldCustomDomain) {
      // Fetch status anyway to show to the admin
      let vercelInfo = null;
      if (newCustomDomain) {
        try {
          vercelInfo = await addDomainToVercel(newCustomDomain);
        } catch (e) {
          console.warn('Failed to query current verification details:', e);
        }
      }
      return NextResponse.json({
        success: true,
        message: 'No domain changes requested.',
        verification: vercelInfo?.verification || [],
        verified: vercelInfo?.verified ?? true,
      });
    }

    // 4. Update the Database record (optimistic lock / transaction starts)
    const { error: updateDbErr } = await supabaseAdmin
      .from('tenants')
      .update({ custom_domain: newCustomDomain })
      .eq('id', tenantId);

    if (updateDbErr) {
      throw new Error(`Database update failed: ${updateDbErr.message}`);
    }

    // Keep track of completed operations for rollback
    let vercelDomainAdded: string | null = null;
    let cloudflareCnameAdded: string | null = null;
    let vercelVerificationResult: any = null;

    try {
      const testDomain = `${subdomain.toLowerCase()}.kasimshah.com`;

      if (newCustomDomain) {
        // CASE A: Setting custom domain (e.g. salon1.com)
        console.log(`Setting custom domain ${newCustomDomain} for tenant ${subdomain}`);

        // Add the custom domain to Vercel
        const vercelRes = await addDomainToVercel(newCustomDomain);
        vercelDomainAdded = newCustomDomain;
        vercelVerificationResult = vercelRes;

        // Clean up testing subdomain from Vercel
        await removeDomainFromVercel(testDomain);

        // Clean up testing subdomain CNAME from Cloudflare
        await removeCloudflareCname(subdomain);

        // Clean up any previously assigned custom domain from Vercel if different
        if (oldCustomDomain && oldCustomDomain !== newCustomDomain) {
          await removeDomainFromVercel(oldCustomDomain);
        }
      } else {
        // CASE B: Reverting to default testing subdomain (newCustomDomain is null)
        console.log(`Reverting custom domain mapping to default subdomain for tenant ${subdomain}`);

        // Add testing subdomain back to Vercel
        const vercelRes = await addDomainToVercel(testDomain);
        vercelDomainAdded = testDomain;
        vercelVerificationResult = vercelRes;

        // Re-add Cloudflare CNAME record for testing subdomain
        await addCloudflareCname(subdomain);
        cloudflareCnameAdded = subdomain;

        // Remove the old custom domain from Vercel
        if (oldCustomDomain) {
          await removeDomainFromVercel(oldCustomDomain);
        }
      }
    } catch (operationErr: any) {
      console.error('Error during Vercel/Cloudflare orchestration. Rolling back changes...', operationErr);

      // 5. Transactional Rollback
      // Rollback Vercel additions
      if (vercelDomainAdded) {
        try {
          await removeDomainFromVercel(vercelDomainAdded);
        } catch (vErr) {
          console.error(`Rollback: Failed to remove domain ${vercelDomainAdded} from Vercel:`, vErr);
        }
      }

      // Rollback Cloudflare additions
      if (cloudflareCnameAdded) {
        try {
          await removeCloudflareCname(cloudflareCnameAdded);
        } catch (cfErr) {
          console.error(`Rollback: Failed to remove Cloudflare CNAME for ${cloudflareCnameAdded}:`, cfErr);
        }
      }

      // Rollback database update
      try {
        await supabaseAdmin
          .from('tenants')
          .update({ custom_domain: oldCustomDomain })
          .eq('id', tenantId);
      } catch (dbErr) {
        console.error(`Rollback: Failed to revert database custom_domain to ${oldCustomDomain}:`, dbErr);
      }

      throw new Error(`Domain update failed: ${operationErr.message}`);
    }

    return NextResponse.json({
      success: true,
      verified: vercelVerificationResult?.verified ?? true,
      verification: vercelVerificationResult?.verification || [],
    });
  } catch (err: any) {
    console.error('Domain update endpoint error:', err);
    return NextResponse.json({ error: err.message || 'Domain configuration failed.' }, { status: 500 });
  }
}
