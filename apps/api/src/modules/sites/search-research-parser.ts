import { inflateRawSync, inflateSync } from 'node:zlib';

export type ExtractedSearchResearchRow = {
  keyword: string;
  monthlySearchVolume?: number;
  keywordDifficulty?: number;
  costPerClick?: number;
  clicks?: number;
  impressions?: number;
  position?: number;
  url?: string;
  competitor?: string;
};

export type ExtractedSearchResearch = {
  keywordCount: number;
  metricRowCount: number;
  headers: string[];
  rows: ExtractedSearchResearchRow[];
  textPreview?: string;
  warnings: string[];
};

const clean = (value: unknown) => String(value ?? '').trim();
const numberValue = (value: unknown) => {
  const normalized = clean(value).replace(/[£$€,]/g, '').replace(/%$/, '');
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
const aliases = {
  keyword: ['keyword', 'query', 'search term', 'search query', 'term', 'keywords'],
  volume: ['volume', 'search volume', 'monthly search volume', 'avg monthly searches', 'average monthly searches', 'searches'],
  difficulty: ['keyword difficulty', 'kd', 'difficulty', 'seo difficulty'],
  cpc: ['cpc', 'cost per click', 'avg cpc', 'average cpc'],
  clicks: ['clicks'],
  impressions: ['impressions'],
  position: ['position', 'average position', 'avg position', 'rank', 'ranking'],
  url: ['url', 'page', 'landing page', 'landing page url'],
  competitor: ['competitor', 'domain', 'hostname', 'site'],
} as const;

function column(headers: string[], candidates: readonly string[]) {
  const index = headers.map(normalizeHeader).findIndex(header => candidates.includes(header));
  return index >= 0 ? index : undefined;
}

export function parseDelimitedResearch(text: string, delimiter = ',') {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let quoted = false;
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

function fromTable(table: string[][]) {
  if (table.length < 2) return { headers: table[0] ?? [], rows: [] as ExtractedSearchResearchRow[] };
  const headers = table[0]!.map(clean);
  const keyword = column(headers, aliases.keyword);
  if (keyword === undefined) return { headers, rows: [] as ExtractedSearchResearchRow[] };
  const volume = column(headers, aliases.volume);
  const difficulty = column(headers, aliases.difficulty);
  const cpc = column(headers, aliases.cpc);
  const clicks = column(headers, aliases.clicks);
  const impressions = column(headers, aliases.impressions);
  const position = column(headers, aliases.position);
  const url = column(headers, aliases.url);
  const competitor = column(headers, aliases.competitor);
  const rows = table.slice(1, 5001).flatMap(values => {
    const phrase = clean(values[keyword]);
    if (!phrase || phrase.length > 240) return [];
    const output: ExtractedSearchResearchRow = { keyword: phrase };
    const monthlySearchVolume = volume === undefined ? undefined : numberValue(values[volume]);
    const keywordDifficulty = difficulty === undefined ? undefined : numberValue(values[difficulty]);
    const costPerClick = cpc === undefined ? undefined : numberValue(values[cpc]);
    const clickValue = clicks === undefined ? undefined : numberValue(values[clicks]);
    const impressionValue = impressions === undefined ? undefined : numberValue(values[impressions]);
    const positionValue = position === undefined ? undefined : numberValue(values[position]);
    if (monthlySearchVolume !== undefined && monthlySearchVolume >= 0) output.monthlySearchVolume = Math.round(monthlySearchVolume);
    if (keywordDifficulty !== undefined && keywordDifficulty >= 0 && keywordDifficulty <= 100) output.keywordDifficulty = keywordDifficulty;
    if (costPerClick !== undefined && costPerClick >= 0) output.costPerClick = costPerClick;
    if (clickValue !== undefined && clickValue >= 0) output.clicks = clickValue;
    if (impressionValue !== undefined && impressionValue >= 0) output.impressions = impressionValue;
    if (positionValue !== undefined && positionValue >= 0) output.position = positionValue;
    if (url !== undefined && clean(values[url])) output.url = clean(values[url]).slice(0, 2_000);
    if (competitor !== undefined && clean(values[competitor])) output.competitor = clean(values[competitor]).slice(0, 255);
    return [output];
  });
  return { headers, rows };
}

function fromJson(value: unknown) {
  let records: Record<string, unknown>[] = [];
  if (Array.isArray(value)) records = value.filter(item => item && typeof item === 'object') as Record<string, unknown>[];
  else if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['rows', 'keywords', 'queries', 'results', 'data']) {
      if (Array.isArray(object[key])) { records = (object[key] as unknown[]).filter(item => item && typeof item === 'object') as Record<string, unknown>[]; break; }
    }
  }
  if (!records.length) return { headers: [] as string[], rows: [] as ExtractedSearchResearchRow[] };
  const headers = [...new Set(records.flatMap(record => Object.keys(record)))];
  return fromTable([headers, ...records.slice(0, 5000).map(record => headers.map(header => clean(record[header]))) ]);
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
const xmlText = (value: string) => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function fromXlsx(bytes: Buffer) {
  const sharedRaw = zipEntry(bytes, 'xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const shared = [...sharedRaw.matchAll(/<si[\s\S]*?<\/si>/g)].map(match => xmlText([...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(item => item[1]).join('')));
  const workbook = zipEntry(bytes, 'xl/workbook.xml')?.toString('utf8') ?? '';
  const relationships = zipEntry(bytes, 'xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const relationId = workbook.match(/<sheet[^>]+r:id="([^"]+)"/i)?.[1];
  const relationship = relationId ? relationships.match(new RegExp(`<Relationship(?=[^>]*Id="${relationId}")(?=[^>]*Target="([^"]+)")[^>]*/?>`, 'i')) : null;
  const target = relationship?.[1];
  const sheetPath = target ? `xl/${target.replace(/^\/?xl\//, '')}` : 'xl/worksheets/sheet1.xml';
  const sheet = zipEntry(bytes, sheetPath)?.toString('utf8');
  if (!sheet) return { headers: [] as string[], rows: [] as ExtractedSearchResearchRow[] };
  const table: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1]; const inner = cellMatch[2];
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1] ?? 'A';
      let index = 0; for (const char of ref) index = index * 26 + (char.charCodeAt(0) - 64);
      const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '';
      row[index - 1] = /\bt="s"/.test(attrs) ? shared[Number(raw)] ?? '' : xmlText(raw);
    }
    if (row.some(value => clean(value))) table.push(row.map(value => value ?? ''));
    if (table.length > 5001) break;
  }
  return fromTable(table);
}

