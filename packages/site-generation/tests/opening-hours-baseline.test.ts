import assert from 'node:assert/strict';
import test from 'node:test';
import { listSiteComponents } from '@ks-os/site-components';
import {
  createBaselinePageCompositionPlan,
} from '../src/baseline-composition.js';
import { validatePageCompositionPlan } from '../src/composition.js';
import type {
  TemplateGenerationConstraint,
  VerifiedBusinessFacts,
} from '../src/contracts.js';

const id = (value: number) =>
  `${String(value).padStart(8, '0')}-3333-4333-8333-${String(value).padStart(12, '0')}`;

const sectionOrder = [
  'HEADER',
  'HERO',
  'INTRODUCTION',
  'CONTACT',
  'LOCATION',
  'OPENING_HOURS',
  'FAQ',
  'BOOKING_CTA',
  'FOOTER',
] as const;

const page = {
  blueprintPageReference: id(100),
  pageReference: id(200),
  title: 'Contact',
  slug: 'contact',
  pageType: 'CONTACT' as const,
  conversionRole: 'PRIMARY_LANDING' as const,
  layoutReference: id(300),
  plannedSectionTypes: [...sectionOrder],
};

const facts: VerifiedBusinessFacts = {
  businessReference: id(1),
  business: [
    { key: 'business_name', value: 'Governed Studio', status: 'VERIFIED' },
    { key: 'booking_enabled', value: true, status: 'VERIFIED' },
    { key: 'phone_number', value: '020 7000 0000', status: 'TENANT_CONFIRMED' },
    { key: 'public_email', value: 'hello@example.test', status: 'TENANT_CONFIRMED' },
  ],
  services: [],
  locations: [{
    publicReference: id(3),
    facts: [
      { key: 'location_name', value: 'Central Studio', status: 'VERIFIED' },
      { key: 'physical_address', value: '1 High Street', status: 'VERIFIED' },
      // Intentionally no opening_hours fact. The booking system resolves this live.
    ],
  }],
  staff: [],
  policies: [],
  brand: [],
  assetReferences: [],
  approvedAssets: [],
};

const template: TemplateGenerationConstraint = {
  templateVersionReference: id(500),
  templateSourceType: 'INTERNAL',
  templateVersionStatus: 'APPROVED',
  licenceStatus: 'NOT_REQUIRED',
  layoutReference: page.layoutReference,
  layoutStatus: 'APPROVED',
  compatiblePageTypes: ['CONTACT'],
  rendererKey: 'contact-baseline-v1',
  rendererVersion: 1,
  rendererStatus: 'READY',
  requiredSectionTypes: ['HEADER', 'HERO', 'CONTACT', 'LOCATION', 'OPENING_HOURS', 'BOOKING_CTA', 'FOOTER'],
  prohibitedSectionTypes: [],
  sectionOrder: [...sectionOrder],
  componentRegistryVersion: 2,
  availableComponentKeys: sectionOrder.flatMap(sectionType =>
    listSiteComponents({
      sectionType,
      pageType: 'CONTACT',
      conversionRole: 'PRIMARY_LANDING',
    }).map(component => component.componentKey)),
};

test('Contact baseline remains valid when static opening-hours facts are absent', () => {
  const output = createBaselinePageCompositionPlan({
    page,
    template,
    facts,
    approvedPageReferences: [page.pageReference, id(999)],
  });

  const hours = output.selectedComponents.find(section =>
    section.sectionType === 'OPENING_HOURS');
  assert.ok(hours, 'OPENING_HOURS must remain in the deterministic Contact composition');
  assert.ok(hours.dataBindings.includes('LOCATIONS'));
  assert.ok(hours.dataBindings.includes('BOOKING'));
  assert.equal(hours.dataBindings.includes('OPENING_HOURS'), false);

  assert.deepEqual(validatePageCompositionPlan({
    output,
    page,
    template,
    approvedPageReferences: [page.pageReference, id(999)],
    approvedAssetReferences: [],
  }), []);
});
