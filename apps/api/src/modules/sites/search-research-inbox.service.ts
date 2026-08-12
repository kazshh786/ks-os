import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { and, desc, eq, inArray, not } from 'drizzle-orm';
import {
  factFindingQuestionnaires,
  factFindingUploads,
  getDatabase,
  sitePageSeoBriefs,
  siteSearchResearchEvidence,
  siteSearchStrategies,
  sites,
  tenants,
} from '@ks-os/database';
import {
  PageSeoBriefSchema,
  SearchIntelligenceStrategyV2Schema,
  generationDigest,
  pageSeoBriefDigest,
  searchStrategyDigest,
  type PageSeoBrief,
  type SearchIntelligenceStrategyV2,
} from '@ks-os/site-generation';
import { getSupabaseAdmin } from '../../lib/supabase-admin.js';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';

const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const SEARCH_RESEARCH_CATEGORY = 'SEARCH_RESEARCH_SOURCE';
const bucketName = () => process.env.FACT_FINDING_STORAGE_BUCKET || 'private-fact-finding';
const supportedMimes = new Set([
  'text/csv',
  'text/plain',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

type Device = 'DESKTOP' | 'MOBILE';
export interface SearchResearchUploadInput {
  fileName: string;
  mimeType: string;
  byteSize: number;
  digestSha256: string;
  providerHint?: string;
  market: string;
  locale: string;
  location: string;
  language: string;
  device: Device;
  capturedAt?: string;
}

type ExtractedRow = {
  keyword: string;
  monthlySearchVolume?: number;
  keywordDifficulty?: number;
  costPerClick?: number;
  currency?: string;
  clicks?: number;
  impressions?: number;
  position?: number;
  url?: string;
  competitor?: string;
};

type ResearchSidecar = {
  schemaVersion: 1;
  sourceReference: string;
  status: 'PENDING_UPLOAD' | 'EXTRACTED' | 'APPLIED' | 'REJECTED';
  fileName: string;
  mimeType: string;
  providerHint: string;
  market: string;
  locale: string;
  location: string;
  language: string;
  device: Device;
  capturedAt: string;
  sourceDigestSha256: string;
  extractedAt?: string;
  appliedAt?: string;
  rejectedAt?: string;
  extracted: {
    keywordCount: number;
    metricRowCount: number;
    headers: string[];
    rows: ExtractedRow[];
    textPreview?: string;
    warnings: string[];
  };
};

const clean = (value: unknown) => String(value ?? '').trim();
const numberValue = (value: unknown) => {
  const normalized = clean(value).replace(/[£$€,]/g, '').replace(/%$/, '');
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
const keywordAliases = ['keyword', 'query', 'search term', 'search query', 'term', 'keywords'];
const volumeAliases = ['volume', 'search volume', 'monthly search volume', 'avg monthly searches', 'average monthly searches', 'searches'];
const difficultyAliases = ['keyword difficulty', 'kd', 'difficulty', 'seo difficulty'];
const cpcAliases = ['cpc', 'cost per click', 'avg cpc', 'average cpc'];
const clicksAliases = ['clicks'];
const impressionsAliases = ['impressions'];
const positionAliases = ['position', 'average position', 'avg position', 'rank', 'ranking'];
const urlAliases = ['url', 'page', 'landing page', 'landing page url'];
const competitorAliases = ['competitor', 'domain', 'hostname', 'site'];

function findColumn(headers: string[], aliases: string[]) {
  const normalized = headers.map(normalizeHeader);
  const index = normalized.findIndex(header => aliases.includes(header));
  return index >= 0 ? index : undefined;
}

function parseDelimited(text: string, delimiter = ',') {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function rowsFromTable(table: string[][]) {
  if (table.length < 2) return { headers: table[0] ?? [], rows: [] as ExtractedRow[] };
  const headers = table[0]!.map(clean);
  const keyword = findColumn(headers, keywordAliases);
  if (keyword === undefined) return { headers, rows: [] as ExtractedRow[] };
  const volume = findColumn(headers, volumeAliases);
  const difficulty = findColumn(headers, difficultyAliases);
  const cpc = findColumn(headers, cpcAliases);
  const clicks = findColumn(headers, clicksAliases);
  const impressions = findColumn(headers, impressionsAliases);
  const position = findColumn(headers, positionAliases);
  const url = findColumn(headers, urlAliases);
  const competitor = findColumn(headers, competitorAliases);
  const rows = table.slice(1, 5001).flatMap(values => {
    const phrase = clean(values[keyword]);
    if (!phrase || phrase.length > 240) return [];
    const output: ExtractedRow = { keyword: phrase };
    const monthlySearchVolume = volume === undefined ? undefined : numberValue(values[volume]);
    const keywordDifficulty = difficulty === undefined ? undefined : numberValue(values[difficulty]);
    const costPerClick = cpc === undefined ? undefined : numberValue(values[cpc]);
    const clicksValue = clicks === undefined ? undefined : numberValue(values[clicks]);
    const impressionsValue = impressions === undefined ? undefined : numberValue(values[impressions]);
    const positionValue = position === undefined ? undefined : numberValue(values[position]);
    if (monthlySearchVolume !== undefined && monthlySearchVolume >= 0) output.monthlySearchVolume = Math.round(monthlySearchVolume);
    if (keywordDifficulty !== undefined && keywordDifficulty >= 0 && keywordDifficulty <= 100) output.keywordDifficulty = keywordDifficulty;
    if (costPerClick !== undefined && costPerClick >= 0) output.costPerClick = costPerClick;
    if (clicksValue !== undefined && clicksValue >= 0) output.clicks = clicksValue;
    if (impressionsValue !== undefined && impressionsValue >= 0) output.impressions = impressionsValue;
    if (positionValue !== undefined && positionValue >= 0) output.position = positionValue;
    if (url !== undefined && clean(values[url])) output.url = clean(values[url]).slice(0, 2_000);
    if (competitor !== undefined && clean(values[competitor])) output.competitor = clean(values[competitor]).slice(0, 255);
    return [output];
  });
  return { headers, rows };
}

function rowsFromJson(value: unknown) {
  let records: Record<string, unknown>[] = [];
  if (Array.isArray(value)) records = value.filter(item => item && typeof item === 'object') as Record<string, unknown>[];
  else if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['rows', 'keywords', 'queries', 'results', 'data']) {
      if (Array.isArray(object[key])) { records = (object[key] as unknown[]).filter(item => item && typeof item === 'object') as Record<string, unknown>[]; break; }
    }
  }
  if (!records.length) return { headers: [] as string[], rows: [] as ExtractedRow[] };
  const headers = [...new Set(records.flatMap(record => Object.keys(record)))];
  return rowsFromTable([headers, ...records.slice(0, 5000).map(record => headers.map(header => clean(record[header]))) ]);
}

function zipEntry(bytes: Buffer, wanted: string) {
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === wanted) {
      if (bytes.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const localNameLength = bytes.readUInt16LE(localOffset + 26);
      const localExtraLength = bytes.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const payload = bytes.subarray(start, start + compressedSize);
      if (method === 0) return payload;
      if (method === 8) return inflateRawSync(payload);
      return null;
    }
    offset += 45 + nameLength + extraLength + commentLength;
  }
  return null;
}

function xmlText(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function rowsFromXlsx(bytes: Buffer) {
  const sharedRaw = zipEntry(bytes, 'xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const shared = [...sharedRaw.matchAll(/<si[\s\S]*?<\/si>/g)].map(match => xmlText([...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(item => item[1]).join('')));
  const workbookRaw = zipEntry(bytes, 'xl/workbook.xml')?.toString('utf8') ?? '';
  const relationshipsRaw = zipEntry(bytes, 'xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const firstRelationship = workbookRaw.match(/<sheet[^>]+r:id="([^"]+)"/i)?.[1];
  const target = firstRelationship
    ? relationshipsRaw.match(new RegExp(`<Relationship[^>]+Id="${firstRelationship}"[^>]+Target="([^"]+)"`, 'i'))?.[1]
    : undefined;
  const sheetPath = target ? `xl/${target.replace(/^\/?xl\//, '')}` : 'xl/worksheets/sheet1.xml';
  const sheet = zipEntry(bytes, sheetPath)?.toString('utf8');
  if (!sheet) return { headers: [] as string[], rows: [] as ExtractedRow[] };
  const table: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1]; const inner = cellMatch[2];
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1] ?? 'A';
      let column = 0;
      for (const char of ref) column = column * 26 + (char.charCodeAt(0) - 64);
      const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '';
      const isShared = /\bt="s"/.test(attrs);
      const value = isShared ? shared[Number(raw)] ?? '' : xmlText(raw);
      row[column - 1] = value;
    }
    if (row.some(value => clean(value))) table.push(row.map(value => value ?? ''));
    if (table.length > 5001) break;
  }
  return rowsFromTable(table);
}

