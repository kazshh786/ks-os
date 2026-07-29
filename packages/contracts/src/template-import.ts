import { z } from 'zod';
import { PublicReferenceSchema } from './sites.js';
import { Sha256Schema, TemplateAnalysisStatusSchema } from './template-intelligence.js';

export const TemplateImportAssetKindSchema = z.enum([
  'SOURCE_ARCHIVE',
  'LICENCE_EVIDENCE',
  'PREVIEW_IMAGE',
]);
export type TemplateImportAssetKind = z.infer<typeof TemplateImportAssetKindSchema>;

export const TemplateImportAssetSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().positive().max(100 * 1024 * 1024),
  digestSha256: Sha256Schema,
}).strict();
export type TemplateImportAsset = z.infer<typeof TemplateImportAssetSchema>;

const SourceArchiveSchema = TemplateImportAssetSchema.superRefine((asset, context) => {
  if (!['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(asset.mimeType)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mimeType'], message: 'The source package must be a ZIP archive.' });
  }
  if (!asset.fileName.toLowerCase().endsWith('.zip')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['fileName'], message: 'The source package must use the .zip extension.' });
  }
});

const LicenceEvidenceSchema = TemplateImportAssetSchema.superRefine((asset, context) => {
  if (!['application/pdf', 'text/plain'].includes(asset.mimeType)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mimeType'], message: 'Licence evidence must be a PDF or plain-text file.' });
  }
});

const PreviewImageSchema = TemplateImportAssetSchema.superRefine((asset, context) => {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mimeType'], message: 'The preview must be a JPG, PNG or WebP image.' });
  }
});

export const InitiateTemplateImportSchema = z.object({
  name: z.string().trim().min(2).max(160),
  envatoItemUrl: z.string().trim().url().max(500).optional(),
  industryTags: z.array(z.string().trim().toLowerCase().min(2).max(40).regex(/^[a-z0-9-]+$/)).max(30).default([]),
  agencyNotes: z.string().trim().max(2000).optional(),
  sourceArchive: SourceArchiveSchema,
  licenceEvidence: LicenceEvidenceSchema.optional(),
  previewImage: PreviewImageSchema.optional(),
}).strict();
export type InitiateTemplateImport = z.infer<typeof InitiateTemplateImportSchema>;

export const TemplateImportUploadTargetSchema = z.object({
  kind: TemplateImportAssetKindSchema,
  fileName: z.string(),
  signedUploadUrl: z.string().url(),
  uploadToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
}).strict();
export type TemplateImportUploadTarget = z.infer<typeof TemplateImportUploadTargetSchema>;

export const TemplateImportStatusSchema = z.enum([
  'AWAITING_UPLOAD',
  'VERIFYING',
  'ANALYSING',
  'REVIEW_REQUIRED',
  'READY_FOR_APPROVAL',
  'APPROVED',
  'FAILED',
]);
export type TemplateImportStatus = z.infer<typeof TemplateImportStatusSchema>;

export const TemplateImportSummarySchema = z.object({
  importReference: PublicReferenceSchema,
  sourceReference: PublicReferenceSchema,
  versionReference: PublicReferenceSchema,
  name: z.string(),
  sourceType: z.literal('ENVATO_HTML'),
  sourceStatus: z.string(),
  importStatus: TemplateImportStatusSchema,
  analysisStatus: TemplateAnalysisStatusSchema,
  industryTags: z.array(z.string()),
  envatoItemUrl: z.string().nullable(),
  archiveFileName: z.string(),
  previewAvailable: z.boolean(),
  licenceEvidenceAvailable: z.boolean(),
  fileCount: z.number().int().nonnegative(),
  layoutCount: z.number().int().nonnegative(),
  findingCount: z.number().int().nonnegative(),
  blockingFindingCount: z.number().int().nonnegative(),
  failureCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type TemplateImportSummary = z.infer<typeof TemplateImportSummarySchema>;
