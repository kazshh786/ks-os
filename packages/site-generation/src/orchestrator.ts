export * from './draft-first-orchestrator.js';

import {
  executeStructuredSiteGeneration as executeDraftFirstSiteGeneration,
  type ExecuteSiteGenerationInput,
} from './draft-first-orchestrator.js';

export async function executeStructuredSiteGeneration(input: ExecuteSiteGenerationInput) {
  if ((input.pipelineVersion ?? 1) !== 1 || !input.updateProgress) {
    return executeDraftFirstSiteGeneration(input);
  }

  let previousProgressKey = '';
  return executeDraftFirstSiteGeneration({
    ...input,
    updateProgress: async progress => {
      const key = `${progress.current}/${progress.total}`;
      if (key === previousProgressKey) return;
      previousProgressKey = key;
      await input.updateProgress?.(progress);
    },
  });
}
