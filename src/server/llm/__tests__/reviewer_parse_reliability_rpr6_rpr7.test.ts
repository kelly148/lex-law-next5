/**
 * REVIEWER-PARSE-RELIABILITY-1 — RPR-6 (OpenAI/xAI strict json_schema) + RPR-7 (Gemini responseSchema).
 *
 * These request-shape changes are gated on isReviewerNativeStructuredOutputEnabled()
 * (REVIEWER_NATIVE_STRUCTURED_OUTPUT_ENABLED, default OFF) AND MODEL_CAPABILITIES
 * supportsNativeStructuredOutput AND reference-identity to RawSuggestionsArraySchema (so the object-shaped
 * evaluator is never affected). These tests verify the request-BODY selection (compliance itself is a live
 * check) plus the {feedback:[...]} -> [...] reduction. Fixtures inline; no network.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { z } from 'zod';
import { OpenAiAdapter } from '../openai.js';
import { XaiAdapter } from '../xai.js';
import { GoogleAdapter } from '../google.js';
import { RawSuggestionsArraySchema } from '../parsers/feedbackParser.js';

const FLAG = 'REVIEWER_NATIVE_STRUCTURED_OUTPUT_ENABLED';
let savedFlag: string | undefined;

beforeEach(() => {
  savedFlag = process.env[FLAG];
  process.env['OPENAI_API_KEY'] = 'k';
  process.env['XAI_API_KEY'] = 'k';
  process.env['GOOGLE_API_KEY'] = 'k';
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  vi.restoreAllMocks();
});

function captureOpenAiLike(content = '[]') {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return {
        ok: true,
        json: async () => ({
          id: 'c',
          model: 'm',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        text: async () => '',
      };
    }),
  );
  return bodies;
}

function captureGemini(text = '[]') {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
        text: async () => '',
      };
    }),
  );
  return bodies;
}

const REVIEW_PARAMS = {
  systemPrompt: 's',
  userPrompt: 'u',
  structuredOutputSchema: RawSuggestionsArraySchema,
  maxTokens: 16384,
  signal: AbortSignal.timeout(5000),
};

describe('RPR-6 — OpenAI strict json_schema request shape', () => {
  it('flag ON + capable model + reviewer schema → response_format json_schema (feedback wrapper)', async () => {
    process.env[FLAG] = 'true';
    const bodies = captureOpenAiLike();
    await new OpenAiAdapter('gpt-5.5').generate({ ...REVIEW_PARAMS });
    const rf = bodies[0]!.response_format as { type: string; json_schema?: { strict: boolean } };
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema?.strict).toBe(true);
  });

  it('flag OFF → json_object (default, byte-identical to today)', async () => {
    delete process.env[FLAG];
    const bodies = captureOpenAiLike();
    await new OpenAiAdapter('gpt-5.5').generate({ ...REVIEW_PARAMS });
    expect((bodies[0]!.response_format as { type: string }).type).toBe('json_object');
  });

  it('flag ON but model NOT capable → json_object (fail-open)', async () => {
    process.env[FLAG] = 'true';
    const bodies = captureOpenAiLike();
    await new OpenAiAdapter('gpt-3.5-unregistered').generate({ ...REVIEW_PARAMS });
    expect((bodies[0]!.response_format as { type: string }).type).toBe('json_object');
  });

  it('flag ON + capable but NON-reviewer schema (evaluator-like object) → json_object (never json_schema)', async () => {
    process.env[FLAG] = 'true';
    const bodies = captureOpenAiLike('{}');
    await new OpenAiAdapter('gpt-5.5')
      .generate({ ...REVIEW_PARAMS, structuredOutputSchema: z.object({ dispositions: z.array(z.string()) }) })
      .catch(() => undefined); // parse of {} vs object schema may reject; we only assert the request body
    expect((bodies[0]!.response_format as { type: string }).type).toBe('json_object');
  });

  it('reduces a {feedback:[item]} json_schema response to the canonical bare array', async () => {
    process.env[FLAG] = 'true';
    captureOpenAiLike('{"feedback":[{"title":"t","body":"b","severity":"major"}]}');
    const res = await new OpenAiAdapter('gpt-5.5').generate({ ...REVIEW_PARAMS });
    expect(JSON.parse(res.content as string)).toEqual([{ title: 't', body: 'b', severity: 'major' }]);
  });

  it('reduces {feedback:[]} to [] (the no-feedback case)', async () => {
    process.env[FLAG] = 'true';
    captureOpenAiLike('{"feedback":[]}');
    const res = await new OpenAiAdapter('gpt-5.5').generate({ ...REVIEW_PARAMS });
    expect(JSON.parse(res.content as string)).toEqual([]);
  });
});

describe('RPR-6 — xAI strict json_schema request shape', () => {
  it('flag ON + capable + reviewer schema → json_schema', async () => {
    process.env[FLAG] = 'true';
    const bodies = captureOpenAiLike();
    await new XaiAdapter('grok-4.3').generate({ ...REVIEW_PARAMS });
    expect((bodies[0]!.response_format as { type: string }).type).toBe('json_schema');
  });
});

describe('RPR-7 — Gemini native responseSchema', () => {
  it('flag ON + capable + reviewer schema → generationConfig.responseSchema present', async () => {
    process.env[FLAG] = 'true';
    const bodies = captureGemini();
    await new GoogleAdapter('gemini-3.1-pro-preview').generate({ ...REVIEW_PARAMS });
    const gc = bodies[0]!.generationConfig as { responseSchema?: unknown; responseMimeType?: string };
    expect(gc.responseSchema).toBeDefined();
    expect(gc.responseMimeType).toBe('application/json');
  });

  it('flag OFF → responseMimeType only, no responseSchema (default)', async () => {
    delete process.env[FLAG];
    const bodies = captureGemini();
    await new GoogleAdapter('gemini-3.1-pro-preview').generate({ ...REVIEW_PARAMS });
    const gc = bodies[0]!.generationConfig as { responseSchema?: unknown };
    expect(gc.responseSchema).toBeUndefined();
  });
});
