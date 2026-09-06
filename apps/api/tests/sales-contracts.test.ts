import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateSalesOpportunitySchema,
  CreateSalesPipelineSchema,
  CreateSalesQuoteSchema,
  defaultSalesStagesForBusinessType,
  MODULE_REGISTRY,
  resolveBusinessProfile,
} from '@ks-os/contracts';
import { effectiveCapabilities } from '@ks-os/auth';

test('sales stage defaults are business-aware and always fall back safely', () => {
  assert.ok(defaultSalesStagesForBusinessType('AGENCY').some(stage => stage.name === 'Discovery'));
  assert.ok(defaultSalesStagesForBusinessType('LOGISTICS_COURIER').some(stage => stage.name === 'Pricing'));
  assert.ok(defaultSalesStagesForBusinessType('PLUMBING').some(stage => stage.name === 'Site visit'));
  assert.ok(defaultSalesStagesForBusinessType('PROFESSIONAL_SERVICES').some(stage => stage.name === 'Proposal'));
  const salon = defaultSalesStagesForBusinessType('SALON_BARBER');
  assert.ok(salon.some(stage => stage.category === 'WON'));
  assert.ok(salon.some(stage => stage.category === 'LOST'));
  const unknown = defaultSalesStagesForBusinessType('something custom');
  assert.equal(unknown[0]?.name, 'New lead');
});

test('pipeline contracts require explicit terminal stages', () => {
  const valid = CreateSalesPipelineSchema.safeParse({
    name: 'Sales',
    stages: [
      { name: 'New', category: 'OPEN', probability: 10 },
      { name: 'Won', category: 'WON', probability: 100 },
      { name: 'Lost', category: 'LOST', probability: 0 },
    ],
  });
  assert.equal(valid.success, true);
  assert.equal(CreateSalesPipelineSchema.safeParse({
    name: 'Sales',
    stages: [
      { name: 'New', category: 'OPEN', probability: 10 },
      { name: 'Qualified', category: 'OPEN', probability: 30 },
      { name: 'Lost', category: 'LOST', probability: 0 },
    ],
  }).success, false);
});

test('opportunity input requires either an existing client or a new lead', () => {
  const base = { title: 'New website' };
  assert.equal(CreateSalesOpportunitySchema.safeParse({ ...base, lead: { name: 'Acme Ltd' } }).success, true);
  assert.equal(CreateSalesOpportunitySchema.safeParse({ ...base, clientId: '11111111-1111-4111-8111-111111111111' }).success, true);
  assert.equal(CreateSalesOpportunitySchema.safeParse(base).success, false);
  assert.equal(CreateSalesOpportunitySchema.safeParse({ ...base, clientId: '11111111-1111-4111-8111-111111111111', lead: { name: 'Acme Ltd' } }).success, false);
});

test('quote contracts reject negative money and invalid quantities', () => {
  const quote = { title: 'Proposal', items: [{ description: 'Discovery', quantity: 1, unitAmount: 25000, taxRateBasisPoints: 2000 }] };
  assert.equal(CreateSalesQuoteSchema.safeParse(quote).success, true);
  assert.equal(CreateSalesQuoteSchema.safeParse({ ...quote, items: [{ ...quote.items[0], unitAmount: -1 }] }).success, false);
  assert.equal(CreateSalesQuoteSchema.safeParse({ ...quote, items: [{ ...quote.items[0], quantity: 0 }] }).success, false);
});

test('sales is a real module only for profiles that enable it', () => {
  assert.equal(MODULE_REGISTRY.sales.status, 'implemented');
  assert.equal(MODULE_REGISTRY.sales.route, '/app/sales');
  assert.ok(resolveBusinessProfile('AGENCY').enabledModules.includes('sales'));
  assert.ok(resolveBusinessProfile('LOGISTICS_COURIER').enabledModules.includes('sales'));
  assert.ok(resolveBusinessProfile('PLUMBING').enabledModules.includes('sales'));
  assert.equal(resolveBusinessProfile('SALON_BARBER').enabledModules.includes('sales'), false);
});

test('existing access profile architecture grants bounded sales capabilities', () => {
  const practitioner = effectiveCapabilities('staff', 'PRACTITIONER', {});
  assert.ok(practitioner.includes('SALES_VIEW_OWN'));
  assert.ok(practitioner.includes('SALES_CREATE'));
  assert.ok(!practitioner.includes('PIPELINES_MANAGE'));
  const manager = effectiveCapabilities('staff', 'MANAGER', {});
  assert.ok(manager.includes('SALES_VIEW_ALL'));
  assert.ok(manager.includes('QUOTES_MANAGE'));
  assert.ok(manager.includes('PIPELINES_MANAGE'));
  assert.ok(effectiveCapabilities('owner').includes('PIPELINES_MANAGE'));
});
