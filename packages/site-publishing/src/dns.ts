import { z } from 'zod';

export const DnsRecordTypeSchema = z.enum([
  'A', 'AAAA', 'CAA', 'CNAME', 'MX', 'NS', 'SRV', 'TXT',
]);
export type DnsRecordType = z.infer<typeof DnsRecordTypeSchema>;

export const DnsRecordSchema = z.object({
  providerSafeReference: z.string().trim().min(1).max(255).optional(),
  type: DnsRecordTypeSchema,
  name: z.string().trim().toLowerCase().min(1).max(253),
  content: z.string().trim().min(1).max(2_000),
  ttl: z.number().int().min(60).max(86_400).nullable(),
  proxied: z.boolean().default(false),
  managedByKsOs: z.boolean().default(false),
}).strict();
export type DnsRecord = z.infer<typeof DnsRecordSchema>;

export type DnsRecordClassification =
  | 'WEBSITE'
  | 'EMAIL'
  | 'SECURITY'
  | 'SERVICE'
  | 'UNRELATED'
  | 'CONFLICT_REVIEW_REQUIRED';

export function classifyDnsRecord(
  record: DnsRecord,
  apexHostname: string,
): { classification: DnsRecordClassification; protected: boolean } {
  const name = record.name.toLowerCase();
  const content = record.content.toLowerCase();
  if (record.type === 'MX') return { classification: 'EMAIL', protected: true };
  if (record.type === 'CAA') return { classification: 'SECURITY', protected: true };
  if (record.type === 'SRV') return { classification: 'SERVICE', protected: true };
  if (
    record.type === 'TXT'
    && (
      content.startsWith('v=spf1')
      || name.startsWith('_dmarc.')
      || name.includes('._domainkey.')
    )
  ) {
    return { classification: 'EMAIL', protected: true };
  }
  if (name.startsWith('api.') || name.startsWith('mail.')) {
    return { classification: 'SERVICE', protected: true };
  }
  if (
    [apexHostname, `www.${apexHostname}`].includes(name)
    && ['A', 'AAAA', 'CNAME'].includes(record.type)
    && !record.managedByKsOs
  ) {
    return { classification: 'CONFLICT_REVIEW_REQUIRED', protected: true };
  }
  if (
    [apexHostname, `www.${apexHostname}`].includes(name)
    && ['A', 'AAAA', 'CNAME', 'TXT'].includes(record.type)
  ) {
    return { classification: 'WEBSITE', protected: !record.managedByKsOs };
  }
  return { classification: 'UNRELATED', protected: true };
}

export function websiteDnsRecord(input: Omit<DnsRecord, 'proxied' | 'managedByKsOs'>): DnsRecord {
  return DnsRecordSchema.parse({ ...input, proxied: false, managedByKsOs: true });
}

export function assertManagedDnsDeletion(record: DnsRecord): void {
  if (!record.managedByKsOs) throw new Error('DNS_RECORD_NOT_MANAGED');
}
