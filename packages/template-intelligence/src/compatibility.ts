import type { SitePageType } from '@ks-os/contracts';

export interface ApprovedLayoutCompatibility {
  layoutReference: string;
  templateVersionReference: string;
  templateVersionApproved: boolean;
  enabled: boolean;
  approvedPageTypes: readonly SitePageType[];
}

export interface TemplateCompatibilityRepository {
  findLayout(layoutReference: string): Promise<ApprovedLayoutCompatibility | null>;
  listLayouts(
    templateVersionReference: string,
  ): Promise<readonly ApprovedLayoutCompatibility[]>;
}

export interface LayoutCompatibilityExplanation {
  compatible: boolean;
  code:
    | 'LAYOUT_COMPATIBLE'
    | 'LAYOUT_NOT_FOUND'
    | 'TEMPLATE_VERSION_NOT_APPROVED'
    | 'LAYOUT_DISABLED'
    | 'PAGE_TYPE_NOT_APPROVED';
  message: string;
}

export class TemplateLayoutCompatibilityError extends Error {
  constructor(
    readonly code: LayoutCompatibilityExplanation['code'],
    message: string,
  ) {
    super(message);
    this.name = 'TemplateLayoutCompatibilityError';
  }
}

export class TemplateCompatibilityService {
  constructor(private readonly repository: TemplateCompatibilityRepository) {}

  async explainLayoutCompatibility(input: {
    layoutReference: string;
    pageType: SitePageType;
  }): Promise<LayoutCompatibilityExplanation> {
    const layout = await this.repository.findLayout(input.layoutReference);
    if (!layout) {
      return {
        compatible: false,
        code: 'LAYOUT_NOT_FOUND',
        message: 'The template layout was not found.',
      };
    }
    if (!layout.templateVersionApproved) {
      return {
        compatible: false,
        code: 'TEMPLATE_VERSION_NOT_APPROVED',
        message: 'The template version has not been approved.',
      };
    }
    if (!layout.enabled) {
      return {
        compatible: false,
        code: 'LAYOUT_DISABLED',
        message: 'The template layout is disabled.',
      };
    }
    if (!layout.approvedPageTypes.includes(input.pageType)) {
      return {
        compatible: false,
        code: 'PAGE_TYPE_NOT_APPROVED',
        message: `The layout is not approved for ${input.pageType}.`,
      };
    }
    return {
      compatible: true,
      code: 'LAYOUT_COMPATIBLE',
      message: `The layout is approved for ${input.pageType}.`,
    };
  }

  async isLayoutCompatible(input: {
    layoutReference: string;
    pageType: SitePageType;
  }) {
    return (await this.explainLayoutCompatibility(input)).compatible;
  }

  async assertLayoutCompatible(input: {
    layoutReference: string;
    pageType: SitePageType;
  }) {
    const explanation = await this.explainLayoutCompatibility(input);
    if (!explanation.compatible) {
      throw new TemplateLayoutCompatibilityError(
        explanation.code,
        explanation.message,
      );
    }
    return explanation;
  }

  async listCompatibleLayouts(input: {
    templateVersionReference: string;
    pageType: SitePageType;
  }) {
    const layouts = await this.repository.listLayouts(
      input.templateVersionReference,
    );
    return layouts.filter(
      (layout) =>
        layout.templateVersionApproved
        && layout.enabled
        && layout.approvedPageTypes.includes(input.pageType),
    );
  }
}
