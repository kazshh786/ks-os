import {
  DEFAULT_SITE_JOB_RETRY_POLICY,
  ActivateCustomDomainPayloadSchema,
  ActivateFallbackDomainPayloadSchema,
  ConfigureCustomDomainDnsPayloadSchema,
  CreateCustomDomainPlanPayloadSchema,
  CreateSitePublicationPayloadSchema,
  DiscoverCustomDomainDnsPayloadSchema,
  GenerateMetadataPayloadSchema,
  GeneratePagePayloadSchema,
  GenerateSitePayloadSchema,
  GenerateStructuredDataPayloadSchema,
  EvaluatePublicationReadinessPayloadSchema,
  RegenerateSectionPayloadSchema,
  ProvisionWorkspacePayloadSchema,
  InvalidateSiteCachePayloadSchema,
  RemoveSiteDomainPayloadSchema,
  RollbackSitePublicationPayloadSchema,
  RunPublicationHealthChecksPayloadSchema,
  RunAssetReadinessAuditPayloadSchema,
  RunBookingIntegrityAuditPayloadSchema,
  RunContentIntegrityAuditPayloadSchema,
  RunFullSiteQualityAuditPayloadSchema,
  RunPerformanceAuditPayloadSchema,
  RunPhase158AccessibilityAuditPayloadSchema,
  RunPhase158ConversionAuditPayloadSchema,
  RunResponsiveUxAuditPayloadSchema,
  RunTechnicalSeoAuditPayloadSchema,
  SiteJobExecutionError,
  SiteJobHandlerRegistry,
  SiteJobResultSchema,
  SuspendSiteDomainPayloadSchema,
  TestCancellablePayloadSchema,
  TestLongRunningPayloadSchema,
  TestRetryableFailurePayloadSchema,
  TestSucceedPayloadSchema,
  TestTerminalFailurePayloadSchema,
  VerifyCustomDomainPayloadSchema,
  VerifyNameserverDelegationPayloadSchema,
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

export interface WorkspaceProvisioningJobExecutor {
  execute(payload: unknown, context: SiteJobLeaseContext): Promise<SiteJobResult>;
}

export type SiteQualityJobType = Extract<SiteJobType,
  | 'RUN_FULL_SITE_QUALITY_AUDIT'
  | 'RUN_TECHNICAL_SEO_AUDIT'
  | 'RUN_ACCESSIBILITY_AUDIT'
  | 'RUN_RESPONSIVE_UX_AUDIT'
  | 'RUN_CONVERSION_AUDIT'
  | 'RUN_BOOKING_INTEGRITY_AUDIT'
  | 'RUN_PERFORMANCE_AUDIT'
  | 'RUN_CONTENT_INTEGRITY_AUDIT'
  | 'RUN_ASSET_READINESS_AUDIT'
  | 'EVALUATE_PUBLICATION_READINESS'>;

export interface SiteQualityJobExecutor {
  execute(
    jobType: SiteQualityJobType,
    payload: unknown,
    context: SiteJobLeaseContext,
  ): Promise<SiteJobResult>;
  close?(): Promise<void>;
}

export type SitePublicationJobType = Extract<SiteJobType,
  | 'CREATE_SITE_PUBLICATION'
  | 'ACTIVATE_FALLBACK_DOMAIN'
  | 'CREATE_CUSTOM_DOMAIN_PLAN'
  | 'DISCOVER_CUSTOM_DOMAIN_DNS'
  | 'VERIFY_NAMESERVER_DELEGATION'
  | 'CONFIGURE_CUSTOM_DOMAIN_DNS'
  | 'VERIFY_CUSTOM_DOMAIN'
  | 'ACTIVATE_CUSTOM_DOMAIN'
  | 'RUN_PUBLICATION_HEALTH_CHECKS'
  | 'ROLLBACK_SITE_PUBLICATION'
  | 'SUSPEND_SITE_DOMAIN'
  | 'REMOVE_SITE_DOMAIN'
  | 'INVALIDATE_SITE_CACHE'>;

export interface SitePublicationJobExecutor {
  execute(
    jobType: SitePublicationJobType,
    payload: unknown,
    context: SiteJobLeaseContext,
  ): Promise<SiteJobResult>;
  close?(): Promise<void>;
}

const disabledProvisioningExecutor: WorkspaceProvisioningJobExecutor = {
  async execute() {
    throw new SiteJobExecutionError(
      'TERMINAL_HANDLER_NOT_IMPLEMENTED',
      'Workspace provisioning is not configured for this worker.',
    );
  },
};

const disabledGenerationExecutor: SiteGenerationJobExecutor = {
  async execute() {
    throw new SiteJobExecutionError(
      'TERMINAL_DATA_MISSING',
      'Structured site generation is disabled or its server-side provider is not configured.',
    );
  },
};

const disabledQualityExecutor: SiteQualityJobExecutor = {
  async execute() {
    throw new SiteJobExecutionError(
      'TERMINAL_DATA_MISSING',
      'Site-quality execution is disabled for this worker.',
    );
  },
};

const disabledPublicationExecutor: SitePublicationJobExecutor = {
  async execute() {
    throw new SiteJobExecutionError(
      'TERMINAL_DATA_MISSING',
      'Site publication is disabled or its server-side providers are not configured.',
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

function qualityHandler(
  jobType: SiteQualityJobType,
  payloadSchema: SiteJobHandler['payloadSchema'],
  executor: SiteQualityJobExecutor,
): SiteJobHandler {
  return {
    jobType,
    payloadSchemaVersion: 1,
    supportsCancellation: true,
    defaultRetryPolicy: DEFAULT_SITE_JOB_RETRY_POLICY,
    payloadSchema,
    resultSchema: SiteJobResultSchema,
    async execute(payload: unknown, context: SiteJobLeaseContext) {
      return executor.execute(jobType, payloadSchema.parse(payload), context);
    },
  };
}

function publicationHandler(
  jobType: SitePublicationJobType,
  payloadSchema: SiteJobHandler['payloadSchema'],
  executor: SitePublicationJobExecutor,
): SiteJobHandler {
  return {
    jobType,
    payloadSchemaVersion: 1,
    supportsCancellation: true,
    defaultRetryPolicy: DEFAULT_SITE_JOB_RETRY_POLICY,
    payloadSchema,
    resultSchema: SiteJobResultSchema,
    async execute(payload: unknown, context: SiteJobLeaseContext) {
      return executor.execute(jobType, payloadSchema.parse(payload), context);
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
  provisioningExecutor: WorkspaceProvisioningJobExecutor = disabledProvisioningExecutor,
  qualityExecutor: SiteQualityJobExecutor = disabledQualityExecutor,
  publicationExecutor: SitePublicationJobExecutor = disabledPublicationExecutor,
): SiteJobHandlerRegistry {
  const registry = new SiteJobHandlerRegistry()
    .register({
      jobType: 'PROVISION_WORKSPACE',
      payloadSchemaVersion: 1,
      supportsCancellation: true,
      defaultRetryPolicy: DEFAULT_SITE_JOB_RETRY_POLICY,
      payloadSchema: ProvisionWorkspacePayloadSchema,
      resultSchema: SiteJobResultSchema,
      async execute(payload: unknown, context: SiteJobLeaseContext) {
        return provisioningExecutor.execute(
          ProvisionWorkspacePayloadSchema.parse(payload),
          context,
        );
      },
    })
    .register(generationHandler('GENERATE_SITE', GenerateSitePayloadSchema, generationExecutor))
    .register(generationHandler('GENERATE_PAGE', GeneratePagePayloadSchema, generationExecutor))
    .register(generationHandler('REGENERATE_SECTION', RegenerateSectionPayloadSchema, generationExecutor))
    .register(generationHandler('GENERATE_METADATA', GenerateMetadataPayloadSchema, generationExecutor))
    .register(generationHandler('GENERATE_STRUCTURED_DATA', GenerateStructuredDataPayloadSchema, generationExecutor))
    .register(qualityHandler('RUN_FULL_SITE_QUALITY_AUDIT', RunFullSiteQualityAuditPayloadSchema, qualityExecutor))
    .register(qualityHandler('RUN_TECHNICAL_SEO_AUDIT', RunTechnicalSeoAuditPayloadSchema, qualityExecutor))
    .register(qualityHandler('RUN_ACCESSIBILITY_AUDIT', RunPhase158AccessibilityAuditPayloadSchema, qualityExecutor))
    .register(qualityHandler('RUN_RESPONSIVE_UX_AUDIT', RunResponsiveUxAuditPayloadSchema, qualityExecutor))
    .register(qualityHandler('RUN_CONVERSION_AUDIT', RunPhase158ConversionAuditPayloadSchema, qualityExecutor))
    .register(qualityHandler('RUN_BOOKING_INTEGRITY_AUDIT', RunBookingIntegrityAuditPayloadSchema, qualityExecutor))
    .register(qualityHandler('RUN_PERFORMANCE_AUDIT', RunPerformanceAuditPayloadSchema, qualityExecutor))
    .register(qualityHandler('RUN_CONTENT_INTEGRITY_AUDIT', RunContentIntegrityAuditPayloadSchema, qualityExecutor))
    .register(qualityHandler('RUN_ASSET_READINESS_AUDIT', RunAssetReadinessAuditPayloadSchema, qualityExecutor))
    .register(qualityHandler('EVALUATE_PUBLICATION_READINESS', EvaluatePublicationReadinessPayloadSchema, qualityExecutor))
    .register(publicationHandler('CREATE_SITE_PUBLICATION', CreateSitePublicationPayloadSchema, publicationExecutor))
    .register(publicationHandler('ACTIVATE_FALLBACK_DOMAIN', ActivateFallbackDomainPayloadSchema, publicationExecutor))
    .register(publicationHandler('CREATE_CUSTOM_DOMAIN_PLAN', CreateCustomDomainPlanPayloadSchema, publicationExecutor))
    .register(publicationHandler('DISCOVER_CUSTOM_DOMAIN_DNS', DiscoverCustomDomainDnsPayloadSchema, publicationExecutor))
    .register(publicationHandler('VERIFY_NAMESERVER_DELEGATION', VerifyNameserverDelegationPayloadSchema, publicationExecutor))
    .register(publicationHandler('CONFIGURE_CUSTOM_DOMAIN_DNS', ConfigureCustomDomainDnsPayloadSchema, publicationExecutor))
    .register(publicationHandler('VERIFY_CUSTOM_DOMAIN', VerifyCustomDomainPayloadSchema, publicationExecutor))
    .register(publicationHandler('ACTIVATE_CUSTOM_DOMAIN', ActivateCustomDomainPayloadSchema, publicationExecutor))
    .register(publicationHandler('RUN_PUBLICATION_HEALTH_CHECKS', RunPublicationHealthChecksPayloadSchema, publicationExecutor))
    .register(publicationHandler('ROLLBACK_SITE_PUBLICATION', RollbackSitePublicationPayloadSchema, publicationExecutor))
    .register(publicationHandler('SUSPEND_SITE_DOMAIN', SuspendSiteDomainPayloadSchema, publicationExecutor))
    .register(publicationHandler('REMOVE_SITE_DOMAIN', RemoveSiteDomainPayloadSchema, publicationExecutor))
    .register(publicationHandler('INVALIDATE_SITE_CACHE', InvalidateSiteCachePayloadSchema, publicationExecutor));
  if (!enableTestHandlers) return registry;
  return registry
    .register(succeedHandler)
    .register(retryableFailureHandler)
    .register(terminalFailureHandler)
    .register(durationHandler('TEST_LONG_RUNNING', false))
    .register(durationHandler('TEST_CANCELLABLE', true));
}
