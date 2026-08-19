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

function normalizeMissingDataFindings<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  if (!Array.isArray(object.missingDataFindings)) return value;

  return {
    ...object,
    missingDataFindings: object.missingDataFindings.map(finding => {
      if (!finding || typeof finding !== 'object' || Array.isArray(finding)) return finding;
      const findingObject = finding as Record<string, unknown>;
      return findingObject.severity === 'ERROR'
        ? { ...findingObject, severity: 'WARNING' }
        : finding;
    }),
  } as T;
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
      const providerResponse = await input.provider.generateStructuredOutput(
        input.buildRequest(repairAttempt, previousFindings),
      );
      const value = normalizeMissingDataFindings(providerResponse.value);
      const response: StructuredGenerationResponse<T> = { ...providerResponse, value };
      const validation = input.validate(value);
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
