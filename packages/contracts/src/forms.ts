import { z } from 'zod';

const SAFE_TEXT = /^(?![\s\S]*<(?:script|style|iframe|object|embed)\b)(?![\s\S]*\bjavascript\s*:)[\s\S]*$/i;
const stableId = z.string().uuid();
const label = z.string().trim().min(1).max(255).regex(SAFE_TEXT);
const helpText = z.string().trim().max(1000).regex(SAFE_TEXT).optional();

const base = { id: stableId, label, helpText, required: z.boolean() };
const TextFieldSchema = z.object({ ...base, type: z.enum(['SHORT_TEXT', 'LONG_TEXT', 'EMAIL', 'PHONE', 'DATE']) }).strict();
const BooleanFieldSchema = z.object({ ...base, type: z.enum(['YES_NO', 'CONSENT_CHECKBOX']) }).strict();
const FormOptionSchema = z.object({ id: stableId, label }).strict();
const ChoiceFieldSchema = z.object({ ...base, type: z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SELECT']), options: z.array(FormOptionSchema).min(2).max(50) }).strict()
;
const InformationFieldSchema = z.object({ id: stableId, type: z.literal('INFORMATION'), label: z.string().trim().min(1).max(5000).regex(SAFE_TEXT), helpText, required: z.literal(false) }).strict();

export const FormFieldSchema = z.discriminatedUnion('type', [TextFieldSchema, BooleanFieldSchema, ChoiceFieldSchema, InformationFieldSchema]);
export const FormSchemaJsonSchema = z.object({ fields: z.array(FormFieldSchema).min(1).max(100) }).strict().superRefine((schema, ctx) => {
  const ids = schema.fields.map((field) => field.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Field IDs must be unique', path: ['fields'] });
  if (!schema.fields.some((field) => field.type !== 'INFORMATION')) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one input field is required', path: ['fields'] });
  schema.fields.forEach((field, fieldIndex) => {
    if (!('options' in field)) return;
    const optionIds = field.options.map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Option IDs must be unique', path: ['fields', fieldIndex, 'options'] });
    }
  });
});

export const FormDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(255).regex(SAFE_TEXT),
  description: z.string().trim().max(4000).regex(SAFE_TEXT).default(''),
  schema: FormSchemaJsonSchema,
  acknowledgementText: z.string().trim().max(3000).regex(SAFE_TEXT).default('')
}).strict();
export const FormPublishInputSchema = z.object({}).strict();
export const FormIdParamsSchema = z.object({ formId: z.string().uuid() }).strict();
export const FormVersionParamsSchema = z.object({ formId: z.string().uuid(), versionId: z.string().uuid() }).strict();
export const FormAssignmentIdParamsSchema = z.object({ assignmentId: z.string().uuid() }).strict();
export const FormSubmissionIdParamsSchema = z.object({ submissionId: z.string().uuid() }).strict();
export const PublicFormTokenParamsSchema = z.object({ token: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/) }).strict();

export const CreateFormAssignmentSchema = z.object({
  formId: z.string().uuid(), formVersionId: z.string().uuid().optional(), clientId: z.string().uuid(), appointmentId: z.string().uuid().optional(), deliveryMethod: z.enum(['COPY_LINK','EMAIL','SMS']).default('COPY_LINK')
}).strict();
export const FormAssignmentListQuerySchema = z.object({ status: z.enum(['PENDING', 'OPENED', 'SUBMITTED', 'EXPIRED', 'CANCELLED']).optional(), clientId: z.string().uuid().optional(), appointmentId: z.string().uuid().optional(), formId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
export const FormSubmissionListQuerySchema = z.object({ clientId: z.string().uuid().optional(), appointmentId: z.string().uuid().optional(), formId: z.string().uuid().optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();

export const PublicFormSubmissionSchema = z.object({
  answers: z.record(z.string().uuid(), z.unknown()),
  acknowledgement: z.object({ accepted: z.literal(true), name: z.string().trim().min(2).max(255) }).strict(),
  idempotencyKey: z.string().uuid()
}).strict();

export type FormField = z.infer<typeof FormFieldSchema>;
export type FormSchemaJson = z.infer<typeof FormSchemaJsonSchema>;
export type FormDraftInput = z.infer<typeof FormDraftInputSchema>;
export type CreateFormAssignmentInput = z.infer<typeof CreateFormAssignmentSchema>;
export type PublicFormSubmission = z.infer<typeof PublicFormSubmissionSchema>;
