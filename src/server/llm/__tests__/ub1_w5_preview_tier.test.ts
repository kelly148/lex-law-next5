/**
 * ULTRABUILD-1 W5 — preview-tier model predicate (audit A-6 / Top-5 #5).
 *
 * Preview endpoints are perpetually swap-eligible and their reviewer calibration is UNCALIBRATED-until-rerun.
 * isPreviewTierModel derives the flag from the id string (single source of truth) so the one preview lane
 * (google:gemini-3.1-pro-preview) flags true while GA slugs — including gemini-3.5-flash, which is unverified
 * against provider docs but NOT preview — correctly do not.
 */
import { describe, it, expect } from 'vitest';
import { isPreviewTierModel, REVIEWER_MODELS, WHITELISTED_MODELS } from '../config.js';

describe('W5 — isPreviewTierModel', () => {
  it('flags a -preview slug and only a -preview slug', () => {
    expect(isPreviewTierModel('google:gemini-3.1-pro-preview')).toBe(true);
    expect(isPreviewTierModel('GOOGLE:GEMINI-3.1-PRO-PREVIEW')).toBe(true); // case-insensitive
    expect(isPreviewTierModel('google:gemini-3.5-flash')).toBe(false); // GA-class flash, NOT preview
    expect(isPreviewTierModel('anthropic:claude-opus-4-5')).toBe(false);
    expect(isPreviewTierModel('openai:gpt-5.5')).toBe(false);
    expect(isPreviewTierModel('xai:grok-4.3')).toBe(false);
  });

  it('exactly ONE reviewer lane + ONE whitelist entry is preview-tier today (gemini)', () => {
    const previewReviewers = Object.entries(REVIEWER_MODELS).filter(([, id]) => isPreviewTierModel(id));
    expect(previewReviewers.map(([k]) => k)).toEqual(['gemini']);
    expect(WHITELISTED_MODELS.filter((id) => isPreviewTierModel(id))).toEqual(['google:gemini-3.1-pro-preview']);
  });
});
