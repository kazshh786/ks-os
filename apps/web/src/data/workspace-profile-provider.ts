import { fetchWithAuth } from '../api/client.js';
import type { BusinessTenant } from './types.js';
import type { DataProvider } from './data-provider.js';

async function workspaceRequest(init?: RequestInit): Promise<BusinessTenant> {
  const response = await fetchWithAuth('/api/v1/workspace', {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error?.message || body.error?.code || 'Business settings could not be saved.');
  }
  const profile = body.data?.profile;
  if (!profile) throw new Error('Business settings could not be loaded.');
  return profile as BusinessTenant;
}

export function attachWorkspaceProfileMethods(provider: DataProvider): DataProvider {
  provider.getTenants = async () => [await workspaceRequest()];
  provider.saveTenants = async tenants => {
    const tenant = tenants[0];
    if (!tenant) throw new Error('No business workspace is selected.');
    await workspaceRequest({
      method: 'PATCH',
      body: JSON.stringify({
        name: tenant.name,
        address: tenant.address || '',
        phone: tenant.phone || '',
        email: tenant.email || '',
        primaryColor: tenant.primaryColor,
        currency: tenant.currency,
        paymentPolicy: tenant.paymentPolicy,
      }),
    });
  };
  return provider;
}
