import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { removeDomainFromVercel, removeCloudflareCname } from '@/utils/domain-service';

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ 
        error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured on this machine.' 
      }, { status: 500 });
    }

    // Initialize Supabase Admin Client dynamically
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // 1. Authenticate caller session token (must be Master Admin: kasimashah@gmail.com)
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized: Missing session token.' }, { status: 401 });
    }

    const { data: { user }, error: verifyErr } = await supabaseAdmin.auth.getUser(token);
    if (verifyErr || !user || user.email !== 'kasimashah@gmail.com') {
      return NextResponse.json({ error: 'Unauthorized: Access restricted to Master Admin.' }, { status: 403 });
    }

    // 2. Parse tenant details to delete
    const { tenantId } = await req.json();
    if (!tenantId) {
      return NextResponse.json({ error: 'Missing required tenant ID parameter.' }, { status: 400 });
    }

    console.log(`Starting automated teardown for tenant ID: ${tenantId}`);

    // 3. Fetch tenant record to get subdomain
    const { data: tenant, error: tenantQueryErr } = await supabaseAdmin
      .from('tenants')
      .select('name, subdomain')
      .eq('id', tenantId)
      .single();

    if (tenantQueryErr || !tenant) {
      throw new Error(`Tenant workspace not found in database: ${tenantQueryErr?.message || 'unknown error'}`);
    }

    const subdomain = tenant.subdomain;
    const testDomain = `${subdomain.toLowerCase()}.kasimshah.com`;

    // 4. Fetch all user accounts registered to this tenant to delete them from Supabase Auth
    const { data: tenantUsers, error: usersQueryErr } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('tenant_id', tenantId);

    if (usersQueryErr) {
      console.warn(`Warning: Could not retrieve associated users list for tenant: ${usersQueryErr.message}`);
    }

    // 5. Domain Teardown Integration
    console.log(`Removing mapped domain: ${testDomain}`);
    try {
      // Step A: Delete Cloudflare CNAME record
      await removeCloudflareCname(subdomain);
      console.log(`Cloudflare DNS record deletion successful for ${subdomain}`);
    } catch (dnsErr: any) {
      console.error(`Warning: Cloudflare DNS teardown failed for ${subdomain}:`, dnsErr.message);
      // Non-blocking warning: let teardown proceed even if DNS was already cleaned
    }

    try {
      // Step B: Delete Vercel domain mapping
      await removeDomainFromVercel(testDomain);
      console.log(`Vercel project domain mapping deletion successful for ${testDomain}`);
    } catch (vercelErr: any) {
      console.error(`Warning: Vercel project domain teardown failed for ${testDomain}:`, vercelErr.message);
      // Non-blocking warning
    }

    // 6. Delete users from Supabase Auth (auth.users) via Admin Client
    if (tenantUsers && tenantUsers.length > 0) {
      console.log(`Deleting ${tenantUsers.length} associated user accounts from Auth...`);
      for (const u of tenantUsers) {
        try {
          const { error: deleteUserErr } = await supabaseAdmin.auth.admin.deleteUser(u.id);
          if (deleteUserErr) {
            console.error(`Failed to delete Auth User ${u.email} (ID: ${u.id}):`, deleteUserErr.message);
          } else {
            console.log(`Successfully deleted Auth User: ${u.email}`);
          }
        } catch (authDeleteErr: any) {
          console.error(`Error deleting Auth User ${u.id}:`, authDeleteErr.message);
        }
      }
    }

    // 7. Delete Tenant row from tenants table (cascade deletes all related public data)
    console.log(`Deleting tenant row ${tenantId} from database...`);
    const { error: tenantDeleteErr } = await supabaseAdmin
      .from('tenants')
      .delete()
      .eq('id', tenantId);

    if (tenantDeleteErr) {
      throw new Error(`Failed to delete tenant database record: ${tenantDeleteErr.message}`);
    }

    console.log(`Teardown of tenant ${subdomain} completed successfully.`);

    return NextResponse.json({ success: true, message: `Tenant workspace ${subdomain} deleted successfully.` });
  } catch (err: any) {
    console.error('Delete tenant API error:', err);
    return NextResponse.json({ error: err.message || 'Tenant deletion execution failed.' }, { status: 500 });
  }
}
