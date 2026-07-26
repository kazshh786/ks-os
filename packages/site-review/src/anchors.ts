import type { CommentAnchor } from './contracts.js';

export function resolveCommentAnchor(input: {
  anchor: CommentAnchor;
  pageExists: boolean;
  sectionExists?: boolean;
  fieldExists?: boolean;
  currentContentDigest?: string;
}): 'CURRENT' | 'OUTDATED' | 'REQUIRES_REANCHOR' {
  if (!input.pageExists) return 'REQUIRES_REANCHOR';
  if (input.anchor.sectionPublicReference && input.sectionExists === false) {
    return 'REQUIRES_REANCHOR';
  }
  if (input.anchor.fieldPath && input.fieldExists === false) {
    return 'REQUIRES_REANCHOR';
  }
  if (
    input.anchor.contentDigest
    && input.currentContentDigest
    && input.anchor.contentDigest !== input.currentContentDigest
  ) {
    return 'OUTDATED';
  }
  return 'CURRENT';
}
