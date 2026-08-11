import { createHash } from 'node:crypto';
import type { FactFieldMapping } from './contracts.js';

export interface ApprovedFactInput {
  responseReference: string;
  questionnaireReference: string;
  questionReference: string;
  mapping: FactFieldMapping;
  dataClassification: 'PUBLIC_FACT' | 'PRIVATE_OPERATIONAL' | 'CONSENT' | 'EVIDENCE' | 'CONTENT_PREFERENCE' | 'ASSET';
  approvedValue: unknown;
  valueDigestSha256: string;
  submittedByReference: string | null;
  submittedAt: string;
  reviewedByReference: string;
  approvedAt: string;
  publicUseEligible: boolean;
  bookingUseEligible: boolean;
  generationUseEligible: boolean;
}

export interface ApprovedAssetInput {
  assetReference: string;
  category: string;
  digestSha256: string;
  provenance?: string;
  publicUsePermission: boolean;
  aiUsePermission: boolean;
  consentStatus: string;
  agencyReviewStatus: 'APPROVED';
}

export interface ProductionBriefData {
  verifiedFacts: Record<string, unknown[]>;
  canonical: {
    business: Record<string, unknown>;
    locations: Record<string, unknown>[];
    services: Record<string, unknown>[];
    staff: Record<string, unknown>[];
    booking: Record<string, unknown>;
    brand: Record<string, unknown>;
    content: Record<string, unknown[]>;
  };
  copyContext: Record<string, unknown>;
  imageBrief: Array<Record<string, unknown>>;
  assetReferences: string[];
  provenance: Array<Omit<ApprovedFactInput, 'approvedValue'>>;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function setMapped(target: ProductionBriefData['canonical'], mapping: FactFieldMapping, value: unknown) {
  const [group, field] = mapping.split('.');
  if (group === 'BUSINESS') target.business[field] = value;
  else if (group === 'BOOKING') target.booking[field] = value;
  else if (group === 'BRAND') target.brand[field] = value;
  else if (group === 'CONTENT') (target.content[field] ||= []).push(value);
  else if (group === 'LOCATION') target.locations.push({ field, value });
  else if (group === 'SERVICE') target.services.push({ field, value });
  else if (group === 'STAFF') target.staff.push({ field, value });
}

export function buildProductionBriefData(input: {
  facts: readonly ApprovedFactInput[];
  assets: readonly ApprovedAssetInput[];
}) {
  const permittedFacts = input.facts.filter(fact => {
    if (fact.dataClassification === 'PUBLIC_FACT') {
      return fact.publicUseEligible || fact.bookingUseEligible || fact.generationUseEligible;
    }
    if (fact.dataClassification === 'CONTENT_PREFERENCE') {
      return fact.generationUseEligible;
    }
    return false;
  });
  const canonical: ProductionBriefData['canonical'] = {
    business: {}, locations: [], services: [], staff: [], booking: {}, brand: {}, content: {},
  };
  const verifiedFacts: Record<string, unknown[]> = {};
  for (const fact of permittedFacts) {
    (verifiedFacts[fact.mapping] ||= []).push(fact.approvedValue);
    setMapped(canonical, fact.mapping, fact.approvedValue);
  }
  const approvedAssets = input.assets.filter(asset =>
    asset.agencyReviewStatus === 'APPROVED'
    && asset.publicUsePermission
    && ['CONFIRMED', 'NOT_APPLICABLE'].includes(asset.consentStatus));
  const data: ProductionBriefData = {
    verifiedFacts,
    canonical,
    copyContext: Object.fromEntries(permittedFacts
      .filter(fact => fact.generationUseEligible && !fact.mapping.startsWith('ASSET.'))
      .map(fact => [fact.mapping, fact.approvedValue])),
    imageBrief: approvedAssets.map(asset => ({
      assetReference: asset.assetReference,
      category: asset.category,
      provenance: asset.provenance || 'UNKNOWN',
      existingApprovedAsset: true,
      stockImagePermitted: false,
      aiGeneratedImagePermitted: asset.aiUsePermission,
      consentRequired: asset.consentStatus === 'REQUIRED',
      missingAsset: false,
    })),
    assetReferences: approvedAssets.map(asset => asset.assetReference),
    provenance: permittedFacts.map(({ approvedValue: _approvedValue, ...fact }) => fact),
  };
  const contentDigestSha256 = createHash('sha256').update(JSON.stringify(stable(data))).digest('hex');
  return { data, contentDigestSha256 };
}
