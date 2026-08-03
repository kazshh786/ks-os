const clientVisibleCategories = new Set([
  'ACCESSIBILITY',
  'BOOKING_INTEGRITY',
  'ASSET_READINESS',
  'REVIEW_AND_APPROVAL',
]);

export function toClientSafeQualitySummary(input: {
  status: string;
  requiredClientActions: readonly string[];
  missingFacts: number;
  missingAssets: number;
  bookingStatus: string;
  accessibilityStatus: string;
  findings: readonly {
    reference: string;
    category: string;
    code: string;
    message: string;
    clientVisible?: boolean;
  }[];
}) {
  return {
    status: input.status,
    requiredClientActions: [...input.requiredClientActions],
    missingFacts: input.missingFacts,
    missingAssets: input.missingAssets,
    bookingStatus: input.bookingStatus,
    accessibilityStatus: input.accessibilityStatus,
    changesRequiringConfirmation: input.findings
      .filter((finding) =>
        finding.clientVisible === true
        && clientVisibleCategories.has(finding.category))
      .map((finding) => ({
        reference: finding.reference,
        category: finding.category,
        code: finding.code,
        message: finding.message,
      })),
  };
}
