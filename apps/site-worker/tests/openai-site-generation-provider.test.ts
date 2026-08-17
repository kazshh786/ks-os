import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { parseSiteGenerationConfig, SiteGenerationProviderError } from '@ks-os/site-generation';
import {
  OPENAI_SITES_CREATIVE_BRIEF_VERSION,
  OpenAISiteGenerationProvider,
} from '../src/openai-site-generation-provider.js';

const Output = z.object({
  headline: z.string(),
  sections: z.array(z.string()),
}).strict();

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'sections'],
  properties: {
    headline: { type: 'string' },
    sections: { type: 'array', items: { type: 'string' } },
  },
};

test('OpenAI provider sends the KS OS whole-site creative brief through Responses structured output', async () => {
  let requestBody: any;
  let requestAuthorization = '';
  const provider = new OpenAISiteGenerationProvider({
    apiKey: 'sk-test-secret',
    modelKey: 'gpt-5.6',
    requestTimeoutMs: 5_000,
    baseUrl: 'https://api.openai.test/v1',
    fetchImplementation: async (_url, init) => {
      requestAuthorization = new Headers(init?.headers).get('authorization') ?? '';
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'resp_test',
        model: 'gpt-5.6-2026-08-01',
        status: 'completed',
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: JSON.stringify({
              headline: 'A considered premium experience',
              sections: ['hero', 'services', 'trust', 'booking'],
            }),
          }],
        }],
        usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await provider.generateStructuredOutput({
    prompt: '{"operation":"SITE_COMPOSITION_STRATEGY_V2"}',
    outputSchema: Output,
    responseJsonSchema,
    maxOutputCharacters: 10_000,
  });

  assert.equal(requestAuthorization, 'Bearer sk-test-secret');
  assert.equal(requestBody.model, 'gpt-5.6');
  assert.equal(requestBody.store, false);
  assert.match(requestBody.instructions, /senior digital art director/i);
  assert.match(requestBody.instructions, /fully realised website/i);
  assert.match(requestBody.instructions, new RegExp(OPENAI_SITES_CREATIVE_BRIEF_VERSION.replaceAll('.', '\\.')));
  assert.equal(requestBody.input, '{"operation":"SITE_COMPOSITION_STRATEGY_V2"}');
  assert.equal(requestBody.text.format.type, 'json_schema');
  assert.equal(requestBody.text.format.name, 'ks_os_site_generation');
  assert.equal(requestBody.text.format.strict, false);
  assert.deepEqual(requestBody.text.format.schema, responseJsonSchema);
  assert.deepEqual(result.value.sections, ['hero', 'services', 'trust', 'booking']);
  assert.equal(result.providerKey, 'openai');
  assert.equal(result.responseReference, 'resp_test');
  assert.equal(result.usage?.totalTokens, 200);
});

test('OpenAI provider keeps local KS OS schema validation authoritative', async () => {
  const provider = new OpenAISiteGenerationProvider({
    apiKey: 'sk-test-secret',
    modelKey: 'gpt-5.6',
    requestTimeoutMs: 5_000,
    fetchImplementation: async () => new Response(JSON.stringify({
      status: 'completed',
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: '{"headline":42,"sections":[]}' }],
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });

  await assert.rejects(
    () => provider.generateStructuredOutput({
      prompt: '{}',
      outputSchema: Output,
      responseJsonSchema,
      maxOutputCharacters: 10_000,
    }),
    (error: unknown) => error instanceof SiteGenerationProviderError
      && error.kind === 'TERMINAL_INVALID_OUTPUT',
  );
});

test('OpenAI provider maps rate limiting to the existing durable retry contract', async () => {
  const provider = new OpenAISiteGenerationProvider({
    apiKey: 'sk-test-secret',
    modelKey: 'gpt-5.6',
    requestTimeoutMs: 5_000,
    fetchImplementation: async () => new Response('{}', {
      status: 429,
      headers: { 'retry-after': '3' },
    }),
  });

  await assert.rejects(
    () => provider.generateStructuredOutput({
      prompt: '{}',
      outputSchema: Output,
      responseJsonSchema,
      maxOutputCharacters: 10_000,
    }),
    (error: unknown) => error instanceof SiteGenerationProviderError
      && error.kind === 'RETRYABLE_RATE_LIMIT'
      && error.retryAfterMs === 3_000,
  );
});

test('site generation config accepts OpenAI without weakening existing provider config', () => {
  const config = parseSiteGenerationConfig({
    SITE_AI_GENERATION_ENABLED: 'true',
    SITE_AI_PROVIDER: 'openai',
    SITE_AI_MODEL: 'gpt-5.6',
    OPENAI_API_KEY: 'sk-config-test',
    SITE_AI_OPENAI_BASE_URL: 'https://gb.api.openai.com/v1',
  });

  assert.equal(config.provider, 'openai');
  assert.equal(config.model, 'gpt-5.6');
  assert.equal(config.apiKey, 'sk-config-test');
  assert.equal(config.openAiBaseUrl, 'https://gb.api.openai.com/v1');
});
