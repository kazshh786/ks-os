import type { KnowledgePackStatus } from './contracts.js';

const TRANSITIONS: Readonly<Record<KnowledgePackStatus, readonly KnowledgePackStatus[]>> = {
  DRAFT: ['IMPORTING', 'REJECTED'],
  IMPORTING: ['REVIEW_REQUIRED'],
  REVIEW_REQUIRED: ['IMPORTING', 'READY_FOR_APPROVAL', 'REJECTED'],
  READY_FOR_APPROVAL: ['IMPORTING', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED'],
  APPROVED: ['ACTIVE', 'RETIRED'],
  ACTIVE: ['RETIRED', 'SUPERSEDED'],
  RETIRED: [],
  REJECTED: [],
  SUPERSEDED: [],
};

export function canTransitionKnowledgePack(
  from: KnowledgePackStatus,
  to: KnowledgePackStatus,
) {
  return TRANSITIONS[from].includes(to);
}

export function assertKnowledgePackTransition(
  from: KnowledgePackStatus,
  to: KnowledgePackStatus,
) {
  if (!canTransitionKnowledgePack(from, to)) {
    throw Object.assign(
      new Error(`Knowledge pack cannot transition from ${from} to ${to}.`),
      { code: 'KNOWLEDGE_PACK_TRANSITION_INVALID' },
    );
  }
}

export function knowledgePackContentIsMutable(status: KnowledgePackStatus) {
  return [
    'DRAFT',
    'IMPORTING',
    'REVIEW_REQUIRED',
    'READY_FOR_APPROVAL',
  ].includes(status);
}

export function assertKnowledgePackContentMutable(status: KnowledgePackStatus) {
  if (!knowledgePackContentIsMutable(status)) {
    throw Object.assign(
      new Error('Approved, active, retired, rejected, and superseded packs are immutable.'),
      { code: 'KNOWLEDGE_PACK_IMMUTABLE' },
    );
  }
}

export function knowledgePackIsSelectable(
  status: KnowledgePackStatus,
  policy: 'ACTIVE_ONLY' | 'APPROVED_OR_ACTIVE' = 'ACTIVE_ONLY',
) {
  return status === 'ACTIVE'
    || (policy === 'APPROVED_OR_ACTIVE' && status === 'APPROVED');
}

export function assertKnowledgePackSelectable(
  status: KnowledgePackStatus,
  policy: 'ACTIVE_ONLY' | 'APPROVED_OR_ACTIVE' = 'ACTIVE_ONLY',
) {
  if (!knowledgePackIsSelectable(status, policy)) {
    throw Object.assign(
      new Error('This knowledge pack is not selectable for generation.'),
      { code: 'KNOWLEDGE_PACK_NOT_SELECTABLE' },
    );
  }
}
