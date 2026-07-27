import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/features/agency/AgencyPages.tsx'), 'utf8');

describe('Client Management Workstation user access panel', () => {
  it('shows manual creation next to the invitation workflow', () => {
    expect(source).toContain('+ Add user manually');
    expect(source).toContain('+ Invite Owner');
    expect(source).toContain('<ManualTenantUserDialog');
  });

  it('surfaces tenant-user API failures instead of presenting an empty account list', () => {
    expect(source).toContain("useLive<any[]>(() => agencyFetch(`/tenants/${tenantId}/users`), [tenantId])");
    expect(source).toContain('<State loading={live.loading} error={live.error}>');
    expect(source).not.toContain("agencyFetch(`/tenants/${tenantId}/users`).catch(() => [])");
  });

  it('refreshes the real user list after a successful manual creation', () => {
    expect(source).toContain('onCreated={live.reload}');
  });
});
