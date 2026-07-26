import {
  EMPTY_TEMPLATE_RESPONSIVE_SIGNALS,
  TemplateManifestSchema,
  type SitePageType,
  type TemplateManifest,
  type TemplateManifestLayout,
  type TemplateSourceType,
} from '@ks-os/contracts';
import type { AnalysedTemplateLayout } from './types.js';

interface ManifestLayoutIdentity {
  layoutReference: string;
  layoutKey: string;
  allowedPageTypes?: SitePageType[];
  enabled?: boolean;
}

export function createTemplateManifest(input: {
  templateVersionReference: string;
  sourceType: TemplateSourceType;
  name: string;
  industryTags?: string[];
  designSignals: TemplateManifest['designSignals'];
  layouts: Array<{
    identity: ManifestLayoutIdentity;
    analysed: AnalysedTemplateLayout;
  }>;
  findings?: Array<{
    reference?: string;
    severity: 'BLOCKING' | 'WARNING' | 'INFO';
    category:
      | 'SECURITY'
      | 'STRUCTURE'
      | 'CLASSIFICATION'
      | 'RESPONSIVE'
      | 'ACCESSIBILITY'
      | 'BOOKING_CONVERSION'
      | 'DESIGN_SYSTEM'
      | 'LICENSING';
    code: string;
    filePath: string | null;
    layoutReference?: string | null;
    message: string;
    resolved?: boolean;
  }>;
}): TemplateManifest {
  const layouts: TemplateManifestLayout[] = input.layouts.map(
    ({ identity, analysed }) => {
      const allowedPageTypes = identity.enabled === false
        ? []
        : identity.allowedPageTypes || [];
      const suggestedAdditionalPageTypes =
        analysed.classification.suggestedAdditionalPageTypes.filter(
          (pageType) =>
            pageType !== analysed.classification.recommendedPageType
            && !allowedPageTypes.includes(pageType),
        );
      const incompatiblePageTypes =
        analysed.classification.incompatiblePageTypes.filter(
          (pageType) =>
            !allowedPageTypes.includes(pageType)
            && !suggestedAdditionalPageTypes.includes(pageType),
        );
      return {
        layoutReference: identity.layoutReference,
        layoutKey: identity.layoutKey,
        sourceFile: analysed.sourceFile,
        detectedPageType: analysed.classification.detectedPageType,
        recommendedPageType: analysed.classification.recommendedPageType,
        suggestedAdditionalPageTypes,
        allowedPageTypes,
        incompatiblePageTypes,
        conversionRole: analysed.classification.conversionRole,
        classificationConfidence: analysed.classification.confidence,
        classificationEvidence: analysed.classification.evidence,
        sections: analysed.analysis.sections,
        bookingCtaPositions: [
          ...new Set(analysed.analysis.bookingCtas.map((cta) => cta.position)),
        ],
        responsiveSignals:
          analysed.analysis.responsiveSignals || EMPTY_TEMPLATE_RESPONSIVE_SIGNALS,
        accessibilityConcerns: analysed.analysis.accessibilityConcerns,
        securityConcerns: analysed.analysis.securityConcerns,
        requiresAgencyReview: analysed.classification.requiresAgencyReview,
        enabled: identity.enabled !== false,
      };
    },
  );
  return TemplateManifestSchema.parse({
    schemaVersion: 1,
    templateVersionReference: input.templateVersionReference,
    sourceType: input.sourceType,
    name: input.name,
    industryTags: input.industryTags || [],
    designSignals: input.designSignals,
    layouts,
    findings: input.findings || [],
  });
}

export function assertTemplateVersionMutable(status: string) {
  if (status === 'APPROVED') {
    const error = new Error(
      'Approved template versions are immutable; create a new version.',
    );
    Object.assign(error, { code: 'TEMPLATE_VERSION_IMMUTABLE' });
    throw error;
  }
}

export function assertTemplateApprovalReady(input: {
  manifest: unknown;
  unresolvedBlockingFindings: number;
}) {
  const manifest = TemplateManifestSchema.parse(input.manifest);
  if (input.unresolvedBlockingFindings > 0) {
    const error = new Error(
      'Template approval is blocked by unresolved security or quality findings.',
    );
    Object.assign(error, { code: 'TEMPLATE_APPROVAL_BLOCKED' });
    throw error;
  }
  const hasHome = manifest.layouts.some(
    (layout) => layout.enabled && layout.allowedPageTypes.includes('HOME'),
  );
  if (!hasHome) {
    const error = new Error(
      'A complete production template requires an enabled HOME-compatible layout.',
    );
    Object.assign(error, { code: 'TEMPLATE_HOME_LAYOUT_REQUIRED' });
    throw error;
  }
  return {
    manifest,
    warnings: manifest.layouts.some(
      (layout) =>
        layout.enabled && layout.allowedPageTypes.includes('SERVICE_DETAIL'),
    )
      ? []
      : ['TEMPLATE_SERVICE_DETAIL_LAYOUT_RECOMMENDED'],
  };
}
