import type { FormSchemaJson } from '@ks-os/contracts';

export function formState(schema: FormSchemaJson, answers: Record<string, unknown>) {
  const state = new Map(schema.fields.map(field => [field.key || field.id, { visible: !field.hidden, required: field.required }]));
  for (const rule of schema.logic.filter(rule => rule.enabled)) {
    const check = (condition: (typeof rule.conditions)[number]) => {
      const answer = answers[condition.fieldKey];
      if (condition.operator === 'EQUALS') return answer === condition.value;
      if (condition.operator === 'NOT_EQUALS') return answer !== condition.value;
      if (condition.operator === 'EMPTY') return answer == null || answer === '' || (Array.isArray(answer) && !answer.length);
      if (condition.operator === 'NOT_EMPTY') return !(answer == null || answer === '' || (Array.isArray(answer) && !answer.length));
      if (condition.operator === 'CONTAINS') return String(answer ?? '').includes(String(condition.value ?? ''));
      if (condition.operator === 'INCLUDES') return Array.isArray(answer) && answer.includes(condition.value);
      if (condition.operator === 'GT') return Number(answer) > Number(condition.value);
      if (condition.operator === 'LT') return Number(answer) < Number(condition.value);
      return false;
    };
    const matches = rule.combinator === 'AND' ? rule.conditions.every(check) : rule.conditions.some(check);
    if (!matches) continue;
    const target = state.get(rule.targetKey);
    if (!target) continue;
    if (rule.action === 'SHOW') target.visible = true;
    if (rule.action === 'HIDE') { target.visible = false; target.required = false; }
    if (rule.action === 'REQUIRE' && target.visible) target.required = true;
    if (rule.action === 'OPTIONAL') target.required = false;
  }
  // A negative answer is valid for a required yes/no question. Required consent
  // checkboxes remain required until affirmatively selected.
  for (const field of schema.fields) {
    const fieldKey = field.key || field.id;
    if (field.type === 'YES_NO' && answers[fieldKey] === false) state.get(fieldKey)!.required = false;
  }
  return state;
}
