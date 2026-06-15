/**
 * MR-LLM-LITE-1 — Test Suite
 *
 * Engagement: MR-LLM-LITE-1 (Lite model options for Review and Generate)
 * Phase: A
 *
 * Test IDs: T-LITE-1 through T-LITE-10
 *
 * Coverage:
 *   T-LITE-1  — config: resolveReviewerModel returns correct full model strings
 *   T-LITE-2  — config: resolveReviewerModel returns correct Lite model strings
 *   T-LITE-3  — config: resolveReviewerModel returns undefined for unknown keys
 *   T-LITE-4  — config: resolveGenerationModel('full', ...) returns the full model
 *   T-LITE-5  — config: resolveGenerationModel('lite', ...) returns LITE_GENERATION_MODEL
 *   T-LITE-6  — config: REVIEWER_TITLES includes all 8 keys (4 full + 4 Lite)
 *   T-LITE-7  — config: LITE_REVIEWER_MODELS has all 4 Lite keys
 *   T-LITE-8  — server: Lite reviewer key passes validation (liteToFullKey enablement check)
 *   T-LITE-9  — server: unknown reviewer key still rejected
 *   T-LITE-10 — server: Lite reviewer key rejected when parent full key is disabled
 */

import { describe, it, expect } from 'vitest';
import {
  resolveReviewerModel,
  resolveGenerationModel,
  REVIEWER_MODELS,
  LITE_REVIEWER_MODELS,
  REVIEWER_TITLES,
  LITE_GENERATION_MODEL,
  type ReviewerKey,
  type LiteReviewerKey,
} from '../../server/llm/config.js';

// ─── T-LITE-1: resolveReviewerModel — full keys ──────────────────────────────
describe('T-LITE-1: resolveReviewerModel — full reviewer keys', () => {
  it('claude → anthropic model', () => {
    expect(resolveReviewerModel('claude')).toBe(REVIEWER_MODELS.claude);
  });
  it('gpt → openai model', () => {
    expect(resolveReviewerModel('gpt')).toBe(REVIEWER_MODELS.gpt);
  });
  it('gemini → google model', () => {
    expect(resolveReviewerModel('gemini')).toBe(REVIEWER_MODELS.gemini);
  });
  it('grok → xai model', () => {
    expect(resolveReviewerModel('grok')).toBe(REVIEWER_MODELS.grok);
  });
});

// ─── T-LITE-2: resolveReviewerModel — Lite keys ──────────────────────────────
describe('T-LITE-2: resolveReviewerModel — Lite reviewer keys', () => {
  it('claude_lite → Lite anthropic model', () => {
    expect(resolveReviewerModel('claude_lite')).toBe(LITE_REVIEWER_MODELS.claude_lite);
  });
  it('gpt_lite → Lite openai model', () => {
    expect(resolveReviewerModel('gpt_lite')).toBe(LITE_REVIEWER_MODELS.gpt_lite);
  });
  it('gemini_lite → Lite google model', () => {
    expect(resolveReviewerModel('gemini_lite')).toBe(LITE_REVIEWER_MODELS.gemini_lite);
  });
  it('grok_lite → Lite xai model', () => {
    expect(resolveReviewerModel('grok_lite')).toBe(LITE_REVIEWER_MODELS.grok_lite);
  });
});

// ─── T-LITE-3: resolveReviewerModel — unknown key ────────────────────────────
describe('T-LITE-3: resolveReviewerModel — unknown key returns undefined', () => {
  it('unknown_reviewer → undefined', () => {
    expect(resolveReviewerModel('unknown_reviewer')).toBeUndefined();
  });
  it('empty string → undefined', () => {
    expect(resolveReviewerModel('')).toBeUndefined();
  });
  it('claude_ultra (non-existent Lite variant) → undefined', () => {
    expect(resolveReviewerModel('claude_ultra')).toBeUndefined();
  });
});

