import { fetchWithAuth } from '../../api/client';
import { supabase } from '../../lib/supabase';

export function clearClientMeetingCredentials() {
  try { for (let index = sessionStorage.length - 1; index >= 0; index--) { const key = sessionStorage.key(index); if (key?.startsWith('ksos-client-meeting:')) sessionStorage.removeItem(key); } } catch { /* Storage can be disabled. */ }
}
export async function signOutCustomer() {
  clearClientMeetingCredentials();
  await fetchWithAuth('/api/v1/auth/logout', { method: 'POST', authContext: 'CUSTOMER' }).catch(() => undefined);
  await supabase.auth.signOut({ scope: 'local' });
}