function decodePdfLiteral(value: string) {
  return value.replace(/\\([nrtbf()\\])/g, (_match, char) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[char] ?? char))
    .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8)));
}
function extractPdfText(bytes: Buffer) {
  const chunks: string[] = [];
  const inspect = (text: string) => {
    for (const match of text.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)\s*Tj/g)) chunks.push(decodePdfLiteral(match[1]));
    for (const match of text.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
      for (const stringMatch of match[1].matchAll(/\(([^()]*(?:\\.[^()]*)*)\)/g)) chunks.push(decodePdfLiteral(stringMatch[1]));
    }
  };
  const latin = bytes.toString('latin1');
  inspect(latin);
  for (const stream of latin.matchAll(/<<(?:.|\n|\r)*?\/FlateDecode(?:.|\n|\r)*?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { inspect(inflateSync(Buffer.from(stream[1], 'latin1')).toString('latin1')); } catch { /* Best-effort text PDF extraction only. */ }
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, 40_000);
}

function extract(bytes: Buffer, mimeType: string) {
  let headers: string[] = []; let rows: ExtractedRow[] = []; let textPreview = ''; const warnings: string[] = [];
  try {
    if (mimeType === 'text/csv') ({ headers, rows } = rowsFromTable(parseDelimited(bytes.toString('utf8'))));
    else if (mimeType === 'application/json') ({ headers, rows } = rowsFromJson(JSON.parse(bytes.toString('utf8'))));
    else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') ({ headers, rows } = rowsFromXlsx(bytes));
    else if (mimeType === 'text/plain') {
      const text = bytes.toString('utf8');
      const table = parseDelimited(text, text.includes('\t') ? '\t' : ',');
      ({ headers, rows } = rowsFromTable(table));
      textPreview = text.slice(0, 8_000);
    } else if (mimeType === 'application/pdf') {
      textPreview = extractPdfText(bytes);
      warnings.push(textPreview ? 'PDF text is available for human review. Structured keyword rows were not inferred from prose.' : 'This PDF did not expose extractable text. Upload a CSV, XLSX or JSON export for structured keyword evidence.');
    }
  } catch {
    warnings.push('KS OS could not safely parse structured rows from this file. The source remains stored privately for human review.');
  }
  const deduplicated = [...new Map(rows.map(row => [row.keyword.toLocaleLowerCase(), row])).values()].slice(0, 5000);
  if (!deduplicated.length && !warnings.length) warnings.push('No recognised keyword/query column was found. Check the preview or upload a standard keyword export.');
  return {
    keywordCount: deduplicated.length,
    metricRowCount: deduplicated.filter(row => row.monthlySearchVolume !== undefined || row.keywordDifficulty !== undefined || row.costPerClick !== undefined || row.clicks !== undefined || row.impressions !== undefined || row.position !== undefined).length,
    headers: headers.slice(0, 100),
    rows: deduplicated,
    ...(textPreview ? { textPreview } : {}),
    warnings,
  };
}

