import type { SiteComponentAssetSlot } from '@ks-os/site-components';
import type {
  ApprovedGenerationAsset,
  AssetCoveragePlan,
  GenerationFinding,
  PageCompositionPlan,
  VerifiedBusinessFacts,
} from './contracts.js';

const SLOT_CLASS: Record<SiteComponentAssetSlot, readonly ApprovedGenerationAsset['assetClass'][]> = {
  LOGO: ['LOGO'],
  PRIMARY_IMAGE: ['BRAND', 'SERVICE', 'STAFF', 'LOCATION', 'GALLERY'],
  SECONDARY_IMAGE: ['BRAND', 'SERVICE', 'STAFF', 'LOCATION', 'GALLERY', 'DECORATIVE'],
  PORTRAIT: ['STAFF'],
  LOCATION_IMAGE: ['LOCATION'],
  GALLERY_SET: ['GALLERY', 'BRAND', 'SERVICE', 'LOCATION'],
  RESULT_PAIR: ['RESULT'],
  DECORATIVE_IMAGE: ['DECORATIVE', 'BRAND'],
};

const PLACEHOLDER: Record<SiteComponentAssetSlot, AssetCoveragePlan['assignments'][number]['placeholderCode']> = {
  LOGO: 'BRAND_IMAGE_REQUIRED',
  PRIMARY_IMAGE: 'SERVICE_IMAGE_REQUIRED',
  SECONDARY_IMAGE: 'BRAND_IMAGE_REQUIRED',
  PORTRAIT: 'STAFF_PORTRAIT_REQUIRED',
  LOCATION_IMAGE: 'LOCATION_IMAGE_REQUIRED',
  GALLERY_SET: 'GALLERY_ASSET_REQUIRED',
  RESULT_PAIR: 'RESULT_ASSET_REQUIRED',
  DECORATIVE_IMAGE: 'BRAND_IMAGE_REQUIRED',
};

function isSlotEligible(asset: ApprovedGenerationAsset, slot: SiteComponentAssetSlot) {
  if (!SLOT_CLASS[slot].includes(asset.assetClass)) return false;
  // A portrait is an assertion about a specific person. Generic team imagery
  // may still support primary/secondary section slots, but never a portrait.
  if (slot === 'PORTRAIT') return Boolean(asset.entityReference);
  return true;
}

export function buildApprovedAssetInventory(
  facts: VerifiedBusinessFacts,
): readonly ApprovedGenerationAsset[] {
  if (facts.approvedAssets?.length) return facts.approvedAssets;
  // V1 fact snapshots expose only governed public references. Preserve them as
  // approved brand assets until the richer classifier is available; never infer
  // tenant-external URLs or identifiers.
  return facts.assetReferences.map(publicReference => ({
    publicReference,
    assetClass: 'BRAND' as const,
    approved: true as const,
  }));
}

export function validateAssetCoveragePlan(input: {
  plan: AssetCoveragePlan;
  facts: VerifiedBusinessFacts;
  approvedPageReferences: readonly string[];
}): GenerationFinding[] {
  const findings: GenerationFinding[] = [];
  const approvedAssets = new Set(buildApprovedAssetInventory(input.facts).map(asset => asset.publicReference));
  const approvedPages = new Set(input.approvedPageReferences);
  for (const assignment of input.plan.assignments) {
    if (!approvedPages.has(assignment.pageReference)) {
      findings.push({ severity: 'ERROR', category: 'ASSET', code: 'ASSET_PAGE_NOT_APPROVED', message: 'An asset assignment targets a page outside the approved blueprint.' });
    }
    if (assignment.assetReference && !approvedAssets.has(assignment.assetReference)) {
      findings.push({ severity: 'ERROR', category: 'ASSET', code: 'CROSS_TENANT_ASSET_REJECTED', message: 'An asset assignment is not in the tenant-scoped approved inventory.', targetReference: assignment.pageReference });
    }
    if (assignment.placeholderCode) {
      findings.push({ severity: 'REVIEW', category: 'ASSET', code: 'MISSING_REQUIRED_ASSET', message: `${assignment.placeholderCode} is represented by a private preview-only placeholder.`, targetReference: assignment.pageReference });
    }
  }
  return findings;
}

export function createDeterministicAssetCoveragePlan(input: {
  facts: VerifiedBusinessFacts;
  pages: readonly PageCompositionPlan[];
  requiredSlotsByComponentKey: ReadonlyMap<string, readonly SiteComponentAssetSlot[]>;
}): AssetCoveragePlan {
  const inventory = [...buildApprovedAssetInventory(input.facts)];
  const used = new Set<string>();
  const assignments: AssetCoveragePlan['assignments'] = [];
  const uncoveredRequirements: AssetCoveragePlan['uncoveredRequirements'] = [];
  for (const page of input.pages) {
    for (const selection of page.selectedComponents) {
      for (const slot of input.requiredSlotsByComponentKey.get(selection.componentKey) ?? []) {
        const preferredReference = selection.assetAssignments?.find(
          assignment => assignment.slot === slot,
        )?.assetReference;
        const preferred = preferredReference
          ? inventory.find(asset => asset.publicReference === preferredReference)
          : undefined;
        const matching = preferred
          && !used.has(preferred.publicReference)
          && isSlotEligible(preferred, slot)
          ? preferred
          : inventory.find(asset =>
          !used.has(asset.publicReference) && isSlotEligible(asset, slot));
        if (matching) {
          used.add(matching.publicReference);
          assignments.push({
            pageReference: page.pageReference,
            sectionType: selection.sectionType,
            componentKey: selection.componentKey,
            slot,
            assetReference: matching.publicReference,
          });
        } else {
          const placeholderCode = PLACEHOLDER[slot]!;
          assignments.push({
            pageReference: page.pageReference,
            sectionType: selection.sectionType,
            componentKey: selection.componentKey,
            slot,
            placeholderCode,
          });
          uncoveredRequirements.push({
            pageReference: page.pageReference,
            componentKey: selection.componentKey,
            slot,
            placeholderCode,
          });
        }
      }
    }
  }
  return { inventory, assignments, uncoveredRequirements };
}
