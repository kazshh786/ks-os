import { FormSchemaJsonSchema, type FormField, type FormSchemaJson, type PublicFormSubmission } from '@ks-os/contracts';

const fail = (code: string, message = 'The form submission is invalid.') => { throw Object.assign(new Error(message), { statusCode: 400, code }); };

export function validateSubmission(schemaValue: unknown, submission: PublicFormSubmission): FormSchemaJson {
  const schema = FormSchemaJsonSchema.parse(schemaValue);
  const byId = new Map(schema.fields.map((field) => [field.id, field]));
  for (const id of Object.keys(submission.answers)) if (!byId.has(id) || byId.get(id)?.type === 'INFORMATION') fail('FORM_UNKNOWN_ANSWER');
  for (const field of schema.fields) validateAnswer(field, submission.answers[field.id]);
  return schema;
}

function validateAnswer(field: FormField, answer: unknown) {
  if (field.type === 'INFORMATION') return;
  const empty = answer === undefined || answer === '' || answer === false || (Array.isArray(answer) && answer.length === 0);
  if (field.required && empty) fail('FORM_REQUIRED_ANSWER_MISSING');
  if (answer === undefined) return;
  if (['SHORT_TEXT','LONG_TEXT','EMAIL','PHONE','DATE'].includes(field.type)) {
    if (typeof answer !== 'string') fail('FORM_ANSWER_TYPE_INVALID');
    const max = field.type === 'LONG_TEXT' ? 10000 : 1000;
    if ((answer as string).length > max) fail('FORM_ANSWER_TYPE_INVALID');
    if (field.type === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer as string)) fail('FORM_ANSWER_TYPE_INVALID');
    if (field.type === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(answer as string)) fail('FORM_ANSWER_TYPE_INVALID');
  } else if (field.type === 'YES_NO' || field.type === 'CONSENT_CHECKBOX') {
    if (typeof answer !== 'boolean') fail('FORM_ANSWER_TYPE_INVALID');
  } else if (field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE' || field.type === 'SELECT') {
    const values = field.type === 'MULTIPLE_CHOICE' ? answer : [answer];
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) fail('FORM_ANSWER_TYPE_INVALID');
    const allowed = new Set(field.options.map((option) => option.id));
    if ((values as unknown[]).some((value) => !allowed.has(value as string))) fail('FORM_ANSWER_TYPE_INVALID');
  }
}

export function renderAnswers(schema: FormSchemaJson, answers: Record<string, unknown>) {
  return schema.fields.filter((field) => field.type !== 'INFORMATION').map((field) => {
    const raw = answers[field.id];
    const options = 'options' in field ? new Map(field.options.map((option) => [option.id, option.label])) : null;
    const displayValue = options ? (Array.isArray(raw) ? raw.map((id) => options.get(String(id)) ?? 'Unknown option') : options.get(String(raw)) ?? 'Not answered') : raw ?? 'Not answered';
    return { fieldId: field.id, label: field.label, type: field.type, value: displayValue };
  });
}