function uploadedFileMatchesMime(bytes: Buffer, mimeType: string) {
  if (bytes.length < 2 || !supportedMimes.has(mimeType)) return false;
  const hex = bytes.subarray(0, 16).toString('hex');
  if (hex.startsWith('4d5a') || hex.startsWith('7f454c46') || hex.startsWith('0061736d') || hex.startsWith('cffaedfe') || hex.startsWith('feedfacf')) return false;
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return hex.startsWith('504b0304');
  if (mimeType === 'application/json') { try { JSON.parse(bytes.toString('utf8')); return true; } catch { return false; } }
  return !bytes.includes(0) && !bytes.toString('utf8').includes('\uFFFD');
}

function keywordClass(keyword: string, location: string) {
  const lower = keyword.toLocaleLowerCase();
  if (/^(who|what|when|where|why|how|can|does|is|are|should|which)\b/.test(lower) || keyword.endsWith('?')) return ['QUESTION'] as const;
  if (lower.includes('near me') || (location && lower.includes(location.toLocaleLowerCase()))) return ['LOCAL'] as const;
  if (/\b(price|cost|book|booking|buy|quote|appointment)\b/.test(lower)) return ['TRANSACTIONAL'] as const;
  return [(keyword.split(/\s+/).length >= 4 ? 'LONG_TAIL' : 'MID_TAIL')] as const;
}
function intentFor(keyword: string, location: string) {
  const lower = keyword.toLocaleLowerCase();
  if (lower.includes('near me') || (location && lower.includes(location.toLocaleLowerCase()))) return 'LOCAL' as const;
  if (/\b(book|booking|appointment|buy|order)\b/.test(lower)) return 'TRANSACTIONAL' as const;
  if (/\b(price|cost|best|compare|reviews?|vs)\b/.test(lower)) return 'COMMERCIAL_INVESTIGATION' as const;
  return 'INFORMATIONAL' as const;
}
function tokens(value: string) { return new Set(value.toLocaleLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(token => token.length > 2)); }
function scoreTarget(keyword: string, brief: PageSeoBrief) {
  const wanted = tokens(keyword); const candidate = tokens(`${brief.primaryKeyword} ${brief.primaryTopic} ${brief.secondaryTopics.join(' ')}`);
  let score = 0; for (const token of wanted) if (candidate.has(token)) score += 1;
  return score;
}

export class SearchResearchInboxService {
  private readonly db = getDatabase();
  private readonly audit = new AgencyAuditService();

