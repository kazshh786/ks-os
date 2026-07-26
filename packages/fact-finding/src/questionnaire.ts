import type { z } from 'zod';
import {
  FactAnswerValueSchema,
  QuestionnaireQuestionSchema,
  type FactFindingResponseStatus,
} from './contracts.js';

export class FactFindingPolicyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'FactFindingPolicyError';
  }
}

type Question = z.infer<typeof QuestionnaireQuestionSchema>;

function scalar(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
}

export function questionIsVisible(
  question: Question,
  answers: ReadonlyMap<string, unknown>,
) {
  return question.conditions.every(condition => {
    const answer = answers.get(condition.questionReference);
    const expected = condition.value;
    switch (condition.operator) {
      case 'IS_ANSWERED': return answer !== undefined && answer !== null && answer !== '';
      case 'EQUALS': return scalar(answer) === expected;
      case 'NOT_EQUALS': return scalar(answer) !== expected;
      case 'INCLUDES': return Array.isArray(answer) && answer.includes(expected);
      case 'GREATER_THAN': return typeof answer === 'number' && typeof expected === 'number' && answer > expected;
      case 'LESS_THAN': return typeof answer === 'number' && typeof expected === 'number' && answer < expected;
    }
  });
}

export function assertQuestionCanBeRemoved(question: Question) {
  if (question.systemRequired) {
    throw new FactFindingPolicyError(
      'SYSTEM_REQUIRED_QUESTION',
      'This system-required question cannot be removed.',
    );
  }
}

export function assertClientCanSaveResponse(input: {
  questionnaireStatus: string;
  question: Question;
  answer: unknown;
}) {
  if (!['INVITED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'].includes(input.questionnaireStatus)) {
    throw new FactFindingPolicyError('QUESTIONNAIRE_NOT_EDITABLE', 'The questionnaire is not open for client responses.');
  }
  if (!FactAnswerValueSchema.safeParse(input.answer).success) {
    throw new FactFindingPolicyError('ANSWER_INVALID', 'The answer does not match a controlled response shape.');
  }
}

export function completionForQuestions(
  questions: readonly Question[],
  responses: ReadonlyMap<string, { status: FactFindingResponseStatus; answer: unknown }>,
) {
  const answers = new Map([...responses].map(([key, value]) => [key, value.answer]));
  const visible = questions.filter(question => questionIsVisible(question, answers));
  const required = visible.filter(question => question.required);
  const answeredRequired = required.filter(question => {
    const response = responses.get(question.reference);
    return response && !['NOT_STARTED', 'AGENCY_REJECTED', 'SUPERSEDED'].includes(response.status);
  });
  const answered = visible.filter(question => responses.has(question.reference));
  return {
    visibleQuestionCount: visible.length,
    requiredQuestionCount: required.length,
    answeredQuestionCount: answered.length,
    missingRequiredQuestionReferences: required
      .filter(question => !answeredRequired.includes(question))
      .map(question => question.reference),
    completionPercentage: visible.length === 0 ? 100 : Math.round((answered.length / visible.length) * 100),
    complete: answeredRequired.length === required.length,
  };
}
