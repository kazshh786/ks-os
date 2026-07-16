import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { addDomainToVercel, removeDomainFromVercel, addCloudflareCname } from '@/utils/domain-service';

export async function POST(req: Request) {
  try {
    // Read keys inside request handler to prevent next build time crashes when env vars are missing
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

    // 1. Authenticate the caller to make sure they are the Master Admin (kasimashah@gmail.com)
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized: Missing session token.' }, { status: 401 });
    }

    // Verify token with Supabase Auth
    const { data: { user }, error: verifyErr } = await supabaseAdmin.auth.getUser(token);
    if (verifyErr || !user || user.email !== 'kasimashah@gmail.com') {
      return NextResponse.json({ error: 'Unauthorized: Access restricted to Master Admin.' }, { status: 403 });
    }

    // 2. Parse request body parameters
    const { salonName, subdomain, packageTier = 'core', industry, ownerEmail, ownerPassword } = await req.json();

    if (!salonName || !subdomain || !industry || !ownerEmail || !ownerPassword) {
      return NextResponse.json({ error: 'Missing required configuration parameters.' }, { status: 400 });
    }
    if (!['core', 'growth', 'scale'].includes(packageTier)) {
      return NextResponse.json({ error: 'Invalid workspace package tier.' }, { status: 400 });
    }

    console.log(`Starting automated provisioning for tenant: ${subdomain}`);

    // 3. Create the Owner User account in Supabase Auth (auth.users) via Admin Client
    const { data: newAuthUser, error: createUserErr } = await supabaseAdmin.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
      user_metadata: { name: `${salonName} Owner` },
    });

    if (createUserErr) {
      throw new Error(`Failed to create owner auth profile: ${createUserErr.message}`);
    }

    const ownerId = newAuthUser.user?.id;
    if (!ownerId) {
      throw new Error('Failed to retrieve provisioned user UUID.');
    }

    console.log(`Successfully created Auth account for owner: ${ownerId}`);

    // 4. Call Postgres Stored Procedure to provision tenant and seed standard vertical lists
    const { data: tenantId, error: rpcErr } = await supabaseAdmin.rpc('provision_new_tenant', {
      p_name: salonName,
      p_subdomain: subdomain.toLowerCase(),
      p_industry: industry,
      p_owner_email: ownerEmail,
      p_owner_id: ownerId,
    });

    if (rpcErr) {
      // Clean up newly created user on failure
      await supabaseAdmin.auth.admin.deleteUser(ownerId);
      throw rpcErr;
    }

    const { error: packageUpdateErr } = await supabaseAdmin
      .from('tenants')
      .update({ package_tier: packageTier })
      .eq('id', tenantId);

    if (packageUpdateErr) {
      await supabaseAdmin.from('tenants').delete().eq('id', tenantId);
      await supabaseAdmin.auth.admin.deleteUser(ownerId);
      throw new Error(`Failed to assign workspace package: ${packageUpdateErr.message}`);
    }

    // 5. Update public.users record for the newly created salon owner to force a password change
    const { error: profileUpdateErr } = await supabaseAdmin
      .from('users')
      .update({
        permissions: { requires_password_change: true }
      })
      .eq('id', ownerId);

    if (profileUpdateErr) {
      console.warn('Warning: Could not set force password change flag on owner profile:', profileUpdateErr.message);
    }

    // 6. Domain Automation Integration
    const testDomain = `${subdomain.toLowerCase()}.kasimshah.com`;
    console.log(`Configuring test domain: ${testDomain}`);
    
    let domainAddedToVercel = false;
    try {
      // Step A: Add domain to Vercel
      await addDomainToVercel(testDomain);
      domainAddedToVercel = true;
      
      // Step B: Add CNAME to Cloudflare DNS
      await addCloudflareCname(subdomain);
      console.log(`Successfully configured domain routing for ${testDomain}`);
    } catch (domainErr: any) {
      console.error(`Domain provisioning failed for ${testDomain}:`, domainErr);
      
      // Safety rollback: if Vercel addition succeeded but Cloudflare record failed, remove from Vercel
      if (domainAddedToVercel) {
        console.log(`Rolling back Vercel domain mapping for ${testDomain}...`);
        try {
          await removeDomainFromVercel(testDomain);
          console.log(`Vercel domain rollback successful.`);
        } catch (rollbackErr: any) {
          console.error(`Rollback of Vercel domain ${testDomain} failed:`, rollbackErr);
        }
      }
      
      // Database rollback
      console.log(`Rolling back database tenant ${tenantId} and Auth User ${ownerId}...`);
      try {
        await supabaseAdmin.from('tenants').delete().eq('id', tenantId);
        await supabaseAdmin.auth.admin.deleteUser(ownerId);
        console.log(`Database and Auth rollback successful.`);
      } catch (dbRollbackErr: any) {
        console.error(`Rollback of database/auth failed:`, dbRollbackErr);
      }

      throw new Error(`Domain provisioning failure: ${domainErr.message}`);
    }

    console.log(`Provisioning completed successfully. Tenant ID: ${tenantId}`);

    return NextResponse.json({ success: true, tenantId });
  } catch (err: any) {
    console.error('Provisioning API error:', err);
    return NextResponse.json({ error: err.message || 'Tenant setup execution failed.' }, { status: 500 });
  }
}
