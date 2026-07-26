import type {
  SiteGenerationProvider,
  StructuredGenerationRequest,
  StructuredGenerationResponse,
} from './provider.js';
import { SiteGenerationProviderError } from './provider.js';

export interface ControlledRepairResult<T> {
  response: StructuredGenerationResponse<T>;
  repairAttempts: number;
  findings: readonly { code: string; message: string }[];
}

export async function generateWithControlledRepair<T>(input: {
  provider: SiteGenerationProvider;
  maxRepairAttempts: number;
  buildRequest: (
    repairAttempt: number,
    previousFindings: readonly { code: string; message: string }[],
  ) => StructuredGenerationRequest<T>;
  validate: (value: T) => {
    valid: boolean;
    findings: readonly { code: string; message: string }[];
  };
}): Promise<ControlledRepairResult<T>> {
  let previousFindings: readonly { code: string; message: string }[] = [];
  for (let repairAttempt = 0; repairAttempt <= input.maxRepairAttempts; repairAttempt += 1) {
    try {
      const response = await input.provider.generateStructuredOutput(
        input.buildRequest(repairAttempt, previousFindings),
      );
      const validation = input.validate(response.value);
      if (validation.valid) {
        return { response, repairAttempts: repairAttempt, findings: validation.findings };
      }
      previousFindings = validation.findings;
    } catch (error) {
      if (!(error instanceof SiteGenerationProviderError)
        || error.kind !== 'TERMINAL_INVALID_OUTPUT') {
        throw error;
      }
      previousFindings = [{
        code: 'PROVIDER_OUTPUT_INVALID',
        message: 'Return valid structured output matching the supplied schema.',
      }];
    }
  }
  throw new SiteGenerationProviderError(
    'TERMINAL_INVALID_OUTPUT',
    'Controlled generation repair attempts were exhausted.',
  );
}
