import { VerifiedBusinessFactsSchema, type VerifiedBusinessFacts } from './contracts.js';

const DIRECT_STATEMENT_STATUSES = new Set([
  'VERIFIED',
  'AGENCY_CONFIRMED',
  'TENANT_CONFIRMED',
]);

export interface CanonicalGenerationFactInput {
  business: {
    reference: string;
    name: string;
    legalName?: string | null;
    businessType?: string | null;
    phone?: string | null;
    email?: string | null;
    primaryColour?: string | null;
    secondaryColour?: string | null;
    accentColour?: string | null;
    minimumCancellationNoticeMinutes?: number | null;
    minimumRescheduleNoticeMinutes?: number | null;
    lateCancellationMessage?: string | null;
    depositPolicyMessage?: string | null;
  };
  services: readonly {
    reference: string;
    name: string;
    description?: string | null;
    duration?: number | null;
    price?: string | number | null;
  }[];
  locations: readonly {
    reference: string;
    name: string;
    address?: string | null;
    postcode?: string | null;
    phone?: string | null;
    openingHours?: readonly {
      dayOfWeek: number;
      intervalNumber?: number;
      opensAt: string;
      closesAt: string;
    }[];
  }[];
  staff: readonly {
    reference: string;
    name: string;
    jobTitle?: string | null;
    biography?: string | null;
    bookingEnabled?: boolean | null;
  }[];
  assetReferences?: readonly string[];
  assets?: readonly {
    reference: string;
    kind: string;
    entityReference?: string | null;
    alt?: string | null;
    width?: number | null;
    height?: number | null;
  }[];
}

function classifyAssetKind(kind: string) {
  const value = kind.toUpperCase();
  if (value.includes('LOGO')) return 'LOGO' as const;
  if (value.includes('STAFF') || value.includes('PORTRAIT')) return 'STAFF' as const;
  if (value.includes('LOCATION')) return 'LOCATION' as const;
  if (value.includes('RESULT') || value.includes('BEFORE') || value.includes('AFTER')) return 'RESULT' as const;
  if (value.includes('SERVICE')) return 'SERVICE' as const;
  if (value.includes('GALLERY')) return 'GALLERY' as const;
  if (value.includes('DECORATIVE')) return 'DECORATIVE' as const;
  return 'BRAND' as const;
}

const publicFact = (
  key: string,
  value: string | number | boolean | null | undefined,
  status: 'VERIFIED' | 'TENANT_CONFIRMED' = 'TENANT_CONFIRMED',
) => value === null || value === undefined || value === ''
  ? null
  : { key, value, status };

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

function openingHoursFact(
  hours: CanonicalGenerationFactInput['locations'][number]['openingHours'],
) {
  if (!hours?.length) return null;
  return [...hours]
    .sort((left, right) => left.dayOfWeek - right.dayOfWeek
      || (left.intervalNumber ?? 1) - (right.intervalNumber ?? 1))
    .map(item => `${WEEKDAYS[item.dayOfWeek] ?? `DAY_${item.dayOfWeek}`} ${item.opensAt.slice(0, 5)}-${item.closesAt.slice(0, 5)}`)
    .join('; ');
}

function compact<T>(items: Array<T | null>): T[] {
  return items.filter((item): item is T => item !== null);
}

