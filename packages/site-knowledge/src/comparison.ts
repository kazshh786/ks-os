import type {
  KnowledgeConflict,
  KnowledgeImportBundle,
  KnowledgeRule,
} from './contracts.js';
import { stableStringify } from './normalization.js';

export interface KnowledgePackComparison {
  addedRuleIds: string[];
  removedRuleIds: string[];
  changedRuleIds: string[];
  priorityChanges: Array<{ ruleId: string; from: string; to: string }>;
  publicationEffectChanges: Array<{ ruleId: string; from: string; to: string }>;
  validationTypeChanges: Array<{ ruleId: string; from: string; to: string }>;
  applicabilityChanges: string[];
  sourceChanges: string[];
  pagePlaybookChanges: string[];
  sectionPlaybookChanges: string[];
  newConflicts: string[];
  resolvedConflicts: string[];
}

function mapRules(rules: readonly KnowledgeRule[]) {
  return new Map(rules.map(rule => [rule.ruleId, rule]));
}

function conflictKey(conflict: KnowledgeConflict) {
  return [
    conflict.conflictType,
    [...conflict.ruleIds].sort().join(':'),
    conflict.pageType,
    conflict.sectionType,
  ].join(':');
}

export function compareKnowledgePacks(
  left: KnowledgeImportBundle,
  right: KnowledgeImportBundle,
  leftConflicts: readonly KnowledgeConflict[] = [],
  rightConflicts: readonly KnowledgeConflict[] = [],
): KnowledgePackComparison {
  const leftRules = mapRules(left.rules);
  const rightRules = mapRules(right.rules);
  const addedRuleIds = [...rightRules.keys()]
    .filter(ruleId => !leftRules.has(ruleId))
    .sort();
  const removedRuleIds = [...leftRules.keys()]
    .filter(ruleId => !rightRules.has(ruleId))
    .sort();
  const changedRuleIds: string[] = [];
  const priorityChanges: KnowledgePackComparison['priorityChanges'] = [];
  const publicationEffectChanges:
    KnowledgePackComparison['publicationEffectChanges'] = [];
  const validationTypeChanges:
    KnowledgePackComparison['validationTypeChanges'] = [];
  const applicabilityChanges: string[] = [];
  for (const [ruleId, before] of leftRules) {
    const after = rightRules.get(ruleId);
    if (!after) continue;
    if (before.contentDigest !== after.contentDigest) changedRuleIds.push(ruleId);
    if (before.priority !== after.priority) {
      priorityChanges.push({ ruleId, from: before.priority, to: after.priority });
    }
    if (before.publicationEffect !== after.publicationEffect) {
      publicationEffectChanges.push({
        ruleId,
        from: before.publicationEffect,
        to: after.publicationEffect,
      });
    }
    if (before.validationType !== after.validationType) {
      validationTypeChanges.push({
        ruleId,
        from: before.validationType,
        to: after.validationType,
      });
    }
    if (stableStringify({
      pages: before.applicablePageTypes,
      sections: before.applicableSectionTypes,
      roles: before.conversionRoles,
    }) !== stableStringify({
      pages: after.applicablePageTypes,
      sections: after.applicableSectionTypes,
      roles: after.conversionRoles,
    })) {
      applicabilityChanges.push(ruleId);
    }
  }
  const leftSources = new Map(
    left.sources.map(source => [source.sourceId, source.contentDigest]),
  );
  const rightSources = new Map(
    right.sources.map(source => [source.sourceId, source.contentDigest]),
  );
  const sourceChanges = [...new Set([
    ...[...leftSources].filter(([id, digest]) =>
      rightSources.get(id) !== digest).map(([id]) => id),
    ...[...rightSources].filter(([id, digest]) =>
      leftSources.get(id) !== digest).map(([id]) => id),
  ])].sort();
  const playbookKey = (
    page: KnowledgeImportBundle['pagePlaybooks'][number],
  ) => `${page.pageType}:${page.conversionRole}`;
  const leftPlaybooks = new Map(left.pagePlaybooks.map(page =>
    [playbookKey(page), page]));
  const rightPlaybooks = new Map(right.pagePlaybooks.map(page =>
    [playbookKey(page), page]));
  const pagePlaybookChanges = [...new Set([
    ...[...leftPlaybooks].filter(([key, page]) =>
      rightPlaybooks.get(key)?.contentDigest !== page.contentDigest)
      .map(([key]) => key),
    ...[...rightPlaybooks].filter(([key, page]) =>
      leftPlaybooks.get(key)?.contentDigest !== page.contentDigest)
      .map(([key]) => key),
  ])].sort();
  const sectionPlaybookChanges = pagePlaybookChanges.flatMap(key => {
    const before = leftPlaybooks.get(key);
    const after = rightPlaybooks.get(key);
    const beforeSections = new Map(before?.sections.map(section =>
      [section.sectionType, section.contentDigest]) ?? []);
    const afterSections = new Map(after?.sections.map(section =>
      [section.sectionType, section.contentDigest]) ?? []);
    return [...new Set([
      ...[...beforeSections].filter(([section, digest]) =>
        afterSections.get(section) !== digest).map(([section]) => `${key}:${section}`),
      ...[...afterSections].filter(([section, digest]) =>
        beforeSections.get(section) !== digest).map(([section]) => `${key}:${section}`),
    ])];
  }).sort();
  const leftOpen = new Set(
    leftConflicts.filter(entry => !entry.resolved).map(conflictKey),
  );
  const rightOpen = new Set(
    rightConflicts.filter(entry => !entry.resolved).map(conflictKey),
  );
  return {
    addedRuleIds,
    removedRuleIds,
    changedRuleIds: changedRuleIds.sort(),
    priorityChanges,
    publicationEffectChanges,
    validationTypeChanges,
    applicabilityChanges: applicabilityChanges.sort(),
    sourceChanges,
    pagePlaybookChanges,
    sectionPlaybookChanges,
    newConflicts: [...rightOpen].filter(key => !leftOpen.has(key)).sort(),
    resolvedConflicts: [...leftOpen].filter(key => !rightOpen.has(key)).sort(),
  };
}
