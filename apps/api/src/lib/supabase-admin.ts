import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw Object.assign(new Error('Authentication administration is not configured.'), {
      statusCode: 503,
      code: 'AUTH_ADMIN_UNAVAILABLE',
    });
  }
  adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return adminClient;
}

export async function findSupabaseUserByEmail(emailNormalized: string): Promise<User | null> {
  const admin = getSupabaseAdmin();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find(user => user.email?.trim().toLowerCase() === emailNormalized);
    if (match) return match;
    if (data.users.length < 100) break;
  }
  return null;
}

export type InvitationProvisioningResult = {
  authUserId: string;
  delivery: 'SUPABASE_INVITE' | 'EXISTING_ACCOUNT';
};

export async function provisionSupabaseInvitation(emailNormalized: string, redirectTo: string): Promise<InvitationProvisioningResult> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(emailNormalized, { redirectTo });
  if (!error && data.user) return { authUserId: data.user.id, delivery: 'SUPABASE_INVITE' };

  // Supabase correctly refuses a second identity for an address that already
  // exists. Resolve that identity server-side and let the application send a
  // normal access notification; never expose the lookup result to the caller.
  const existing = await findSupabaseUserByEmail(emailNormalized);
  if (existing) return { authUserId: existing.id, delivery: 'EXISTING_ACCOUNT' };

  throw Object.assign(new Error('The invitation could not be delivered.'), {
    statusCode: 502,
    code: 'INVITATION_DELIVERY_FAILED',
  });
}

export type ManualAuthProvisioningResult = {
  authUserId: string;
  created: boolean;
  temporaryPassword: string | null;
};

export async function provisionSupabaseUserWithoutEmail(input: {
  email: string;
  displayName: string;
  temporaryPassword: string;
}): Promise<ManualAuthProvisioningResult> {
  const emailNormalized = input.email.trim().toLowerCase();
  const existing = await findSupabaseUserByEmail(emailNormalized);
  if (existing) {
    return { authUserId: existing.id, created: false, temporaryPassword: null };
  }

  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email: emailNormalized,
    password: input.temporaryPassword,
    email_confirm: true,
    user_metadata: { display_name: input.displayName.trim() },
  });
  if (error || !data.user) {
    throw Object.assign(new Error('The login identity could not be created.'), {
      statusCode: 502,
      code: 'AUTH_USER_PROVISIONING_FAILED',
    });
  }
  return { authUserId: data.user.id, created: true, temporaryPassword: input.temporaryPassword };
}

export async function deleteSupabaseUserIfCreated(authUserId: string): Promise<void> {
  const { error } = await getSupabaseAdmin().auth.admin.deleteUser(authUserId);
  if (error) {
    throw Object.assign(new Error('The partially created login identity could not be rolled back.'), {
      statusCode: 502,
      code: 'AUTH_USER_ROLLBACK_FAILED',
    });
  }
}

export async function createDevelopmentAuthUser(email: string, password: string): Promise<User> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development authentication seed is disabled in production.');
  }
  const normalized = email.trim().toLowerCase();
  const existing = await findSupabaseUserByEmail(normalized);
  if (existing) {
    const { data, error } = await getSupabaseAdmin().auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw error || new Error('Supabase user update failed.');
    return data.user;
  }
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email: normalized,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error || new Error('Supabase user creation failed.');
  return data.user;
}
