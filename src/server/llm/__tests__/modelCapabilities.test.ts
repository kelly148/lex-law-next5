/**
 * GEMINI-BUDGET-CALIBRATION-1 — Increment 2
 * Model-capability registry: per-model calibrated reviewer ceilings + capability metadata.
 */
import { describe, it, expect } from 'vitest';
import {
  MODEL_CAPABILITIES,
  DEFAULT_REVIEWER_CEILING,
  getReviewerCeiling,
  getModelCapability,
} from '../modelCapabilities.js';
import { REVIEWER_MODELS } from '../config.js';

describe('getReviewerCeiling — calibrated per-model budgets', () => {
  it('raises Gemini 2.5 Pro to 32768 (the measured demand-curve calibration)', () => {
    expect(getReviewerCeiling('google:gemini-2.5-pro')).toBe(32768);
  });
  it('holds Claude / GPT-5 / Grok at the 16384 floor', () => {
    expect(getReviewerCeiling('anthropic:claude-opus-4-5')).toBe(16384);
    expect(getReviewerCeiling('openai:gpt-5')).toBe(16384);
    expect(getReviewerCeiling('xai:grok-4')).toBe(16384);
  });
  it('holds the lite models at 16384 (unmeasured)', () => {
    expect(getReviewerCeiling('anthropic:claude-sonnet-4-5')).toBe(16384);
    expect(getReviewerCeiling('openai:gpt-4.1-mini')).toBe(16384);
    expect(getReviewerCeiling('google:gemini-2.5-flash')).toBe(16384);
    expect(getReviewerCeiling('xai:grok-3-mini')).toBe(16384);
  });
  it('falls back to the safe floor for an unregistered model (e.g. an env-overridden lite)', () => {
    expect(getReviewerCeiling('openai:some-future-model')).toBe(DEFAULT_REVIEWER_CEILING);
    expect(DEFAULT_REVIEWER_CEILING).toBe(16384);
  });
  // REVIEWER-MODEL-MODERNIZATION-1: the modernized reviewer ids must be registered (not silently DEFAULT).
  // Critically, the new Gemini Pro id KEEPS the calibrated 32768 ceiling — a bare config.ts id swap would
  // have dropped it to 16384 (the DEFAULT), re-risking the Gemini truncation api_error.
  it('preserves the Gemini-Pro 32768 reviewer ceiling on the modernized id (regression guard)', () => {
    expect(getReviewerCeiling('google:gemini-3.1-pro-preview')).toBe(32768);
  });
  it('registers the modernized GA reviewer ids at the calibrated floor', () => {
    expect(getReviewerCeiling('openai:gpt-5.5')).toBe(16384);
    expect(getReviewerCeiling('xai:grok-4.3')).toBe(16384);
    expect(getReviewerCeiling('openai:gpt-5.4-mini')).toBe(16384);
    expect(getReviewerCeiling('google:gemini-3.5-flash')).toBe(16384);
  });
  // CLAUDE-LANE-MODERNIZATION-1: the current daily-driver Claude reviewer ids are registered at the
  // 16384 floor (unmeasured) with the live-confirmed 128000 provider cap. The prior opus-4-5 / sonnet-4-5
  // entries remain registered (asserted above) so historical jobs still resolve their ceiling.
  it('registers the modernized Claude reviewer ids (opus-4-8 full, sonnet-5 lite)', () => {
    expect(getReviewerCeiling('anthropic:claude-opus-4-8')).toBe(16384);
    // RPR-7: sonnet-5 lite ceiling raised 16384 -> 32768 for adaptive-thinking output headroom.
    expect(getReviewerCeiling('anthropic:claude-sonnet-5')).toBe(32768);
    expect(getModelCapability('anthropic:claude-opus-4-8')?.providerMaxOutputTokens).toBe(128000);
    expect(getModelCapability('anthropic:claude-sonnet-5')?.providerMaxOutputTokens).toBe(128000);
    expect(getModelCapability('anthropic:claude-opus-4-8')?.pricingClass).toBe('premium');
    expect(getModelCapability('anthropic:claude-sonnet-5')?.pricingClass).toBe('lite');
  });
});

describe('registry coverage + capability metadata', () => {
  it('registers every full reviewer model', () => {
    for (const modelString of Object.values(REVIEWER_MODELS)) {
      expect(getModelCapability(modelString), modelString).toBeDefined();
    }
  });
  it('flags GPT-5 as the only extended-latency (async-lane) reviewer; the rest are standard', () => {
    expect(MODEL_CAPABILITIES['openai:gpt-5']?.timeoutClass).toBe('extended');
    expect(MODEL_CAPABILITIES['google:gemini-2.5-pro']?.timeoutClass).toBe('standard');
    expect(MODEL_CAPABILITIES['anthropic:claude-opus-4-5']?.timeoutClass).toBe('standard');
    expect(MODEL_CAPABILITIES['xai:grok-4']?.timeoutClass).toBe('standard');
  });
  it('records thinking-control support where the provider exposes it', () => {
    expect(MODEL_CAPABILITIES['openai:gpt-5']?.supportsThinkingControl).toBe(true); // reasoning_effort
    expect(MODEL_CAPABILITIES['google:gemini-2.5-pro']?.supportsThinkingControl).toBe(true); // thinkingBudget
  });
  it('keeps every reviewerCeiling within the model provider max (sanity invariant)', () => {
    for (const [modelString, cap] of Object.entries(MODEL_CAPABILITIES)) {
      expect(cap.reviewerCeiling, modelString).toBeLessThanOrEqual(cap.providerMaxOutputTokens);
      expect(cap.reviewerCeiling, modelString).toBeGreaterThanOrEqual(DEFAULT_REVIEWER_CEILING);
    }
  });
});
