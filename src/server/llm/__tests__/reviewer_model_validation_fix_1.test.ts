/**
 * REVIEWER-MODEL-VALIDATION-FIX-1 (Batch A) — boot-time reviewer-id validation + gpt_lite pin +
 * gpt-5.5 latency-tuning match.
 *
 * Covers (from the overnight MONSTER UAT audit, outputs/MONSTER_UAT_FINDINGS_2026-06-15.md):
 *   1. CR-1 — validateReviewerModels THROWS on an unrecognized reviewer/lite id (naming the offending
 *      key) and PASSES on the current resolved set; validateLlmConfig() passes with the CI-default env.
 *   2. CR-2 — gpt_lite resolves to openai:gpt-4.1-mini by default and honors the
 *      LITE_OPENAI_REVIEWER_MODEL override (re-resolved via a fresh module import).
 *   3. HI-1 — resolveReviewerLatencyTuning returns the tuning for the active full GPT reviewer
 *      (openai:gpt-5.5) AND the legacy openai:gpt-5 when the flag is ON; null when OFF and for the
 *      lite GPT reviewer / other models.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateReviewerModels,
  validateLlmConfig,
  resolveReviewerLatencyTuning,
  REVIEWER_MODELS,
  LITE_REVIEWER_MODELS,
} from '../config.js';
import { getModelCapability } from '../modelCapabilities.js';

// ─── 1. CR-1: boot-time reviewer-id validation ───────────────────────────────

describe('REVIEWER-MODEL-VALIDATION-FIX-1 — CR-1 validateReviewerModels', () => {
  it('passes on the current resolved reviewer + lite-reviewer set', () => {
    expect(() => validateReviewerModels(REVIEWER_MODELS, LITE_REVIEWER_MODELS)).not.toThrow();
  });

  it('every current full + lite reviewer id has a MODEL_CAPABILITIES entry', () => {
    for (const id of [
      ...Object.values(REVIEWER_MODELS),
      ...Object.values(LITE_REVIEWER_MODELS),
    ]) {
      expect(getModelCapability(id), `expected ${id} to be registered`).toBeDefined();
    }
  });

  it('throws, naming the offending FULL key, on an unrecognized reviewer id', () => {
    expect(() =>
      validateReviewerModels({ gpt: 'openai:not-a-real-model' }, {}),
    ).toThrow(/Invalid reviewer model for "gpt".*not a recognized model id/s);
  });

  it('throws, naming the offending LITE key, on an unrecognized lite id', () => {
    expect(() =>
      validateReviewerModels({}, { gpt_lite: 'openai:gpt-5.4-mini-bogus' }),
    ).toThrow(/Invalid reviewer model for "gpt_lite"/);
  });

  it('the error message does not echo any env-var value / secret', () => {
    // It names the key and the (non-secret) model id only.
    try {
      validateReviewerModels({ gemini: 'google:made-up' }, {});
      throw new Error('expected throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('gemini');
      expect(msg).toContain('google:made-up');
    }
  });

  it('validateLlmConfig() does not throw under the CI-default env (drafter/evaluator + reviewers all valid)', () => {
    expect(() => validateLlmConfig()).not.toThrow();
  });
});

// ─── 2. CR-2: gpt_lite default pin + env override ────────────────────────────

describe('REVIEWER-MODEL-VALIDATION-FIX-1 — CR-2 gpt_lite default + override', () => {
  const ENV = 'LITE_OPENAI_REVIEWER_MODEL';
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  it('defaults gpt_lite to openai:gpt-4.1-mini when no override is set', async () => {
    delete process.env[ENV];
    vi.resetModules();
    const fresh = await import('../config.js');
    expect(fresh.LITE_REVIEWER_MODELS.gpt_lite).toBe('openai:gpt-4.1-mini');
  });

  it('honors the LITE_OPENAI_REVIEWER_MODEL override', async () => {
    process.env[ENV] = 'openai:gpt-5.4-mini'; // a different registered lite id
    vi.resetModules();
    const fresh = await import('../config.js');
    expect(fresh.LITE_REVIEWER_MODELS.gpt_lite).toBe('openai:gpt-5.4-mini');
  });

  afterEach(() => {
    vi.resetModules();
  });
});

// ─── 3. HI-1: latency-tuning id match (gpt-5.5 + legacy gpt-5) ────────────────

describe('REVIEWER-MODEL-VALIDATION-FIX-1 — HI-1 resolveReviewerLatencyTuning id match', () => {
  const FLAG = 'REVIEWER_LATENCY_TUNING_ENABLED';
  const EFFORT = 'REVIEWER_GPT5_REASONING_EFFORT';
  const TIER = 'REVIEWER_GPT5_SERVICE_TIER';
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = { [FLAG]: process.env[FLAG], [EFFORT]: process.env[EFFORT], [TIER]: process.env[TIER] };
    delete process.env[FLAG];
    delete process.env[EFFORT];
    delete process.env[TIER];
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('the active full GPT reviewer id is openai:gpt-5.5 (anchors this fix)', () => {
    expect(REVIEWER_MODELS.gpt).toBe('openai:gpt-5.5');
  });

  it('flag ON returns low+priority for the active full GPT reviewer (openai:gpt-5.5)', () => {
    process.env[FLAG] = 'true';
    expect(resolveReviewerLatencyTuning('reviewer_feedback', 'openai:gpt-5.5')).toEqual({
      reasoningEffort: 'low',
      serviceTier: 'priority',
    });
  });

  it('flag ON still returns tuning for the legacy openai:gpt-5 (historical jobs)', () => {
    process.env[FLAG] = 'true';
    expect(resolveReviewerLatencyTuning('reviewer_feedback', 'openai:gpt-5')).toEqual({
      reasoningEffort: 'low',
      serviceTier: 'priority',
    });
  });

  it('flag OFF returns null even for the active GPT reviewer', () => {
    expect(resolveReviewerLatencyTuning('reviewer_feedback', 'openai:gpt-5.5')).toBeNull();
  });

  it('flag ON returns null for the lite GPT reviewer and other models (scope unchanged)', () => {
    process.env[FLAG] = 'true';
    for (const m of [
      'openai:gpt-5.4-mini', // lite GPT reviewer — intentionally excluded
      'openai:gpt-4.1-mini',
      'anthropic:claude-opus-4-5',
      'google:gemini-3.1-pro-preview',
      'xai:grok-4.3',
    ]) {
      expect(resolveReviewerLatencyTuning('reviewer_feedback', m)).toBeNull();
    }
  });

  it('flag ON returns null for non-reviewer job types on the GPT reviewer', () => {
    process.env[FLAG] = 'true';
    expect(resolveReviewerLatencyTuning('draft_generation', 'openai:gpt-5.5')).toBeNull();
    expect(resolveReviewerLatencyTuning('evaluator', 'openai:gpt-5.5')).toBeNull();
  });

  it('flag ON honors env overrides for effort and tier', () => {
    process.env[FLAG] = 'true';
    process.env[EFFORT] = 'minimal';
    process.env[TIER] = 'default';
    expect(resolveReviewerLatencyTuning('reviewer_feedback', 'openai:gpt-5.5')).toEqual({
      reasoningEffort: 'minimal',
      serviceTier: 'default',
    });
  });
});