const pdfEscapes: Record<string, string> = {
  n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\',
};
function decodePdfLiteral(value: string) {
  return value.replace(/\\([nrtbf()\\])/g, (_match: string, char: string) => pdfEscapes[char] ?? char)
    .replace(/\\([0-7]{1,3})/g, (_match: string, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}
function pdfText(bytes: Buffer) {
  const chunks: string[] = [];
  const inspect = (text: string) => {
    for (const match of text.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)\s*Tj/g)) chunks.push(decodePdfLiteral(match[1]));
    for (const match of text.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) for (const item of match[1].matchAll(/\(([^()]*(?:\\.[^()]*)*)\)/g)) chunks.push(decodePdfLiteral(item[1]));
  };
  const latin = bytes.toString('latin1'); inspect(latin);
  for (const stream of latin.matchAll(/<<(?:.|\n|\r)*?\/FlateDecode(?:.|\n|\r)*?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { inspect(inflateSync(Buffer.from(stream[1], 'latin1')).toString('latin1')); } catch { /* Best effort; OCR is intentionally not attempted. */ }
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, 40_000);
}

export function searchResearchFileMatchesMime(bytes: Buffer, mimeType: string) {
  if (bytes.length < 2) return false;
  const hex = bytes.subarray(0, 16).toString('hex');
  if (hex.startsWith('4d5a') || hex.startsWith('7f454c46') || hex.startsWith('0061736d') || hex.startsWith('cffaedfe') || hex.startsWith('feedfacf')) return false;
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return hex.startsWith('504b0304');
  if (mimeType === 'application/json') { try { JSON.parse(bytes.toString('utf8')); return true; } catch { return false; } }
  return ['text/csv', 'text/plain'].includes(mimeType) && !bytes.includes(0) && !bytes.toString('utf8').includes('\uFFFD');
}

export function extractSearchResearch(bytes: Buffer, mimeType: string): ExtractedSearchResearch {
  let headers: string[] = []; let rows: ExtractedSearchResearchRow[] = []; let textPreview = ''; const warnings: string[] = [];
  try {
    if (mimeType === 'text/csv') ({ headers, rows } = fromTable(parseDelimitedResearch(bytes.toString('utf8'))));
    else if (mimeType === 'application/json') ({ headers, rows } = fromJson(JSON.parse(bytes.toString('utf8'))));
    else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') ({ headers, rows } = fromXlsx(bytes));
    else if (mimeType === 'text/plain') {
      const text = bytes.toString('utf8'); ({ headers, rows } = fromTable(parseDelimitedResearch(text, text.includes('\t') ? '\t' : ','))); textPreview = text.slice(0, 8_000);
    } else if (mimeType === 'application/pdf') {
      textPreview = pdfText(bytes);
      warnings.push(textPreview ? 'PDF text is available for human review. Structured keyword rows are not inferred from prose.' : 'No extractable PDF text was found. Upload a CSV, XLSX or JSON export for structured keyword evidence.');
    }
  } catch {
    warnings.push('KS OS could not safely parse structured rows from this file. The source remains private for human review.');
  }
  const deduplicated = [...new Map(rows.map(row => [row.keyword.toLocaleLowerCase(), row])).values()].slice(0, 5000);
  if (!deduplicated.length && !warnings.length) warnings.push('No recognised keyword/query column was found. Upload a standard keyword export or review the source manually.');
  return {
    keywordCount: deduplicated.length,
    metricRowCount: deduplicated.filter(row => row.monthlySearchVolume !== undefined || row.keywordDifficulty !== undefined || row.costPerClick !== undefined || row.clicks !== undefined || row.impressions !== undefined || row.position !== undefined).length,
    headers: headers.slice(0, 100),
    rows: deduplicated,
    ...(textPreview ? { textPreview } : {}),
    warnings,
  };
}
