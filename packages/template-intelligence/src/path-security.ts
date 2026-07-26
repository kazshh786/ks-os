import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  TemplateFileInventoryEntry,
  TemplateInputFile,
  TemplateInventoryLimits,
} from './types.js';

export const DEFAULT_TEMPLATE_INVENTORY_LIMITS: TemplateInventoryLimits = {
  maxFileCount: 2_000,
  maxExtractedBytes: 250 * 1024 * 1024,
  maxIndividualFileBytes: 20 * 1024 * 1024,
};

export class TemplateIngestionSecurityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TemplateIngestionSecurityError';
  }
}

export function normalizeTemplateRelativePath(input: string): string {
  if (input.includes('\0')) {
    throw new TemplateIngestionSecurityError(
      'TEMPLATE_PATH_NULL_BYTE',
      'Template paths cannot contain null bytes.',
    );
  }
  const slashes = input.replaceAll('\\', '/').replace(/\/+/g, '/');
  if (
    !slashes
    || slashes.startsWith('/')
    || /^[a-z]:\//i.test(slashes)
    || slashes.startsWith('//')
    || isAbsolute(input)
  ) {
    throw new TemplateIngestionSecurityError(
      'TEMPLATE_PATH_ABSOLUTE',
      'Template paths must be relative.',
    );
  }
  const parts = slashes.split('/');
  if (parts.some((part) => part === '..')) {
    throw new TemplateIngestionSecurityError(
      'TEMPLATE_PATH_TRAVERSAL',
      'Template paths cannot traverse outside the assigned root.',
    );
  }
  const normalized = parts.filter((part) => part && part !== '.').join('/');
  if (!normalized) {
    throw new TemplateIngestionSecurityError(
      'TEMPLATE_PATH_EMPTY',
      'Template paths cannot be empty.',
    );
  }
  return normalized;
}

export function resolveTemplatePathWithinRoot(root: string, input: string): string {
  const normalized = normalizeTemplateRelativePath(input);
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, ...normalized.split('/'));
  const fromRoot = relative(absoluteRoot, target);
  if (
    !fromRoot
    || fromRoot === '..'
    || fromRoot.startsWith(`..${sep}`)
    || isAbsolute(fromRoot)
  ) {
    throw new TemplateIngestionSecurityError(
      'TEMPLATE_PATH_OUTSIDE_ROOT',
      'The resolved template path must remain inside its assigned root.',
    );
  }
  return target;
}

const fileCategories = {
  HTML: new Set(['.html', '.htm']),
  CSS: new Set(['.css']),
  JAVASCRIPT: new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']),
  IMAGE: new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico']),
  FONT: new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot']),
  SVG: new Set(['.svg']),
  JSON: new Set(['.json']),
  DOCUMENTATION: new Set(['.md', '.txt', '.pdf']),
  BUILD_CONFIG: new Set(['.yml', '.yaml', '.toml', '.lock', '.xml']),
} as const;

const executableExtensions = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.php',
  '.sh',
  '.bash',
  '.bat',
  '.cmd',
  '.exe',
  '.dll',
  '.bin',
]);

function extensionOf(path: string) {
  const name = path.split('/').at(-1) || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

function categoryOf(path: string): TemplateFileInventoryEntry['category'] {
  const extension = extensionOf(path);
  const base = path.split('/').at(-1)?.toLowerCase() || '';
  if (
    ['package.json', 'vite.config.ts', 'webpack.config.js', 'gulpfile.js'].includes(base)
  ) {
    return 'BUILD_CONFIG';
  }
  for (const [category, extensions] of Object.entries(fileCategories)) {
    if ((extensions as ReadonlySet<string>).has(extension)) {
      return category as TemplateFileInventoryEntry['category'];
    }
  }
  return 'UNKNOWN';
}

function bytesFor(file: TemplateInputFile) {
  if (typeof file.content === 'string') return new TextEncoder().encode(file.content);
  return file.content;
}

export function inventoryTemplateFiles(
  inputFiles: readonly TemplateInputFile[],
  limits: TemplateInventoryLimits = DEFAULT_TEMPLATE_INVENTORY_LIMITS,
): TemplateFileInventoryEntry[] {
  if (inputFiles.length > limits.maxFileCount) {
    throw new TemplateIngestionSecurityError(
      'TEMPLATE_FILE_COUNT_EXCEEDED',
      `Template inventory exceeds ${limits.maxFileCount} files.`,
    );
  }

  let totalBytes = 0;
  const seen = new Set<string>();
  return inputFiles.map((file) => {
    if ((file.kind || 'FILE') !== 'FILE') {
      throw new TemplateIngestionSecurityError(
        'TEMPLATE_LINK_ENTRY_REJECTED',
        'Symbolic and hard links are not accepted in template inventories.',
      );
    }
    const relativePath = normalizeTemplateRelativePath(file.relativePath);
    const canonical = relativePath.toLowerCase();
    if (seen.has(canonical)) {
      throw new TemplateIngestionSecurityError(
        'TEMPLATE_DUPLICATE_PATH',
        `Duplicate template path: ${relativePath}.`,
      );
    }
    seen.add(canonical);
    const bytes = bytesFor(file);
    const byteSize = bytes?.byteLength ?? file.byteSize ?? 0;
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
      throw new TemplateIngestionSecurityError(
        'TEMPLATE_FILE_SIZE_INVALID',
        'Template file sizes must be non-negative safe integers.',
      );
    }
    if (byteSize > limits.maxIndividualFileBytes) {
      throw new TemplateIngestionSecurityError(
        'TEMPLATE_FILE_SIZE_EXCEEDED',
        `${relativePath} exceeds the individual file-size limit.`,
      );
    }
    totalBytes += byteSize;
    if (totalBytes > limits.maxExtractedBytes) {
      throw new TemplateIngestionSecurityError(
        'TEMPLATE_EXTRACTED_SIZE_EXCEEDED',
        'Template inventory exceeds the total extracted-size limit.',
      );
    }
    const category = categoryOf(relativePath);
    const extension = extensionOf(relativePath);
    const containsExecutableCode =
      executableExtensions.has(extension) || category === 'JAVASCRIPT';
    const safeForPublicUse = [
      'HTML',
      'CSS',
      'IMAGE',
      'FONT',
      'SVG',
    ].includes(category) && !containsExecutableCode;
    return {
      relativePath,
      category,
      extension,
      byteSize,
      sha256: bytes
        ? createHash('sha256').update(bytes).digest('hex')
        : null,
      likelyPageCandidate: category === 'HTML',
      referencedByAnalysedFile: false,
      containsExecutableCode,
      safeForPublicUse,
      requiresAgencyReview:
        containsExecutableCode
        || category === 'BUILD_CONFIG'
        || category === 'UNKNOWN',
    };
  });
}

export function templateArtifactDigest(
  inventory: readonly TemplateFileInventoryEntry[],
): string {
  const canonical = [...inventory]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map((file) => `${file.relativePath}\0${file.byteSize}\0${file.sha256 || ''}`)
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}
