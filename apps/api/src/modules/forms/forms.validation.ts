import { FormSchemaJsonSchema, type FormField, type FormSchemaJson, type PublicFormSubmission } from '@ks-os/contracts';
import { calculateFormula, evaluateForm, validateLogicGraph } from './forms.engine.js';

const fail = (code: string, message = 'The form submission is invalid.') => { throw Object.assign(new Error(message), { statusCode: 400, code }); };

export function validateSubmission(schemaValue: unknown, submission: PublicFormSubmission): FormSchemaJson {
  const schema = FormSchemaJsonSchema.parse(schemaValue);
  if(!validateLogicGraph(schema).valid)fail('FORM_LOGIC_CYCLE');
  const byKey = new Map(schema.fields.map((field) => [field.key||field.id, field]));
  for (const id of Object.keys(submission.answers)) if (!byKey.has(id) || ['INFORMATION','HEADING','DIVIDER'].includes(byKey.get(id)!.type)) fail('FORM_UNKNOWN_ANSWER');
  const evaluated=evaluateForm(schema,submission.answers);
  for (const field of schema.fields){const fieldKey=field.key||field.id;const state=evaluated.state.get(fieldKey);if(!state?.visible)continue;validateAnswer({...field,required:state.required},evaluated.answers[fieldKey]);if(field.type==='CALCULATED'&&field.formula)calculateFormula(field.formula,evaluated.answers);}
  return schema;
}

function validateAnswer(field: FormField, answer: unknown) {
  if (['INFORMATION','HEADING','DIVIDER','HIDDEN','CALCULATED'].includes(field.type)) return;
  const empty = answer === undefined || answer === '' || (answer === false && ['CONSENT_CHECKBOX','TERMS_ACCEPTANCE'].includes(field.type)) || (Array.isArray(answer) && answer.length === 0);
  if (field.required && empty) fail('FORM_REQUIRED_ANSWER_MISSING');
  if (answer === undefined) return;
  if (['SHORT_TEXT','LONG_TEXT','EMAIL','PHONE','DATE','TIME','DATETIME','ADDRESS','WEBSITE'].includes(field.type)) {
    if (typeof answer !== 'string') fail('FORM_ANSWER_TYPE_INVALID');
    const max = field.type === 'LONG_TEXT' ? 10000 : 1000;
    if ((answer as string).length > max) fail('FORM_ANSWER_TYPE_INVALID');
    if (field.type === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer as string)) fail('FORM_ANSWER_TYPE_INVALID');
    if (field.type === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(answer as string)) fail('FORM_ANSWER_TYPE_INVALID');
  } else if (field.type === 'NUMBER'||field.type==='RATING'||field.type==='SCALE') { if(typeof answer!=='number'||!Number.isFinite(answer))fail('FORM_ANSWER_TYPE_INVALID');
  } else if (['YES_NO','TOGGLE','CONSENT_CHECKBOX','TERMS_ACCEPTANCE'].includes(field.type)) {
    if (typeof answer !== 'boolean') fail('FORM_ANSWER_TYPE_INVALID');
  } else if (field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE' || field.type === 'SELECT') {
    const values = field.type === 'MULTIPLE_CHOICE' ? answer : [answer];
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) fail('FORM_ANSWER_TYPE_INVALID');
    const allowed = new Set((field.options||[]).map((option) => option.id));
    if ((values as unknown[]).some((value) => !allowed.has(value as string))) fail('FORM_ANSWER_TYPE_INVALID');
  }
}

export function renderAnswers(schema: FormSchemaJson, answers: Record<string, unknown>) {
  return schema.fields.filter((field) => !['INFORMATION','HEADING','DIVIDER'].includes(field.type)).map((field) => {
    const fieldKey=field.key||field.id;const raw = answers[fieldKey];
    const options = field.options ? new Map(field.options.map((option) => [option.id, option.label])) : null;
    const displayValue = options ? (Array.isArray(raw) ? raw.map((id) => options.get(String(id)) ?? 'Unknown option') : options.get(String(raw)) ?? 'Not answered') : raw ?? 'Not answered';
    return { fieldId: field.id, fieldKey, label: field.label, type: field.type, value: displayValue, sensitiveClassification:field.sensitiveClassification };
  });
}
