import { z } from 'zod';

export const AuditCategorySchema=z.enum(['AUTHENTICATION','AUTHORISATION','ADMINISTRATION','FINANCIAL','PRIVACY','CONSENT','SECURITY','BOOKING','INTEGRATION','RETENTION','DATA_ACCESS']);
export const AuditQuerySchema=z.object({
  cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50),
  from:z.coerce.date().optional(),to:z.coerce.date().optional(),agencyUserId:z.string().uuid().optional(),tenantId:z.string().uuid().optional(),
  category:AuditCategorySchema.optional(),eventType:z.string().trim().max(120).optional(),targetType:z.string().trim().max(80).optional(),
  targetId:z.string().trim().max(255).optional(),outcome:z.enum(['SUCCESS','FAILED','DENIED']).optional(),search:z.string().trim().max(120).optional(),
}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,'Audit start must precede end.');

export const PrivacyRequestStatusSchema=z.enum(['RECEIVED','IDENTITY_VERIFICATION_REQUIRED','IN_REVIEW','PROCESSING','READY_FOR_DOWNLOAD','APPROVED','SCHEDULED','COMPLETED','REJECTED','CANCELLED','FAILED']);
export const CreatePrivacyRequestSchema=z.object({
  tenantId:z.string().uuid().nullable().optional(),requestType:z.enum(['ACCESS','DELETION']),subjectAuthUserId:z.string().uuid().optional(),subjectClientId:z.string().uuid().optional(),
  subjectEmail:z.string().email().optional(),requestNotes:z.string().trim().max(4000).optional(),dueAt:z.coerce.date().optional(),
}).strict().refine(v=>Boolean(v.subjectAuthUserId||v.subjectClientId),'A subject identity is required.');
export const UpdatePrivacyRequestSchema=z.object({
  status:PrivacyRequestStatusSchema.optional(),identityVerificationStatus:z.enum(['REQUIRED','VERIFIED','FAILED']).optional(),assignedAgencyUserId:z.string().uuid().nullable().optional(),
  requestNotes:z.string().max(4000).optional(),decisionReason:z.string().trim().min(8).max(1000).optional(),deletionStrategy:z.enum(['DEACTIVATE','SOFT_DELETE','HARD_DELETE','ANONYMISE','PSEUDONYMISE','RETAIN']).optional(),scheduledFor:z.coerce.date().optional(),
}).strict().refine(v=>Object.keys(v).length>0,'At least one change is required.');

export const CreateConsentRecordSchema=z.object({
  tenantId:z.string().uuid().nullable().optional(),authUserId:z.string().uuid().optional(),clientId:z.string().uuid().optional(),consentType:z.string().trim().min(2).max(80),consentVersion:z.string().trim().min(1).max(40),
  policyReference:z.string().max(500).optional(),wordingSnapshot:z.string().trim().min(10).max(20000),status:z.enum(['GRANTED','WITHDRAWN']),collectionSource:z.string().trim().min(2).max(80),
  evidenceMetadata:z.record(z.unknown()).default({}),supersedesConsentId:z.string().uuid().optional(),
}).strict().refine(v=>Boolean(v.authUserId||v.clientId),'A consent subject is required.');

export const CreateLegalHoldSchema=z.object({tenantId:z.string().uuid().nullable().optional(),subjectAuthUserId:z.string().uuid().optional(),subjectClientId:z.string().uuid().optional(),reason:z.string().trim().min(12).max(1000),legalBasis:z.string().trim().min(5).max(500),endsAt:z.coerce.date().optional()}).strict().refine(v=>Boolean(v.tenantId||v.subjectAuthUserId||v.subjectClientId),'A legal-hold scope is required.');
export const CreateRetentionPolicySchema=z.object({tenantId:z.string().uuid().nullable().optional(),dataCategory:z.string().trim().min(2).max(100),retentionDays:z.number().int().min(1).max(36500),retentionTrigger:z.string().trim().min(2).max(80),expiryAction:z.enum(['DELETE','ANONYMISE','ARCHIVE','REVIEW_MANUALLY','RETAIN_LEGAL_HOLD']),legalBasis:z.string().trim().min(5).max(500),jurisdiction:z.string().trim().max(80).optional(),enabled:z.boolean().default(false),dryRun:z.boolean().default(true),nextExecutionAt:z.coerce.date().optional()}).strict();
