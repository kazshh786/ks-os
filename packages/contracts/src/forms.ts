import { z } from 'zod';

const SAFE_TEXT = /^(?![\s\S]*<(?:script|style|iframe|object|embed)\b)(?![\s\S]*\bjavascript\s*:)[\s\S]*$/i;
const id = z.string().uuid();
const key = z.string().regex(/^[a-z][a-z0-9_]{1,119}$/);
const draftKey = z.string().max(120).regex(/^[a-z0-9_]*$/);
const text = (max: number) => z.string().trim().max(max).regex(SAFE_TEXT);

const FieldTypeSchema = z.enum([
  'SHORT_TEXT', 'LONG_TEXT', 'EMAIL', 'PHONE', 'NUMBER', 'DATE', 'TIME', 'DATETIME', 'ADDRESS', 'WEBSITE', 'HIDDEN',
  'YES_NO', 'TOGGLE', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SELECT', 'RATING', 'SCALE', 'FILE_UPLOAD', 'SIGNATURE',
  'CONSENT_CHECKBOX', 'TERMS_ACCEPTANCE', 'HEADING', 'INFORMATION', 'DIVIDER', 'CALCULATED',
]);
const ValidationSchema = z.object({
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().max(10000).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().max(200).optional(),
  errorMessage: text(500).optional(),
  allowedFileTypes: z.array(z.enum(['image/jpeg', 'image/png', 'application/pdf'])).max(6).optional(),
  maxFileSize: z.number().int().positive().max(10_485_760).optional(),
  maxFiles: z.number().int().min(1).max(5).optional(),
}).strict().default({});
const ConditionSchema = z.object({
  fieldKey: key,
  operator: z.enum(['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'NOT_CONTAINS', 'EMPTY', 'NOT_EMPTY', 'GT', 'LT', 'BEFORE', 'AFTER', 'INCLUDES']),
  value: z.unknown().optional(),
}).strict();
const RuleSchema = z.object({
  id,
  enabled: z.boolean().default(true),
  combinator: z.enum(['AND', 'OR']).default('AND'),
  conditions: z.array(ConditionSchema).min(1).max(20),
  action: z.enum(['SHOW', 'HIDE', 'REQUIRE', 'OPTIONAL', 'SET_VALUE', 'CLEAR_VALUE', 'FLAG_REVIEW', 'END_FORM']),
  targetKey: key,
  value: z.unknown().optional(),
  clearWhenHidden: z.boolean().default(true),
  description: text(500).optional(),
}).strict();
const OptionSchema = z.object({
  id,
  label: text(255).min(1),
  value: z.string().max(255).optional(),
  score: z.number().optional(),
}).strict();
const DraftOptionSchema = z.object({
  id,
  label: text(255),
  value: z.string().max(255).optional(),
  score: z.number().optional(),
}).strict();

const fieldShape = {
  id,
  type: FieldTypeSchema,
  internalLabel: text(255).optional(),
  description: text(1000).optional(),
  helpText: text(1000).optional(),
  placeholder: text(255).optional(),
  required: z.boolean().default(false),
  readOnly: z.boolean().default(false),
  hidden: z.boolean().default(false),
  width: z.enum(['25', '33', '50', '66', '75', '100']).default('100'),
  pageId: id.optional(),
  sectionId: id.optional(),
  validation: ValidationSchema,
  defaultValue: z.unknown().optional(),
  formula: z.string().max(500).regex(/^[a-zA-Z0-9_+\-*/()., <>=!?]+$/).optional(),
  mappingTarget: z.string().max(120).optional(),
  sensitiveClassification: z.enum(['STANDARD', 'PERSONAL', 'SENSITIVE', 'MEDICAL', 'CONSENT']).default('STANDARD'),
  translations: z.record(z.string().max(12), z.object({
    label: text(255).optional(),
    description: text(1000).optional(),
    placeholder: text(255).optional(),
  }).strict()).default({}),
  accessibility: z.object({ ariaLabel: text(255).optional(), instructions: text(1000).optional() }).strict().default({}),
};

export const FormFieldSchema = z.object({
  ...fieldShape,
  key: key.optional(),
  label: text(255).min(1),
  options: z.array(OptionSchema).min(2).max(250).optional(),
}).strict().superRefine((field, context) => {
  if (['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SELECT'].includes(field.type) && !field.options) {
    context.addIssue({ code: 'custom', path: ['options'], message: 'Choice fields require options' });
  }
  if (field.type === 'CONSENT_CHECKBOX' && !field.description) {
    context.addIssue({ code: 'custom', path: ['description'], message: 'Consent wording is required' });
  }
});

const DraftFormFieldSchema = z.object({
  ...fieldShape,
  key: draftKey.optional(),
  label: text(255),
  options: z.array(DraftOptionSchema).max(250).optional(),
}).strict();

const PageSchema = z.object({ id, title: text(255).min(1), description: text(1000).optional(), progressLabel: text(80).optional() }).strict();
const SectionSchema = z.object({
  id,
  pageId: id.optional(),
  title: text(255).min(1),
  description: text(1000).optional(),
  columns: z.number().int().min(1).max(4).default(1),
  collapsible: z.boolean().default(false),
  repeatable: z.boolean().default(false),
  minRepetitions: z.number().int().min(0).max(20).default(0),
  maxRepetitions: z.number().int().min(1).max(20).default(1),
}).strict();
const ThemeSchema = z.object({
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#f8fafc'),
  cardColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#ffffff'),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#4f46e5'),
  textColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#0f172a'),
  mutedColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#64748b'),
  errorColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#b91c1c'),
  radius: z.enum(['none', 'small', 'medium', 'large']).default('large'),
  density: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
  progressStyle: z.enum(['BAR', 'PERCENT', 'STEPS', 'NONE']).default('BAR'),
}).strict();
const SettingsSchema = z.object({
  showIntroduction: z.boolean().default(true),
  showReview: z.boolean().default(true),
  estimatedMinutes: z.number().int().min(1).max(180).optional(),
  completionMessage: text(2000).default('Thank you. Your response was received.'),
  autosave: z.boolean().default(true),
}).strict().default({});

export const FormSchemaJsonSchema = z.object({
  schemaVersion: z.literal(2).default(2),
  fields: z.array(FormFieldSchema).min(1).max(250),
  pages: z.array(PageSchema).max(30).default([]),
  sections: z.array(SectionSchema).max(100).default([]),
  logic: z.array(RuleSchema).max(200).default([]),
  theme: ThemeSchema.default({}),
  settings: SettingsSchema,
}).strict().superRefine((schema, context) => {
  const ids = schema.fields.map(field => field.id);
  const keys = schema.fields.map(field => field.key || field.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['fields'], message: 'Field IDs must be unique' });
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', path: ['fields'], message: 'Field keys must be unique' });
  if (!schema.fields.some(field => !['INFORMATION', 'HEADING', 'DIVIDER'].includes(field.type))) {
    context.addIssue({ code: 'custom', path: ['fields'], message: 'At least one input field is required' });
  }
  const known = new Set(keys);
  schema.logic.forEach((rule, index) => {
    if (!known.has(rule.targetKey) || rule.conditions.some(condition => !known.has(condition.fieldKey))) {
      context.addIssue({ code: 'custom', path: ['logic', index], message: 'Logic references an unknown field' });
    }
  });
});

const FormDraftSchemaJsonSchema = z.object({
  schemaVersion: z.literal(2).default(2),
  fields: z.array(DraftFormFieldSchema).max(250).default([]),
  pages: z.array(PageSchema).max(30).default([]),
  sections: z.array(SectionSchema).max(100).default([]),
  logic: z.array(RuleSchema).max(200).default([]),
  theme: ThemeSchema.default({}),
  settings: SettingsSchema,
}).strict().superRefine((schema, context) => {
  const ids = schema.fields.map(field => field.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['fields'], message: 'Field IDs must be unique' });
  }
  const completedKeys = schema.fields.map(field => field.key).filter((value): value is string => Boolean(value));
  if (new Set(completedKeys).size !== completedKeys.length) {
    context.addIssue({ code: 'custom', path: ['fields'], message: 'Completed field keys must be unique' });
  }
});