  private async context(siteReference: string) {
    const [context] = await this.db.select({
      siteId: sites.id,
      tenantId: tenants.id,
      tenantReference: tenants.agencyReference,
      tenantName: tenants.name,
    }).from(sites).innerJoin(tenants, eq(sites.tenantId, tenants.id)).where(eq(sites.publicReference, siteReference)).limit(1);
    if (!context) throw fail(404, 'SEARCH_RESEARCH_SITE_NOT_FOUND', 'Website was not found.');
    return context;
  }
  private async questionnaire(tenantId: string) {
    const [row] = await this.db.select({ id: factFindingQuestionnaires.id, reference: factFindingQuestionnaires.publicReference })
      .from(factFindingQuestionnaires)
      .where(and(eq(factFindingQuestionnaires.tenantId, tenantId), not(inArray(factFindingQuestionnaires.status, ['CANCELLED', 'SUPERSEDED']))))
      .orderBy(desc(factFindingQuestionnaires.questionnaireVersion)).limit(1);
    if (!row) throw fail(409, 'SEARCH_RESEARCH_DISCOVERY_REQUIRED', 'Complete client discovery before adding search research.');
    return row;
  }
  private sidecarPath(storagePath: string) { return `${storagePath}.research.json`; }
  private async readSidecar(storageBucket: string, storagePath: string): Promise<ResearchSidecar | null> {
    const { data } = await getSupabaseAdmin().storage.from(storageBucket).download(this.sidecarPath(storagePath));
    if (!data) return null;
    try { return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8')) as ResearchSidecar; } catch { return null; }
  }
  private async writeSidecar(storageBucket: string, storagePath: string, sidecar: ResearchSidecar) {
    const bytes = Buffer.from(JSON.stringify(sidecar));
    const { error } = await getSupabaseAdmin().storage.from(storageBucket).upload(this.sidecarPath(storagePath), bytes, { contentType: 'application/json', upsert: true });
    if (error) throw fail(503, 'SEARCH_RESEARCH_METADATA_UNAVAILABLE', 'Research metadata could not be stored.');
  }

  async assertNotResearchSource(uploadReference: string) {
    const [row] = await this.db.select({ category: factFindingUploads.assetCategory }).from(factFindingUploads).where(eq(factFindingUploads.publicReference, uploadReference)).limit(1);
    if (row?.category === SEARCH_RESEARCH_CATEGORY) throw fail(409, 'SEARCH_RESEARCH_REVIEW_SEPARATE', 'Search research must be reviewed from Website → Search → Research.');
  }

  async list(siteReference: string) {
    const context = await this.context(siteReference);
    const rows = await this.db.select({
      reference: factFindingUploads.publicReference,
      fileName: factFindingUploads.safeFilename,
      mimeType: factFindingUploads.mimeType,
      byteSize: factFindingUploads.byteSize,
      digestSha256: factFindingUploads.digestSha256,
      uploadStatus: factFindingUploads.uploadStatus,
      storageBucket: factFindingUploads.storageBucket,
      storagePath: factFindingUploads.storagePath,
      createdAt: factFindingUploads.createdAt,
    }).from(factFindingUploads).where(and(
      eq(factFindingUploads.tenantId, context.tenantId),
      eq(factFindingUploads.assetCategory, SEARCH_RESEARCH_CATEGORY),
    )).orderBy(desc(factFindingUploads.createdAt)).limit(100);
    const sources = await Promise.all(rows.map(async row => {
      const sidecar = await this.readSidecar(row.storageBucket, row.storagePath);
      return {
        reference: row.reference,
        fileName: row.fileName,
        mimeType: row.mimeType,
        byteSize: row.byteSize,
        uploadStatus: row.uploadStatus,
        createdAt: row.createdAt.toISOString(),
        status: sidecar?.status ?? (row.uploadStatus === 'UPLOADED' ? 'NEEDS_REVIEW' : row.uploadStatus),
        providerHint: sidecar?.providerHint ?? 'FILE_UPLOAD',
        market: sidecar?.market ?? null,
        locale: sidecar?.locale ?? null,
        location: sidecar?.location ?? null,
        language: sidecar?.language ?? null,
        device: sidecar?.device ?? null,
        capturedAt: sidecar?.capturedAt ?? null,
        extracted: sidecar?.extracted ?? { keywordCount: 0, metricRowCount: 0, headers: [], rows: [], warnings: ['Extraction metadata is unavailable.'] },
      };
    }));
    return { tenantName: context.tenantName, siteReference, sources };
  }

  async initiate(actor: AgencyActor, siteReference: string, input: SearchResearchUploadInput) {
    if (!supportedMimes.has(input.mimeType)) throw fail(400, 'SEARCH_RESEARCH_FILE_TYPE_UNSUPPORTED', 'Upload CSV, XLSX, JSON, PDF or plain text research.');
    if (input.byteSize < 1 || input.byteSize > 20 * 1024 * 1024) throw fail(400, 'SEARCH_RESEARCH_FILE_SIZE_INVALID', 'Research files must be smaller than 20 MB.');
    if (!/^[a-f0-9]{64}$/.test(input.digestSha256)) throw fail(400, 'SEARCH_RESEARCH_DIGEST_INVALID', 'Research file digest is invalid.');
    const context = await this.context(siteReference);
    const questionnaire = await this.questionnaire(context.tenantId);
    const reference = randomUUID();
    const safeFilename = input.fileName.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 255);
    const storageBucket = bucketName();
    const storagePath = `${context.tenantReference}/search-research/${siteReference}/${reference}/${safeFilename}`;
    const [upload] = await this.db.insert(factFindingUploads).values({
      publicReference: reference,
      questionnaireId: questionnaire.id,
      tenantId: context.tenantId,
      participantId: null,
      questionId: null,
      storageBucket,
      storagePath,
      safeFilename,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      digestSha256: input.digestSha256,
      assetCategory: SEARCH_RESEARCH_CATEGORY,
      provenance: 'AGENCY_SUPPLIED',
      publicUsePermission: false,
      aiUsePermission: false,
      copyrightConfirmed: true,
      consentStatus: 'NOT_APPLICABLE',
    }).returning();
    const sidecar: ResearchSidecar = {
      schemaVersion: 1,
      sourceReference: reference,
      status: 'PENDING_UPLOAD',
      fileName: safeFilename,
      mimeType: input.mimeType,
      providerHint: clean(input.providerHint || 'FILE_UPLOAD').slice(0, 80) || 'FILE_UPLOAD',
      market: input.market,
      locale: input.locale,
      location: input.location,
      language: input.language,
      device: input.device,
      capturedAt: input.capturedAt || new Date().toISOString(),
      sourceDigestSha256: input.digestSha256,
      extracted: { keywordCount: 0, metricRowCount: 0, headers: [], rows: [], warnings: [] },
    };
    await this.writeSidecar(storageBucket, storagePath, sidecar);
    const { data, error } = await getSupabaseAdmin().storage.from(storageBucket).createSignedUploadUrl(storagePath);
    if (error || !data) {
      await this.db.update(factFindingUploads).set({ uploadStatus: 'REJECTED', updatedAt: new Date() }).where(eq(factFindingUploads.id, upload.id));
      throw fail(503, 'SEARCH_RESEARCH_UPLOAD_UNAVAILABLE', 'A private upload URL could not be created.');
    }
    await this.audit.write(actor, 'SEARCH_RESEARCH_SOURCE_UPLOAD_STARTED', 'SITE_SEARCH_RESEARCH_SOURCE', reference, {
      tenantId: context.tenantId, category: 'WEBSITE', metadata: { siteReference, mimeType: input.mimeType, byteSize: input.byteSize },
    });
    return { reference, signedUploadUrl: data.signedUrl, expiresInSeconds: 7_200, public: false };
  }

