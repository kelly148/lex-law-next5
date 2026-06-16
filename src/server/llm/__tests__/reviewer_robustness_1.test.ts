/**
 * REVIEWER-ROBUSTNESS-1 — adapter + boot hardening (from the overnight MONSTER UAT audit,
 * outputs/MONSTER_UAT_FINDINGS_2026-06-15.md).
 *
 *   HI-5b — the nested-wrapper (Rule 4) + singleton-item (Rule 5) JSON recovery is lifted into a SHARED
 *           normalizer used by ALL FOUR reviewer adapters, so Anthropic + Google gain the robustness
 *           OpenAI/xAI already had. (Additive: only recovers shapes that previously failed.)
 *   HI-6  — SESSION_SECRET length (>=32) is enforced at boot, not just presence.
 *   ME-9  — the OpenAI reasoning-vs-temperature request shape is driven by MODEL_CAPABILITIES (with the
 *           gpt-5/o-series prefix fallback for unregistered ids), not a bare startsWith('gpt-5').
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalizeStructuredOutput } from '../structuredOutputNormalize.js';
import { normalizeAnthropicStructuredOutput } from '../anthropic.js';
import { normalizeGoogleStructuredOutput } from '../google.js';
import { normalizeOpenAiStructuredOutput, OpenAiAdapter } from '../openai.js';
import { normalizeGrokStructuredOutput } from '../xai.js';
import { assertSessionSecret } from '../../middleware/session.js';

// A minimal object that validates as a single reviewer-feedback item: RawSuggestionSchema requires
// { title: string.min(1), body: string.min(1), severity: 'critical'|'major'|'minor' }. Only the
// required fields are present so the Rule-5 singleton wrap returns exactly [FEEDBACK_ITEM].
const FEEDBACK_ITEM = {
  title: 'Indemnity is one-sided',
  body: 'Consider a mutual cap.',
  severity: 'major',
};

// ─── HI-5b: shared normalizer — Rules 1-5 ────────────────────────────────────
describe('REVIEWER-ROBUSTNESS-1 — HI-5b shared normalizeStructuredOutput', () => {
  it('Rule 1: a direct array passes through unchanged', () => {
    const arr = [FEEDBACK_ITEM];
    expect(normalizeStructuredOutput(arr)).toBe(arr);
  });
  it('Rule 2: single-key array wrapper is unwrapped', () => {
    expect(normalizeStructuredOutput({ anything: [FEEDBACK_ITEM] })).toEqual([FEEDBACK_ITEM]);
  });
  it('Rule 3: a known multi-key wrapper (feedback) is unwrapped', () => {
    expect(normalizeStructuredOutput({ feedback: [FEEDBACK_ITEM], note: 'x' })).toEqual([FEEDBACK_ITEM]);
  });
  it('Rule 4: a nested object wrapper { review: { feedback: [...] } } is unwrapped', () => {
    expect(normalizeStructuredOutput({ review: { feedback: [FEEDBACK_ITEM] } })).toEqual([FEEDBACK_ITEM]);
  });
  it('Rule 5: a singleton feedback item object is wrapped into an array', () => {
    expect(normalizeStructuredOutput(FEEDBACK_ITEM)).toEqual([FEEDBACK_ITEM]);
  });
  it('Rule 6: an unrecoverable object is returned unchanged (Zod will reject)', () => {
    const junk = { totally: 'unrelated', shape: 1 };
    expect(normalizeStructuredOutput(junk)).toBe(junk);
  });
});

describe('REVIEWER-ROBUSTNESS-1 — HI-5b all four adapters share the same recovery', () => {
  const nested = { review: { feedback: [FEEDBACK_ITEM] } };
  it('Anthropic now recovers a nested wrapper (previously Rules 1-3 only)', () => {
    expect(normalizeAnthropicStructuredOutput(nested)).toEqual([FEEDBACK_ITEM]);
  });
  it('Anthropic now recovers a singleton item (previously Rules 1-3 only)', () => {
    expect(normalizeAnthropicStructuredOutput(FEEDBACK_ITEM)).toEqual([FEEDBACK_ITEM]);
  });
  it('Google now recovers a nested wrapper (previously Rules 1-3 only)', () => {
    expect(normalizeGoogleStructuredOutput(nested)).toEqual([FEEDBACK_ITEM]);
  });
  it('Google now recovers a singleton item (previously Rules 1-3 only)', () => {
    expect(normalizeGoogleStructuredOutput(FEEDBACK_ITEM)).toEqual([FEEDBACK_ITEM]);
  });
  it('OpenAI + xAI behavior is unchanged (still recover nested + singleton)', () => {
    expect(normalizeOpenAiStructuredOutput(nested)).toEqual([FEEDBACK_ITEM]);
    expect(normalizeGrokStructuredOutput(FEEDBACK_ITEM)).toEqual([FEEDBACK_ITEM]);
  });
  it('all four agree on a plain array (no-op) and an unrecoverable object (unchanged)', () => {
    const arr = [FEEDBACK_ITEM];
    const junk = { unrelated: true };
    for (const fn of [
      normalizeOpenAiStructuredOutput,
      normalizeGrokStructuredOutput,
      normalizeAnthropicStructuredOutput,
      normalizeGoogleStructuredOutput,
    ]) {
      expect(fn(arr)).toEqual(arr);
      expect(fn(junk)).toBe(junk);
    }
  });
});

// ─── HI-6: SESSION_SECRET length enforcement ─────────────────────────────────
describe('REVIEWER-ROBUSTNESS-1 — HI-6 assertSessionSecret', () => {
  it('throws when the secret is absent', () => {
    expect(() => assertSessionSecret(undefined)).toThrow(/required/);
    expect(() => assertSessionSecret('')).toThrow(/required/);
  });
  it('throws when the secret is shorter than 32 characters (names the length, not the value)', () => {
    const short = 'a'.repeat(31);
    expect(() => assertSessionSecret(short)).toThrow(/at least 32 characters \(got 31\)/);
    // the secret value itself is not echoed
    try {
      assertSessionSecret(short);
    } catch (e) {
      expect((e as Error).message).not.toContain(short);
    }
  });
  it('returns the secret when it is exactly 32+ characters', () => {
    const ok = 'b'.repeat(32);
    expect(assertSessionSecret(ok)).toBe(ok);
    expect(assertSessionSecret('c'.repeat(64))).toHaveLength(64);
  });
});

// ─── ME-9: OpenAI request shape driven by MODEL_CAPABILITIES ──────────────────
describe('REVIEWER-ROBUSTNESS-1 — ME-9 capability-driven OpenAI request shape', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env['OPENAI_API_KEY'] = 'test-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  function makeFetch(): ReturnType<typeof vi.fn> {
    const body = {
      id: 'x', object: 'chat.completion', model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    return vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);
  }
  function bodyOf(m: ReturnType<typeof vi.fn>): Record<string, unknown> {
    return JSON.parse((m.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
  }
  const BASE = { systemPrompt: 'S', userPrompt: 'U', maxTokens: 16384, temperature: 0.4, signal: new AbortController().signal };

  it('a registered reasoning model (gpt-5.5) uses max_completion_tokens and no temperature', async () => {
    mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);
    await new OpenAiAdapter('gpt-5.5').generate(BASE);
    const body = bodyOf(mockFetch);
    expect('max_completion_tokens' in body).toBe(true);
    expect('max_tokens' in body).toBe(false);
    expect('temperature' in body).toBe(false);
  });

  it('a registered non-reasoning model (gpt-4.1-mini) uses max_tokens + temperature', async () => {
    mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);
    await new OpenAiAdapter('gpt-4.1-mini').generate(BASE);
    const body = bodyOf(mockFetch);
    expect('max_tokens' in body).toBe(true);
    expect('temperature' in body).toBe(true);
    expect('max_completion_tokens' in body).toBe(false);
  });

  it('an UNregistered o-series model (o3) falls back to the prefix match -> max_completion_tokens', async () => {
    mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);
    await new OpenAiAdapter('o3').generate(BASE);
    const body = bodyOf(mockFetch);
    expect('max_completion_tokens' in body).toBe(true);
    expect('temperature' in body).toBe(false);
  });
});
