import { useContext } from 'react';
import { resolveBusinessProfile } from '@ks-os/contracts';
import { AuthContext } from './useAuth';
const compatibilityProfile = resolveBusinessProfile(null);
/** Authenticated server configuration is authoritative; fallback supports existing isolated surfaces. */
export function useBusinessProfile() {
  return useContext(AuthContext)?.businessProfile ?? compatibilityProfile;
}
