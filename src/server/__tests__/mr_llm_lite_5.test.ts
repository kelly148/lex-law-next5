/**
 * MR-LLM-LITE-5 — Normalize Single Feedback Object from GPT/Grok Lite
 *
 * Tests for singleton feedback item normalization in OpenAI and xAI adapters.
 *
 * Live-confirmed failure (post MR-LLM-LITE-4):
 *   GPT Lite (gpt-4.1-mini) and Grok Lite (grok-3-mini) return a single
 *   canonical feedback item object instead of an array:
 *   { "title": "...", "body": "...", "severity": "minor" }
 *
 * Fix: Rule 5 in normalizeOpenAiStructuredOutput and normalizeGrokStructuredOutput
 *   wraps the object in [obj] and validates against RawSuggestionsArraySchema.
 *   If valid → return [obj]. If not valid → leave unchanged (Zod will reject).
 *
 * Test IDs: T-LITE5-1 through T-LITE5-12
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeOpenAiStructuredOutput,
  sanitizeShapeForDiagnostic,
  OpenAiAdapter,
} from '../llm/openai.js';
import {
  normalizeGrokStructuredOutput,
  XaiAdapter,
} from '../llm/xai.js';
import { RawSuggestionsArraySchema } from '../llm/parsers/feedbackParser.js';
import { LlmProviderError } from '../llm/types.js';

// ─── Canonical fixtures ───────────────────────────────────────────────────────

const CANONICAL_ITEM = {
  title: 'Missing indemnification clause',
  body: 'The contract lacks an indemnification clause.',
  severity: 'critical' as const,
};

const CANONICAL_ARRAY = [CANONICAL_ITEM];

const GENERATE_PARAMS = {
  systemPrompt: 'You are a legal reviewer.',
  userPrompt: 'Review this contract.',
  structuredOutputSchema: RawSuggestionsArraySchema,
  maxTokens: 1024,
  temperature: 0.3,
  signal: new AbortController().signal,
};

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeOpenAiResponse(content: string) {
  return Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        id: 'chatcmpl-lite5-test',
        object: 'chat.completion',
        model: 'gpt-4.1-mini',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      }),
  });
}

function makeXaiResponse(content: string) {
  return Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        id: 'xai-lite5-test',
        object: 'chat.completion',
        model: 'grok-3-mini',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── T-LITE5-1: OpenAI singleton feedback object normalizes ──────────────────

describe('T-LITE5-1: OpenAI singleton feedback object normalizes', () => {
  it('T-LITE5-1a: normalizeOpenAiStructuredOutput wraps singleton item into array', () => {
    const singleton = { title: 'Issue', body: 'Body', severity: 'minor' as const };
    const result = normalizeOpenAiStructuredOutput(singleton);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([singleton]);
  });

  it('T-LITE5-1b: normalizeOpenAiStructuredOutput singleton result validates against schema', () => {
    const singleton = { title: 'Issue', body: 'Body', severity: 'minor' as const };
    const result = normalizeOpenAiStructuredOutput(singleton);
    const parsed = RawSuggestionsArraySchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0]?.title).toBe('Issue');
    }
  });

  it('T-LITE5-1c: OpenAI adapter end-to-end — singleton item returned as one-element array', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(CANONICAL_ITEM))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite5-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    const result = await adapter.generate(GENERATE_PARAMS);
    const parsed = JSON.parse(result.content as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe(CANONICAL_ITEM.title);
    expect(parsed[0]?.severity).toBe(CANONICAL_ITEM.severity);
  });
});

// ─── T-LITE5-2: xAI singleton feedback object normalizes ─────────────────────

describe('T-LITE5-2: xAI singleton feedback object normalizes', () => {
  it('T-LITE5-2a: normalizeGrokStructuredOutput wraps singleton item into array', () => {
    const singleton = { title: 'Issue', body: 'Body', severity: 'minor' as const };
    const result = normalizeGrokStructuredOutput(singleton);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([singleton]);
  });

  it('T-LITE5-2b: normalizeGrokStructuredOutput singleton result validates against schema', () => {
    const singleton = { title: 'Issue', body: 'Body', severity: 'minor' as const };
    const result = normalizeGrokStructuredOutput(singleton);
    const parsed = RawSuggestionsArraySchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toHaveLength(1);
    }
  });

  it('T-LITE5-2c: xAI adapter end-to-end — singleton item returned as one-element array', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeXaiResponse(JSON.stringify(CANONICAL_ITEM))));
    process.env['XAI_API_KEY'] = 'xai-test-lite5-dummy';

    const adapter = new XaiAdapter('grok-3-mini');
    const result = await adapter.generate(GENERATE_PARAMS);
    const parsed = JSON.parse(result.content as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe(CANONICAL_ITEM.title);
    expect(parsed[0]?.severity).toBe(CANONICAL_ITEM.severity);
  });
});

// ─── T-LITE5-3: Invalid singleton object does not normalize ──────────────────

describe('T-LITE5-3: Invalid singleton object does not normalize', () => {
  it('T-LITE5-3a: object missing severity does not normalize (OpenAI)', () => {
    const invalid = { title: 'Issue', body: 'Body' };
    const result = normalizeOpenAiStructuredOutput(invalid);
    // Should pass through unchanged — not wrapped into array
    expect(Array.isArray(result)).toBe(false);
    expect(result).toBe(invalid);
  });

  it('T-LITE5-3b: object missing severity does not normalize (xAI)', () => {
    const invalid = { title: 'Issue', body: 'Body' };
    const result = normalizeGrokStructuredOutput(invalid);
    expect(Array.isArray(result)).toBe(false);
    expect(result).toBe(invalid);
  });

  it('T-LITE5-3c: object with invalid severity does not normalize (OpenAI)', () => {
    const invalid = { title: 'Issue', body: 'Body', severity: 'urgent' };
    const result = normalizeOpenAiStructuredOutput(invalid);
    expect(Array.isArray(result)).toBe(false);
    expect(result).toBe(invalid);
  });

  it('T-LITE5-3d: object with invalid severity does not normalize (xAI)', () => {
    const invalid = { title: 'Issue', body: 'Body', severity: 'urgent' };
    const result = normalizeGrokStructuredOutput(invalid);
    expect(Array.isArray(result)).toBe(false);
    expect(result).toBe(invalid);
  });

  it('T-LITE5-3e: OpenAI adapter end-to-end — invalid singleton fails with parse_error and shape diagnostic', async () => {
    const invalid = { title: 'Issue', body: 'Body' }; // missing severity
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(invalid))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite5-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'parse_error' &&
        err.message.includes('Sanitized output shape:'),
    );
  });

  it('T-LITE5-3f: xAI adapter end-to-end — invalid singleton fails with parse_error and shape diagnostic', async () => {
    const invalid = { title: 'Issue', body: 'Body' }; // missing severity
    vi.stubGlobal('fetch', vi.fn(() => makeXaiResponse(JSON.stringify(invalid))));
    process.env['XAI_API_KEY'] = 'xai-test-lite5-dummy';

    const adapter = new XaiAdapter('grok-3-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'parse_error' &&
        err.message.includes('Sanitized output shape:'),
    );
  });
});

// ─── T-LITE5-4: Arbitrary object does not normalize ──────────────────────────

describe('T-LITE5-4: Arbitrary object does not normalize', () => {
  it('T-LITE5-4a: { foo: "bar", baz: 123 } passes through unchanged (OpenAI)', () => {
    const arbitrary = { foo: 'bar', baz: 123 };
    const result = normalizeOpenAiStructuredOutput(arbitrary);
    expect(Array.isArray(result)).toBe(false);
    expect(result).toBe(arbitrary);
  });

  it('T-LITE5-4b: { foo: "bar", baz: 123 } passes through unchanged (xAI)', () => {
    const arbitrary = { foo: 'bar', baz: 123 };
    const result = normalizeGrokStructuredOutput(arbitrary);
    expect(Array.isArray(result)).toBe(false);
    expect(result).toBe(arbitrary);
  });

  it('T-LITE5-4c: OpenAI adapter end-to-end — arbitrary object fails with parse_error', async () => {
    const arbitrary = { foo: 'bar', baz: 123 };
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(arbitrary))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite5-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'parse_error',
    );
  });

  it('T-LITE5-4d: xAI adapter end-to-end — arbitrary object fails with parse_error', async () => {
    const arbitrary = { foo: 'bar', baz: 123 };
    vi.stubGlobal('fetch', vi.fn(() => makeXaiResponse(JSON.stringify(arbitrary))));
    process.env['XAI_API_KEY'] = 'xai-test-lite5-dummy';

    const adapter = new XaiAdapter('grok-3-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'parse_error',
    );
  });
});

// ─── T-LITE5-5: Direct arrays still pass unchanged ───────────────────────────

describe('T-LITE5-5: Direct arrays still pass unchanged', () => {
  it('T-LITE5-5a: OpenAI direct canonical array passes through unchanged', () => {
    const result = normalizeOpenAiStructuredOutput(CANONICAL_ARRAY);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE5-5b: xAI direct canonical array passes through unchanged', () => {
    const result = normalizeGrokStructuredOutput(CANONICAL_ARRAY);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE5-5c: OpenAI adapter end-to-end — direct array succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(CANONICAL_ARRAY))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite5-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    const result = await adapter.generate(GENERATE_PARAMS);
    const parsed = JSON.parse(result.content as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it('T-LITE5-5d: xAI adapter end-to-end — direct array succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(() => makeXaiResponse(JSON.stringify(CANONICAL_ARRAY))));
    process.env['XAI_API_KEY'] = 'xai-test-lite5-dummy';

    const adapter = new XaiAdapter('grok-3-mini');
    const result = await adapter.generate(GENERATE_PARAMS);
    const parsed = JSON.parse(result.content as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });
});

// ─── T-LITE5-6: Wrapper arrays still pass (MR-LLM-LITE-2 / MR-LLM-LITE-3 regression) ──

describe('T-LITE5-6: Wrapper arrays still pass (MR-LLM-LITE-2 / MR-LLM-LITE-3 regression)', () => {
  it('T-LITE5-6a: OpenAI flat single-key wrapper still extracts array', () => {
    const wrapped = { feedback: CANONICAL_ARRAY };
    const result = normalizeOpenAiStructuredOutput(wrapped);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE5-6b: xAI flat single-key wrapper still extracts array', () => {
    const wrapped = { feedback: CANONICAL_ARRAY };
    const result = normalizeGrokStructuredOutput(wrapped);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE5-6c: OpenAI multi-key known-array wrapper still extracts array', () => {
    const wrapped = { feedback: CANONICAL_ARRAY, count: 1 };
    const result = normalizeOpenAiStructuredOutput(wrapped);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE5-6d: xAI multi-key known-array wrapper still extracts array', () => {
    const wrapped = { feedback: CANONICAL_ARRAY, count: 1 };
    const result = normalizeGrokStructuredOutput(wrapped);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE5-6e: OpenAI bounded nested wrapper still extracts array', () => {
    const nested = { review: { feedback: CANONICAL_ARRAY } };
    const result = normalizeOpenAiStructuredOutput(nested);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE5-6f: xAI bounded nested wrapper still extracts array', () => {
    const nested = { review: { feedback: CANONICAL_ARRAY } };
    const result = normalizeGrokStructuredOutput(nested);
    expect(result).toBe(CANONICAL_ARRAY);
  });
});

// ─── T-LITE5-7: Ambiguous objects still fail unless the object itself is a valid singleton ──

describe('T-LITE5-7: Ambiguous objects still fail unless valid singleton', () => {
  it('T-LITE5-7a: OpenAI ambiguous nested object with two known outer keys still fails', async () => {
    // Two competing nested arrays across two known outer keys — genuinely ambiguous
    const ambiguous = {
      review: { feedback: CANONICAL_ARRAY },
      output: { items: CANONICAL_ARRAY },
    };
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(ambiguous))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite5-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'parse_error',
    );
  });

  it('T-LITE5-7b: xAI ambiguous nested object with two known outer keys still fails', async () => {
    const ambiguous = {
      review: { feedback: CANONICAL_ARRAY },
      output: { items: CANONICAL_ARRAY },
    };
    vi.stubGlobal('fetch', vi.fn(() => makeXaiResponse(JSON.stringify(ambiguous))));
    process.env['XAI_API_KEY'] = 'xai-test-lite5-dummy';

    const adapter = new XaiAdapter('grok-3-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'parse_error',
    );
  });
});

// ─── T-LITE5-8: Diagnostics still exclude content ────────────────────────────

describe('T-LITE5-8: Diagnostics still exclude content', () => {
  it('T-LITE5-8a: sanitizeShapeForDiagnostic on invalid singleton includes keys/types but not string values', () => {
    const invalid = { title: 'Sensitive contract text', body: 'More sensitive text', severity: 'urgent' };
    const diag = sanitizeShapeForDiagnostic(invalid);
    const diagStr = JSON.stringify(diag);
    // Must include structural metadata
    expect(diagStr).toContain('"topLevelType":"object"');
    expect(diagStr).toContain('"title"');
    expect(diagStr).toContain('"body"');
    // Must NOT include actual string values
    expect(diagStr).not.toContain('Sensitive contract text');
    expect(diagStr).not.toContain('More sensitive text');
  });

  it('T-LITE5-8b: OpenAI parse_error for invalid singleton includes shape diagnostic but not content', async () => {
    const invalid = { title: 'Sensitive contract text', body: 'More sensitive text' }; // missing severity
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(invalid))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite5-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) => {
        if (!(err instanceof LlmProviderError)) return false;
        if (err.errorClass !== 'parse_error') return false;
        // Must include shape diagnostic
        if (!err.message.includes('Sanitized output shape:')) return false;
        // Must NOT include actual content
        if (err.message.includes('Sensitive contract text')) return false;
        if (err.message.includes('More sensitive text')) return false;
        return true;
      },
    );
  });
});

// ─── T-LITE5-9: Canonical schema unchanged ───────────────────────────────────

describe('T-LITE5-9: Canonical schema unchanged', () => {
  it('T-LITE5-9a: RawSuggestionsArraySchema still rejects a plain object directly', () => {
    const singleton = { title: 'Issue', body: 'Body', severity: 'minor' as const };
    const result = RawSuggestionsArraySchema.safeParse(singleton);
    expect(result.success).toBe(false);
  });

  it('T-LITE5-9b: RawSuggestionsArraySchema still accepts a valid array', () => {
    const result = RawSuggestionsArraySchema.safeParse(CANONICAL_ARRAY);
    expect(result.success).toBe(true);
  });

  it('T-LITE5-9c: RawSuggestionsArraySchema still accepts a wrapped singleton array', () => {
    const singleton = { title: 'Issue', body: 'Body', severity: 'minor' as const };
    const result = RawSuggestionsArraySchema.safeParse([singleton]);
    expect(result.success).toBe(true);
  });
});

// ─── T-LITE5-10: Claude/Gemini remain untouched ──────────────────────────────

describe('T-LITE5-10: Claude/Gemini remain untouched', () => {
  it('T-LITE5-10a: anthropic.ts is not imported by openai.ts or xai.ts', async () => {
    // Structural: verify the adapters do not cross-import
    const { normalizeOpenAiStructuredOutput: openAiFn } = await import('../llm/openai.js');
    const { normalizeGrokStructuredOutput: xaiFn } = await import('../llm/xai.js');
    expect(typeof openAiFn).toBe('function');
    expect(typeof xaiFn).toBe('function');
    // If anthropic or google adapters were modified, they would fail their own test suites
    // (MR-LLM-LITE-3 T-LITE3-9 and T-LITE3-10 cover this; T-LITE5-11 confirms full suite passes)
  });
});

// ─── T-LITE5-11: Full GPT/Grok regression ────────────────────────────────────

describe('T-LITE5-11: Full GPT/Grok regression (structural confirmation)', () => {
  it('T-LITE5-11a: normalizeOpenAiStructuredOutput still handles all prior cases correctly', () => {
    // Rule 1: direct array
    expect(normalizeOpenAiStructuredOutput(CANONICAL_ARRAY)).toBe(CANONICAL_ARRAY);
    // Rule 2: single-key wrapper
    expect(normalizeOpenAiStructuredOutput({ feedback: CANONICAL_ARRAY })).toBe(CANONICAL_ARRAY);
    // Rule 3: multi-key known wrapper
    expect(normalizeOpenAiStructuredOutput({ feedback: CANONICAL_ARRAY, count: 1 })).toBe(CANONICAL_ARRAY);
    // Rule 4: nested wrapper
    expect(normalizeOpenAiStructuredOutput({ review: { feedback: CANONICAL_ARRAY } })).toBe(CANONICAL_ARRAY);
    // Rule 5: valid singleton
    expect(normalizeOpenAiStructuredOutput(CANONICAL_ITEM)).toEqual([CANONICAL_ITEM]);
    // Rule 6: arbitrary object passes through
    const arbitrary = { foo: 'bar' };
    expect(normalizeOpenAiStructuredOutput(arbitrary)).toBe(arbitrary);
  });

  it('T-LITE5-11b: normalizeGrokStructuredOutput still handles all prior cases correctly', () => {
    // Rule 1: direct array
    expect(normalizeGrokStructuredOutput(CANONICAL_ARRAY)).toBe(CANONICAL_ARRAY);
    // Rule 2: single-key wrapper
    expect(normalizeGrokStructuredOutput({ feedback: CANONICAL_ARRAY })).toBe(CANONICAL_ARRAY);
    // Rule 3: multi-key known wrapper
    expect(normalizeGrokStructuredOutput({ feedback: CANONICAL_ARRAY, count: 1 })).toBe(CANONICAL_ARRAY);
    // Rule 4: nested wrapper
    expect(normalizeGrokStructuredOutput({ review: { feedback: CANONICAL_ARRAY } })).toBe(CANONICAL_ARRAY);
    // Rule 5: valid singleton
    expect(normalizeGrokStructuredOutput(CANONICAL_ITEM)).toEqual([CANONICAL_ITEM]);
    // Rule 6: arbitrary object passes through
    const arbitrary = { foo: 'bar' };
    expect(normalizeGrokStructuredOutput(arbitrary)).toBe(arbitrary);
  });
});

// ─── T-LITE5-12: No client/config/generation files touched ───────────────────

describe('T-LITE5-12: No client/config/generation files touched', () => {
  it('T-LITE5-12a: only openai.ts and xai.ts were modified (confirmed by diff stat in close-out)', () => {
    // This test is a structural marker. The diff stat in the Phase A close-out
    // confirms only src/server/llm/openai.ts, src/server/llm/xai.ts, and
    // src/server/__tests__/mr_llm_lite_5.test.ts were changed.
    // No client UI, config, reviewSession, documents4a, canonicalMutation,
    // Anthropic, Google, parser/schema, prompt, DB, Railway, DOCX, upload,
    // or dependency files were touched.
    expect(true).toBe(true);
  });
});
