/**
 * REVIEWER-PARSE-RELIABILITY-1 — RPR-3 (derive-from-card legacy-severity backfill) + RPR-4 (OpenAI
 * empty-object -> empty-array coercion).
 *
 * RPR-3 derives a DROPPED top-level severity from the reviewer's own embedded STRUCTURED_FEEDBACK_CARDS
 * card (never a flat default: a BLOCKER derives to 'critical' and is never downgraded), gated to the
 * reviewer-item shape so the object-shaped evaluator schema is never touched. RPR-4 coerces GPT's `{}`
 * "no feedback" answer to `[]` only when the target schema accepts an empty array.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { normalizeStructuredOutput } from '../structuredOutputNormalize.js';
import { RawSuggestionsArraySchema } from '../parsers/feedbackParser.js';
import { OpenAiAdapter } from '../openai.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A legacy suggestion body carrying an embedded card with the given card severity (no top-level severity). */
function bodyWithCard(cardSeverity: string): string {
  return (
    `NARRATIVE_REVIEWER_MEMO: The clause raises an issue.\n` +
    `STRUCTURED_FEEDBACK_CARDS\n[{"severity":"${cardSeverity}","issue":"the issue"}]`
  );
}

describe('RPR-3 — derive legacy severity from the embedded card', () => {
  it('backfills each array item from its card, mapping card severity → legacy severity', () => {
    const input = [
      { title: 'T1', body: bodyWithCard('BLOCKER') },
      { title: 'T2', body: bodyWithCard('SUBSTANTIVE') },
      { title: 'T3', body: bodyWithCard('POLISH') },
    ];
    const out = normalizeStructuredOutput(input);
    // Now valid against the canonical reviewer array schema, with DERIVED severities (not downgraded).
    const parsed = RawSuggestionsArraySchema.parse(out);
    expect(parsed.map((p) => p.severity)).toEqual(['critical', 'major', 'minor']);
  });

  it('wraps a lone reviewer-item object (title+body, no severity) into [item] with the derived severity', () => {
    const out = normalizeStructuredOutput({ title: 'Solo', body: bodyWithCard('BLOCKER') });
    const parsed = RawSuggestionsArraySchema.parse(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.severity).toBe('critical'); // BLOCKER → critical, NEVER downgraded
  });

  it('EVALUATOR SAFETY: an object with no title/body is never wrapped or given a severity', () => {
    const evaluatorish = { status: 'ok', count: 3 };
    expect(normalizeStructuredOutput(evaluatorish)).toBe(evaluatorish); // untouched, same reference
  });

  it('no re-derivation: an array whose items already have valid severity is returned unchanged (same ref)', () => {
    const valid = [{ title: 'T', body: 'b', severity: 'major' }];
    expect(normalizeStructuredOutput(valid)).toBe(valid);
  });

  it('does NOT backfill when an element lacks title or body (not the reviewer-item shape)', () => {
    const arr = [{ title: 'T', body: bodyWithCard('BLOCKER') }, { title: 'no-body' }];
    // one element isn't reviewer-shaped → the whole array is returned untouched (no partial mutation)
    expect(normalizeStructuredOutput(arr)).toBe(arr);
  });

  it('NEVER flat-defaults: a reviewer item whose body has no recoverable card is left severity-less (Zod rejects)', () => {
    const arr = [{ title: 'T', body: 'plain prose, no STRUCTURED_FEEDBACK_CARDS block' }];
    const out = normalizeStructuredOutput(arr) as Array<Record<string, unknown>>;
    expect(out[0]!.severity).toBeUndefined();
    expect(RawSuggestionsArraySchema.safeParse(out).success).toBe(false);
  });

  it('ignores an unrecognized card severity string (no fabricated severity)', () => {
    const arr = [{ title: 'T', body: bodyWithCard('NONSENSE_TIER') }];
    const out = normalizeStructuredOutput(arr) as Array<Record<string, unknown>>;
    expect(out[0]!.severity).toBeUndefined();
  });
});

describe('RPR-4 — OpenAI empty-object → empty-array (array-target-gated)', () => {
  function stubOpenAi(content: string) {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'cmpl',
        model: 'gpt-5.5',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
      text: async () => '',
    });
  }

  it('coerces GPT `{}` to `[]` for an array-target schema (the T1 no-feedback case)', async () => {
    vi.stubGlobal('fetch', stubOpenAi('{}'));
    process.env['OPENAI_API_KEY'] = 'test-key';
    const res = await new OpenAiAdapter('gpt-5.5').generate({
      systemPrompt: 's',
      userPrompt: 'u',
      structuredOutputSchema: RawSuggestionsArraySchema,
      maxTokens: 16384,
      signal: AbortSignal.timeout(5000),
    });
    expect(JSON.parse(res.content as string)).toEqual([]);
  });

  it('does NOT coerce `{}` for an object-target schema (evaluator safety) — still parse_error', async () => {
    vi.stubGlobal('fetch', stubOpenAi('{}'));
    process.env['OPENAI_API_KEY'] = 'test-key';
    await expect(
      new OpenAiAdapter('gpt-5.5').generate({
        systemPrompt: 's',
        userPrompt: 'u',
        structuredOutputSchema: z.object({ status: z.literal('ok') }),
        maxTokens: 16384,
        signal: AbortSignal.timeout(5000),
      }),
    ).rejects.toMatchObject({ errorClass: 'parse_error' });
  });
});
