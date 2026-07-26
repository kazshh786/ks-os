import {
  DEFAULT_SITE_JOB_RETRY_POLICY,
  GenerateMetadataPayloadSchema,
  GeneratePagePayloadSchema,
  GenerateSitePayloadSchema,
  GenerateStructuredDataPayloadSchema,
  RegenerateSectionPayloadSchema,
  SiteJobExecutionError,
  SiteJobHandlerRegistry,
  SiteJobResultSchema,
  TestCancellablePayloadSchema,
  TestLongRunningPayloadSchema,
  TestRetryableFailurePayloadSchema,
  TestSucceedPayloadSchema,
  TestTerminalFailurePayloadSchema,
  type SiteJobHandler,
  type SiteJobLeaseContext,
  type SiteJobResult,
  type SiteJobType,
} from '@ks-os/site-jobs';

export interface SiteGenerationJobExecutor {
  execute(
    jobType: Extract<SiteJobType,
      | 'GENERATE_SITE'
      | 'GENERATE_PAGE'
      | 'REGENERATE_SECTION'
      | 'GENERATE_METADATA'
      | 'GENERATE_STRUCTURED_DATA'>,
    payload: unknown,
    context: SiteJobLeaseContext,
  ): Promise<SiteJobResult>;
}

const disabledGenerationExecutor: SiteGenerationJobExecutor = {
  async execute() {
    throw new SiteJobExecutionError(
      'TERMINAL_DATA_MISSING',
      'Structured site generation is disabled or its server-side provider is not configured.',
    );
  },
};

function generationHandler(
  jobType: Parameters<SiteGenerationJobExecutor['execute']>[0],
  payloadSchema: SiteJobHandler['payloadSchema'],
  executor: SiteGenerationJobExecutor,
): SiteJobHandler {
  return {
    jobType,
    payloadSchemaVersion: 1,
    supportsCancellation: true,
    defaultRetryPolicy: DEFAULT_SITE_JOB_RETRY_POLICY,
    payloadSchema,
    resultSchema: SiteJobResultSchema,
    async execute(payload: unknown, context: SiteJobLeaseContext) {
      const parsed = payloadSchema.parse(payload);
      return executor.execute(jobType, parsed, context);
    },
  };
}

function waitForDuration(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

const succeedHandler: SiteJobHandler = {
  jobType: 'TEST_SUCCEED',
  payloadSchemaVersion: 1,
  supportsCancellation: false,
  defaultRetryPolicy: DEFAULT_SITE_JOB_RETRY_POLICY,
  payloadSchema: TestSucceedPayloadSchema,
  resultSchema: SiteJobResultSchema,
  async execute(payload: unknown) {
    const parsed = TestSucceedPayloadSchema.parse(payload);
    return {
      summary: 'The internal test job completed.',
      outputReferences: [parsed.correlationReference],
      metrics: { completed: 1 },
    };
  },
};

const retryableFailureHandler: SiteJobHandler = {
  jobType: 'TEST_RETRYABLE_FAILURE',
  payloadSchemaVersion: 1,
  supportsCancellation: false,
  defaultRetryPolicy: {
    ...DEFAULT_SITE_JOB_RETRY_POLICY,
    initialDelayMs: 100,
    maximumDelayMs: 2_000,
    jitterRatio: 0,
  },
  payloadSchema: TestRetryableFailurePayloadSchema,
  resultSchema: SiteJobResultSchema,
  async execute(payload: unknown) {
    const parsed = TestRetryableFailurePayloadSchema.parse(payload);
    throw new SiteJobExecutionError(
      'RETRYABLE_EXTERNAL_FAILURE',
      'The internal retry test requested another attempt.',
      parsed.retryAfterMs,
    );
  },
};

const terminalFailureHandler: SiteJobHandler = {
  jobType: 'TEST_TERMINAL_FAILURE',
  payloadSchemaVersion: 1,
  supportsCancellation: false,
  defaultRetryPolicy: DEFAULT_SITE_JOB_RETRY_POLICY,
  payloadSchema: TestTerminalFailurePayloadSchema,
  resultSchema: SiteJobResultSchema,
  async execute(payload: unknown) {
    TestTerminalFailurePayloadSchema.parse(payload);
    throw new SiteJobExecutionError(
      'TERMINAL_VALIDATION_FAILURE',
      'The internal terminal-failure test was rejected.',
    );
  },
};

function durationHandler(
  jobType: 'TEST_LONG_RUNNING' | 'TEST_CANCELLABLE',
  supportsCancellation: boolean,
): SiteJobHandler {
  const payloadSchema = jobType === 'TEST_LONG_RUNNING'
    ? TestLongRunningPayloadSchema
    : TestCancellablePayloadSchema;
  return {
    jobType,
    payloadSchemaVersion: 1,
    supportsCancellation,
    defaultRetryPolicy: DEFAULT_SITE_JOB_RETRY_POLICY,
    payloadSchema,
    resultSchema: SiteJobResultSchema,
    async execute(payload: unknown, context: SiteJobLeaseContext) {
      const parsed = payloadSchema.parse(payload);
      await context.updateProgress({
        current: 1,
        total: 2,
        message: 'Internal test work is in progress.',
      });
      await waitForDuration(parsed.durationMs, context.signal);
      await context.updateProgress({
        current: 2,
        total: 2,
        message: 'Internal test work completed.',
      });
      return {
        summary: 'The internal duration test completed.',
        outputReferences: [parsed.correlationReference],
        metrics: { durationMs: parsed.durationMs },
      };
    },
  };
}

export function createSiteJobHandlerRegistry(
  enableTestHandlers = false,
  generationExecutor: SiteGenerationJobExecutor = disabledGenerationExecutor,
): SiteJobHandlerRegistry {
  const registry = new SiteJobHandlerRegistry()
    .register(generationHandler('GENERATE_SITE', GenerateSitePayloadSchema, generationExecutor))
    .register(generationHandler('GENERATE_PAGE', GeneratePagePayloadSchema, generationExecutor))
    .register(generationHandler('REGENERATE_SECTION', RegenerateSectionPayloadSchema, generationExecutor))
    .register(generationHandler('GENERATE_METADATA', GenerateMetadataPayloadSchema, generationExecutor))
    .register(generationHandler('GENERATE_STRUCTURED_DATA', GenerateStructuredDataPayloadSchema, generationExecutor));
  if (!enableTestHandlers) return registry;
  return registry
    .register(succeedHandler)
    .register(retryableFailureHandler)
    .register(terminalFailureHandler)
    .register(durationHandler('TEST_LONG_RUNNING', false))
    .register(durationHandler('TEST_CANCELLABLE', true));
}
