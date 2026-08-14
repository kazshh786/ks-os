export interface V2ExpectedLayout {
  semanticKey: string;
  pageTypes: readonly string[];
}

export interface V2PersistedLayout {
  id: string;
  semanticKey: string;
  status: string;
  sectionManifest: unknown;
  rendererStatus: string | null;
  rendererKey: string | null;
  rendererVersion: number | null;
  compiledRendererVersion?: number | null;
  compiledRendererPageTypes?: readonly string[];
}

export function isV2TemplateManifest(manifest: unknown) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
  const value = manifest as Record<string, unknown>;
  return value.componentRegistryVersion === 2 && value.generationPipelineVersion === 2;
}

export function auditV2TemplateReadiness(input: {
  manifest: unknown;
  analysisStatus: string;
  expectedLayouts: readonly V2ExpectedLayout[];
  layouts: readonly V2PersistedLayout[];
  pageTypesByLayoutId: ReadonlyMap<string, ReadonlySet<string>>;
  sectionLayoutIds: ReadonlySet<string>;
}) {
  const failures: string[] = [];
  if (!isV2TemplateManifest(input.manifest)) failures.push('The template manifest is not pinned to V2.');
  if (input.analysisStatus !== 'APPROVED') failures.push('Template analysis is not approved.');
  if (input.layouts.length !== input.expectedLayouts.length) {
    failures.push(`Expected ${input.expectedLayouts.length} persisted layouts; found ${input.layouts.length}.`);
  }
  const expectedByKey = new Map(input.expectedLayouts.map(layout => [layout.semanticKey, layout]));
  const persistedKeys = new Set(input.layouts.map(layout => layout.semanticKey));
  for (const expected of input.expectedLayouts) {
    if (!persistedKeys.has(expected.semanticKey)) failures.push(`Layout ${expected.semanticKey} is missing.`);
  }
  for (const layout of input.layouts) {
    const expected = expectedByKey.get(layout.semanticKey);
    if (!expected) failures.push(`Unexpected V2 layout ${layout.semanticKey} is persisted.`);
    if (layout.status !== 'APPROVED') failures.push(`Layout ${layout.semanticKey} is not approved.`);
    if (!Array.isArray(layout.sectionManifest) || layout.sectionManifest.length === 0) {
      failures.push(`Layout ${layout.semanticKey} has no section manifest.`);
    }
    if (layout.rendererStatus !== 'READY' || !layout.rendererKey || !layout.rendererVersion) {
      failures.push(`Layout ${layout.semanticKey} has no ready versioned renderer.`);
    }
    if (layout.rendererVersion !== layout.compiledRendererVersion) {
      failures.push(`Layout ${layout.semanticKey} does not match a compiled renderer version.`);
    }
    if (!input.sectionLayoutIds.has(layout.id)) failures.push(`Layout ${layout.semanticKey} has no normalized sections.`);
    if (expected) {
      const pageTypes = input.pageTypesByLayoutId.get(layout.id) ?? new Set<string>();
      for (const pageType of expected.pageTypes) {
        if (!pageTypes.has(pageType)) failures.push(`Layout ${layout.semanticKey} is missing ${pageType} compatibility.`);
        if (!layout.compiledRendererPageTypes?.includes(pageType)) failures.push(`Layout ${layout.semanticKey} renderer cannot render ${pageType}.`);
      }
    }
  }
  return { ready: failures.length === 0, failures } as const;
}