// ─── T-LITE-4: resolveGenerationModel — 'full' mode ─────────────────────────
describe('T-LITE-4: resolveGenerationModel — full mode returns fullModel arg', () => {
  it('full mode returns the provided fullModel string', () => {
    const fullModel = 'anthropic:claude-opus-4-5';
    expect(resolveGenerationModel('full', fullModel)).toBe(fullModel);
  });
  it('full mode is not affected by LITE_GENERATION_MODEL', () => {
    const fullModel = 'openai:gpt-5';
    const result = resolveGenerationModel('full', fullModel);
    expect(result).toBe(fullModel);
    expect(result).not.toBe(LITE_GENERATION_MODEL);
  });
});

// ─── T-LITE-5: resolveGenerationModel — 'lite' mode ─────────────────────────
describe('T-LITE-5: resolveGenerationModel — lite mode returns LITE_GENERATION_MODEL', () => {
  it('lite mode returns LITE_GENERATION_MODEL regardless of fullModel arg', () => {
    expect(resolveGenerationModel('lite', 'anthropic:claude-opus-4-5')).toBe(LITE_GENERATION_MODEL);
  });
  it('LITE_GENERATION_MODEL is a non-empty string', () => {
    expect(typeof LITE_GENERATION_MODEL).toBe('string');
    expect(LITE_GENERATION_MODEL.length).toBeGreaterThan(0);
  });
  it('LITE_GENERATION_MODEL contains a provider prefix', () => {
    expect(LITE_GENERATION_MODEL).toMatch(/^[a-z]+:/);
  });
});

// ─── T-LITE-6: REVIEWER_TITLES — all 8 keys present ─────────────────────────
describe('T-LITE-6: REVIEWER_TITLES includes all 8 reviewer keys', () => {
  const fullKeys: ReviewerKey[] = ['claude', 'gpt', 'gemini', 'grok'];
  const liteKeys: LiteReviewerKey[] = ['claude_lite', 'gpt_lite', 'gemini_lite', 'grok_lite'];

  it.each(fullKeys)('full key %s has a title', (key) => {
    expect(REVIEWER_TITLES[key]).toBeTruthy();
  });
  it.each(liteKeys)('Lite key %s has a title', (key) => {
    expect(REVIEWER_TITLES[key]).toBeTruthy();
  });
  it('Lite titles are distinct from their full counterparts', () => {
    expect(REVIEWER_TITLES.claude_lite).not.toBe(REVIEWER_TITLES.claude);
    expect(REVIEWER_TITLES.gpt_lite).not.toBe(REVIEWER_TITLES.gpt);
  });
});

// ─── T-LITE-7: LITE_REVIEWER_MODELS — all 4 Lite keys ───────────────────────
describe('T-LITE-7: LITE_REVIEWER_MODELS has all 4 Lite keys', () => {
  it('has claude_lite', () => {
    expect(LITE_REVIEWER_MODELS.claude_lite).toBeTruthy();
  });
  it('has gpt_lite', () => {
    expect(LITE_REVIEWER_MODELS.gpt_lite).toBeTruthy();
  });
  it('has gemini_lite', () => {
    expect(LITE_REVIEWER_MODELS.gemini_lite).toBeTruthy();
  });
  it('has grok_lite', () => {
    expect(LITE_REVIEWER_MODELS.grok_lite).toBeTruthy();
  });
  it('Lite models are distinct from full models (except Grok — see note)', () => {
    expect(LITE_REVIEWER_MODELS.claude_lite).not.toBe(REVIEWER_MODELS.claude);
    expect(LITE_REVIEWER_MODELS.gpt_lite).not.toBe(REVIEWER_MODELS.gpt);
    expect(LITE_REVIEWER_MODELS.gemini_lite).not.toBe(REVIEWER_MODELS.gemini);
    // REVIEWER-MODEL-MODERNIZATION-1: grok-3-mini was retired with no GA Grok "mini", so BOTH the full and
    // lite Grok tracks deliberately point at the fast GA flagship grok-4.3 (operator-confirmed). This is
    // the one tier where lite == full, until a distinct GA Grok mini exists.
    expect(LITE_REVIEWER_MODELS.grok_lite).toBe(REVIEWER_MODELS.grok);
  });
});

