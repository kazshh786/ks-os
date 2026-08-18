import { GoogleAuth } from 'google-auth-library';
import type { z } from 'zod';
import {
  isSiteGenerationProviderReady,
  type SiteGenerationConfig,
} from './config.js';

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

export interface VertexGeminiProviderOptions {
  project: string;
  location: string;
  modelKey: string;
  requestTimeoutMs: number;
  temperature?: number;
  endpoint?: string;
  googleAuthFactory?: (options: VertexGoogleAuthOptions) => VertexGoogleAuthClient;
  fetchImplementation?: typeof fetch;
}

export interface VertexGoogleAuthOptions {
  projectId: string;
  scopes: string[];
}

export interface VertexGoogleAuthClient {
  getRequestHeaders(url?: string): Promise<
    | { get(name: string): string | null }
    | Record<string, string | undefined>
  >;
}

interface VertexGeminiResponse {
  responseId?: string;
  name?: string;
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

function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

const VERTEX_JSON_SCHEMA_SCALAR_PROPERTIES = new Set([
  '$id',
  '$ref',
  '$anchor',
  'type',
  'format',
  'title',
  'description',
  'enum',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'required',
  'propertyOrdering',
]);

/**
 * Vertex accepts JSON Schema, but only a documented subset of its keywords.
 * The authoritative Zod schema still validates every provider response locally;
 * this projection only prevents Vertex from rejecting unsupported request fields.
 */
function vertexResponseJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};

  if (schema.enum === undefined
    && (typeof schema.const === 'string' || typeof schema.const === 'number')) {
    projected.enum = [schema.const];
  }

  for (const [key, value] of Object.entries(schema)) {
    if (VERTEX_JSON_SCHEMA_SCALAR_PROPERTIES.has(key)) {
      projected[key] = value;
      continue;
    }

    if ((key === 'properties' || key === '$defs')
      && value !== null
      && typeof value === 'object'
      && !Array.isArray(value)) {
      projected[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter((entry): entry is [string, Record<string, unknown>] => (
            entry[1] !== null && typeof entry[1] === 'object' && !Array.isArray(entry[1])
          ))
          .map(([name, child]) => [name, vertexResponseJsonSchema(child)]),
      );
      continue;
    }

    if ((key === 'anyOf' || key === 'oneOf' || key === 'prefixItems')
      && Array.isArray(value)) {
      projected[key] = value
        .filter((child): child is Record<string, unknown> => (
          child !== null && typeof child === 'object' && !Array.isArray(child)
        ))
        .map(child => vertexResponseJsonSchema(child));
      continue;
    }

    if ((key === 'items' || key === 'additionalProperties')
      && value !== null
      && typeof value === 'object'
      && !Array.isArray(value)) {
      projected[key] = vertexResponseJsonSchema(value as Record<string, unknown>);
      continue;
    }

    if (key === 'additionalProperties' && typeof value === 'boolean') {
      projected[key] = value;
    }
  }

  return projected;
}

/** Server-only Vertex Gemini adapter using Application Default Credentials. */
export class VertexGeminiSiteGenerationProvider implements SiteGenerationProvider {
  readonly providerKey = 'vertex-gemini';
  readonly modelKey: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly googleAuth: VertexGoogleAuthClient;

  constructor(private readonly options: VertexGeminiProviderOptions) {
    if (!options.project.trim()) throw new Error('Vertex project is required.');
    if (!options.location.trim()) throw new Error('Vertex location is required.');
    if (!/^[A-Za-z0-9._-]{2,160}$/.test(options.modelKey)) {
      throw new Error('Vertex Gemini model key is invalid.');
    }
    this.modelKey = options.modelKey;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    const authOptions = {
      projectId: options.project,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    };
    this.googleAuth = options.googleAuthFactory?.(authOptions) ?? new GoogleAuth(authOptions);
  }

  private async getAuthorizationHeader(url: string): Promise<string> {
    try {
      const headers = await this.googleAuth.getRequestHeaders(url);
      const getHeader = (headers as { get?: (name: string) => string | null }).get;
      const headerRecord = headers as Record<string, string | undefined>;
      const authorization = typeof getHeader === 'function'
        ? getHeader.call(headers, 'authorization')
        : headerRecord.authorization ?? headerRecord.Authorization;

      if (typeof authorization === 'string' && authorization.trim()) {
        return authorization.trim();
      }
    } catch {
      // The stable error below avoids leaking credential paths or provider details.
    }

    throw new SiteGenerationProviderError(
      'TERMINAL_PROVIDER_FAILURE',
      'Application Default Credentials could not authorize the Vertex AI request.',
    );
  }

