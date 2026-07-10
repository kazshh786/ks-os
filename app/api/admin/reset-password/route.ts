import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

    // 1. Authenticate caller (must be Master Admin: kasimashah@gmail.com)
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized: Missing session token.' }, { status: 401 });
    }

    const { data: { user }, error: verifyErr } = await supabaseAdmin.auth.getUser(token);
    if (verifyErr || !user || user.email !== 'kasimashah@gmail.com') {
      return NextResponse.json({ error: 'Unauthorized: Access restricted to Master Admin.' }, { status: 403 });
    }

    // 2. Parse request body
    const { userId, newPassword } = await req.json();
    if (!userId || !newPassword) {
      return NextResponse.json({ error: 'Missing userId or newPassword.' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long.' }, { status: 400 });
    }

    console.log(`Master admin triggering password reset for user ID: ${userId}`);

    // 3. Reset password inside Supabase Auth
    const { error: resetErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (resetErr) {
      throw new Error(`Failed to update password in auth: ${resetErr.message}`);
    }

    // 4. Update public.users database permissions to force a reset upon login
    const { error: profileUpdateErr } = await supabaseAdmin
      .from('users')
      .update({
        permissions: { requires_password_change: true }
      })
      .eq('id', userId);

    if (profileUpdateErr) {
      console.warn('Warning: Could not set force password change flag on user profile:', profileUpdateErr.message);
    }

    console.log(`Password reset and force-reset flag set successfully for user: ${userId}`);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Reset Password API error:', err);
    return NextResponse.json({ error: err.message || 'Password reset execution failed.' }, { status: 500 });
  }
}
