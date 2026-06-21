/**
 * GPT5-REASONING-CAP-1 — bounded reasoning_effort truncation insurance for the GPT-5 reviewer lane.
 *
 * Locks: the flag default-OFF / exact-"true"; the resolver scope (reviewer_feedback × the GPT reviewer only;
 * env-overridable effort); the DECOUPLING from REVIEWER_LATENCY_TUNING_ENABLED; and the reviewerJobFactory
 * fallback wiring (latency tuning wins; otherwise the cap supplies reasoning_effort; both off → nothing).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isGpt5ReasoningCapEnabled } from '../config/featureFlags.js';
import { resolveReviewerReasoningCap, resolveReviewerLatencyTuning } from '../llm/config.js';

const CAP = 'GPT5_REASONING_CAP_ENABLED';
const EFFORT = 'GPT5_REASONING_CAP_EFFORT';
const LATENCY = 'REVIEWER_LATENCY_TUNING_ENABLED';
const GPT = 'openai:gpt-5'; // always in TUNED_REVIEWER_MODELS
const saved: Record<string, string | undefined> = {};
function setEnv(k: string, v: string | undefined): void {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}
afterEach(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
    delete saved[k];
  }
});

describe('GPT5-REASONING-CAP-1 flag', () => {
  it('defaults OFF; ON only for "true"', () => {
    setEnv(CAP, undefined);
    expect(isGpt5ReasoningCapEnabled()).toBe(false);
    setEnv(CAP, 'true');
    expect(isGpt5ReasoningCapEnabled()).toBe(true);
    for (const v of ['false', 'TRUE', '1', '']) {
      setEnv(CAP, v);
      expect(isGpt5ReasoningCapEnabled()).toBe(false);
    }
  });
});

describe('resolveReviewerReasoningCap', () => {
  it('null when the flag is OFF (no reasoning_effort sent → byte-for-byte)', () => {
    setEnv(CAP, undefined);
    expect(resolveReviewerReasoningCap('reviewer_feedback', GPT)).toBeNull();
  });
  it('returns a bounded reasoning_effort for the GPT reviewer lane when ON (default "low", env-overridable)', () => {
    setEnv(CAP, 'true');
    setEnv(EFFORT, undefined);
    expect(resolveReviewerReasoningCap('reviewer_feedback', GPT)).toEqual({ reasoningEffort: 'low' });
    setEnv(EFFORT, 'minimal');
    expect(resolveReviewerReasoningCap('reviewer_feedback', GPT)).toEqual({ reasoningEffort: 'minimal' });
  });
  it('is scoped: null for non-reviewer jobs and non-GPT-reviewer models', () => {
    setEnv(CAP, 'true');
    expect(resolveReviewerReasoningCap('draft_generation', GPT)).toBeNull();
    expect(resolveReviewerReasoningCap('reviewer_feedback', 'anthropic:claude-opus-4-5')).toBeNull();
    expect(resolveReviewerReasoningCap('reviewer_feedback', 'openai:gpt-4.1-mini')).toBeNull(); // lite excluded
  });
  it('is DECOUPLED from REVIEWER_LATENCY_TUNING_ENABLED — the cap supplies effort even when latency tuning is OFF', () => {
    setEnv(LATENCY, undefined); // latency tuning OFF
    setEnv(CAP, 'true');
    expect(resolveReviewerLatencyTuning('reviewer_feedback', GPT)).toBeNull(); // latency path inert
    expect(resolveReviewerReasoningCap('reviewer_feedback', GPT)).toEqual({ reasoningEffort: 'low' });
  });
});

describe('reviewerJobFactory wiring (source-audit)', () => {
  it('uses the cap as a FALLBACK after latency tuning (latency wins; otherwise the cap; both off → {})', () => {
    const src = readFileSync(resolve(__dirname, '../jobs/reviewerJobFactory.ts'), 'utf8');
    expect(src).toContain('resolveReviewerLatencyTuning(REVIEWER_JOB_TYPE, modelString) ??');
    expect(src).toContain('resolveReviewerReasoningCap(REVIEWER_JOB_TYPE, modelString) ??');
  });
});
