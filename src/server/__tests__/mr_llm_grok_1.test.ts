/**
 * mr_llm_grok_1.test.ts — MR-LLM-GROK-1
 *
 * Tests for the Grok reviewer output-shape normalization fix.
 *
 * T-GROK-1: Grok object wrapper with single array property normalizes to canonical array.
 * T-GROK-2: Grok direct array passes through unchanged.
 * T-GROK-3: Grok object with no array-bearing wrapper fails with diagnostic parse_error.
 * T-GROK-4: Canonical reviewer-feedback schema (RawSuggestionsArraySchema) still expects array.
 * T-GROK-5: Other provider paths (OpenAI) do not regress — existing tests still pass.
 * T-GROK-6: XaiAdapter structured output path returns string content (consistent with OpenAI/Google).
 * T-GROK-7: XaiAdapter object-wrapper path re-serializes normalized array as string for txn2Commit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XaiAdapter, normalizeGrokStructuredOutput } from '../llm/xai.js';
import { LlmProviderError } from '../llm/types.js';
import { RawSuggestionsArraySchema, parseFeedbackOutput } from '../llm/parsers/feedbackParser.js';

// ── Canonical reviewer feedback item fixture ──────────────────────────────────
const CANONICAL_ITEM = { title: 'Issue title', body: 'Detailed feedback body.', severity: 'major' as const };
const CANONICAL_ARRAY = [CANONICAL_ITEM];
const CANONICAL_ARRAY_JSON = JSON.stringify(CANONICAL_ARRAY);

// ── Helper: build a mock xAI API response ────────────────────────────────────
function makeXaiResponse(content: string) {
  return new Response(
    JSON.stringify({
      id: 'xai-test-id',
      object: 'chat.completion',
      model: 'grok-4',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ── T-GROK-1: normalizeGrokStructuredOutput — object wrapper normalizes to array ──
describe('MR-LLM-GROK-1 — normalizeGrokStructuredOutput', () => {
  it('T-GROK-1a: { "feedback": [...] } wrapper extracts the array', () => {
    const wrapped = { feedback: CANONICAL_ARRAY };
    const result = normalizeGrokStructuredOutput(wrapped);
    expect(result).toEqual(CANONICAL_ARRAY);
  });

  it('T-GROK-1b: { "suggestions": [...] } wrapper extracts the array', () => {
    const wrapped = { suggestions: CANONICAL_ARRAY };
    const result = normalizeGrokStructuredOutput(wrapped);
    expect(result).toEqual(CANONICAL_ARRAY);
  });

  it('T-GROK-1c: { "items": [...] } wrapper extracts the array', () => {
    const wrapped = { items: CANONICAL_ARRAY };
    const result = normalizeGrokStructuredOutput(wrapped);
    expect(result).toEqual(CANONICAL_ARRAY);
  });

  it('T-GROK-1d: { "result": [...] } wrapper extracts the array', () => {
    const wrapped = { result: CANONICAL_ARRAY };
    const result = normalizeGrokStructuredOutput(wrapped);
    expect(result).toEqual(CANONICAL_ARRAY);
  });

  // ── T-GROK-2: Direct array passes through unchanged ──
  it('T-GROK-2: direct array passes through unchanged', () => {
    const result = normalizeGrokStructuredOutput(CANONICAL_ARRAY);
    expect(result).toBe(CANONICAL_ARRAY); // same reference
  });

  // ── T-GROK-3: Object without unambiguous array wrapper passes through unchanged ──
  it('T-GROK-3a: object with multiple unknown-key properties passes through unchanged (Zod will reject it)', () => {
    // MR-LLM-LITE-2: known keys (feedback, suggestions, items, result, data) are now extracted.
    // A truly ambiguous object has multiple keys none of which are known wrapper keys.
    const ambiguous = { unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'value' };
    const result = normalizeGrokStructuredOutput(ambiguous);
    // Multiple unknown keys → not normalized; returned as-is so Zod validation will fail
    expect(result).toBe(ambiguous);
  });

  it('T-GROK-3b: object with single non-array property passes through unchanged', () => {
    const noArray = { message: 'not an array' };
    const result = normalizeGrokStructuredOutput(noArray);
    expect(result).toBe(noArray);
  });

  it('T-GROK-3c: null passes through unchanged', () => {
    expect(normalizeGrokStructuredOutput(null)).toBeNull();
  });

  it('T-GROK-3d: string passes through unchanged', () => {
    expect(normalizeGrokStructuredOutput('raw string')).toBe('raw string');
  });

  // ── T-GROK-4: Canonical schema still expects array (no schema weakening) ──
  it('T-GROK-4: RawSuggestionsArraySchema still rejects a plain object and accepts a canonical array', () => {
    // Schema must still reject an object wrapper — normalization happens before schema validation
    const rejectResult = RawSuggestionsArraySchema.safeParse({ feedback: CANONICAL_ARRAY });
    expect(rejectResult.success).toBe(false);

    // Schema must accept the canonical array shape
    const acceptResult = RawSuggestionsArraySchema.safeParse(CANONICAL_ARRAY);
    expect(acceptResult.success).toBe(true);
  });
});

// ── XaiAdapter integration tests (mock fetch) ────────────────────────────────
describe('MR-LLM-GROK-1 — XaiAdapter structured output path', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    process.env['XAI_API_KEY'] = 'xai-test-dummy';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['XAI_API_KEY'];
  });

  // ── T-GROK-6: Direct array from Grok returns string content ──
  it('T-GROK-6: XaiAdapter returns string content when Grok returns a direct JSON array', async () => {
    mockFetch.mockResolvedValueOnce(makeXaiResponse(CANONICAL_ARRAY_JSON));

    const adapter = new XaiAdapter('grok-4');
    const result = await adapter.generate({
      systemPrompt: 'You are a legal document reviewer.',
      userPrompt: 'Review this document.',
      structuredOutputSchema: RawSuggestionsArraySchema,
      signal: new AbortController().signal,
    });

    // Content must be a string (consistent with OpenAI/Google adapters)
    expect(typeof result.content).toBe('string');
    // The string must be parseable and produce the canonical array
    const parsed = parseFeedbackOutput(result.content as string);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.title).toBe('Issue title');
    expect(parsed[0]!.severity).toBe('major');
  });

  // ── T-GROK-7: Object wrapper from Grok is normalized and returned as string ──
  it('T-GROK-7: XaiAdapter normalizes { "feedback": [...] } wrapper and returns re-serialized array string', async () => {
    const wrappedJson = JSON.stringify({ feedback: CANONICAL_ARRAY });
    mockFetch.mockResolvedValueOnce(makeXaiResponse(wrappedJson));

    const adapter = new XaiAdapter('grok-4');
    const result = await adapter.generate({
      systemPrompt: 'You are a legal document reviewer.',
      userPrompt: 'Review this document.',
      structuredOutputSchema: RawSuggestionsArraySchema,
      signal: new AbortController().signal,
    });

    // Content must be a string
    expect(typeof result.content).toBe('string');
    // The string must parse to the canonical array (wrapper stripped)
    const parsed = parseFeedbackOutput(result.content as string);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.title).toBe('Issue title');
    expect(parsed[0]!.severity).toBe('major');
  });

  // ── T-GROK-3 (adapter level): Invalid Grok object fails with diagnostic parse_error ──
  it('T-GROK-3 (adapter): ambiguous object with no known key fails Zod validation with parse_error', async () => {
    // MR-LLM-LITE-2: { feedback: [...], extra: ... } now normalizes successfully.
    // Use an object with no known wrapper keys to test the ambiguous/fail path.
    const ambiguousJson = JSON.stringify({ unknownKeyA: CANONICAL_ARRAY, unknownKeyB: 'value' });
    mockFetch.mockResolvedValueOnce(makeXaiResponse(ambiguousJson));

    const adapter = new XaiAdapter('grok-4');
    await expect(
      adapter.generate({
        systemPrompt: 'You are a legal document reviewer.',
        userPrompt: 'Review this document.',
        structuredOutputSchema: RawSuggestionsArraySchema,
        signal: new AbortController().signal,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'parse_error' &&
        err.message.includes('Zod validation'),
    );
  });

  // ── T-GROK-5: Non-structured output path is unaffected ──
  it('T-GROK-5: XaiAdapter non-structured output path returns rawText unchanged', async () => {
    const plainText = 'This is a plain text response.';
    mockFetch.mockResolvedValueOnce(makeXaiResponse(plainText));

    const adapter = new XaiAdapter('grok-4');
    const result = await adapter.generate({
      systemPrompt: 'You are a drafter.',
      userPrompt: 'Draft this document.',
      signal: new AbortController().signal,
    });

    expect(result.content).toBe(plainText);
  });

  // ── Regression: response_format is set to json_object when structuredOutputSchema provided ──
  it('Regression: response_format: json_object is still set when structuredOutputSchema is provided', async () => {
    let capturedBody: Record<string, unknown> = {};
    mockFetch.mockImplementationOnce((_url: unknown, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve(makeXaiResponse(CANONICAL_ARRAY_JSON));
    });

    const adapter = new XaiAdapter('grok-4');
    await adapter.generate({
      systemPrompt: 'You are a reviewer.',
      userPrompt: 'Review this.',
      structuredOutputSchema: RawSuggestionsArraySchema,
      signal: new AbortController().signal,
    });

    expect(capturedBody['response_format']).toEqual({ type: 'json_object' });
  });

  // ── T-GROK-6 (persistence): txn2Commit string-handling path works with normalized output ──
  it('T-GROK-6 (persistence): txn2Commit rawOutput handling works — string content flows to parseFeedbackOutput', async () => {
    // Simulate what txn2Commit does with the adapter output
    const wrappedJson = JSON.stringify({ feedback: CANONICAL_ARRAY });
    mockFetch.mockResolvedValueOnce(makeXaiResponse(wrappedJson));

    const adapter = new XaiAdapter('grok-4');
    const llmResult = await adapter.generate({
      systemPrompt: 'You are a legal document reviewer.',
      userPrompt: 'Review this document.',
      structuredOutputSchema: RawSuggestionsArraySchema,
      signal: new AbortController().signal,
    });

    // Simulate txn2Commit: const rawOutput = typeof output === 'string' ? output : JSON.stringify(output);
    const rawOutput =
      typeof llmResult.content === 'string'
        ? llmResult.content
        : JSON.stringify(llmResult.content);

    const suggestions = parseFeedbackOutput(rawOutput);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.title).toBe('Issue title');
    expect(suggestions[0]!.body).toBe('Detailed feedback body.');
    expect(suggestions[0]!.severity).toBe('major');
    // suggestionId is stamped by parseFeedbackOutput
    expect(typeof suggestions[0]!.suggestionId).toBe('string');
  });
});

// ── T-GROK-5 (schema level): Verify canonical schema is unchanged ─────────────
describe('MR-LLM-GROK-1 — Canonical schema preservation', () => {
  it('T-GROK-5 (schema): RawSuggestionsArraySchema shape is unchanged — array of title/body/severity', () => {
    const validArray = [
      { title: 'A', body: 'B', severity: 'critical' },
      { title: 'C', body: 'D', severity: 'minor' },
    ];
    const result = RawSuggestionsArraySchema.safeParse(validArray);
    expect(result.success).toBe(true);

    // Empty array is also valid
    const emptyResult = RawSuggestionsArraySchema.safeParse([]);
    expect(emptyResult.success).toBe(true);

    // Object is still rejected
    const objectResult = RawSuggestionsArraySchema.safeParse({ title: 'A', body: 'B', severity: 'minor' });
    expect(objectResult.success).toBe(false);
  });
});
