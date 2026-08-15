export interface GovernedEntityAssetBinding {
  publicReference: string;
  assetClass: 'LOGO' | 'BRAND' | 'SERVICE' | 'STAFF' | 'LOCATION' | 'GALLERY' | 'RESULT' | 'DECORATIVE';
  entityReference?: string;
}

/**
 * Applies governed asset bindings to the public entity model. Staff and
 * service imagery requires an exact entity reference; unbound imagery is
 * intentionally left available only to generic section slots.
 */
export function applyGovernedEntityAssetBindings<TBusiness, TService, TStaff>(input: {
  assets: readonly GovernedEntityAssetBinding[];
  availableAssetReferences: ReadonlySet<string>;
  business: TBusiness;
  services: readonly (TService & { publicReference: string })[];
  staff: readonly (TStaff & { publicReference: string })[];
}) {
  const available = input.assets
    .filter(asset => input.availableAssetReferences.has(asset.publicReference))
    .sort((left, right) => left.publicReference.localeCompare(right.publicReference));
  const logo = available.find(asset => asset.assetClass === 'LOGO');
  const entityAsset = (assetClass: 'SERVICE' | 'STAFF', entityReference: string) =>
    available.find(asset =>
      asset.assetClass === assetClass && asset.entityReference === entityReference);
  return {
    business: {
      ...input.business,
      ...(logo ? { logoAssetReference: logo.publicReference } : {}),
    },
    services: input.services.map(service => {
      const asset = entityAsset('SERVICE', service.publicReference);
      return { ...service, ...(asset ? { imageAssetReference: asset.publicReference } : {}) };
    }),
    staff: input.staff.map(staff => {
      const asset = entityAsset('STAFF', staff.publicReference);
      return { ...staff, ...(asset ? { imageAssetReference: asset.publicReference } : {}) };
    }),
  };
}
