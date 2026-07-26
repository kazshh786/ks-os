import type { z } from 'zod';

export type ProviderFailureKind =
  | 'RETRYABLE_RATE_LIMIT'
  | 'RETRYABLE_EXTERNAL_FAILURE'
  | 'TERMINAL_PROVIDER_FAILURE'
  | 'TERMINAL_INVALID_OUTPUT'
  | 'TIMEOUT'
  | 'CANCELLED';

export class SiteGenerationProviderError extends Error {
  constructor(
    readonly kind: ProviderFailureKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'SiteGenerationProviderError';
  }
}

export interface StructuredGenerationRequest<T> {
  prompt: string;
  outputSchema: z.ZodType<T>;
  responseJsonSchema: Record<string, unknown>;
  maxOutputCharacters: number;
  signal?: AbortSignal;
}

export interface StructuredGenerationResponse<T> {
  value: T;
  providerKey: string;
  modelKey: string;
  responseReference?: string;
  modelVersion?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  outputCharacterCount: number;
}

export interface SiteGenerationProvider {
  readonly providerKey: string;
  readonly modelKey: string;
  generateStructuredOutput<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResponse<T>>;
}

/** Process-local concurrency guard; durable job concurrency remains worker-controlled. */
export class ConcurrencyLimitedSiteGenerationProvider
implements SiteGenerationProvider {
  readonly providerKey: string;
  readonly modelKey: string;
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly delegate: SiteGenerationProvider,
    private readonly maximumConcurrency: number,
  ) {
    if (!Number.isInteger(maximumConcurrency)
      || maximumConcurrency < 1
      || maximumConcurrency > 16) {
      throw new Error('Provider concurrency must be between 1 and 16.');
    }
    this.providerKey = delegate.providerKey;
    this.modelKey = delegate.modelKey;
  }

  async generateStructuredOutput<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResponse<T>> {
    await this.acquire(request.signal);
    try {
      return await this.delegate.generateStructuredOutput(request);
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  private async acquire(signal?: AbortSignal) {
    if (signal?.aborted) {
      throw new SiteGenerationProviderError('CANCELLED', 'Generation was cancelled.');
    }
    if (this.active < this.maximumConcurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal?.removeEventListener('abort', cancelled);
        this.active += 1;
        resolve();
      };
      const cancelled = () => {
        const index = this.waiting.indexOf(ready);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new SiteGenerationProviderError('CANCELLED', 'Generation was cancelled.'));
      };
      this.waiting.push(ready);
      signal?.addEventListener('abort', cancelled, { once: true });
    });
  }
}

export interface GeminiProviderOptions {
  apiKey: string;
  modelKey: string;
  requestTimeoutMs: number;
  temperature?: number;
  endpoint?: string;
  fetchImplementation?: typeof fetch;
}

