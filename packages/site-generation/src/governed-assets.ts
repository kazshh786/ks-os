export const GOVERNED_SITE_ASSET_CATEGORIES = [
  'LOGO',
  'TEAM_PHOTO',
  'LOCATION_PHOTO',
  'SERVICE_PHOTO',
  'RESULT_PHOTO',
] as const;

export const GOVERNED_SITE_ASSET_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

export const GOVERNED_SITE_ASSET_SCAN_STATUSES = ['NOT_AVAILABLE', 'CLEAN'] as const;
export const GOVERNED_SITE_ASSET_CONSENT_STATUSES = ['NOT_APPLICABLE', 'CONFIRMED'] as const;

export interface GovernedAssetEligibilityInput {
  uploadStatus: string;
  agencyReviewStatus: string;
  publicUsePermission: boolean;
  aiUsePermission: boolean;
  copyrightConfirmed: boolean;
  consentStatus: string;
  malwareScanStatus: string;
  assetCategory: string;
  mimeType: string;
}

export function isGovernedSiteAssetPubliclyDeliverable(input: GovernedAssetEligibilityInput) {
  return input.uploadStatus === 'UPLOADED'
    && input.agencyReviewStatus === 'APPROVED'
    && input.publicUsePermission
    && input.copyrightConfirmed
    && GOVERNED_SITE_ASSET_CONSENT_STATUSES.includes(
      input.consentStatus as typeof GOVERNED_SITE_ASSET_CONSENT_STATUSES[number],
    )
    && GOVERNED_SITE_ASSET_SCAN_STATUSES.includes(
      input.malwareScanStatus as typeof GOVERNED_SITE_ASSET_SCAN_STATUSES[number],
    )
    && GOVERNED_SITE_ASSET_CATEGORIES.includes(
      input.assetCategory as typeof GOVERNED_SITE_ASSET_CATEGORIES[number],
    )
    && GOVERNED_SITE_ASSET_MIME_TYPES.includes(
      input.mimeType as typeof GOVERNED_SITE_ASSET_MIME_TYPES[number],
    );
}

export function isGovernedSiteAssetAiEligible(input: GovernedAssetEligibilityInput) {
  return isGovernedSiteAssetPubliclyDeliverable(input) && input.aiUsePermission;
}

/** @deprecated Use the explicit AI or public-delivery policy. */
export const isGovernedSiteAssetEligible = isGovernedSiteAssetAiEligible;

export function governedSiteAssetKind(category: string) {
  switch (category) {
    case 'LOGO': return 'LOGO';
    case 'TEAM_PHOTO': return 'STAFF';
    case 'LOCATION_PHOTO': return 'LOCATION';
    case 'SERVICE_PHOTO': return 'SERVICE';
    case 'RESULT_PHOTO': return 'RESULT';
    default: return null;
  }
}

export {
  applyGovernedEntityAssetBindings,
  type GovernedEntityAssetBinding,
} from '@ks-os/site-schema';