  async generateStructuredOutput<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResponse<T>> {
    const timeout = AbortSignal.timeout(this.options.requestTimeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeout])
      : timeout;

    if (signal.aborted) {
      const cancelled = request.signal?.aborted;
      throw new SiteGenerationProviderError(
        cancelled ? 'CANCELLED' : 'TIMEOUT',
        cancelled ? 'Generation was cancelled.' : 'The provider request timed out.',
      );
    }

    const endpointPath = `/v1/projects/${encodeURIComponent(this.options.project)}/locations/${encodeURIComponent(this.options.location)}/publishers/google/models/${encodeURIComponent(this.modelKey)}:generateContent`;
    let url: string;
    if (this.options.endpoint) {
      const trimmedEndpoint = withoutTrailingSlashes(this.options.endpoint);
      if (trimmedEndpoint.includes('/projects/') || trimmedEndpoint.endsWith(':generateContent')) {
        url = trimmedEndpoint;
      } else {
        url = `${trimmedEndpoint}${endpointPath}`;
      }
    } else {
      const host = this.options.location === 'global'
        ? 'aiplatform.googleapis.com'
        : `${encodeURIComponent(this.options.location)}-aiplatform.googleapis.com`;
      url = `https://${host}${endpointPath}`;
    }

    let authorization: string;
    try {
      authorization = await this.getAuthorizationHeader(url);
    } catch (error) {
      if (signal.aborted) {
        const cancelled = request.signal?.aborted;
        throw new SiteGenerationProviderError(
          cancelled ? 'CANCELLED' : 'TIMEOUT',
          cancelled ? 'Generation was cancelled.' : 'The provider request timed out.',
        );
      }
      if (error instanceof SiteGenerationProviderError) throw error;
      throw new SiteGenerationProviderError(
        'TERMINAL_PROVIDER_FAILURE',
        'Application Default Credentials could not authorize the Vertex AI request.',
      );
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: vertexResponseJsonSchema(request.responseJsonSchema),
            candidateCount: 1,
            ...(this.options.temperature === undefined
              ? {}
              : { temperature: this.options.temperature }),
          },
        }),
        signal,
      });
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
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
      const kind: ProviderFailureKind = response.status === 429
        ? 'RETRYABLE_RATE_LIMIT'
        : retryable
          ? 'RETRYABLE_EXTERNAL_FAILURE'
          : 'TERMINAL_PROVIDER_FAILURE';
      throw new SiteGenerationProviderError(
        kind,
        `The generation provider rejected the request (${response.status}).`,
        Number.isFinite(retryAfter) ? (retryAfter as number) * 1_000 : undefined,
      );
    }

    const envelope = await response.json() as VertexGeminiResponse;
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
      responseReference: envelope.responseId ?? envelope.name,
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

export function createSiteGenerationProvider(
  config: SiteGenerationConfig,
  options?: {
    googleAuthFactory?: (options: VertexGoogleAuthOptions) => VertexGoogleAuthClient;
    fetchImplementation?: typeof fetch;
  },
): SiteGenerationProvider {
  if (!isSiteGenerationProviderReady(config) || !config.model) {
    throw new Error('A complete enabled generation configuration is required.');
  }

  let baseProvider: SiteGenerationProvider;

  if (config.provider === 'vertex-gemini') {
    if (!config.googleCloudProject || !config.googleCloudLocation) {
      throw new Error('GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are required for vertex-gemini.');
    }
    baseProvider = new VertexGeminiSiteGenerationProvider({
      project: config.googleCloudProject,
      location: config.googleCloudLocation,
      modelKey: config.model,
      requestTimeoutMs: config.requestTimeoutMs,
      temperature: config.temperature,
      googleAuthFactory: options?.googleAuthFactory,
      fetchImplementation: options?.fetchImplementation,
    });
  } else if (config.provider === 'gemini') {
    if (!config.apiKey) {
      throw new Error('SITE_AI_API_KEY is required for gemini.');
    }
    baseProvider = new GeminiSiteGenerationProvider({
      apiKey: config.apiKey,
      modelKey: config.model,
      requestTimeoutMs: config.requestTimeoutMs,
      temperature: config.temperature,
      fetchImplementation: options?.fetchImplementation,
    });
  } else {
    throw new Error(`Unsupported SITE_AI_PROVIDER: ${(config as { provider: string }).provider}`);
  }

  return new ConcurrencyLimitedSiteGenerationProvider(
    baseProvider,
    config.maxConcurrentRequests,
  );
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
