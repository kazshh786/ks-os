import type {
  SiteConversionRole,
  SitePageType,
  TemplateBookingCtaPosition,
  TemplateDesignSignals,
  TemplateDetectedPageType,
  TemplateFindingCategory,
  TemplateFindingSeverity,
  TemplateManifestSection,
  TemplateResponsiveSignals,
} from '@ks-os/contracts';

export type TemplateArchiveEntryKind = 'FILE' | 'SYMLINK' | 'HARDLINK';

export interface TemplateInputFile {
  relativePath: string;
  kind?: TemplateArchiveEntryKind;
  byteSize?: number;
  content?: string | Uint8Array;
}

export interface TemplateInventoryLimits {
  maxFileCount: number;
  maxExtractedBytes: number;
  maxIndividualFileBytes: number;
}

export interface TemplateFileInventoryEntry {
  relativePath: string;
  category:
    | 'HTML'
    | 'CSS'
    | 'JAVASCRIPT'
    | 'IMAGE'
    | 'FONT'
    | 'SVG'
    | 'JSON'
    | 'DOCUMENTATION'
    | 'BUILD_CONFIG'
    | 'UNKNOWN';
  extension: string;
  byteSize: number;
  sha256: string | null;
  likelyPageCandidate: boolean;
  referencedByAnalysedFile: boolean;
  containsExecutableCode: boolean;
  safeForPublicUse: boolean;
  requiresAgencyReview: boolean;
}

export interface HtmlHeadingSignal {
  level: number;
  text: string;
}

export interface HtmlBookingCtaSignal {
  label: string;
  structuralReference: string;
  position: TemplateBookingCtaPosition;
}

export interface HtmlPageAnalysis {
  title: string | null;
  metaDescription: string | null;
  canonicalHref: string | null;
  language: string | null;
  hasHeader: boolean;
  hasNavigation: boolean;
  hasMain: boolean;
  hasFooter: boolean;
  headings: HtmlHeadingSignal[];
  hasBreadcrumbs: boolean;
  formCount: number;
  linkCount: number;
  buttonCount: number;
  imageCount: number;
  sectionCount: number;
  hasStructuredData: boolean;
  scriptReferences: string[];
  stylesheetReferences: string[];
  inlineStyleCount: number;
  internalLinks: string[];
  sections: TemplateManifestSection[];
  bookingCtas: HtmlBookingCtaSignal[];
  responsiveSignals: TemplateResponsiveSignals;
  accessibilityConcerns: string[];
  securityConcerns: string[];
  textSignals: string[];
}

export interface TemplateLayoutClassification {
  detectedPageType: TemplateDetectedPageType;
  recommendedPageType: SitePageType | null;
  suggestedAdditionalPageTypes: SitePageType[];
  incompatiblePageTypes: SitePageType[];
  conversionRole: SiteConversionRole;
  confidence: number;
  confidenceBand: 'LOW' | 'MEDIUM' | 'HIGH';
  evidence: string[];
  missingExpectedSections: string[];
  requiresAgencyReview: boolean;
}

export interface TemplateAnalysisFinding {
  severity: TemplateFindingSeverity;
  category: TemplateFindingCategory;
  code: string;
  filePath: string | null;
  message: string;
}

export interface AnalysedTemplateLayout {
  sourceFile: string;
  analysis: HtmlPageAnalysis;
  classification: TemplateLayoutClassification;
}

export interface TrustedTemplateAnalysis {
  files: TemplateFileInventoryEntry[];
  layouts: AnalysedTemplateLayout[];
  designSignals: TemplateDesignSignals;
  findings: TemplateAnalysisFinding[];
  artifactDigestSha256: string;
}
