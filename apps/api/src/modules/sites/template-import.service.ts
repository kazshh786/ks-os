import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { and, desc, eq, sql } from 'drizzle-orm';
import type {
  InitiateTemplateImport,
  TemplateImportAsset,
  TemplateImportAssetKind,
  TemplateImportStatus,
} from '@ks-os/contracts';
import {
  getDatabase,
  templateAnalysisFindings,
  templateAnalysisRuns,
  templateSources,
  templateVersions,
} from '@ks-os/database';
import {
  analyseTrustedTemplateFiles,
  normalizeTemplateRelativePath,
  TemplateIngestionSecurityError,
  type TemplateAnalysisFinding,
  type TemplateInputFile,
} from '@ks-os/template-intelligence';
import { getSupabaseAdmin } from '../../lib/supabase-admin.js';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';
import { TemplateIntelligenceService } from './template-intelligence.service.js';

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_FILE_COUNT = 2_000;
const MAX_EXTRACTED_BYTES = 250 * 1024 * 1024;
const MAX_INDIVIDUAL_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ANALYSED_TEXT_BYTES = 2 * 1024 * 1024;
const IMPORT_METADATA_KEY = 'templateImport';

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeFileName(value: string) {
  const safe = value.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 255);
  return safe || 'file';
}

function digest(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function zipMagicMatches(bytes: Buffer) {
  if (bytes.length < 4) return false;
  const signature = bytes.readUInt32LE(0);
  return signature === 0x04034b50 || signature === 0x06054b50 || signature === 0x08074b50;
}

function imageMagicMatches(bytes: Buffer, mimeType: string) {
  if (mimeType === 'image/jpeg') return bytes.subarray(0, 3).toString('hex') === 'ffd8ff';
  if (mimeType === 'image/png') return bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (mimeType === 'image/webp') {
    return bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function licenceMagicMatches(bytes: Buffer, mimeType: string) {
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'text/plain') {
    return !bytes.includes(0)
      && bytes.subarray(0, 2).toString('ascii') !== '#!'
      && !bytes.toString('utf8').includes('\uFFFD');
  }
  return false;
}

interface StoredImportAsset extends TemplateImportAsset {
  kind: TemplateImportAssetKind;
  bucket: string;
  storagePath: string;
}

interface StoredImportMetadata {
  importReference: string;
  versionReference: string;
  status: TemplateImportStatus;
  archive: StoredImportAsset;
  licenceEvidence?: StoredImportAsset;
  previewImage?: StoredImportAsset;
  fileCount: number;
  layoutCount: number;
  findingCount: number;
  blockingFindingCount: number;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseImportMetadata(value: unknown): StoredImportMetadata | null {
  const source = record(value);
  if (
    typeof source.importReference !== 'string'
    || typeof source.versionReference !== 'string'
    || typeof source.status !== 'string'
  ) return null;
  return source as unknown as StoredImportMetadata;
}

function findEndOfCentralDirectory(bytes: Buffer) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new TemplateIngestionSecurityError('TEMPLATE_ZIP_DIRECTORY_MISSING', 'The ZIP central directory could not be found.');
}

function unixFileType(externalAttributes: number) {
  return (externalAttributes >>> 16) & 0o170000;
}

export interface InspectedTemplateArchive {
  files: TemplateInputFile[];
  findings: TemplateAnalysisFinding[];
}

export function inspectTemplateZip(bytes: Buffer): InspectedTemplateArchive {
  if (!zipMagicMatches(bytes)) {
    throw new TemplateIngestionSecurityError('TEMPLATE_ARCHIVE_INVALID', 'The uploaded source is not a valid ZIP archive.');
  }
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = bytes.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocdOffset + 8);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new TemplateIngestionSecurityError('TEMPLATE_MULTI_DISK_ZIP_REJECTED', 'Multi-disk ZIP archives are not accepted.');
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new TemplateIngestionSecurityError('TEMPLATE_ZIP64_UNSUPPORTED', 'ZIP64 packages are not accepted by this importer.');
  }
  if (entryCount > MAX_FILE_COUNT) {
    throw new TemplateIngestionSecurityError('TEMPLATE_FILE_COUNT_EXCEEDED', `Template packages may contain at most ${MAX_FILE_COUNT} files.`);
  }
  if (centralOffset + centralSize > eocdOffset || centralOffset < 0) {
    throw new TemplateIngestionSecurityError('TEMPLATE_ZIP_DIRECTORY_INVALID', 'The ZIP central directory is outside the uploaded archive.');
  }

  const files: TemplateInputFile[] = [];
  const findings: TemplateAnalysisFinding[] = [];
  let cursor = centralOffset;
  let totalExtractedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new TemplateIngestionSecurityError('TEMPLATE_ZIP_ENTRY_INVALID', 'A ZIP directory entry is malformed.');
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const compressionMethod = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const fileNameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const diskStart = bytes.readUInt16LE(cursor + 34);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    const entryEnd = cursor + 46 + fileNameLength + extraLength + commentLength;
    if (entryEnd > bytes.length || diskStart !== 0) {
      throw new TemplateIngestionSecurityError('TEMPLATE_ZIP_ENTRY_INVALID', 'A ZIP directory entry points outside the archive.');
    }
    if ((flags & 0x1) !== 0) {
      throw new TemplateIngestionSecurityError('TEMPLATE_ENCRYPTED_ENTRY_REJECTED', 'Encrypted ZIP entries are not accepted.');
    }
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + fileNameLength).toString('utf8');
    cursor = entryEnd;
    if (rawName.endsWith('/')) continue;
    if (rawName.includes('\uFFFD')) {
      throw new TemplateIngestionSecurityError('TEMPLATE_PATH_ENCODING_INVALID', 'ZIP entry names must use valid UTF-8 text.');
    }
    const relativePath = normalizeTemplateRelativePath(rawName);
    if (unixFileType(externalAttributes) === 0o120000) {
      throw new TemplateIngestionSecurityError('TEMPLATE_LINK_ENTRY_REJECTED', 'Symbolic links are not accepted in template packages.');
    }
    if (uncompressedSize > MAX_INDIVIDUAL_FILE_BYTES) {
      throw new TemplateIngestionSecurityError('TEMPLATE_FILE_SIZE_EXCEEDED', `${relativePath} exceeds the individual file-size limit.`);
    }
    totalExtractedBytes += uncompressedSize;
    if (totalExtractedBytes > MAX_EXTRACTED_BYTES) {
      throw new TemplateIngestionSecurityError('TEMPLATE_EXTRACTED_SIZE_EXCEEDED', 'The ZIP expands beyond the safe import limit.');
    }
    if (localHeaderOffset + 30 > bytes.length || bytes.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new TemplateIngestionSecurityError('TEMPLATE_ZIP_LOCAL_HEADER_INVALID', `${relativePath} has an invalid local ZIP header.`);
    }
    const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) {
      throw new TemplateIngestionSecurityError('TEMPLATE_ZIP_ENTRY_TRUNCATED', `${relativePath} is truncated.`);
    }

    const lower = relativePath.toLowerCase();
    const shouldInspectContent = (lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.css'))
      && uncompressedSize <= MAX_ANALYSED_TEXT_BYTES;
    let content: Uint8Array | undefined;
    if (shouldInspectContent) {
      const compressed = bytes.subarray(dataStart, dataEnd);
      if (compressionMethod === 0) content = new Uint8Array(compressed);
      else if (compressionMethod === 8) content = new Uint8Array(inflateRawSync(compressed));
      else {
        findings.push({
          severity: 'BLOCKING',
          category: 'SECURITY',
          code: 'UNSUPPORTED_ZIP_COMPRESSION',
          filePath: relativePath,
          message: 'This HTML or CSS file uses an unsupported ZIP compression method and could not be inspected.',
        });
      }
      if (content && content.byteLength !== uncompressedSize) {
        throw new TemplateIngestionSecurityError('TEMPLATE_ZIP_ENTRY_SIZE_MISMATCH', `${relativePath} does not match its declared size.`);
      }
    } else if ((lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.css')) && uncompressedSize > MAX_ANALYSED_TEXT_BYTES) {
      findings.push({
        severity: 'BLOCKING',
        category: 'SECURITY',
        code: 'ANALYSABLE_SOURCE_TOO_LARGE',
        filePath: relativePath,
        message: 'This HTML or CSS file is too large for bounded automated inspection.',
      });
    }
    files.push({ relativePath, kind: 'FILE', byteSize: uncompressedSize, ...(content ? { content } : {}) });
  }
  if (cursor !== centralOffset + centralSize) {
    throw new TemplateIngestionSecurityError('TEMPLATE_ZIP_DIRECTORY_SIZE_MISMATCH', 'The ZIP central directory length is inconsistent.');
  }
  return { files, findings };
}

