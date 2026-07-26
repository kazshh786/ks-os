import { createHash } from 'node:crypto';
import { SiteReviewPolicyError } from './lifecycle.js';

export type StructuredChangeType = 'ADDED' | 'REMOVED' | 'CHANGED' | 'MOVED' | 'UNCHANGED';

export interface ComparableSection {
  publicReference: string;
  sectionType: string;
  displayOrder: number;
  content: unknown;
}

export interface ComparablePage {
  publicReference: string;
  slug: string;
  displayOrder: number;
  metadata: unknown;
  navigation: unknown;
  bookingAction: unknown;
  internalLinks: unknown;
  structuredDataInputs: unknown;
  assetReferences: unknown;
  sections: ComparableSection[];
}

export interface ComparableFact {
  matchKey: string;
  publicReference: string;
  factType: string;
  value: unknown;
}

export interface ComparableFinding {
  matchKey: string;
  publicReference: string;
  code: string;
  value: unknown;
}

export interface ComparableSiteVersion {
  tenantReference: string;
  siteReference: string;
  versionReference: string;
  pages: ComparablePage[];
  facts?: ComparableFact[];
  findings?: ComparableFinding[];
}

export interface StructuredFieldDiff {
  targetType: 'PAGE' | 'SECTION' | 'FIELD' | 'FACT' | 'GENERATION_FINDING';
  changeType: StructuredChangeType;
  pageReference?: string;
  sectionReference?: string;
  factReference?: string;
  findingReference?: string;
  fieldPath?: string;
  previousValue?: unknown;
  currentValue?: unknown;
}

export interface StructuredVersionComparison {
  fromVersionReference: string;
  toVersionReference: string;
  digestSha256: string;
  truncated: boolean;
  summary: Record<StructuredChangeType, number>;
  changes: StructuredFieldDiff[];
}