/** Canonical server-side public projection shared by enqueue-time digests and workers. */
export function buildVerifiedBusinessFacts(input: CanonicalGenerationFactInput) {
  return VerifiedBusinessFactsSchema.parse({
    businessReference: input.business.reference,
    business: compact([
      publicFact('business_name', input.business.name),
      publicFact('legal_business_name', input.business.legalName),
      publicFact('business_type', input.business.businessType),
      publicFact('phone_number', input.business.phone),
      publicFact('public_email', input.business.email),
      publicFact('booking_enabled', true, 'VERIFIED'),
      publicFact('native_crm_enabled', true, 'VERIFIED'),
    ]),
    services: [...input.services].sort((left, right) =>
      left.reference.localeCompare(right.reference)).map(service => ({
      publicReference: service.reference,
      facts: compact([
        publicFact('service_name', service.name),
        publicFact('service_description', service.description),
        publicFact('service_duration', service.duration),
        publicFact('service_price', service.price),
        publicFact('service_availability', true),
      ]),
    })),
    locations: [...input.locations].sort((left, right) =>
      left.reference.localeCompare(right.reference)).map(location => ({
      publicReference: location.reference,
      facts: compact([
        publicFact('location_name', location.name),
        publicFact('physical_address', location.address),
        publicFact('postcode', location.postcode),
        publicFact('phone_number', location.phone),
        publicFact('opening_hours', openingHoursFact(location.openingHours), 'VERIFIED'),
      ]),
    })),
    staff: [...input.staff].sort((left, right) =>
      left.reference.localeCompare(right.reference)).map(staff => ({
      publicReference: staff.reference,
      facts: compact([
        publicFact('staff_name', staff.name),
        publicFact('staff_job_title', staff.jobTitle),
        publicFact('staff_biography', staff.biography),
        publicFact('staff_booking_enabled', staff.bookingEnabled),
      ]),
    })),
    policies: compact([
      publicFact('minimum_cancellation_notice_minutes', input.business.minimumCancellationNoticeMinutes, 'VERIFIED'),
      publicFact('minimum_reschedule_notice_minutes', input.business.minimumRescheduleNoticeMinutes, 'VERIFIED'),
      publicFact('late_cancellation_policy', input.business.lateCancellationMessage, 'VERIFIED'),
      publicFact('deposit_policy', input.business.depositPolicyMessage, 'VERIFIED'),
    ]),
    brand: compact([
      publicFact('brand_primary_colour', input.business.primaryColour),
      publicFact('brand_secondary_colour', input.business.secondaryColour),
      publicFact('brand_accent_colour', input.business.accentColour),
    ]),
    assetReferences: [...(input.assetReferences ?? [])].sort(),
    approvedAssets: [...(input.assets ?? [])]
      .sort((left, right) => left.reference.localeCompare(right.reference))
      .map(asset => ({
        publicReference: asset.reference,
        assetClass: classifyAssetKind(asset.kind),
        ...(asset.entityReference ? { entityReference: asset.entityReference } : {}),
        ...(asset.alt ? { alt: asset.alt } : {}),
        ...(asset.width ? { width: asset.width } : {}),
        ...(asset.height ? { height: asset.height } : {}),
        approved: true as const,
      })),
  });
}

export function selectGenerationSafeFacts(input: VerifiedBusinessFacts) {
  const select = (facts: VerifiedBusinessFacts['business']) => facts
    .filter(fact => DIRECT_STATEMENT_STATUSES.has(fact.status))
    .map(({ key, value, status }) => ({ key, value, status }))
    .sort((left, right) => left.key.localeCompare(right.key));
  const entities = (items: VerifiedBusinessFacts['services']) => items
    .map(item => ({
      publicReference: item.publicReference,
      facts: select(item.facts),
    }))
    .filter(item => item.facts.length > 0)
    .sort((left, right) => left.publicReference.localeCompare(right.publicReference));
  return {
    businessReference: input.businessReference,
    business: select(input.business),
    services: entities(input.services),
    locations: entities(input.locations),
    staff: entities(input.staff),
    policies: select(input.policies),
    brand: select(input.brand),
    assetReferences: [...input.assetReferences].sort(),
    approvedAssets: (input.approvedAssets ?? []).map(asset => ({
      publicReference: asset.publicReference,
      assetClass: asset.assetClass,
      ...(asset.entityReference ? { entityReference: asset.entityReference } : {}),
      ...(asset.width ? { width: asset.width } : {}),
      ...(asset.height ? { height: asset.height } : {}),
      ...(asset.alt ? { alt: asset.alt } : {}),
      approved: true as const,
    })),
  };
}

export function availableBusinessDataKeys(input: VerifiedBusinessFacts) {
  return [...new Set([
    ...input.business,
    ...input.policies,
    ...input.brand,
    ...input.services.flatMap(entity => entity.facts),
    ...input.locations.flatMap(entity => entity.facts),
    ...input.staff.flatMap(entity => entity.facts),
  ].filter(fact => DIRECT_STATEMENT_STATUSES.has(fact.status)).map(fact => fact.key))].sort();
}

export function safePublicEntityReferences(input: VerifiedBusinessFacts) {
  return {
    services: new Set(input.services.map(entity => entity.publicReference)),
    locations: new Set(input.locations.map(entity => entity.publicReference)),
    staff: new Set(input.staff.map(entity => entity.publicReference)),
    assets: new Set(input.assetReferences),
  };
}
