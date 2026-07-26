import type {
  BlueprintComparison,
  BlueprintPageSummary,
} from '@ks-os/contracts';

export function compareBlueprints(input: {
  fromBlueprintReference: string;
  toBlueprintReference: string;
  fromPages: readonly BlueprintPageSummary[];
  toPages: readonly BlueprintPageSummary[];
}): BlueprintComparison {
  const from = new Map(input.fromPages.map((page) => [page.reference, page]));
  const to = new Map(input.toPages.map((page) => [page.reference, page]));
  const addedPages = input.toPages.filter((page) => !from.has(page.reference));
  const removedPages = input.fromPages.filter((page) => !to.has(page.reference));
  const changedPages = input.toPages.flatMap((toPage) => {
    const fromPage = from.get(toPage.reference);
    if (!fromPage) return [];
    const changedFields = [
      'pageType',
      'conversionRole',
      'titleLabel',
      'plannedSlug',
      'navigationGroup',
      'navigationOrder',
      'layoutReference',
    ].filter((field) =>
      fromPage[field as keyof BlueprintPageSummary]
      !== toPage[field as keyof BlueprintPageSummary]);
    return changedFields.length > 0
      ? [{ from: fromPage, to: toPage, changedFields }]
      : [];
  });
  return {
    fromBlueprintReference: input.fromBlueprintReference,
    toBlueprintReference: input.toBlueprintReference,
    addedPages,
    removedPages,
    changedPages,
    entitlementDelta:
      input.toPages.filter((page) => page.consumesMarketingEntitlement).length
      - input.fromPages.filter((page) => page.consumesMarketingEntitlement).length,
  };
}
