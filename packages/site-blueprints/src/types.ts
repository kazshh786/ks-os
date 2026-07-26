import type {
  BlueprintActionItemCategory,
  BlueprintActionItemSeverity,
  BlueprintEntitlementUsage,
  BlueprintGenerationRequest,
  BlueprintPageInput,
  BlueprintReadinessAssessment,
  BlueprintValidationResult,
  PlanKey,
  SitePageType,
  TemplateSourceType,
} from '@ks-os/contracts';

export const BLUEPRINT_ENGINE_VERSION = '15.4.0';

export interface BlueprintLayoutInput {
  reference: string;
  templateVersionReference: string;
  approved: boolean;
  enabled: boolean;
  approvedPageTypes: readonly SitePageType[];
}

export interface BlueprintServiceInput {
  reference: string;
  tenantReference: string;
  name: string;
  description: string | null;
  durationMinutes: number | null;
  priceMinor: number | null;
  active: boolean;
  bookingEligible: boolean;
  updatedAt: string;
}

export interface BlueprintLocationInput {
  reference: string;
  tenantReference: string;
  name: string;
  active: boolean;
  primary: boolean;
  addressComplete: boolean;
  openingHoursComplete: boolean;
  telephonePresent: boolean;
  updatedAt: string;
}

export interface BlueprintStaffInput {
  reference: string;
  tenantReference: string;
  name: string;
  active: boolean;
  bookingEnabled: boolean;
  publicProfileAllowed: boolean;
  biographyPresent: boolean;
  rolePresent: boolean;
  imagePresent: boolean;
  serviceAssignmentCount: number;
  updatedAt: string;
}

export interface BlueprintBusinessInput {
  name: string;
  businessType: string | null;
  profileComplete: boolean;
  contactComplete: boolean;
  brandComplete: boolean;
  approvedResultsAssetCount: number;
}

export interface BlueprintTemplateInput {
  reference: string;
  status: 'APPROVED' | 'UNAPPROVED';
  sourceType: TemplateSourceType;
  licensedForSite: boolean;
  layouts: readonly BlueprintLayoutInput[];
}

export interface BlueprintEngineInput {
  tenantReference: string;
  siteReference: string;
  planKey: PlanKey;
  planAssignmentReference: string;
  marketingPageLimit: number;
  entitlementOverrideApplied: boolean;
  template: BlueprintTemplateInput;
  services: readonly BlueprintServiceInput[];
  locations: readonly BlueprintLocationInput[];
  staff: readonly BlueprintStaffInput[];
  business: BlueprintBusinessInput;
  existingCanonicalPaths: readonly string[];
  request: BlueprintGenerationRequest;
}

export interface PlannedBlueprintActionItem {
  category: BlueprintActionItemCategory;
  severity: BlueprintActionItemSeverity;
  code: string;
  message: string;
  pageReference: null;
  subjectReference: string | null;
  safeMetadata: Record<string, string | number | boolean | null>;
}

export interface BlueprintPlan {
  sourceDataDigest: string;
  engineVersion: string;
  pages: BlueprintPageInput[];
  entitlementUsage: BlueprintEntitlementUsage;
  readiness: BlueprintReadinessAssessment[];
  actionItems: PlannedBlueprintActionItem[];
  validation: BlueprintValidationResult;
}

export interface BlueprintValidationContext {
  tenantReference: string;
  planKey: PlanKey;
  marketingPageLimit: number;
  entitlementOverrideApplied: boolean;
  template: BlueprintTemplateInput;
  services: readonly BlueprintServiceInput[];
  locations: readonly BlueprintLocationInput[];
  staff: readonly BlueprintStaffInput[];
}
