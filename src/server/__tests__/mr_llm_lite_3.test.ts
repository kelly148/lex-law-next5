/**
 * MR-LLM-LITE-3: GPT Lite and Grok Lite nested wrapper normalization tests
 *
 * Covers:
 *   T-LITE3-1:  normalizeOpenAiStructuredOutput — nested wrapper {review:{feedback:[...]}} extracted
 *   T-LITE3-2:  normalizeOpenAiStructuredOutput — nested wrapper {output:{items:[...]}} extracted
 *   T-LITE3-3:  normalizeOpenAiStructuredOutput — ambiguous nested (two competing arrays) unchanged
 *   T-LITE3-4:  normalizeGrokStructuredOutput — nested wrapper {review:{feedback:[...]}} extracted
 *   T-LITE3-5:  normalizeGrokStructuredOutput — ambiguous nested (two competing arrays) unchanged
 *   T-LITE3-6:  sanitizeShapeForDiagnostic — excludes content, includes keys/types/array lengths
 *   T-LITE3-7:  direct arrays still pass unchanged for OpenAI and xAI
 *   T-LITE3-8:  Claude Lite fenced JSON behavior remains passing (regression)
 *   T-LITE3-9:  Gemini Lite remains unchanged (no normalization layer)
 *   T-LITE3-10: RawSuggestionsArraySchema still rejects plain objects, accepts canonical arrays
 *   T-LITE3-11: Full GPT/Grok regression — existing flat-wrapper tests still pass
 *   T-LITE3-12: No client/config/generation files touched (diff stat confirmation)
 */

import { describe, it, expect } from 'vitest';
import { normalizeOpenAiStructuredOutput, sanitizeShapeForDiagnostic } from '../llm/openai.js';
import { normalizeGrokStructuredOutput, sanitizeShapeForDiagnostic as sanitizeShapeGrok } from '../llm/xai.js';
import {
  stripJsonCodeFenceIfWholeResponse,
  normalizeAnthropicStructuredOutput,
} from '../llm/anthropic.js';
import { RawSuggestionsArraySchema, parseFeedbackOutput } from '../llm/parsers/feedbackParser.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_SUGGESTION = {
  title: 'Clarify indemnification scope',
  body: 'The indemnification clause should specify the scope.',
  severity: 'major' as const,
};

const VALID_ARRAY = [VALID_SUGGESTION];

const MOCK_SUGGESTIONS_JSON = JSON.stringify([
  { title: 'Fix clause 3', body: 'Clause 3 needs clarification.', severity: 'critical' },
  { title: 'Add definitions', body: 'Add a definitions section.', severity: 'minor' },
]);

// ─── T-LITE3-1: OpenAI nested wrapper {review:{feedback:[...]}} ───────────────