  async complete(actor: AgencyActor, siteReference: string, sourceReference: string) {
    const context = await this.context(siteReference);
    const [upload] = await this.db.select().from(factFindingUploads).where(and(
      eq(factFindingUploads.publicReference, sourceReference),
      eq(factFindingUploads.tenantId, context.tenantId),
      eq(factFindingUploads.assetCategory, SEARCH_RESEARCH_CATEGORY),
      eq(factFindingUploads.uploadStatus, 'PENDING_UPLOAD'),
    )).limit(1);
    if (!upload) throw fail(404, 'SEARCH_RESEARCH_SOURCE_NOT_FOUND', 'Pending research upload was not found.');
    const { data, error } = await getSupabaseAdmin().storage.from(upload.storageBucket).download(upload.storagePath);
    if (error || !data) throw fail(409, 'SEARCH_RESEARCH_UPLOAD_INCOMPLETE', 'The private research upload has not completed.');
    const bytes = Buffer.from(await data.arrayBuffer());
    const valid = bytes.byteLength === upload.byteSize
      && createHash('sha256').update(bytes).digest('hex') === upload.digestSha256
      && uploadedFileMatchesMime(bytes, upload.mimeType);
    if (!valid) {
      await this.db.update(factFindingUploads).set({ uploadStatus: 'QUARANTINED', malwareScanStatus: 'FAILED', updatedAt: new Date() }).where(eq(factFindingUploads.id, upload.id));
      await getSupabaseAdmin().storage.from(upload.storageBucket).remove([upload.storagePath, this.sidecarPath(upload.storagePath)]);
      throw fail(400, 'SEARCH_RESEARCH_UPLOAD_VERIFICATION_FAILED', 'The uploaded research file did not match the declared safe file.');
    }
    const sidecar = await this.readSidecar(upload.storageBucket, upload.storagePath);
    if (!sidecar) throw fail(409, 'SEARCH_RESEARCH_METADATA_MISSING', 'Research upload metadata is missing.');
    const extracted = extract(bytes, upload.mimeType);
    const completedSidecar: ResearchSidecar = { ...sidecar, status: 'EXTRACTED', extractedAt: new Date().toISOString(), extracted };
    await this.writeSidecar(upload.storageBucket, upload.storagePath, completedSidecar);
    await this.db.update(factFindingUploads).set({ uploadStatus: 'UPLOADED', updatedAt: new Date() }).where(eq(factFindingUploads.id, upload.id));
    await this.audit.write(actor, 'SEARCH_RESEARCH_SOURCE_EXTRACTED', 'SITE_SEARCH_RESEARCH_SOURCE', sourceReference, {
      tenantId: context.tenantId, category: 'WEBSITE', metadata: { siteReference, keywordCount: extracted.keywordCount, metricRowCount: extracted.metricRowCount },
    });
    return { reference: sourceReference, status: completedSidecar.status, extracted };
  }