interface GeminiResponse {
  responseId?: string;
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/** Server-only Gemini adapter. It never logs or returns its credential. */
export class GeminiSiteGenerationProvider implements SiteGenerationProvider {
  readonly providerKey = 'gemini';
  readonly modelKey: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: GeminiProviderOptions) {
    if (!options.apiKey.trim()) throw new Error('Gemini API key is required.');
    if (!/^[A-Za-z0-9._-]{2,160}$/.test(options.modelKey)) {
      throw new Error('Gemini model key is invalid.');
    }
    this.modelKey = options.modelKey;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async generateStructuredOutput<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResponse<T>> {
    const timeout = AbortSignal.timeout(this.options.requestTimeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeout])
      : timeout;
    const endpoint = this.options.endpoint
      ?? 'https://generativelanguage.googleapis.com/v1beta';
    let response: Response;
    try {
      response = await this.fetchImplementation(
        `${endpoint}/models/${encodeURIComponent(this.modelKey)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.options.apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseJsonSchema: request.responseJsonSchema,
              candidateCount: 1,
              ...(this.options.temperature === undefined
                ? {}
                : { temperature: this.options.temperature }),
            },
          }),
          signal,
        },
      );
    } catch (error) {
      if (signal.aborted) {
        const cancelled = request.signal?.aborted;
        throw new SiteGenerationProviderError(
          cancelled ? 'CANCELLED' : 'TIMEOUT',
          cancelled ? 'Generation was cancelled.' : 'The provider request timed out.',
        );
      }
      throw new SiteGenerationProviderError(
        'RETRYABLE_EXTERNAL_FAILURE',
        'The generation provider could not be reached.',
      );
    }
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new SiteGenerationProviderError(
        response.status === 429
          ? 'RETRYABLE_RATE_LIMIT'
          : retryable ? 'RETRYABLE_EXTERNAL_FAILURE' : 'TERMINAL_PROVIDER_FAILURE',
        `The generation provider rejected the request (${response.status}).`,
        Number.isFinite(retryAfter) ? retryAfter * 1_000 : undefined,
      );
    }
    const envelope = await response.json() as GeminiResponse;
    const text = envelope.candidates?.[0]?.content?.parts
      ?.map(part => part.text ?? '')
      .join('')
      .trim();
    if (!text || envelope.promptFeedback?.blockReason) {
      throw new SiteGenerationProviderError(
        'TERMINAL_PROVIDER_FAILURE',
        'The generation provider returned no usable structured output.',
      );
    }
    if (text.length > request.maxOutputCharacters) {
      throw new SiteGenerationProviderError(
        'TERMINAL_INVALID_OUTPUT',
        'The provider output exceeded the configured safe size.',
      );
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new SiteGenerationProviderError(
        'TERMINAL_INVALID_OUTPUT',
        'The provider output was not valid JSON.',
      );
    }
    const parsed = request.outputSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new SiteGenerationProviderError(
        'TERMINAL_INVALID_OUTPUT',
        'The provider output did not match the controlled schema.',
      );
    }
    return {
      value: parsed.data,
      providerKey: this.providerKey,
      modelKey: this.modelKey,
      responseReference: envelope.responseId,
      modelVersion: envelope.modelVersion,
      usage: {
        inputTokens: envelope.usageMetadata?.promptTokenCount,
        outputTokens: envelope.usageMetadata?.candidatesTokenCount,
        totalTokens: envelope.usageMetadata?.totalTokenCount,
      },
      outputCharacterCount: text.length,
    };
  }
}

export type FakeProviderFixture =
  | { kind: 'VALUE'; value: unknown }
  | { kind: 'MALFORMED_JSON' }
  | { kind: 'RETRYABLE_FAILURE'; retryAfterMs?: number }
  | { kind: 'TERMINAL_FAILURE' }
  | { kind: 'TIMEOUT' };

export class DeterministicFakeSiteGenerationProvider
implements SiteGenerationProvider {
  readonly providerKey = 'fake';
  readonly modelKey = 'deterministic-fixture-v1';
  readonly requests: Array<{ prompt: string; maxOutputCharacters: number }> = [];
  private cursor = 0;

  constructor(private readonly fixtures: readonly FakeProviderFixture[]) {}

  async generateStructuredOutput<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResponse<T>> {
    this.requests.push({
      prompt: request.prompt,
      maxOutputCharacters: request.maxOutputCharacters,
    });
    if (request.signal?.aborted) {
      throw new SiteGenerationProviderError('CANCELLED', 'Generation was cancelled.');
    }
    const fixture = this.fixtures[this.cursor++];
    if (!fixture) throw new Error('No deterministic provider fixture remains.');
    if (fixture.kind === 'RETRYABLE_FAILURE') {
      throw new SiteGenerationProviderError(
        'RETRYABLE_EXTERNAL_FAILURE',
        'The deterministic provider requested a retry.',
        fixture.retryAfterMs,
      );
    }
    if (fixture.kind === 'TERMINAL_FAILURE') {
      throw new SiteGenerationProviderError(
        'TERMINAL_PROVIDER_FAILURE',
        'The deterministic provider failed terminally.',
      );
    }
    if (fixture.kind === 'TIMEOUT') {
      throw new SiteGenerationProviderError('TIMEOUT', 'The deterministic provider timed out.');
    }
    if (fixture.kind === 'MALFORMED_JSON') {
      throw new SiteGenerationProviderError('TERMINAL_INVALID_OUTPUT', 'Malformed fixture JSON.');
    }
    const parsed = request.outputSchema.safeParse(fixture.value);
    if (!parsed.success) {
      throw new SiteGenerationProviderError(
        'TERMINAL_INVALID_OUTPUT',
        'The deterministic fixture failed schema validation.',
      );
    }
    const outputCharacterCount = JSON.stringify(parsed.data).length;
    if (outputCharacterCount > request.maxOutputCharacters) {
      throw new SiteGenerationProviderError(
        'TERMINAL_INVALID_OUTPUT',
        'The deterministic fixture exceeded the safe size.',
      );
    }
    return {
      value: parsed.data,
      providerKey: this.providerKey,
      modelKey: this.modelKey,
      responseReference: `fixture-${this.cursor}`,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      outputCharacterCount,
    };
  }
}
