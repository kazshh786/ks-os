import type { TemplateSourceType } from '@ks-os/contracts';

export interface TemplateLicenceContext {
  sourceType: TemplateSourceType;
  siteReference: string;
  templateVersionReference: string;
  licence: {
    status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
    expiresAt: Date | null;
  } | null;
}

export interface TemplateLicenceRepository {
  findLicenceContext(input: {
    siteReference: string;
    templateVersionReference: string;
  }): Promise<TemplateLicenceContext | null>;
}

export class TemplateLicenceRequiredError extends Error {
  readonly code = 'TEMPLATE_LICENCE_REQUIRED';

  constructor(message = 'A valid site-specific Envato licence is required.') {
    super(message);
    this.name = 'TemplateLicenceRequiredError';
  }
}

export class TemplateLicenceGuard {
  constructor(private readonly repository: TemplateLicenceRepository) {}

  async assertTemplateLicensedForSite(input: {
    siteReference: string;
    templateVersionReference: string;
    now?: Date;
  }) {
    const context = await this.repository.findLicenceContext(input);
    if (!context) {
      throw new TemplateLicenceRequiredError(
        'The site or template version could not be resolved.',
      );
    }
    if (context.sourceType !== 'ENVATO_HTML') {
      return {
        required: false,
        licensed: true,
        sourceType: context.sourceType,
      };
    }
    const now = input.now || new Date();
    const licensed =
      context.licence?.status === 'ACTIVE'
      && (!context.licence.expiresAt || context.licence.expiresAt > now);
    if (!licensed) throw new TemplateLicenceRequiredError();
    return {
      required: true,
      licensed: true,
      sourceType: context.sourceType,
    };
  }
}
