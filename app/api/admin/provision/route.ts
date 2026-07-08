import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
    const { salonName, subdomain, industry, ownerEmail, ownerPassword } = await req.json();

    if (!salonName || !subdomain || !industry || !ownerEmail || !ownerPassword) {
      return NextResponse.json({ error: 'Missing required configuration parameters.' }, { status: 400 });
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

    console.log(`Provisioning completed successfully. Tenant ID: ${tenantId}`);

    return NextResponse.json({ success: true, tenantId });
  } catch (err: any) {
    console.error('Provisioning API error:', err);
    return NextResponse.json({ error: err.message || 'Tenant setup execution failed.' }, { status: 500 });
  }
}