export class TemplateImportService {
  private readonly db = getDatabase();
  private readonly audit = new AgencyAuditService();
  private readonly templates = new TemplateIntelligenceService();
  private readonly bucket = process.env.TEMPLATE_IMPORT_STORAGE_BUCKET || 'private-template-imports';

  private async sourceRow(sourceReference: string) {
    const [source] = await this.db.select().from(templateSources)
      .where(eq(templateSources.publicReference, sourceReference)).limit(1);
    if (!source) throw fail(404, 'TEMPLATE_SOURCE_NOT_FOUND', 'Template source not found.');
    return source;
  }

  private async versionContext(versionReference: string) {
    const [context] = await this.db.select({
      versionId: templateVersions.id,
      versionReference: templateVersions.publicReference,
      artifactDigestSha256: templateVersions.artifactDigestSha256,
      analysisStatus: templateVersions.analysisStatus,
      versionCreatedAt: templateVersions.createdAt,
      sourceId: templateSources.id,
      sourceReference: templateSources.publicReference,
      sourceType: templateSources.sourceType,
      sourceStatus: templateSources.status,
      sourceName: templateSources.name,
      sourceUrl: templateSources.sourceReference,
      metadataJson: templateSources.metadataJson,
      sourceUpdatedAt: templateSources.updatedAt,
    }).from(templateVersions)
      .innerJoin(templateSources, eq(templateVersions.templateSourceId, templateSources.id))
      .where(eq(templateVersions.publicReference, versionReference)).limit(1);
    if (!context) throw fail(404, 'TEMPLATE_VERSION_NOT_FOUND', 'Template version not found.');
    return context;
  }