function normalized(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(normalized).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${normalized(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function equal(left: unknown, right: unknown): boolean {
  return normalized(left) === normalized(right);
}

function pushFieldDiffs(
  changes: StructuredFieldDiff[],
  pageReference: string,
  prefix: string,
  previous: unknown,
  current: unknown,
  sectionReference?: string,
): void {
  if (equal(previous, current)) return;
  if (
    previous
    && current
    && typeof previous === 'object'
    && typeof current === 'object'
    && !Array.isArray(previous)
    && !Array.isArray(current)
  ) {
    const keys = new Set([
      ...Object.keys(previous as Record<string, unknown>),
      ...Object.keys(current as Record<string, unknown>),
    ]);
    for (const key of [...keys].sort()) {
      const left = (previous as Record<string, unknown>)[key];
      const right = (current as Record<string, unknown>)[key];
      pushFieldDiffs(
        changes,
        pageReference,
        prefix ? `${prefix}.${key}` : key,
        left,
        right,
        sectionReference,
      );
    }
    return;
  }
  changes.push({
    targetType: 'FIELD',
    changeType: previous === undefined ? 'ADDED' : current === undefined ? 'REMOVED' : 'CHANGED',
    pageReference,
    ...(sectionReference ? { sectionReference } : {}),
    fieldPath: prefix,
    ...(previous === undefined ? {} : { previousValue: previous }),
    ...(current === undefined ? {} : { currentValue: current }),
  });
}

export function compareStructuredSiteVersions(
  previous: ComparableSiteVersion,
  current: ComparableSiteVersion,
  maxChanges = 1_000,
): StructuredVersionComparison {
  if (previous.tenantReference !== current.tenantReference) {
    throw new SiteReviewPolicyError('SITE_REVIEW_COMPARISON_CROSS_TENANT', 'Versions must belong to the same tenant.');
  }
  if (previous.siteReference !== current.siteReference) {
    throw new SiteReviewPolicyError('SITE_REVIEW_COMPARISON_CROSS_SITE', 'Versions must belong to the same site.');
  }

  const changes: StructuredFieldDiff[] = [];
  const oldPages = new Map(previous.pages.map((page) => [page.publicReference, page]));
  const newPages = new Map(current.pages.map((page) => [page.publicReference, page]));
  for (const pageReference of [...new Set([...oldPages.keys(), ...newPages.keys()])].sort()) {
    const oldPage = oldPages.get(pageReference);
    const newPage = newPages.get(pageReference);
    if (!oldPage || !newPage) {
      changes.push({
        targetType: 'PAGE',
        changeType: oldPage ? 'REMOVED' : 'ADDED',
        pageReference,
      });
      continue;
    }
    if (oldPage.displayOrder !== newPage.displayOrder) {
      changes.push({ targetType: 'PAGE', changeType: 'MOVED', pageReference, fieldPath: 'displayOrder', previousValue: oldPage.displayOrder, currentValue: newPage.displayOrder });
    }
    for (const field of ['slug', 'metadata', 'navigation', 'bookingAction', 'internalLinks', 'structuredDataInputs', 'assetReferences'] as const) {
      pushFieldDiffs(changes, pageReference, field, oldPage[field], newPage[field]);
    }
    const oldSections = new Map(oldPage.sections.map((section) => [section.publicReference, section]));
    const newSections = new Map(newPage.sections.map((section) => [section.publicReference, section]));
    for (const sectionReference of [...new Set([...oldSections.keys(), ...newSections.keys()])].sort()) {
      const oldSection = oldSections.get(sectionReference);
      const newSection = newSections.get(sectionReference);
      if (!oldSection || !newSection) {
        changes.push({
          targetType: 'SECTION',
          changeType: oldSection ? 'REMOVED' : 'ADDED',
          pageReference,
          sectionReference,
        });
        continue;
      }
      if (oldSection.displayOrder !== newSection.displayOrder) {
        changes.push({
          targetType: 'SECTION',
          changeType: 'MOVED',
          pageReference,
          sectionReference,
          fieldPath: 'displayOrder',
          previousValue: oldSection.displayOrder,
          currentValue: newSection.displayOrder,
        });
      }
      pushFieldDiffs(changes, pageReference, 'sectionType', oldSection.sectionType, newSection.sectionType, sectionReference);
      pushFieldDiffs(changes, pageReference, 'content', oldSection.content, newSection.content, sectionReference);
    }
  }
  const oldFacts = new Map((previous.facts ?? []).map((fact) => [fact.matchKey, fact]));
  const newFacts = new Map((current.facts ?? []).map((fact) => [fact.matchKey, fact]));
  for (const matchKey of [...new Set([...oldFacts.keys(), ...newFacts.keys()])].sort()) {
    const oldFact = oldFacts.get(matchKey);
    const newFact = newFacts.get(matchKey);
    if (!oldFact || !newFact) {
      const fact = newFact ?? oldFact!;
      changes.push({
        targetType: 'FACT',
        changeType: oldFact ? 'REMOVED' : 'ADDED',
        factReference: fact.publicReference,
        fieldPath: fact.factType,
        ...(oldFact ? { previousValue: oldFact.value } : {}),
        ...(newFact ? { currentValue: newFact.value } : {}),
      });
      continue;
    }
    if (!equal(oldFact.value, newFact.value)) {
      changes.push({
        targetType: 'FACT',
        changeType: 'CHANGED',
        factReference: newFact.publicReference,
        fieldPath: newFact.factType,
        previousValue: oldFact.value,
        currentValue: newFact.value,
      });
    }
  }
  const oldFindings = new Map(
    (previous.findings ?? []).map((finding) => [finding.matchKey, finding]),
  );
  const newFindings = new Map(
    (current.findings ?? []).map((finding) => [finding.matchKey, finding]),
  );
  for (
    const matchKey of
    [...new Set([...oldFindings.keys(), ...newFindings.keys()])].sort()
  ) {
    const oldFinding = oldFindings.get(matchKey);
    const newFinding = newFindings.get(matchKey);
    if (!oldFinding || !newFinding) {
      const finding = newFinding ?? oldFinding!;
      changes.push({
        targetType: 'GENERATION_FINDING',
        changeType: oldFinding ? 'REMOVED' : 'ADDED',
        findingReference: finding.publicReference,
        fieldPath: finding.code,
      });
      continue;
    }
    if (!equal(oldFinding.value, newFinding.value)) {
      changes.push({
        targetType: 'GENERATION_FINDING',
        changeType: 'CHANGED',
        findingReference: newFinding.publicReference,
        fieldPath: newFinding.code,
        previousValue: oldFinding.value,
        currentValue: newFinding.value,
      });
    }
  }

  const fullDigest = createHash('sha256').update(normalized(changes)).digest('hex');
  const visibleChanges = changes.slice(0, Math.max(1, Math.min(maxChanges, 2_000)));
  const summary: Record<StructuredChangeType, number> = {
    ADDED: 0,
    REMOVED: 0,
    CHANGED: 0,
    MOVED: 0,
    UNCHANGED: 0,
  };
  for (const change of changes) summary[change.changeType] += 1;
  if (changes.length === 0) summary.UNCHANGED = 1;
  return {
    fromVersionReference: previous.versionReference,
    toVersionReference: current.versionReference,
    digestSha256: fullDigest,
    truncated: visibleChanges.length !== changes.length,
    summary,
    changes: visibleChanges,
  };
}