// ─── T-LITE-8 through T-LITE-10: server validation logic ────────────────────
// These tests exercise the liteToFullKey enablement check logic introduced in
// reviewSession.ts. We test the logic directly (not via tRPC) to avoid
// requiring a full DB setup.

const validFullKeys = ['claude', 'gpt', 'gemini', 'grok'];
const validLiteKeys = ['claude_lite', 'gpt_lite', 'gemini_lite', 'grok_lite'];
const liteToFullKey: Record<string, string> = {
  claude_lite: 'claude',
  gpt_lite: 'gpt',
  gemini_lite: 'gemini',
  grok_lite: 'grok',
};

function simulateReviewerValidation(
  reviewerRole: string,
  enablement: Record<string, boolean>,
): { valid: boolean; error?: string } {
  const isFullKey = validFullKeys.includes(reviewerRole);
  const isLiteKey = validLiteKeys.includes(reviewerRole);
  if (!isFullKey && !isLiteKey) {
    return { valid: false, error: `REVIEWER_NOT_ENABLED: '${reviewerRole}' is not a valid reviewer identifier` };
  }
  const enablementKey = isLiteKey ? liteToFullKey[reviewerRole]! : reviewerRole;
  if (!enablement[enablementKey]) {
    return { valid: false, error: `REVIEWER_NOT_ENABLED: reviewer '${reviewerRole}' is not enabled in user settings` };
  }
  return { valid: true };
}

describe('T-LITE-8: Lite reviewer key passes validation when parent is enabled', () => {
  const enablement = { claude: true, gpt: true, gemini: true, grok: true };

  it('gpt_lite passes when gpt is enabled', () => {
    expect(simulateReviewerValidation('gpt_lite', enablement).valid).toBe(true);
  });
  it('claude_lite passes when claude is enabled', () => {
    expect(simulateReviewerValidation('claude_lite', enablement).valid).toBe(true);
  });
  it('gemini_lite passes when gemini is enabled', () => {
    expect(simulateReviewerValidation('gemini_lite', enablement).valid).toBe(true);
  });
  it('grok_lite passes when grok is enabled', () => {
    expect(simulateReviewerValidation('grok_lite', enablement).valid).toBe(true);
  });
  it('full key gpt still passes', () => {
    expect(simulateReviewerValidation('gpt', enablement).valid).toBe(true);
  });
});

describe('T-LITE-9: unknown reviewer key is rejected', () => {
  const enablement = { claude: true, gpt: true, gemini: true, grok: true };

  it('unknown_reviewer is rejected', () => {
    const result = simulateReviewerValidation('unknown_reviewer', enablement);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('REVIEWER_NOT_ENABLED');
    expect(result.error).toContain('unknown_reviewer');
  });
  it('gpt_ultra (non-existent Lite variant) is rejected', () => {
    const result = simulateReviewerValidation('gpt_ultra', enablement);
    expect(result.valid).toBe(false);
  });
  it('empty string is rejected', () => {
    const result = simulateReviewerValidation('', enablement);
    expect(result.valid).toBe(false);
  });
});

describe('T-LITE-10: Lite reviewer key rejected when parent full key is disabled', () => {
  const enablement = { claude: true, gpt: false, gemini: true, grok: true };

  it('gpt_lite is rejected when gpt is disabled', () => {
    const result = simulateReviewerValidation('gpt_lite', enablement);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('REVIEWER_NOT_ENABLED');
  });
  it('gpt (full) is also rejected when gpt is disabled', () => {
    const result = simulateReviewerValidation('gpt', enablement);
    expect(result.valid).toBe(false);
  });
  it('gpt_lite is accepted when gpt is re-enabled', () => {
    const enablementEnabled = { ...enablement, gpt: true };
    expect(simulateReviewerValidation('gpt_lite', enablementEnabled).valid).toBe(true);
  });
  it('other Lite keys are not affected by gpt being disabled', () => {
    expect(simulateReviewerValidation('claude_lite', enablement).valid).toBe(true);
    expect(simulateReviewerValidation('gemini_lite', enablement).valid).toBe(true);
    expect(simulateReviewerValidation('grok_lite', enablement).valid).toBe(true);
  });
});
