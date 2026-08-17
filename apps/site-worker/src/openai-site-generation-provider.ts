import type {
  SiteGenerationProvider,
  StructuredGenerationRequest,
  StructuredGenerationResponse,
} from '@ks-os/site-generation';
import { SiteGenerationProviderError } from '@ks-os/site-generation';

export const OPENAI_SITES_CREATIVE_BRIEF_VERSION = '1.0.0';

const CREATIVE_SYSTEM_INSTRUCTIONS = [
  'You are the creative site-generation layer for KS OS.',
  'Work like a senior digital art director, conversion designer, UX lead and premium website builder rather than a minimum-valid content generator.',
  'Create a cohesive, fully realised website experience across the supplied blueprint: strong hierarchy, rich but purposeful page depth, visual rhythm, deliberate cross-page variation, mobile-first composition and clear conversion journeys.',
  'Aim for the level of completeness and polish expected from a strong bespoke agency website or modern AI website builder.',
  'Do not reduce pages to the minimum number of valid sections when the supplied component catalog and facts support a richer composition.',
  'Use the supplied site-wide strategy to make pages feel related but not repetitive.',
  'Treat imagery, typography, spacing, surfaces and section sequencing as a coordinated design system.',
  'Prefer concrete, useful, audience-facing content over generic filler.',
  'Never invent business facts, services, prices, staff, locations, reviews, awards, results, availability, asset references or URLs.',
  'Never bypass the supplied schema, approved component catalog, Search Intelligence, booking rules, accessibility rules or provenance constraints.',
  'Return only the requested structured output. KS OS validation is authoritative.',
  `Creative brief contract version: ${OPENAI_SITES_CREATIVE_BRIEF_VERSION}.`,
].join(' ');

export interface OpenAISiteGenerationProviderOptions {
  apiKey: string;
  modelKey: string;
  requestTimeoutMs: number;
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
}

interface OpenAIResponsesEnvelope {
  id?: string;
  model?: string;
  status?: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete';
  error?: { code?: string | null; message?: string | null } | null;
  incomplete_details?: { reason?: string | null } | null;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  } | null;
}

function withoutTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

function responseText(envelope: OpenAIResponsesEnvelope) {
  return envelope.output
    ?.flatMap(item => item.content ?? [])
    .filter(item => item.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text ?? '')
    .join('')
    .trim() ?? '';
}

function responseRefusal(envelope: OpenAIResponsesEnvelope) {
  return envelope.output
    ?.flatMap(item => item.content ?? [])
    .find(item => item.type === 'refusal' && typeof item.refusal === 'string')
    ?.refusal;
}

/**
 * OpenAI Responses adapter for the controlled KS OS generator.
 *
 * The remote JSON schema is advisory rather than strict because the existing
 * KS OS schemas contain JSON-Schema features outside OpenAI's strict subset.
 * Local Zod validation + controlled repair remains authoritative.
 */
export class OpenAISiteGenerationProvider implements SiteGenerationProvider {
  readonly providerKey = 'openai';
  readonly modelKey: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: OpenAISiteGenerationProviderOptions) {
    if (!options.apiKey.trim()) throw new Error('OpenAI API key is required.');
    if (!/^[A-Za-z0-9._:-]{2,160}$/.test(options.modelKey)) {
      throw new Error('OpenAI model key is invalid.');
    }
    const baseUrl = new URL(options.baseUrl ?? 'https://api.openai.com/v1');
    if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password) {
      throw new Error('OpenAI base URL must be a credential-free HTTPS URL.');
    }
    this.modelKey = options.modelKey;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.baseUrl = withoutTrailingSlashes(baseUrl.toString());
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

    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelKey,
          store: false,
          instructions: CREATIVE_SYSTEM_INSTRUCTIONS,
          input: request.prompt,
          text: {
            format: {
              type: 'json_schema',
              name: 'ks_os_site_generation',
              schema: request.responseJsonSchema,
              strict: false,
            },
          },
        }),
        signal,
      });
    } catch {
      if (signal.aborted) {
        const cancelled = request.signal?.aborted;
        throw new SiteGenerationProviderError(
          cancelled ? 'CANCELLED' : 'TIMEOUT',
          cancelled ? 'Generation was cancelled.' : 'The provider request timed out.',
        );
      }
      throw new SiteGenerationProviderError(
        'RETRYABLE_EXTERNAL_FAILURE',
        'The OpenAI generation provider could not be reached.',
      );
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
      throw new SiteGenerationProviderError(
        response.status === 429
          ? 'RETRYABLE_RATE_LIMIT'
          : retryable ? 'RETRYABLE_EXTERNAL_FAILURE' : 'TERMINAL_PROVIDER_FAILURE',
        `The OpenAI generation provider rejected the request (${response.status}).`,
        Number.isFinite(retryAfter) ? (retryAfter as number) * 1_000 : undefined,
      );
    }

    const envelope = await response.json() as OpenAIResponsesEnvelope;
    const refusal = responseRefusal(envelope);
    if (refusal) {
      throw new SiteGenerationProviderError(
        'TERMINAL_PROVIDER_FAILURE',
        'The OpenAI generation provider refused the structured generation request.',
      );
    }
    if (envelope.status === 'failed' || envelope.status === 'cancelled') {
      throw new SiteGenerationProviderError(
        'RETRYABLE_EXTERNAL_FAILURE',
        'The OpenAI generation provider did not complete the request.',
      );
    }
    if (envelope.status === 'incomplete') {
      throw new SiteGenerationProviderError(
        'RETRYABLE_EXTERNAL_FAILURE',
        'The OpenAI generation provider returned an incomplete response.',
      );
    }

    const text = responseText(envelope);
    if (!text) {
      throw new SiteGenerationProviderError(
        'TERMINAL_PROVIDER_FAILURE',
        'The OpenAI generation provider returned no usable structured output.',
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
      responseReference: envelope.id,
      modelVersion: envelope.model,
      usage: {
        inputTokens: envelope.usage?.input_tokens,
        outputTokens: envelope.usage?.output_tokens,
        totalTokens: envelope.usage?.total_tokens,
      },
      outputCharacterCount: text.length,
    };
  }
}
