import { sql, type SQL } from 'drizzle-orm';
import { getDatabase } from '@ks-os/database';
import type { CustomerActor } from './customer-360.adapters.js';

export type CustomerIdentity = { id: string; reference: string; name: string; email: string | null; phone: string | null; since: Date; businessType: string | null; businessProfile: unknown };
export class Customer360Repository {
  async query<T extends Record<string, unknown>>(query: SQL): Promise<T[]> {
    return getDatabase().transaction(async tx => {
      await tx.execute(sql`set local statement_timeout = '4000ms'`);
      const result = await tx.execute(query);
      return result.rows as T[];
    }, { accessMode: 'read only' });
  }
  async identity(actor: CustomerActor, reference: string): Promise<CustomerIdentity | undefined> {
    // Legacy bookmarked client IDs remain supported, but all new output uses public references.
    const rows = await this.query<CustomerIdentity>(sql`select c.id,c.public_reference as reference,c.name,c.email,c.phone,c.created_at as since,
      t.business_type as "businessType",t.business_profile as "businessProfile"
      from clients c join tenants t on t.id=c.tenant_id
      where c.tenant_id=${actor.tenantId}::uuid and (c.public_reference=${reference}::uuid or c.id=${reference}::uuid) limit 1`);
    return rows[0];
  }
  async salesIdentity(actor: CustomerActor, clientId: string) {
    return (await this.query<{ lifecycle: string; owner: string | null }>(sql`select p.lifecycle,u.name as owner
      from client_sales_profiles p left join users u on u.id=p.owner_user_id and u.tenant_id=${actor.tenantId}::uuid
      where p.tenant_id=${actor.tenantId}::uuid and p.client_id=${clientId}::uuid
      and (${actor.role === 'owner' || actor.permissions.includes('SALES_VIEW_ALL')} or p.owner_user_id=${actor.userId}::uuid) limit 1`))[0];
  }
}
