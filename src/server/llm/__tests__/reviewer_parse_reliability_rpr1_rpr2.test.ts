/**
 * REVIEWER-PARSE-RELIABILITY-1 — RPR-1 (structural truncation detector) + RPR-2 (guarded tolerant parse).
 *
 * Unit tests for both shared helpers, plus OpenAI-adapter integration proving: a signal-less truncation
 * is classified as the retriable api_error class (not a terminal parse_error); a complete-but-malformed
 * array with a single bad delimiter is repaired and validated; and a genuinely-wrong complete response is
 * still rejected as parse_error (no over-coercion). Fixtures are inline (CI has no run artifacts).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { looksLikeTruncatedJson } from '../truncationDetect.js';
import { tryRepairArrayJson } from '../tolerantJsonParse.js';
import { OpenAiAdapter } from '../openai.js';
import { LlmProviderError } from '../types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// A grok-shaped mid-string truncation (from the CAL-1 corpus): a JSON array cut inside an open string.
const GROK_TRUNCATED = '[\n  {\n    "title": "Governing Law Selects California",\n    "body": "NARRATIVE_REVIEWER_MEMO: Section 14 selects California law and Los Angeles venue for a transaction with zero Cali';
// A gemini-shaped complete-but-malformed array: the top-level `[` closed with a `}`.
const GEMINI_BAD_CLOSER =
  '[{"title":"BLOCKER: CA law in VA deal","body":"Section 14 designates California.","severity":"critical"}}';

describe('looksLikeTruncatedJson (RPR-1)', () => {
  it('flags a mid-string truncation (open string at end)', () => {
    expect(looksLikeTruncatedJson(GROK_TRUNCATED)).toBe(true);
  });
  it('flags an unclosed array ending on a "more is coming" token (trailing comma / colon)', () => {
    expect(looksLikeTruncatedJson('[{"a":1},')).toBe(true);
    expect(looksLikeTruncatedJson('[{"a":')).toBe(true);
  });
  it('does NOT flag a complete valid array', () => {
    expect(looksLikeTruncatedJson('[{"a":1},{"b":2}]')).toBe(false);
  });
  it('does NOT flag unbalanced GARBAGE with no open string (that is a genuine parse_error, not truncation)', () => {
    expect(looksLikeTruncatedJson('{ broken json')).toBe(false);
    expect(looksLikeTruncatedJson('{{{')).toBe(false);
    expect(looksLikeTruncatedJson('[{"a":1},{"b":2')).toBe(false); // ended mid-number, ambiguous → conservative
  });
  it('does NOT flag a complete-but-malformed array (bad closer, balanced depth) — that is RPR-2 territory', () => {
    expect(looksLikeTruncatedJson(GEMINI_BAD_CLOSER)).toBe(false);
  });
  it('does NOT flag non-JSON text or empty input', () => {
    expect(looksLikeTruncatedJson('"an unterminated string')).toBe(false); // first char is not [ or {
    expect(looksLikeTruncatedJson('   ')).toBe(false);
    expect(looksLikeTruncatedJson('')).toBe(false);
  });
  it('ignores brackets/quotes inside strings (escape-aware)', () => {
    expect(looksLikeTruncatedJson('[{"body":"a ] } \\" [ { char"}]')).toBe(false);
  });
});

describe('tryRepairArrayJson (RPR-2)', () => {
  it('repairs an array closed with a `}` (mismatched top-level closer)', () => {
    const r = tryRepairArrayJson(GEMINI_BAD_CLOSER);
    expect(r).not.toBeNull();
    expect(Array.isArray(r!.value)).toBe(true);
    expect((r!.value as unknown[]).length).toBe(1);
  });
  it('repairs a trailing comma before the final closer', () => {
    const r = tryRepairArrayJson('[{"a":1},]');
    expect(r).not.toBeNull();
    expect(r!.value).toEqual([{ a: 1 }]);
  });
  it('is ARRAY-GATED: returns null for object-first input (protects the evaluator object schema)', () => {
    expect(tryRepairArrayJson('{"dispositions":[1,2]}}')).toBeNull();
    expect(tryRepairArrayJson('{"a":1,}')).toBeNull();
  });
  it('returns null when no minimal repair yields valid JSON (e.g. a mid-string truncation)', () => {
    expect(tryRepairArrayJson(GROK_TRUNCATED)).toBeNull();
  });
});

// ── OpenAI adapter integration ────────────────────────────────────────────────
function stubOpenAi(content: string, finishReason = 'stop') {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: 'cmpl_test',
      model: 'gpt-5.5',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    text: async () => '',
  });
}
const ARRAY_SCHEMA = z.array(z.object({ title: z.string().min(1), body: z.string().min(1), severity: z.enum(['critical', 'major', 'minor']) }));

async function runOpenAi(content: string, finishReason = 'stop') {
  vi.stubGlobal('fetch', stubOpenAi(content, finishReason));
  process.env['OPENAI_API_KEY'] = 'test-key';
  const adapter = new OpenAiAdapter('gpt-5.5');
  return adapter.generate({
    systemPrompt: 's',
    userPrompt: 'u',
    structuredOutputSchema: ARRAY_SCHEMA,
    maxTokens: 16384,
    signal: AbortSignal.timeout(5000),
  });
}

describe('OpenAiAdapter — RPR-1 truncation reclassification', () => {
  it('classifies a signal-less truncation as retriable api_error, not parse_error', async () => {
    await expect(runOpenAi(GROK_TRUNCATED, 'stop')).rejects.toMatchObject({
      errorClass: 'api_error',
    } as Partial<LlmProviderError>);
  });
});

describe('OpenAiAdapter — RPR-2 structural repair', () => {
  it('repairs a bad-closer array, validates it, and tags structuralRepair', async () => {
    const res = await runOpenAi(GEMINI_BAD_CLOSER, 'stop');
    expect(JSON.parse(res.content as string)).toHaveLength(1);
    expect(res.providerMetadata?.structuralRepair).toBe(true);
  });
  it('does NOT repair/accept a complete-but-genuinely-wrong response — still parse_error', async () => {
    // Valid JSON array, but the item is missing body+severity: no structural repair applies and Zod rejects.
    await expect(runOpenAi('[{"title":"x"}]', 'stop')).rejects.toMatchObject({
      errorClass: 'parse_error',
    } as Partial<LlmProviderError>);
  });
});