  async reject(actor: AgencyActor, siteReference: string, sourceReference: string) {
    const context = await this.context(siteReference);
    const [upload] = await this.db.select().from(factFindingUploads).where(and(
      eq(factFindingUploads.publicReference, sourceReference), eq(factFindingUploads.tenantId, context.tenantId), eq(factFindingUploads.assetCategory, SEARCH_RESEARCH_CATEGORY),
    )).limit(1);
    if (!upload) throw fail(404, 'SEARCH_RESEARCH_SOURCE_NOT_FOUND', 'Research source was not found.');
    const sidecar = await this.readSidecar(upload.storageBucket, upload.storagePath);
    if (!sidecar) throw fail(409, 'SEARCH_RESEARCH_METADATA_MISSING', 'Research upload metadata is missing.');
    if (sidecar.status === 'APPLIED') throw fail(409, 'SEARCH_RESEARCH_ALREADY_APPLIED', 'Applied research cannot be rejected from the inbox.');
    await this.writeSidecar(upload.storageBucket, upload.storagePath, { ...sidecar, status: 'REJECTED', rejectedAt: new Date().toISOString() });
    await this.audit.write(actor, 'SEARCH_RESEARCH_SOURCE_REJECTED', 'SITE_SEARCH_RESEARCH_SOURCE', sourceReference, { tenantId: context.tenantId, category: 'WEBSITE', metadata: { siteReference } });
    return { reference: sourceReference, status: 'REJECTED' as const };
  }

