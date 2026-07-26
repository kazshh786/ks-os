import type {
  BlueprintAgencyOverride,
  BlueprintPageInput,
  BlueprintStatus,
} from '@ks-os/contracts';
import { canonicalPathIssue } from './slug.js';
import type { BlueprintValidationContext } from './types.js';
import { validateBlueprint } from './validation.js';

export class BlueprintMutationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'BlueprintMutationError';
  }
}

export function assertBlueprintMutable(status: BlueprintStatus) {
  if (!['DRAFT', 'REVIEW_REQUIRED'].includes(status)) {
    throw new BlueprintMutationError(
      'BLUEPRINT_IMMUTABLE',
      'Only draft or review-required blueprints may be edited.',
    );
  }
}

export function assertBlueprintPageRemovalAllowed(
  page: Pick<BlueprintPageInput, 'pageType'>,
) {
  if (page.pageType === 'HOME' || page.pageType === 'BOOKING') {
    throw new BlueprintMutationError(
      `${page.pageType}_REMOVAL_FORBIDDEN`,
      `${page.pageType} is required and cannot be removed.`,
    );
  }
}

export function createDraftRevision<T extends {
  status: BlueprintStatus;
  revision: number;
  pages: readonly BlueprintPageInput[];
}>(approved: T) {
  if (approved.status !== 'APPROVED') {
    throw new BlueprintMutationError(
      'BLUEPRINT_REVISION_SOURCE_NOT_APPROVED',
      'Only an approved blueprint can be revised with this operation.',
    );
  }
  return {
    status: 'DRAFT' as const,
    revision: approved.revision + 1,
    pages: approved.pages.map((page) => ({
      ...page,
      reference: undefined,
      bookingRequirements: page.bookingRequirements.map((requirement) => ({
        ...requirement,
        action: { ...requirement.action },
      })),
      selectionReasons: [...page.selectionReasons],
    })),
  };
}

export function validateAgencyOverride(input: {
  status: BlueprintStatus;
  pages: readonly BlueprintPageInput[];
  override: BlueprintAgencyOverride;
  validationContext: BlueprintValidationContext;
}) {
  assertBlueprintMutable(input.status);
  if (input.override.operation === 'REMOVE_PAGE') {
    const pageReference = input.override.pageReference;
    const page = input.pages.find(
      (item) => item.reference === pageReference,
    );
    if (!page) {
      throw new BlueprintMutationError('BLUEPRINT_PAGE_NOT_FOUND', 'Page not found.');
    }
    assertBlueprintPageRemovalAllowed(page);
  }
  if (input.override.operation === 'UPDATE_PAGE') {
    const pageReference = input.override.pageReference;
    const page = input.pages.find(
      (item) => item.reference === pageReference,
    );
    if (!page) {
      throw new BlueprintMutationError('BLUEPRINT_PAGE_NOT_FOUND', 'Page not found.');
    }
    if (input.override.changes.plannedSlug) {
      const issue = canonicalPathIssue(
        input.override.changes.plannedSlug,
        page.pageType,
      );
      if (issue) {
        throw new BlueprintMutationError(issue, 'The requested path is invalid.');
      }
    }
  }
  if (input.override.operation === 'ADD_PAGE') {
    const result = validateBlueprint({
      pages: [...input.pages, input.override.page],
      context: input.validationContext,
    });
    const newBlocking = result.findings.find(
      (item) => item.severity === 'BLOCKING',
    );
    if (newBlocking) {
      throw new BlueprintMutationError(newBlocking.code, newBlocking.message);
    }
  }
  if (input.override.operation === 'REORDER_PAGES') {
    if (
      new Set(input.override.pageReferences).size !== input.pages.length
      || input.override.pageReferences.some(
        (reference) => !input.pages.some((page) => page.reference === reference),
      )
    ) {
      throw new BlueprintMutationError(
        'BLUEPRINT_REORDER_INVALID',
        'Reordering must include every page exactly once.',
      );
    }
  }
  return true;
}