export const FormDraftInputSchema = z.object({
  title: text(255).min(1),
  description: text(4000).default(''),
  internalDescription: text(4000).default(''),
  formType: z.enum(['GENERAL_INTAKE', 'PRE_BOOKING', 'POST_BOOKING', 'CONSULTATION', 'REGISTRATION', 'CONSENT', 'MEDICAL', 'CUSTOMER_ONBOARDING', 'STAFF_ASSESSMENT', 'FEEDBACK', 'APPLICATION', 'CUSTOM']).default('CUSTOM'),
  schema: FormDraftSchemaJsonSchema,
  acknowledgementText: text(3000).default(''),
  defaultLanguage: z.string().max(12).default('en-GB'),
  supportedLanguages: z.array(z.string().max(12)).min(1).max(20).default(['en-GB']),
  expectedRevision: z.number().int().positive().optional(),
  changeSummary: text(1000).optional(),
}).strict();
export const FormPublishInputSchema = z.object({ changeSummary: text(1000).optional() }).strict();
export const FormIdParamsSchema = z.object({ formId: id }).strict();
export const FormVersionParamsSchema = z.object({ formId: id, versionId: id }).strict();
export const FormAssignmentIdParamsSchema = z.object({ assignmentId: id }).strict();
export const FormSubmissionIdParamsSchema = z.object({ submissionId: id }).strict();
export const PublicFormTokenParamsSchema = z.object({ token: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/) }).strict();
export const CreateFormAssignmentSchema = z.object({ formId: id, formVersionId: id.optional(), clientId: id, appointmentId: id.optional(), deliveryMethod: z.enum(['COPY_LINK', 'EMAIL', 'SMS']).default('COPY_LINK') }).strict();
export const FormAssignmentListQuerySchema = z.object({ status: z.enum(['PENDING', 'OPENED', 'SUBMITTED', 'EXPIRED', 'CANCELLED']).optional(), clientId: id.optional(), appointmentId: id.optional(), formId: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
export const FormSubmissionListQuerySchema = z.object({ clientId: id.optional(), appointmentId: id.optional(), formId: id.optional(), status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'ARCHIVED']).optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
export const PublicFormSubmissionSchema = z.object({ answers: z.record(z.string(), z.unknown()), acknowledgement: z.object({ accepted: z.literal(true), name: z.string().trim().min(2).max(255) }).strict(), idempotencyKey: id, language: z.string().max(12).default('en-GB'), timezone: z.string().max(100).optional(), trackingParameters: z.record(z.string().max(40), z.string().max(200)).default({}) }).strict();
export const SaveFormDraftSchema = z.object({ answers: z.record(z.string(), z.unknown()), currentPage: z.number().int().min(0).max(30), revision: z.number().int().nonnegative(), language: z.string().max(12).default('en-GB'), timezone: z.string().max(100).optional() }).strict();
export const ReviewFormSubmissionSchema = z.object({ status: z.enum(['UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'ARCHIVED']), notes: text(4000).optional(), fieldKeys: z.array(key).max(100).default([]) }).strict();
export const FormAnalyticsEventSchema = z.object({ eventType: z.enum(['VIEW', 'START', 'PAGE_VIEW', 'VALIDATION_ERROR', 'DRAFT_SAVED', 'RESUME', 'SUBMIT']), pageId: z.string().max(120).optional(), fieldKey: key.optional(), deviceType: z.enum(['MOBILE', 'TABLET', 'DESKTOP']).optional(), source: z.string().max(100).optional(), campaign: z.string().max(100).optional(), language: z.string().max(12).optional(), durationMs: z.number().int().nonnegative().max(86_400_000).optional() }).strict();

export type FormField = z.infer<typeof FormFieldSchema>;
export type FormSchemaJson = z.infer<typeof FormSchemaJsonSchema>;
export type FormDraftInput = z.infer<typeof FormDraftInputSchema>;
export type CreateFormAssignmentInput = z.infer<typeof CreateFormAssignmentSchema>;
export type PublicFormSubmission = z.infer<typeof PublicFormSubmissionSchema>;