  private async updateImportMetadata(sourceId: string, metadataJson: unknown, patch: Partial<StoredImportMetadata>) {
    const metadata = record(metadataJson);
    const current = parseImportMetadata(metadata[IMPORT_METADATA_KEY]);
    const next = { ...(current || {}), ...patch, updatedAt: new Date().toISOString() } as StoredImportMetadata;
    await this.db.update(templateSources).set({
      metadataJson: { ...metadata, [IMPORT_METADATA_KEY]: next },
      updatedAt: new Date(),
    }).where(eq(templateSources.id, sourceId));
    return next;
  }

  private async signedTarget(asset: StoredImportAsset) {
    const { data, error } = await getSupabaseAdmin().storage.from(asset.bucket).createSignedUploadUrl(asset.storagePath);
    if (error || !data) throw fail(503, 'TEMPLATE_IMPORT_UPLOAD_UNAVAILABLE', 'A private upload URL could not be created.');
    return {
      kind: asset.kind,
      fileName: asset.fileName,
      signedUploadUrl: data.signedUrl,
      uploadToken: data.token,
      expiresInSeconds: 7_200,
    };
  }

  async initiate(actor: AgencyActor, input: InitiateTemplateImport) {
    if (input.sourceArchive.byteSize > MAX_ARCHIVE_BYTES) {
      throw fail(400, 'TEMPLATE_ARCHIVE_TOO_LARGE', 'Template ZIP files may be no larger than 100 MB.');
    }
    const source = await this.templates.createSource(actor, {
      sourceType: 'ENVATO_HTML',
      name: input.name,
      sourceReference: input.envatoItemUrl,
      industryTags: input.industryTags,
      agencyNotes: input.agencyNotes,
    });
    const importReference = randomUUID();
    const makeAsset = (kind: TemplateImportAssetKind, asset: TemplateImportAsset): StoredImportAsset => ({
      ...asset,
      kind,
      bucket: this.bucket,
      storagePath: `${source.reference}/${importReference}/${kind.toLowerCase()}/${safeFileName(asset.fileName)}`,
    });
    const archive = makeAsset('SOURCE_ARCHIVE', input.sourceArchive);
    const licenceEvidence = input.licenceEvidence ? makeAsset('LICENCE_EVIDENCE', input.licenceEvidence) : undefined;
    const previewImage = input.previewImage ? makeAsset('PREVIEW_IMAGE', input.previewImage) : undefined;
    const version = await this.templates.createVersion(actor, source.reference, {
      artifactDigestSha256: archive.digestSha256,
      analyserVersion: 'deterministic-v1',
      artifactReference: `${archive.bucket}:${archive.storagePath}`,
      manualLayouts: [],
    });
    const sourceRow = await this.sourceRow(source.reference);
    const now = new Date().toISOString();
    const importMetadata: StoredImportMetadata = {
      importReference,
      versionReference: version.reference,
      status: 'AWAITING_UPLOAD',
      archive,
      ...(licenceEvidence ? { licenceEvidence } : {}),
      ...(previewImage ? { previewImage } : {}),
      fileCount: 0,
      layoutCount: 0,
      findingCount: 0,
      blockingFindingCount: 0,
      failureCode: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.update(templateSources).set({
      metadataJson: { ...record(sourceRow.metadataJson), [IMPORT_METADATA_KEY]: importMetadata },
      updatedAt: new Date(),
    }).where(eq(templateSources.id, sourceRow.id));
    try {
      const uploads = await Promise.all([
        this.signedTarget(archive),
        ...(licenceEvidence ? [this.signedTarget(licenceEvidence)] : []),
        ...(previewImage ? [this.signedTarget(previewImage)] : []),
      ]);
      await this.audit.write(actor, 'TEMPLATE_IMPORT_STARTED', 'TEMPLATE_VERSION', version.reference, {
        category: 'WEBSITE',
        metadata: {
          importReference,
          templateSourceReference: source.reference,
          templateVersionReference: version.reference,
          archiveByteSize: archive.byteSize,
          licenceEvidenceIncluded: Boolean(licenceEvidence),
          previewIncluded: Boolean(previewImage),
        },
      });
      return { importReference, sourceReference: source.reference, versionReference: version.reference, uploads };
    } catch (error) {
      await this.updateImportMetadata(sourceRow.id, sourceRow.metadataJson, { status: 'FAILED', failureCode: 'SIGNED_UPLOAD_URL_FAILED' });
      throw error;
    }
  }

  private async downloadAndVerify(asset: StoredImportAsset) {
    const { data, error } = await getSupabaseAdmin().storage.from(asset.bucket).download(asset.storagePath);
    if (error || !data) throw fail(409, 'TEMPLATE_IMPORT_UPLOAD_INCOMPLETE', `${asset.fileName} has not finished uploading.`);
    const bytes = Buffer.from(await data.arrayBuffer());
    const validBasics = bytes.byteLength === asset.byteSize && digest(bytes) === asset.digestSha256;
    const validMagic = asset.kind === 'SOURCE_ARCHIVE'
      ? zipMagicMatches(bytes)
      : asset.kind === 'LICENCE_EVIDENCE'
        ? licenceMagicMatches(bytes, asset.mimeType)
        : imageMagicMatches(bytes, asset.mimeType);
    if (!validBasics || !validMagic) {
      await getSupabaseAdmin().storage.from(asset.bucket).remove([asset.storagePath]);
      throw fail(400, 'TEMPLATE_IMPORT_VERIFICATION_FAILED', `${asset.fileName} does not match the declared safe file.`);
    }
    return bytes;
  }

  async complete(actor: AgencyActor, versionReference: string) {
    const context = await this.versionContext(versionReference);
    if (context.sourceType !== 'ENVATO_HTML') {
      throw fail(409, 'TEMPLATE_IMPORT_SOURCE_UNSUPPORTED', 'Only Envato HTML sources use this import workflow.');
    }
    const metadata = parseImportMetadata(record(context.metadataJson)[IMPORT_METADATA_KEY]);
    if (!metadata || metadata.versionReference !== versionReference) {
      throw fail(404, 'TEMPLATE_IMPORT_NOT_FOUND', 'Template import metadata was not found.');
    }
    if (['REVIEW_REQUIRED', 'READY_FOR_APPROVAL', 'APPROVED'].includes(metadata.status)) {
      return this.get(versionReference);
    }
    await this.updateImportMetadata(context.sourceId, context.metadataJson, { status: 'VERIFYING', failureCode: null });
    try {
      const [archiveBytes] = await Promise.all([
        this.downloadAndVerify(metadata.archive),
        ...(metadata.licenceEvidence ? [this.downloadAndVerify(metadata.licenceEvidence)] : []),
        ...(metadata.previewImage ? [this.downloadAndVerify(metadata.previewImage)] : []),
      ]);
      const inspected = inspectTemplateZip(archiveBytes);
      const analysis = analyseTrustedTemplateFiles(inspected.files, {
        maxFileCount: MAX_FILE_COUNT,
        maxExtractedBytes: MAX_EXTRACTED_BYTES,
        maxIndividualFileBytes: MAX_INDIVIDUAL_FILE_BYTES,
      });
      analysis.artifactDigestSha256 = metadata.archive.digestSha256;
      analysis.findings.push(...inspected.findings);
      if (analysis.layouts.length === 0) {
        analysis.findings.push({
          severity: 'BLOCKING',
          category: 'STRUCTURE',
          code: 'NO_HTML_LAYOUTS_DETECTED',
          filePath: null,
          message: 'No inspectable HTML page layouts were detected in the uploaded ZIP.',
        });
      }
      const run = await this.templates.startAnalysis(actor, versionReference, {
        artifactDigestSha256: metadata.archive.digestSha256,
        analyserVersion: 'deterministic-v1',
      });
      await this.updateImportMetadata(context.sourceId, context.metadataJson, { status: 'ANALYSING' });
      const completed = await this.templates.recordTrustedAnalysis(actor, run.reference, analysis);
      const blockingFindingCount = completed.findings.filter((finding) => finding.severity === 'BLOCKING' && !finding.resolvedAt).length;
      const status = completed.status === 'READY_FOR_APPROVAL' ? 'READY_FOR_APPROVAL' : 'REVIEW_REQUIRED';
      await this.updateImportMetadata(context.sourceId, context.metadataJson, {
        status,
        fileCount: completed.files.length,
        layoutCount: completed.layouts.length,
        findingCount: completed.findings.length,
        blockingFindingCount,
        failureCode: null,
      });
      await this.audit.write(actor, 'TEMPLATE_IMPORT_COMPLETED', 'TEMPLATE_VERSION', versionReference, {
        category: 'WEBSITE',
        metadata: {
          importReference: metadata.importReference,
          templateSourceReference: context.sourceReference,
          templateVersionReference: versionReference,
          fileCount: completed.files.length,
          layoutCount: completed.layouts.length,
          findingCount: completed.findings.length,
          status,
        },
      });
      return this.get(versionReference);
    } catch (error) {
      const code = error instanceof TemplateIngestionSecurityError
        ? error.code
        : error instanceof Error && 'code' in error
          ? String(error.code)
          : 'TEMPLATE_IMPORT_FAILED';
      await this.updateImportMetadata(context.sourceId, context.metadataJson, { status: 'FAILED', failureCode: code });
      throw error instanceof TemplateIngestionSecurityError
        ? fail(400, error.code, error.message)
        : error;
    }
  }

  async list() {
    const sources = await this.db.select({
      sourceId: templateSources.id,
      sourceReference: templateSources.publicReference,
      sourceType: templateSources.sourceType,
      sourceStatus: templateSources.status,
      name: templateSources.name,
      sourceUrl: templateSources.sourceReference,
      metadataJson: templateSources.metadataJson,
      createdAt: templateSources.createdAt,
      updatedAt: templateSources.updatedAt,
    }).from(templateSources)
      .where(eq(templateSources.sourceType, 'ENVATO_HTML'))
      .orderBy(desc(templateSources.updatedAt));
    const rows = await Promise.all(sources.map(async (source) => {
      const metadata = record(source.metadataJson);
      const imported = parseImportMetadata(metadata[IMPORT_METADATA_KEY]);
      if (!imported) return null;
      const [version] = await this.db.select({
        analysisStatus: templateVersions.analysisStatus,
      }).from(templateVersions)
        .where(and(eq(templateVersions.templateSourceId, source.sourceId), eq(templateVersions.publicReference, imported.versionReference)))
        .limit(1);
      return {
        importReference: imported.importReference,
        sourceReference: source.sourceReference,
        versionReference: imported.versionReference,
        name: source.name,
        sourceType: 'ENVATO_HTML' as const,
        sourceStatus: source.sourceStatus,
        importStatus: imported.status,
        analysisStatus: version?.analysisStatus || 'PENDING',
        industryTags: Array.isArray(metadata.industryTags) ? metadata.industryTags.filter((value): value is string => typeof value === 'string') : [],
        envatoItemUrl: source.sourceUrl || null,
        archiveFileName: imported.archive.fileName,
        previewAvailable: Boolean(imported.previewImage),
        licenceEvidenceAvailable: Boolean(imported.licenceEvidence),
        fileCount: imported.fileCount || 0,
        layoutCount: imported.layoutCount || 0,
        findingCount: imported.findingCount || 0,
        blockingFindingCount: imported.blockingFindingCount || 0,
        failureCode: imported.failureCode || null,
        createdAt: source.createdAt.toISOString(),
        updatedAt: source.updatedAt.toISOString(),
      };
    }));
    return rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
  }

  async get(versionReference: string) {
    const context = await this.versionContext(versionReference);
    const metadata = parseImportMetadata(record(context.metadataJson)[IMPORT_METADATA_KEY]);
    if (!metadata) throw fail(404, 'TEMPLATE_IMPORT_NOT_FOUND', 'Template import metadata was not found.');
    const analysis = await this.templates.getAnalysis(versionReference);
    const [blocking] = analysis
      ? await this.db.select({ count: sql<number>`count(*)::int` })
        .from(templateAnalysisFindings)
        .innerJoin(templateAnalysisRuns, eq(templateAnalysisFindings.analysisRunId, templateAnalysisRuns.id))
        .where(and(
          eq(templateAnalysisRuns.publicReference, analysis.reference),
          eq(templateAnalysisFindings.severity, 'BLOCKING'),
          sql`${templateAnalysisFindings.resolvedAt} is null`,
        ))
      : [{ count: 0 }];
    return {
      importReference: metadata.importReference,
      sourceReference: context.sourceReference,
      versionReference,
      name: context.sourceName,
      sourceType: 'ENVATO_HTML' as const,
      sourceStatus: context.sourceStatus,
      importStatus: metadata.status,
      analysisStatus: context.analysisStatus,
      industryTags: Array.isArray(record(context.metadataJson).industryTags)
        ? (record(context.metadataJson).industryTags as unknown[]).filter((value): value is string => typeof value === 'string')
        : [],
      envatoItemUrl: context.sourceUrl || null,
      archiveFileName: metadata.archive.fileName,
      previewAvailable: Boolean(metadata.previewImage),
      licenceEvidenceAvailable: Boolean(metadata.licenceEvidence),
      fileCount: analysis?.files.length || metadata.fileCount || 0,
      layoutCount: analysis?.layouts.length || metadata.layoutCount || 0,
      findingCount: analysis?.findings.length || metadata.findingCount || 0,
      blockingFindingCount: Number(blocking?.count || metadata.blockingFindingCount || 0),
      failureCode: analysis?.failureCode || metadata.failureCode || null,
      createdAt: context.versionCreatedAt.toISOString(),
      updatedAt: context.sourceUpdatedAt.toISOString(),
      analysis,
    };
  }
}
