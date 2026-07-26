import { createHash } from 'node:crypto';
import type {
  TemplateInputFile,
  TemplateAnalysisFinding,
  TemplateInventoryLimits,
  TrustedTemplateAnalysis,
} from './types.js';
import {
  inventoryTemplateFiles,
  templateArtifactDigest,
} from './path-security.js';
import { inspectHtmlPage } from './html-analysis.js';
import {
  classifyHtmlLayout,
  requiredSectionsForPageType,
} from './classification.js';
import {
  extractCssResponsiveSignals,
  extractDesignSignals,
  mergeResponsiveSignals,
} from './design-signals.js';

function contentText(file: TemplateInputFile) {
  if (typeof file.content === 'string') return file.content;
  if (file.content) return new TextDecoder('utf-8', { fatal: false }).decode(file.content);
  return null;
}

export function analyseTrustedTemplateFiles(
  inputFiles: readonly TemplateInputFile[],
  limits?: TemplateInventoryLimits,
): TrustedTemplateAnalysis {
  const files = inventoryTemplateFiles(inputFiles, limits);
  const cssSources = inputFiles
    .filter((file) => file.relativePath.toLowerCase().endsWith('.css'))
    .map(contentText)
    .filter((content): content is string => content !== null);
  const designSignals = extractDesignSignals(cssSources);
  const cssResponsive = extractCssResponsiveSignals(cssSources);
  const layouts = inputFiles.flatMap((file) => {
    const normalized = files.find(
      (entry) =>
        entry.relativePath.toLowerCase()
        === file.relativePath.replaceAll('\\', '/').toLowerCase(),
    );
    if (normalized?.category !== 'HTML') return [];
    const html = contentText(file);
    if (html === null) return [];
    const analysis = inspectHtmlPage(html);
    const classification = classifyHtmlLayout(normalized.relativePath, analysis);
    const requiredSections = new Set(
      classification.recommendedPageType
        ? requiredSectionsForPageType(classification.recommendedPageType)
        : [],
    );
    analysis.sections = analysis.sections.map((section) => ({
      ...section,
      requiredForRecommendedPageType:
        requiredSections.has(section.sectionType)
        || (
          requiredSections.has('BOOKING_CTA')
          && section.containsBookingAction
        ),
    }));
    analysis.responsiveSignals = mergeResponsiveSignals(
      analysis.responsiveSignals,
      cssResponsive,
    );
    return [{
      sourceFile: normalized.relativePath,
      analysis,
      classification,
    }];
  });

  const referencedPaths = new Set(
    layouts.flatMap((layout) => [
      ...layout.analysis.scriptReferences,
      ...layout.analysis.stylesheetReferences,
    ]).map((value) => value.replace(/^[./]+/, '').toLowerCase()),
  );
  for (const file of files) {
    file.referencedByAnalysedFile = referencedPaths.has(
      file.relativePath.toLowerCase(),
    );
  }

  const findings: TemplateAnalysisFinding[] = files.flatMap((file) => {
    if (file.containsExecutableCode) {
      return [{
        severity: 'WARNING' as const,
        category: 'SECURITY' as const,
        code: 'SOURCE_SCRIPT_INVENTORIED_NOT_EXECUTED',
        filePath: file.relativePath,
        message: 'Executable source was inventoried and requires agency review; it was not executed.',
      }];
    }
    if (file.category === 'UNKNOWN') {
      return [{
        severity: 'WARNING' as const,
        category: 'SECURITY' as const,
        code: 'UNKNOWN_FILE_REQUIRES_REVIEW',
        filePath: file.relativePath,
        message: 'An unknown file type requires agency review before public use.',
      }];
    }
    return [];
  });
  for (const layout of layouts) {
    if (!layout.analysis.responsiveSignals.hasViewportMeta) {
      findings.push({
        severity: 'WARNING',
        category: 'RESPONSIVE',
        code: 'VIEWPORT_META_MISSING',
        filePath: layout.sourceFile,
        message: 'The HTML layout does not declare a viewport meta tag.',
      });
    }
    for (const concern of layout.analysis.securityConcerns) {
      findings.push({
        severity: 'WARNING',
        category: 'SECURITY',
        code: concern,
        filePath: layout.sourceFile,
        message: 'Source-template script content requires agency security review.',
      });
    }
  }

  return {
    files,
    layouts,
    designSignals,
    findings,
    artifactDigestSha256: inputFiles.some((file) => file.content !== undefined)
      ? templateArtifactDigest(files)
      : createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  };
}