  async apply(actor: AgencyActor, siteReference: string, sourceReference: string) {
    const context = await this.context(siteReference);
    const [upload] = await this.db.select().from(factFindingUploads).where(and(
      eq(factFindingUploads.publicReference, sourceReference), eq(factFindingUploads.tenantId, context.tenantId), eq(factFindingUploads.assetCategory, SEARCH_RESEARCH_CATEGORY), eq(factFindingUploads.uploadStatus, 'UPLOADED'),
    )).limit(1);
    if (!upload) throw fail(404, 'SEARCH_RESEARCH_SOURCE_NOT_FOUND', 'Completed research source was not found.');
    const sidecar = await this.readSidecar(upload.storageBucket, upload.storagePath);
    if (!sidecar || sidecar.status !== 'EXTRACTED') {
      if (sidecar?.status === 'APPLIED') return { reference: sourceReference, status: 'APPLIED' as const, idempotentReplay: true };
      throw fail(409, 'SEARCH_RESEARCH_SOURCE_NOT_REVIEWABLE', 'Extract the research file before adding it to the strategy.');
    }
    if (!sidecar.extracted.rows.length) throw fail(409, 'SEARCH_RESEARCH_SOURCE_NOT_APPLICABLE', 'No structured keyword rows were extracted. Keep this file as reference or upload a CSV, XLSX or JSON keyword export.');

    const [strategyRow] = await this.db.select({ id: siteSearchStrategies.id, value: siteSearchStrategies.strategyJson, status: siteSearchStrategies.status })
      .from(siteSearchStrategies).where(and(eq(siteSearchStrategies.siteId, context.siteId), eq(siteSearchStrategies.status, 'DRAFT')))
      .orderBy(desc(siteSearchStrategies.createdAt)).limit(1);
    if (!strategyRow) throw fail(409, 'SEARCH_RESEARCH_DRAFT_REQUIRED', 'Create a draft search strategy for the approved website structure before adding research.');
    const briefRows = await this.db.select({ id: sitePageSeoBriefs.id, value: sitePageSeoBriefs.briefJson, status: sitePageSeoBriefs.status })
      .from(sitePageSeoBriefs).where(and(eq(sitePageSeoBriefs.strategyId, strategyRow.id), eq(sitePageSeoBriefs.status, 'DRAFT')));
    let strategy = SearchIntelligenceStrategyV2Schema.parse(strategyRow.value);
    let briefs = briefRows.map(row => ({ id: row.id, value: PageSeoBriefSchema.parse(row.value) }));
    if (!briefs.length) throw fail(409, 'SEARCH_RESEARCH_BRIEFS_REQUIRED', 'The draft search strategy has no editable page briefs.');

    const sourceRows = sidecar.extracted.rows.slice(0, Math.min(1000, Math.max(0, 5000 - strategy.keywordUniverse.length)));
    const existingKeywords = new Set(strategy.keywordUniverse.map(item => item.keyword.toLocaleLowerCase()));
    const evidence = sourceRows.map(row => {
      const reference = randomUUID();
      const payloadDigestSha256 = generationDigest(row);
      return {
        reference,
        providerKey: `uploaded-${sidecar.providerHint.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 60)}`,
        query: row.keyword,
        market: sidecar.market,
        locale: sidecar.locale,
        location: sidecar.location,
        language: sidecar.language,
        device: sidecar.device,
        capturedAt: sidecar.capturedAt,
        expiresAt: new Date(new Date(sidecar.capturedAt).getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        sourceDigestSha256: sidecar.sourceDigestSha256,
        payloadDigestSha256,
        notes: [
          `Uploaded research source: ${sidecar.fileName}`,
          ...(row.clicks !== undefined ? [`Clicks: ${row.clicks}`] : []),
          ...(row.impressions !== undefined ? [`Impressions: ${row.impressions}`] : []),
          ...(row.position !== undefined ? [`Average position/rank: ${row.position}`] : []),
          ...(row.url ? [`Observed URL: ${row.url}`] : []),
          ...(row.competitor ? [`Observed competitor/domain: ${row.competitor}`] : []),
        ].slice(0, 100),
      };
    });
    const evidenceByKeyword = new Map(evidence.map(item => [item.query.toLocaleLowerCase(), item]));
    const additions: SearchIntelligenceStrategyV2['keywordUniverse'] = [];
    const assignments = new Map<string, string[]>();
    for (const row of sourceRows) {
      const lower = row.keyword.toLocaleLowerCase();
      if (existingKeywords.has(lower)) continue;
      const evidenceItem = evidenceByKeyword.get(lower)!;
      const ranked = [...briefs].sort((left, right) => scoreTarget(row.keyword, right.value) - scoreTarget(row.keyword, left.value));
      const target = ranked[0]!.value;
      const metrics = row.monthlySearchVolume !== undefined || row.keywordDifficulty !== undefined || row.costPerClick !== undefined ? {
        ...(row.monthlySearchVolume !== undefined ? { monthlySearchVolume: row.monthlySearchVolume } : {}),
        ...(row.keywordDifficulty !== undefined ? { keywordDifficulty: row.keywordDifficulty } : {}),
        ...(row.costPerClick !== undefined ? { costPerClick: row.costPerClick, currency: row.currency || 'GBP' } : {}),
        sourceClassification: 'SEARCH_RESEARCH' as const,
        evidenceReference: evidenceItem.reference,
        measuredAt: sidecar.capturedAt,
      } : undefined;
      additions.push({
        keyword: row.keyword,
        classes: [...keywordClass(row.keyword, sidecar.location)],
        intent: intentFor(row.keyword, sidecar.location),
        topicClusterKey: target.topicClusterKey,
        targetPageReference: target.pageReference,
        ...(metrics ? { metrics } : {}),
        rationale: { statement: `Imported from reviewed search research source ${sidecar.fileName}.`, sourceClassification: 'SEARCH_RESEARCH', evidenceReferences: [evidenceItem.reference], confidence: 1 },
      });
      const assigned = assignments.get(target.reference) ?? []; assigned.push(row.keyword); assignments.set(target.reference, assigned);
      existingKeywords.add(lower);
    }
    if (!additions.length) throw fail(409, 'SEARCH_RESEARCH_NO_NEW_KEYWORDS', 'Every extracted keyword already exists in the draft search strategy.');

    const addedEvidenceReferences = [...new Set(additions.flatMap(item => item.rationale.evidenceReferences))];
    const usedEvidence = evidence.filter(item => addedEvidenceReferences.includes(item.reference));
    const clusterAdditions = new Map<string, string[]>();
    for (const item of additions) { const values = clusterAdditions.get(item.topicClusterKey) ?? []; values.push(item.keyword); clusterAdditions.set(item.topicClusterKey, values); }
    const provenance = {
      ...strategy.provenance,
      providerKey: 'ks-os-research-inbox',
      modelKey: 'deterministic-file-extraction-v1',
      researchDigestSha256: generationDigest({ previous: strategy.provenance.researchDigestSha256, source: sourceReference, evidence: usedEvidence }),
      researchEvidenceReferences: [...new Set([...strategy.provenance.researchEvidenceReferences, ...usedEvidence.map(item => item.reference)])],
      generatedAt: new Date().toISOString(),
    };
    const draftStrategy = SearchIntelligenceStrategyV2Schema.parse({
      ...strategy,
      keywordUniverse: [...strategy.keywordUniverse, ...additions],
      searchIntentClusters: strategy.searchIntentClusters.map(cluster => ({ ...cluster, keywords: [...new Set([...cluster.keywords, ...(clusterAdditions.get(cluster.key) ?? [])])].slice(0, 500) })),
      provenance: { ...provenance, outputDigestSha256: '0'.repeat(64) },
    });
    strategy = SearchIntelligenceStrategyV2Schema.parse({ ...draftStrategy, provenance: { ...draftStrategy.provenance, outputDigestSha256: searchStrategyDigest(draftStrategy) } });
    briefs = briefs.map(item => {
      const keywords = assignments.get(item.value.reference) ?? [];
      if (!keywords.length) return item;
      const question = keywords.filter(keyword => keywordClass(keyword, sidecar.location)[0] === 'QUESTION');
      const longTail = keywords.filter(keyword => keyword.split(/\s+/).length >= 4 && !question.includes(keyword));
      const updated = PageSeoBriefSchema.parse({
        ...item.value,
        secondaryKeywords: [...new Set([...item.value.secondaryKeywords, ...keywords])].slice(0, 100),
        longTailKeywords: [...new Set([...item.value.longTailKeywords, ...longTail])].slice(0, 100),
        questionKeywords: [...new Set([...item.value.questionKeywords, ...question])].slice(0, 100),
        provenance: {
          ...item.value.provenance,
          providerKey: 'ks-os-research-inbox',
          modelKey: 'deterministic-file-extraction-v1',
          researchDigestSha256: strategy.provenance.researchDigestSha256,
          researchEvidenceReferences: strategy.provenance.researchEvidenceReferences,
          strategyDigestSha256: strategy.provenance.outputDigestSha256,
          generatedAt: strategy.provenance.generatedAt,
          outputDigestSha256: '0'.repeat(64),
        },
      });
      return { id: item.id, value: PageSeoBriefSchema.parse({ ...updated, provenance: { ...updated.provenance, outputDigestSha256: pageSeoBriefDigest(updated) } }) };
    });

    await this.db.transaction(async tx => {
      if (usedEvidence.length) await tx.insert(siteSearchResearchEvidence).values(usedEvidence.map(item => ({
        publicReference: item.reference,
        tenantId: context.tenantId,
        siteId: context.siteId,
        strategyId: strategyRow.id,
        providerKey: item.providerKey,
        query: item.query,
        market: item.market,
        locale: item.locale,
        searchLocation: item.location,
        language: item.language,
        device: item.device,
        capturedAt: new Date(item.capturedAt),
        expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
        sourceUrl: null,
        sourceDigestSha256: item.sourceDigestSha256,
        payloadDigestSha256: item.payloadDigestSha256,
        notesJson: item.notes,
      })));
      await tx.update(siteSearchStrategies).set({
        strategyJson: strategy,
        researchDigestSha256: strategy.provenance.researchDigestSha256,
        outputDigestSha256: strategy.provenance.outputDigestSha256,
        providerKey: strategy.provenance.providerKey,
        modelKey: strategy.provenance.modelKey,
        generatedAt: new Date(strategy.provenance.generatedAt),
        updatedAt: new Date(),
      }).where(and(eq(siteSearchStrategies.id, strategyRow.id), eq(siteSearchStrategies.status, 'DRAFT')));
      for (const brief of briefs) await tx.update(sitePageSeoBriefs).set({
        briefJson: brief.value,
        outputDigestSha256: brief.value.provenance.outputDigestSha256,
        updatedAt: new Date(),
      }).where(and(eq(sitePageSeoBriefs.id, brief.id), eq(sitePageSeoBriefs.status, 'DRAFT')));
      await this.audit.write(actor, 'SEARCH_RESEARCH_SOURCE_APPLIED', 'SITE_SEARCH_RESEARCH_SOURCE', sourceReference, {
        tenantId: context.tenantId,
        category: 'WEBSITE',
        metadata: { siteReference, strategyReference: strategy.reference, addedKeywordCount: additions.length, evidenceCount: usedEvidence.length },
        tx,
      });
    });
    await this.writeSidecar(upload.storageBucket, upload.storagePath, { ...sidecar, status: 'APPLIED', appliedAt: new Date().toISOString() });
    return { reference: sourceReference, status: 'APPLIED' as const, strategyReference: strategy.reference, addedKeywordCount: additions.length, evidenceCount: usedEvidence.length, idempotentReplay: false };
  }
}

export const searchResearchSourceCategory = SEARCH_RESEARCH_CATEGORY;