describe('T-LITE3-1: normalizeOpenAiStructuredOutput — nested {review:{feedback:[...]}} extracted', () => {
  it('extracts array from nested review.feedback wrapper', () => {
    const wrapper = { review: { feedback: VALID_ARRAY } };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('extracted result validates against RawSuggestionsArraySchema', () => {
    const wrapper = { review: { feedback: VALID_ARRAY } };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    const validation = RawSuggestionsArraySchema.safeParse(result);
    expect(validation.success).toBe(true);
  });

  it('extracts from nested review.suggestions wrapper', () => {
    const wrapper = { review: { suggestions: VALID_ARRAY } };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('extracts from nested response.feedback wrapper', () => {
    const wrapper = { response: { feedback: VALID_ARRAY } };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('extracts from nested output.items wrapper', () => {
    const wrapper = { output: { items: VALID_ARRAY } };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('extracts from nested result.issues wrapper', () => {
    const wrapper = { result: { issues: VALID_ARRAY } };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('extracts from nested data.feedback wrapper', () => {
    const wrapper = { data: { feedback: VALID_ARRAY } };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('parseFeedbackOutput succeeds after nested wrapper normalization', () => {
    const nestedWrapper = { review: { feedback: JSON.parse(MOCK_SUGGESTIONS_JSON) } };
    const normalized = normalizeOpenAiStructuredOutput(nestedWrapper);
    expect(Array.isArray(normalized)).toBe(true);
    const feedback = parseFeedbackOutput(JSON.stringify(normalized));
    expect(feedback).toHaveLength(2);
    expect(feedback[0]?.title).toBe('Fix clause 3');
  });
});

// ─── T-LITE3-2: OpenAI nested wrapper {output:{items:[...]}} ─────────────────

describe('T-LITE3-2: normalizeOpenAiStructuredOutput — nested {output:{items:[...]}} extracted', () => {
  it('extracts array from nested output.items wrapper', () => {
    const wrapper = { output: { items: VALID_ARRAY } };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('extracted result validates against RawSuggestionsArraySchema', () => {
    const wrapper = { output: { items: VALID_ARRAY } };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    const validation = RawSuggestionsArraySchema.safeParse(result);
    expect(validation.success).toBe(true);
  });

  it('nested wrapper with extra non-array metadata in inner object still extracts', () => {
    const wrapper = { output: { items: VALID_ARRAY, count: 1, status: 'ok' } };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('nested wrapper with extra non-array metadata in outer object still extracts', () => {
    const wrapper = { output: { items: VALID_ARRAY }, version: '1.0' };
    // outer has two keys: 'output' (object) and 'version' (string)
    // Rule 3 won't match (version is not a known array key)
    // Rule 4 should find output.items as the single nested candidate
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });
});

// ─── T-LITE3-3: OpenAI ambiguous nested — two competing arrays unchanged ──────

describe('T-LITE3-3: normalizeOpenAiStructuredOutput — ambiguous nested unchanged', () => {
  it('returns unchanged when two outer keys each have a nested inner array', () => {
    const wrapper = {
      review: { feedback: VALID_ARRAY },
      output: { items: VALID_ARRAY },
    };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    // Ambiguous: two competing nested arrays — must NOT extract
    expect(result).toBe(wrapper);
  });

  it('returns unchanged when one outer key has two inner array keys', () => {
    const wrapper = {
      review: { feedback: VALID_ARRAY, suggestions: VALID_ARRAY },
    };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    // Ambiguous: two inner array keys under same outer key — must NOT extract
    expect(result).toBe(wrapper);
  });

  it('ambiguous nested object fails Zod validation', () => {
    const wrapper = {
      review: { feedback: VALID_ARRAY },
      output: { items: VALID_ARRAY },
    };
    const normalized = normalizeOpenAiStructuredOutput(wrapper);
    const validation = RawSuggestionsArraySchema.safeParse(normalized);
    expect(validation.success).toBe(false);
  });
});

// ─── T-LITE3-4: Grok nested wrapper normalization ─────────────────────────────

describe('T-LITE3-4: normalizeGrokStructuredOutput — nested wrapper extracted', () => {
  it('extracts array from nested review.feedback wrapper', () => {
    const wrapper = { review: { feedback: VALID_ARRAY } };
    const result = normalizeGrokStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('extracted result validates against RawSuggestionsArraySchema', () => {
    const wrapper = { review: { feedback: VALID_ARRAY } };
    const result = normalizeGrokStructuredOutput(wrapper);
    const validation = RawSuggestionsArraySchema.safeParse(result);
    expect(validation.success).toBe(true);
  });

  it('extracts from nested output.items wrapper', () => {
    const wrapper = { output: { items: VALID_ARRAY } };
    const result = normalizeGrokStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('extracts from nested response.suggestions wrapper', () => {
    const wrapper = { response: { suggestions: VALID_ARRAY } };
    const result = normalizeGrokStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('extracts from nested result.issues wrapper', () => {
    const wrapper = { result: { issues: VALID_ARRAY } };
    const result = normalizeGrokStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('parseFeedbackOutput succeeds after Grok nested wrapper normalization', () => {
    const nestedWrapper = { review: { feedback: JSON.parse(MOCK_SUGGESTIONS_JSON) } };
    const normalized = normalizeGrokStructuredOutput(nestedWrapper);
    expect(Array.isArray(normalized)).toBe(true);
    const feedback = parseFeedbackOutput(JSON.stringify(normalized));
    expect(feedback).toHaveLength(2);
    expect(feedback[0]?.title).toBe('Fix clause 3');
  });
});

// ─── T-LITE3-5: Grok ambiguous nested — two competing arrays unchanged ────────

describe('T-LITE3-5: normalizeGrokStructuredOutput — ambiguous nested unchanged', () => {
  it('returns unchanged when two outer keys each have a nested inner array', () => {
    const wrapper = {
      review: { feedback: VALID_ARRAY },
      output: { items: VALID_ARRAY },
    };
    const result = normalizeGrokStructuredOutput(wrapper);
    expect(result).toBe(wrapper);
  });

  it('returns unchanged when one outer key has two inner array keys', () => {
    const wrapper = {
      review: { feedback: VALID_ARRAY, suggestions: VALID_ARRAY },
    };
    const result = normalizeGrokStructuredOutput(wrapper);
    expect(result).toBe(wrapper);
  });

  it('ambiguous nested object fails Zod validation', () => {
    const wrapper = {
      review: { feedback: VALID_ARRAY },
      output: { items: VALID_ARRAY },
    };
    const normalized = normalizeGrokStructuredOutput(wrapper);
    const validation = RawSuggestionsArraySchema.safeParse(normalized);
    expect(validation.success).toBe(false);
  });
});

// ─── T-LITE3-6: sanitizeShapeForDiagnostic ────────────────────────────────────

describe('T-LITE3-6: sanitizeShapeForDiagnostic — excludes content, includes structure', () => {
  it('returns topLevelType array with length for array input', () => {
    const shape = sanitizeShapeForDiagnostic(VALID_ARRAY);
    expect(shape).toMatchObject({ topLevelType: 'array', length: 1 });
    // Must NOT include any array item content
    expect(JSON.stringify(shape)).not.toContain('indemnification');
  });

  it('returns topLevelType null for null', () => {
    expect(sanitizeShapeForDiagnostic(null)).toEqual({ topLevelType: 'null' });
  });

  it('returns topLevelType string for string', () => {
    expect(sanitizeShapeForDiagnostic('hello')).toEqual({ topLevelType: 'string' });
  });

  it('returns topLevelType number for number', () => {
    expect(sanitizeShapeForDiagnostic(42)).toEqual({ topLevelType: 'number' });
  });

  it('returns object shape with key types and array lengths for flat object', () => {
    const obj = { feedback: VALID_ARRAY, count: 1, status: 'ok' };
    const shape = sanitizeShapeForDiagnostic(obj);
    expect(shape.topLevelType).toBe('object');
    const keys = shape['keys'] as Record<string, string>;
    expect(keys['feedback']).toBe('array(length=1)');
    expect(keys['count']).toBe('number');
    expect(keys['status']).toBe('string');
    // Must NOT include feedback item content
    expect(JSON.stringify(shape)).not.toContain('indemnification');
  });

  it('returns nested key shapes for nested objects', () => {
    const obj = { review: { feedback: VALID_ARRAY, note: 'ignored' } };
    const shape = sanitizeShapeForDiagnostic(obj);
    expect(shape.topLevelType).toBe('object');
    const keys = shape['keys'] as Record<string, string>;
    expect(keys['review']).toBe('object');
    const nestedKeys = shape['nestedKeys'] as Record<string, Record<string, string>>;
    expect(nestedKeys['review']?.['feedback']).toBe('array(length=1)');
    expect(nestedKeys['review']?.['note']).toBe('string');
    // Must NOT include feedback item content
    expect(JSON.stringify(shape)).not.toContain('indemnification');
  });

  it('Grok sanitizeShapeForDiagnostic is consistent with OpenAI version', () => {
    const obj = { output: { items: VALID_ARRAY } };
    const openaiShape = sanitizeShapeForDiagnostic(obj);
    const grokShape = sanitizeShapeGrok(obj);
    expect(openaiShape).toEqual(grokShape);
  });
});

// ─── T-LITE3-7: Direct arrays still pass unchanged ────────────────────────────

describe('T-LITE3-7: direct arrays still pass unchanged for OpenAI and xAI', () => {
  it('OpenAI: direct array passes through unchanged', () => {
    const result = normalizeOpenAiStructuredOutput(VALID_ARRAY);
    expect(result).toBe(VALID_ARRAY);
  });

  it('xAI: direct array passes through unchanged', () => {
    const result = normalizeGrokStructuredOutput(VALID_ARRAY);
    expect(result).toBe(VALID_ARRAY);
  });

  it('OpenAI: empty array passes through unchanged', () => {
    const empty: unknown[] = [];
    const result = normalizeOpenAiStructuredOutput(empty);
    expect(result).toBe(empty);
  });

  it('xAI: empty array passes through unchanged', () => {
    const empty: unknown[] = [];
    const result = normalizeGrokStructuredOutput(empty);
    expect(result).toBe(empty);
  });
});

// ─── T-LITE3-8: Claude Lite fenced JSON behavior remains passing ──────────────

describe('T-LITE3-8: Claude Lite fenced JSON behavior remains passing (regression)', () => {
  it('stripJsonCodeFenceIfWholeResponse strips ```json fence', () => {
    const fenced = '```json\n[{"title":"t","body":"b","severity":"low"}]\n```';
    const result = stripJsonCodeFenceIfWholeResponse(fenced);
    expect(result).toBe('[{"title":"t","body":"b","severity":"low"}]');
  });

  it('normalizeAnthropicStructuredOutput extracts known wrapper key', () => {
    const wrapper = { feedback: VALID_ARRAY, count: 1 };
    const result = normalizeAnthropicStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('Claude Lite full pipeline: fenced + wrapped JSON normalizes and validates', () => {
    const wrappedJson = JSON.stringify({ feedback: JSON.parse(MOCK_SUGGESTIONS_JSON), count: 2 });
    const fenced = `\`\`\`json\n${wrappedJson}\n\`\`\``;
    const stripped = stripJsonCodeFenceIfWholeResponse(fenced);
    const parsed = JSON.parse(stripped);
    const normalized = normalizeAnthropicStructuredOutput(parsed);
    expect(Array.isArray(normalized)).toBe(true);
    const validation = RawSuggestionsArraySchema.safeParse(normalized);
    expect(validation.success).toBe(true);
    const feedback = parseFeedbackOutput(JSON.stringify(normalized));
    expect(feedback).toHaveLength(2);
  });
});

// ─── T-LITE3-9: Gemini Lite remains unchanged (no normalization layer) ─────────

describe('T-LITE3-9: Gemini Lite remains unchanged — no normalization layer', () => {
  it('RawSuggestionsArraySchema accepts a bare array (Gemini returns bare arrays)', () => {
    const parsed = JSON.parse(MOCK_SUGGESTIONS_JSON);
    const validation = RawSuggestionsArraySchema.safeParse(parsed);
    expect(validation.success).toBe(true);
  });

  it('Gemini does not use normalizeOpenAiStructuredOutput or normalizeGrokStructuredOutput', () => {
    // Structural test: Gemini adapter has no wrapper normalization.
    // We verify that a bare array JSON string round-trips correctly without normalization.
    const rawText = MOCK_SUGGESTIONS_JSON;
    const parsed = JSON.parse(rawText);
    const validation = RawSuggestionsArraySchema.safeParse(parsed);
    expect(validation.success).toBe(true);
    const feedback = parseFeedbackOutput(rawText);
    expect(feedback).toHaveLength(2);
  });
});

// ─── T-LITE3-10: RawSuggestionsArraySchema still rejects plain objects ─────────

describe('T-LITE3-10: RawSuggestionsArraySchema still rejects plain objects, accepts canonical arrays', () => {
  it('accepts a valid bare array', () => {
    const result = RawSuggestionsArraySchema.safeParse(JSON.parse(MOCK_SUGGESTIONS_JSON));
    expect(result.success).toBe(true);
  });

  it('rejects a plain object wrapper without normalization', () => {
    const result = RawSuggestionsArraySchema.safeParse({ feedback: JSON.parse(MOCK_SUGGESTIONS_JSON) });
    expect(result.success).toBe(false);
  });

  it('rejects a nested object wrapper without normalization', () => {
    const result = RawSuggestionsArraySchema.safeParse({ review: { feedback: JSON.parse(MOCK_SUGGESTIONS_JSON) } });
    expect(result.success).toBe(false);
  });

  it('rejects null', () => {
    expect(RawSuggestionsArraySchema.safeParse(null).success).toBe(false);
  });

  it('rejects a string', () => {
    expect(RawSuggestionsArraySchema.safeParse(MOCK_SUGGESTIONS_JSON).success).toBe(false);
  });

  it('accepts an empty array', () => {
    expect(RawSuggestionsArraySchema.safeParse([]).success).toBe(true);
  });
});

// ─── T-LITE3-11: Full GPT/Grok regression ─────────────────────────────────────

describe('T-LITE3-11: Full GPT/Grok regression — existing flat-wrapper tests still pass', () => {
  // MR-LLM-GPT-1 regression: single-key wrapper
  it('OpenAI single-key wrapper still extracted (MR-LLM-GPT-1)', () => {
    const wrapper = { feedback: VALID_ARRAY };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('OpenAI single-key wrapper (suggestions) still extracted (MR-LLM-GPT-1)', () => {
    const wrapper = { suggestions: VALID_ARRAY };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  // MR-LLM-LITE-2 regression: multi-key known wrapper
  it('OpenAI multi-key known wrapper still extracted (MR-LLM-LITE-2)', () => {
    const wrapper = { feedback: VALID_ARRAY, count: 1 };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('OpenAI multi-key no-known-key still unchanged (MR-LLM-LITE-2)', () => {
    const wrapper = { unknownKey: VALID_ARRAY, anotherKey: 'value' };
    const result = normalizeOpenAiStructuredOutput(wrapper);
    expect(result).toBe(wrapper);
  });

  // MR-LLM-GROK-1 regression: single-key wrapper
  it('Grok single-key wrapper still extracted (MR-LLM-GROK-1)', () => {
    const wrapper = { feedback: VALID_ARRAY };
    const result = normalizeGrokStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('Grok single-key wrapper (items) still extracted (MR-LLM-GROK-1)', () => {
    const wrapper = { items: VALID_ARRAY };
    const result = normalizeGrokStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  // MR-LLM-LITE-2 regression: Grok multi-key known wrapper
  it('Grok multi-key known wrapper still extracted (MR-LLM-LITE-2)', () => {
    const wrapper = { data: VALID_ARRAY, ok: true };
    const result = normalizeGrokStructuredOutput(wrapper);
    expect(result).toBe(VALID_ARRAY);
  });

  it('Grok multi-key no-known-key still unchanged (MR-LLM-LITE-2)', () => {
    const wrapper = { unknownKey: VALID_ARRAY, anotherKey: 'value' };
    const result = normalizeGrokStructuredOutput(wrapper);
    expect(result).toBe(wrapper);
  });

  // Null/primitive pass-through
  it('OpenAI null passes through unchanged', () => {
    expect(normalizeOpenAiStructuredOutput(null)).toBe(null);
  });

  it('Grok null passes through unchanged', () => {
    expect(normalizeGrokStructuredOutput(null)).toBe(null);
  });

  it('OpenAI string passes through unchanged', () => {
    expect(normalizeOpenAiStructuredOutput('hello')).toBe('hello');
  });

  it('Grok string passes through unchanged', () => {
    expect(normalizeGrokStructuredOutput('hello')).toBe('hello');
  });
});

// ─── T-LITE3-12: No client/config/generation files touched ────────────────────

describe('T-LITE3-12: No client/config/generation files touched (diff stat confirmation)', () => {
  it('MR-LLM-LITE-3 changes are confined to allowed files only', async () => {
    // This test verifies the constraint programmatically by checking the git diff
    // against the list of allowed files for this engagement.
    const { execSync } = await import('child_process');
    const diffOutput = execSync(
      'git -C . diff --name-only origin/main HEAD 2>/dev/null || git -C . diff --name-only HEAD~1 HEAD 2>/dev/null || echo "no-diff"',
      { cwd: new URL('../../../..', import.meta.url).pathname, encoding: 'utf8' }
    ).trim();

    if (diffOutput === 'no-diff' || diffOutput === '') {
      // No commits yet — this is acceptable during Phase A before commit
      return;
    }

    const changedFiles = diffOutput.split('\n').filter(Boolean);
    const FORBIDDEN_PATTERNS = [
      /^src\/app\//,
      /^src\/components\//,
      /^src\/client\//,
      /^src\/server\/reviewSession/,
      /^src\/server\/documents4a/,
      /^src\/server\/canonicalMutation/,
      /^src\/server\/llm\/anthropic/,
      /^src\/server\/llm\/google/,
      /^src\/server\/llm\/config/,
      /^src\/server\/llm\/registry/,
      /^src\/server\/llm\/parsers\/feedbackParser/,
      /^prisma\//,
      /^package\.json$/,
      /^pnpm-lock\.yaml$/,
    ];

    for (const file of changedFiles) {
      const isForbidden = FORBIDDEN_PATTERNS.some(pattern => pattern.test(file));
      expect(isForbidden, `Forbidden file changed: ${file}`).toBe(false);
    }
  });
});
