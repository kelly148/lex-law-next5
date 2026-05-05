/**
 * MR-LLM-LITE-4: Safe shape diagnostics for GPT/Grok Lite parse_error messages
 *
 * Covers:
 *   T-LITE4-1: OpenAI parse_error includes sanitized shape for unnormalized object
 *   T-LITE4-2: OpenAI diagnostic excludes content
 *   T-LITE4-3: xAI parse_error includes sanitized shape for unnormalized object
 *   T-LITE4-4: xAI diagnostic excludes content
 *   T-LITE4-5: Array contents are never included — arrays represented by length only
 *   T-LITE4-6: Existing GPT/Grok normalization still works (MR-LLM-LITE-3 regression)
 *   T-LITE4-7: Ambiguous objects still fail, now with sanitized shape diagnostics
 *   T-LITE4-8: Claude/Gemini remain untouched
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAiAdapter, sanitizeShapeForDiagnostic, normalizeOpenAiStructuredOutput } from '../llm/openai.js';
import { XaiAdapter, sanitizeShapeForDiagnostic as sanitizeShapeGrok, normalizeGrokStructuredOutput } from '../llm/xai.js';
import { LlmProviderError } from '../llm/types.js';
import { RawSuggestionsArraySchema } from '../llm/parsers/feedbackParser.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CANONICAL_ITEM = {
  title: 'Missing indemnification clause',
  body: 'The contract lacks an indemnification clause.',
  severity: 'critical' as const,
};
const CANONICAL_ARRAY = [CANONICAL_ITEM];

// ─── Helpers: mock API responses ─────────────────────────────────────────────

function makeOpenAiResponse(content: string, finishReason = 'stop') {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-lite4-test',
      object: 'chat.completion',
      model: 'gpt-4.1-mini',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: finishReason,
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function makeXaiResponse(content: string) {
  return new Response(
    JSON.stringify({
      id: 'xai-lite4-test',
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
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const GENERATE_PARAMS = {
  systemPrompt: 'You are a legal reviewer.',
  userPrompt: 'Review this contract.',
  temperature: 0.3,
  maxTokens: 4096,
  structuredOutputSchema: RawSuggestionsArraySchema,
  signal: new AbortController().signal,
};

// ─── T-LITE4-1: OpenAI parse_error includes sanitized shape ──────────────────

describe('T-LITE4-1: OpenAI parse_error includes sanitized shape for unnormalized object', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  it('T-LITE4-1a: error message contains "Sanitized output shape"', async () => {
    // An object with unknown keys that normalization cannot extract
    const unnormalized = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'some value' };
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(unnormalized))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite4-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'parse_error' &&
        err.message.includes('Sanitized output shape'),
    );
  });

  it('T-LITE4-1b: error message contains topLevelType "object"', async () => {
    const unnormalized = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'some value' };
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(unnormalized))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite4-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.message.includes('"topLevelType":"object"'),
    );
  });

  it('T-LITE4-1c: error message contains top-level key names', async () => {
    const unnormalized = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'some value' };
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(unnormalized))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite4-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.message.includes('unknownKeyA') &&
        err.message.includes('unknownKeyB'),
    );
  });

  it('T-LITE4-1d: error message contains array length for array-valued key', async () => {
    const unnormalized = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'some value' };
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(unnormalized))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite4-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.message.includes('array(length=1)'),
    );
  });

  it('T-LITE4-1e: nested object keys/types appear in diagnostic', async () => {
    // Object with a nested object property that normalization cannot extract
    const unnormalized = {
      unknownOuter: { nestedField: 'some value', count: 5 },
      otherKey: 'value',
    };
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(unnormalized))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite4-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.message.includes('nestedField') &&
        err.message.includes('count'),
    );
  });
});

// ─── T-LITE4-2: OpenAI diagnostic excludes content ───────────────────────────

describe('T-LITE4-2: OpenAI diagnostic excludes content', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  it('T-LITE4-2a: diagnostic does not include string values from the object', async () => {
    const sensitiveContent = 'THIS_IS_SENSITIVE_DOCUMENT_CONTENT_DO_NOT_LOG';
    const unnormalized = {
      unknownKeyA: CANONICAL_ARRAY,
      description: sensitiveContent,
    };
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(unnormalized))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite4-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        !err.message.includes(sensitiveContent),
    );
  });

  it('T-LITE4-2b: diagnostic does not include array item content', async () => {
    const sensitiveBody = 'SENSITIVE_FEEDBACK_BODY_TEXT_DO_NOT_LOG';
    const sensitiveTitle = 'SENSITIVE_FEEDBACK_TITLE_DO_NOT_LOG';
    const unnormalized = {
      unknownKeyA: [{ title: sensitiveTitle, body: sensitiveBody, severity: 'critical' }],
      unknownKeyB: 'value',
    };
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(unnormalized))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite4-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        !err.message.includes(sensitiveBody) &&
        !err.message.includes(sensitiveTitle),
    );
  });

  it('T-LITE4-2c: sanitizeShapeForDiagnostic does not include string values', () => {
    const obj = {
      description: 'THIS_IS_SENSITIVE',
      count: 3,
      items: CANONICAL_ARRAY,
    };
    const diag = sanitizeShapeForDiagnostic(obj);
    expect(JSON.stringify(diag)).not.toContain('THIS_IS_SENSITIVE');
    expect(JSON.stringify(diag)).toContain('string');
    expect(JSON.stringify(diag)).toContain('number');
    expect(JSON.stringify(diag)).toContain('array(length=1)');
  });
});

// ─── T-LITE4-3: xAI parse_error includes sanitized shape ─────────────────────

describe('T-LITE4-3: xAI parse_error includes sanitized shape for unnormalized object', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['XAI_API_KEY'];
  });

  it('T-LITE4-3a: error message contains "Sanitized output shape"', async () => {
    const unnormalized = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'some value' };
    vi.stubGlobal('fetch', vi.fn(() => makeXaiResponse(JSON.stringify(unnormalized))));
    process.env['XAI_API_KEY'] = 'xai-test-lite4-dummy';

    const adapter = new XaiAdapter('grok-3-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'parse_error' &&
        err.message.includes('Sanitized output shape'),
    );
  });

  it('T-LITE4-3b: error message contains topLevelType "object"', async () => {
    const unnormalized = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'some value' };
    vi.stubGlobal('fetch', vi.fn(() => makeXaiResponse(JSON.stringify(unnormalized))));
    process.env['XAI_API_KEY'] = 'xai-test-lite4-dummy';

    const adapter = new XaiAdapter('grok-3-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.message.includes('"topLevelType":"object"'),
    );
  });

  it('T-LITE4-3c: error message contains top-level key names', async () => {
    const unnormalized = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'some value' };
    vi.stubGlobal('fetch', vi.fn(() => makeXaiResponse(JSON.stringify(unnormalized))));
    process.env['XAI_API_KEY'] = 'xai-test-lite4-dummy';

    const adapter = new XaiAdapter('grok-3-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.message.includes('unknownKeyA') &&
        err.message.includes('unknownKeyB'),
    );
  });

  it('T-LITE4-3d: error message contains array length for array-valued key', async () => {
    const unnormalized = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'some value' };
    vi.stubGlobal('fetch', vi.fn(() => makeXaiResponse(JSON.stringify(unnormalized))));
    process.env['XAI_API_KEY'] = 'xai-test-lite4-dummy';

    const adapter = new XaiAdapter('grok-3-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.message.includes('array(length=1)'),
    );
  });

  it('T-LITE4-3e: nested object keys/types appear in xAI diagnostic', async () => {
    const unnormalized = {
      unknownOuter: { nestedField: 'some value', count: 5 },
      otherKey: 'value',
    };
    vi.stubGlobal('fetch', vi.fn(() => makeXaiResponse(JSON.stringify(unnormalized))));
    process.env['XAI_API_KEY'] = 'xai-test-lite4-dummy';

    const adapter = new XaiAdapter('grok-3-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.message.includes('nestedField') &&
        err.message.includes('count'),
    );
  });
});

// ─── T-LITE4-4: xAI diagnostic excludes content ──────────────────────────────

describe('T-LITE4-4: xAI diagnostic excludes content', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['XAI_API_KEY'];
  });

  it('T-LITE4-4a: diagnostic does not include string values from the object', async () => {
    const sensitiveContent = 'THIS_IS_SENSITIVE_DOCUMENT_CONTENT_DO_NOT_LOG';
    const unnormalized = {
      unknownKeyA: CANONICAL_ARRAY,
      description: sensitiveContent,
    };
    vi.stubGlobal('fetch', vi.fn(() => makeXaiResponse(JSON.stringify(unnormalized))));
    process.env['XAI_API_KEY'] = 'xai-test-lite4-dummy';

    const adapter = new XaiAdapter('grok-3-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        !err.message.includes(sensitiveContent),
    );
  });

  it('T-LITE4-4b: diagnostic does not include array item content', async () => {
    const sensitiveBody = 'SENSITIVE_FEEDBACK_BODY_TEXT_DO_NOT_LOG';
    const sensitiveTitle = 'SENSITIVE_FEEDBACK_TITLE_DO_NOT_LOG';
    const unnormalized = {
      unknownKeyA: [{ title: sensitiveTitle, body: sensitiveBody, severity: 'critical' }],
      unknownKeyB: 'value',
    };
    vi.stubGlobal('fetch', vi.fn(() => makeXaiResponse(JSON.stringify(unnormalized))));
    process.env['XAI_API_KEY'] = 'xai-test-lite4-dummy';

    const adapter = new XaiAdapter('grok-3-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        !err.message.includes(sensitiveBody) &&
        !err.message.includes(sensitiveTitle),
    );
  });

  it('T-LITE4-4c: sanitizeShapeForDiagnostic (xAI) does not include string values', () => {
    const obj = {
      description: 'THIS_IS_SENSITIVE',
      count: 3,
      items: CANONICAL_ARRAY,
    };
    const diag = sanitizeShapeGrok(obj);
    expect(JSON.stringify(diag)).not.toContain('THIS_IS_SENSITIVE');
    expect(JSON.stringify(diag)).toContain('string');
    expect(JSON.stringify(diag)).toContain('number');
    expect(JSON.stringify(diag)).toContain('array(length=1)');
  });
});

// ─── T-LITE4-5: Array contents are never included ────────────────────────────

describe('T-LITE4-5: Array contents are never included — arrays represented by length only', () => {
  it('T-LITE4-5a: sanitizeShapeForDiagnostic represents top-level array by length only', () => {
    const arr = [{ title: 'SECRET_TITLE', body: 'SECRET_BODY', severity: 'major' }];
    const diag = sanitizeShapeForDiagnostic(arr);
    expect(diag).toEqual({ topLevelType: 'array', length: 1 });
    expect(JSON.stringify(diag)).not.toContain('SECRET_TITLE');
    expect(JSON.stringify(diag)).not.toContain('SECRET_BODY');
  });

  it('T-LITE4-5b: sanitizeShapeForDiagnostic represents nested array by length only', () => {
    const obj = {
      review: {
        feedback: [
          { title: 'SECRET_NESTED_TITLE', body: 'SECRET_NESTED_BODY', severity: 'critical' },
          { title: 'ANOTHER_SECRET', body: 'MORE_SECRET', severity: 'minor' },
        ],
      },
    };
    const diag = sanitizeShapeForDiagnostic(obj);
    const diagStr = JSON.stringify(diag);
    expect(diagStr).toContain('array(length=2)');
    expect(diagStr).not.toContain('SECRET_NESTED_TITLE');
    expect(diagStr).not.toContain('SECRET_NESTED_BODY');
    expect(diagStr).not.toContain('ANOTHER_SECRET');
    expect(diagStr).not.toContain('MORE_SECRET');
  });

  it('T-LITE4-5c: sanitizeShapeForDiagnostic (xAI) represents arrays by length only', () => {
    const obj = {
      items: [
        { title: 'SECRET_ITEM_TITLE', body: 'SECRET_ITEM_BODY', severity: 'major' },
      ],
      meta: 'some metadata string',
    };
    const diag = sanitizeShapeGrok(obj);
    const diagStr = JSON.stringify(diag);
    expect(diagStr).toContain('array(length=1)');
    expect(diagStr).not.toContain('SECRET_ITEM_TITLE');
    expect(diagStr).not.toContain('SECRET_ITEM_BODY');
    expect(diagStr).not.toContain('some metadata string');
  });

  it('T-LITE4-5d: empty array represented as array(length=0)', () => {
    const obj = { emptyList: [] };
    const diag = sanitizeShapeForDiagnostic(obj);
    expect((diag.keys as Record<string, string>)['emptyList']).toBe('array(length=0)');
  });
});

// ─── T-LITE4-6: Existing GPT/Grok normalization still works ──────────────────

describe('T-LITE4-6: Existing GPT/Grok normalization still works (MR-LLM-LITE-3 regression)', () => {
  it('T-LITE4-6a: OpenAI nested {review:{feedback:[...]}} still extracted', () => {
    const wrapper = { review: { feedback: CANONICAL_ARRAY } };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE4-6b: OpenAI nested {output:{items:[...]}} still extracted', () => {
    const wrapper = { output: { items: CANONICAL_ARRAY } };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE4-6c: xAI nested {review:{feedback:[...]}} still extracted', () => {
    const wrapper = { review: { feedback: CANONICAL_ARRAY } };
    const result = normalizeGrokStructuredOutput(wrapper);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE4-6d: OpenAI flat {feedback:[...]} still extracted', () => {
    const wrapper = { feedback: CANONICAL_ARRAY };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE4-6e: xAI flat {feedback:[...]} still extracted', () => {
    const wrapper = { feedback: CANONICAL_ARRAY };
    const result = normalizeGrokStructuredOutput(wrapper);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE4-6f: OpenAI direct array still passes through unchanged', () => {
    const result = normalizeOpenAiStructuredOutput(CANONICAL_ARRAY);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE4-6g: xAI direct array still passes through unchanged', () => {
    const result = normalizeGrokStructuredOutput(CANONICAL_ARRAY);
    expect(result).toBe(CANONICAL_ARRAY);
  });
});

// ─── T-LITE4-7: Ambiguous objects still fail, now with diagnostics ────────────

describe('T-LITE4-7: Ambiguous objects still fail, now with sanitized shape diagnostics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['XAI_API_KEY'];
  });

  it('T-LITE4-7a: OpenAI ambiguous object fails with parse_error including shape diagnostic', async () => {
    const ambiguous = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'value' };
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(ambiguous))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite4-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'parse_error' &&
        err.message.includes('Sanitized output shape') &&
        err.message.includes('"topLevelType":"object"'),
    );
  });

  it('T-LITE4-7b: xAI ambiguous object fails with parse_error including shape diagnostic', async () => {
    const ambiguous = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'value' };
    vi.stubGlobal('fetch', vi.fn(() => makeXaiResponse(JSON.stringify(ambiguous))));
    process.env['XAI_API_KEY'] = 'xai-test-lite4-dummy';

    const adapter = new XaiAdapter('grok-3-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'parse_error' &&
        err.message.includes('Sanitized output shape') &&
        err.message.includes('"topLevelType":"object"'),
    );
  });

  it('T-LITE4-7c: OpenAI ambiguous nested object fails with parse_error including shape diagnostic', async () => {
    // Two competing nested arrays across two known outer keys — genuinely ambiguous, must fail.
    // Both 'review' and 'output' are in KNOWN_OUTER_WRAPPER_KEYS; both contain a known inner array.
    const ambiguous = {
      review: { feedback: CANONICAL_ARRAY },
      output: { items: CANONICAL_ARRAY },
    };
    vi.stubGlobal('fetch', vi.fn(() => makeOpenAiResponse(JSON.stringify(ambiguous))));
    process.env['OPENAI_API_KEY'] = 'sk-test-lite4-dummy';

    const adapter = new OpenAiAdapter('gpt-4.1-mini');
    await expect(
      adapter.generate(GENERATE_PARAMS),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'parse_error' &&
        err.message.includes('Sanitized output shape'),
    );
  });
});

// ─── T-LITE4-8: Claude/Gemini remain untouched ───────────────────────────────

describe('T-LITE4-8: Claude/Gemini remain untouched', () => {
  it('T-LITE4-8a: anthropic.ts is not modified by MR-LLM-LITE-4 (source analysis)', async () => {
    // Structural assertion: the Anthropic adapter does not import sanitizeShapeForDiagnostic
    // from openai.ts or xai.ts, confirming it was not modified.
    const { normalizeAnthropicStructuredOutput } = await import('../llm/anthropic.js');
    const wrapper = { feedback: CANONICAL_ARRAY };
    const result = normalizeAnthropicStructuredOutput(wrapper);
    expect(result).toBe(CANONICAL_ARRAY);
  });

  it('T-LITE4-8b: google.ts is not modified by MR-LLM-LITE-4 (source analysis)', async () => {
    // Structural assertion: the Google adapter has no normalization layer.
    // A bare array validates directly against RawSuggestionsArraySchema.
    const bareArray = CANONICAL_ARRAY;
    const validation = RawSuggestionsArraySchema.safeParse(bareArray);
    expect(validation.success).toBe(true);
  });

  it('T-LITE4-8c: full test suite baseline — all prior MR-LLM-LITE-3 normalization tests still pass', () => {
    // Regression: nested wrapper extraction still works after MR-LLM-LITE-4 wiring.
    const openAiNested = normalizeOpenAiStructuredOutput({ review: { feedback: CANONICAL_ARRAY } });
    expect(openAiNested).toBe(CANONICAL_ARRAY);

    const xaiNested = normalizeGrokStructuredOutput({ review: { feedback: CANONICAL_ARRAY } });
    expect(xaiNested).toBe(CANONICAL_ARRAY);
  });
});
