export interface MigrationManifestEntry {
  filename: string;
  order: number;
  description: string;
}

export const MIGRATION_MANIFEST: MigrationManifestEntry[] = [
  {
    filename: '0000_uneven_richard_fisk.sql',
    order: 1,
    description: 'Core schema initialization (tenants, users, appointments, clients, services, transactions)',
  },
  {
    filename: '0001_amazing_solo.sql',
    order: 2,
    description: 'Base tables for email outbox, stripe disputes, payment attempts, payouts',
  },
  {
    filename: '0001_stripe_booking_payments.sql',
    order: 3,
    description: 'FK constraints and unique indices for stripe_payment_attempts',
  },
  {
    filename: '0002_stripe_refunds.sql',
    order: 4,
    description: 'Stripe refunds table and transaction/appointment foreign keys',
  },
  {
    filename: '0003_stripe_finance.sql',
    order: 5,
    description: 'Stripe payout items, payout summary indices, and finance foreign keys',
  },
  {
    filename: '0004_phase_6_1_secure_forms.sql',
    order: 6,
    description: 'Form versions and form assignments schema',
  },
  {
    filename: '0005_phase_6_3_transactional_sms.sql',
    order: 7,
    description: 'SMS outbox and Twilio webhook event tracking',
  },
  {
    filename: '0006_phase_7_1_workflow_automation_engine.sql',
    order: 8,
    description: 'Automation rules, action runs, business events, internal notifications',
  },
  {
    filename: '0007_phase_7_2_operations_inbox.sql',
    order: 9,
    description: 'Operations issue tracking schema',
  },
  {
    filename: '0008_phase_7_3_tasks_and_followups.sql',
    order: 10,
    description: 'Tasks and task activity tracking',
  },
  {
    filename: '20260719120000_phase_6_2_transactional_email.sql',
    order: 11,
    description: 'Transactional email outbox and suppressions schema',
  },
  {
    filename: '20260719170000_phase_9_1_team_management.sql',
    order: 12,
    description: 'Staff invitations and staff service assignments',
  },
  {
    filename: '20260719200000_phase_9_2_9_5_team_operations.sql',
    order: 13,
    description: 'Multi-location support, staff locations, service locations, time off, commission rules',
  },
  {
    filename: '20260719210000_phase_8_3_8_4_reporting_analytics.sql',
    order: 14,
    description: 'Reporting schedules, export jobs, and schedule runs',
  },
  {
    filename: '20260720100000_phase_10_1_customer_portal.sql',
    order: 15,
    description: 'Customer accounts, client link resolution, account claims',
  },
  {
    filename: '20260720135949_phase_10_2_customer_booking_management.sql',
    order: 16,
    description: 'Self-service customer booking management tokens, policy settings, audit history',
  },
  {
    filename: '20260720170000_phase_10_6_external_reviews.sql',
    order: 17,
    description: 'Reputation management, review provider connections, review invitations',
  },
  {
    filename: '20260720230000_phase_12_agency_operations.sql',
    order: 18,
    description: 'Agency users, commercial billing accounts, platform entitlements, onboarding stages',
  },
  {
    filename: '20260720235900_phase_12_0_unified_authentication.sql',
    order: 19,
    description: 'Unified authentication schema, application sessions, account invitations',
  },
  {
    filename: '20260722000000_provider_neutral_pos.sql',
    order: 20,
    description: 'Provider-neutral checkout payment components',
  },
  {
    filename: '20260722130000_production_schema_reconciliation.sql',
    order: 21,
    description: 'Production additive schema reconciliation for 13 missing tables',
  },
  {
    filename: '20260722220000_phase_14_compliance_operations.sql',
    order: 22,
    description: 'Phase 14 compliance audit, consent, privacy requests, legal holds, and retention operations',
  },
  {
    filename: '20260723000000_phase_13_integrations.sql',
    order: 23,
    description: 'Phase 13 provider-neutral integrations, automation credentials, and supported hardware',
  },
  {
    filename: '20260723010000_advanced_intake_forms.sql',
    order: 24,
    description: 'Advanced versioned intake forms, save-and-resume, files, templates, review, and analytics',
  },
  {
    filename: '20260723020000_booking_operations_platform.sql',
    order: 25,
    description: 'Booking operations calendar, automatic public booking pages, temporary slot holds, source attribution, audit, and analytics',
  },
];
