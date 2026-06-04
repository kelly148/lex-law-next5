/**
 * FOLD-ORCH-1 Increment 2b — per-matter reviewer toggle (Fork C).
 *
 * Tests the PURE resolution layer (override-over-global + the N-of-M denominator) and the
 * additive Zod-Wall changes (MatterOrchestrationLanes + the optional MatterRow field). The DB
 * write (setMatterOrchestrationLanes) and the tRPC procedure are exercised live, not in unit
 * tests (no test DB); the pure projection consumed by the orchestration dispatch is the core.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveReviewerLanes,
  intendedReviewersFromEnablement,
  intendedReviewersForMatter,
  REVIEWER_LANE_KEYS,
} from '../orchestration/reviewerLanes.js';
import {
  MatterOrchestrationLanesSchema,
  MatterRowSchema,
  type ReviewerEnablement,
  type MatterOrchestrationLanes,
} from '../../shared/schemas/matters.js';

const GLOBAL_DEFAULT: ReviewerEnablement = { claude: true, gpt: true, gemini: true, grok: false };

// ============================================================
// A. resolveReviewerLanes — override-over-global
// ============================================================
describe('FOLD-ORCH-1 Inc2b — resolveReviewerLanes', () => {
  it('null override falls back to the global default (wholesale, not a merge)', () => {
    expect(resolveReviewerLanes({ matterLanes: null, globalEnablement: GLOBAL_DEFAULT })).toEqual(GLOBAL_DEFAULT);
  });

  it('undefined override falls back to the global default', () => {
    expect(resolveReviewerLanes({ globalEnablement: GLOBAL_DEFAULT })).toEqual(GLOBAL_DEFAULT);
  });

  it('a per-matter override wins over the global default', () => {
    const override: MatterOrchestrationLanes = { claude: true, gpt: false, gemini: false, grok: true };
    expect(resolveReviewerLanes({ matterLanes: override, globalEnablement: GLOBAL_DEFAULT })).toEqual(override);
  });
});

// ============================================================
// B. intendedReviewersFromEnablement — the N-of-M denominator
// ============================================================
describe('FOLD-ORCH-1 Inc2b — intendedReviewersFromEnablement', () => {
  it('returns the toggled-on roles in canonical order', () => {
    expect(intendedReviewersFromEnablement({ claude: true, gpt: false, gemini: true, grok: true })).toEqual([
      'claude',
      'gemini',
      'grok',
    ]);
  });

  it('global default (grok off) excludes grok', () => {
    expect(intendedReviewersFromEnablement(GLOBAL_DEFAULT)).toEqual(['claude', 'gpt', 'gemini']);
  });

  it('all-off yields an empty denominator', () => {
    expect(intendedReviewersFromEnablement({ claude: false, gpt: false, gemini: false, grok: false })).toEqual([]);
  });

  it('canonical order is claude, gpt, gemini, grok', () => {
    expect([...REVIEWER_LANE_KEYS]).toEqual(['claude', 'gpt', 'gemini', 'grok']);
  });
});

// ============================================================
// C. intendedReviewersForMatter — end-to-end projection
// ============================================================
describe('FOLD-ORCH-1 Inc2b — intendedReviewersForMatter', () => {
  it('no override uses the global default set', () => {
    expect(intendedReviewersForMatter({ matterLanes: null, globalEnablement: GLOBAL_DEFAULT })).toEqual([
      'claude',
      'gpt',
      'gemini',
    ]);
  });

  it('an override that enables grok and disables gpt is reflected', () => {
    const override: MatterOrchestrationLanes = { claude: true, gpt: false, gemini: true, grok: true };
    expect(intendedReviewersForMatter({ matterLanes: override, globalEnablement: GLOBAL_DEFAULT })).toEqual([
      'claude',
      'gemini',
      'grok',
    ]);
  });
});

// ============================================================
// D. Zod Wall — additive schema (back-compat + new column)
// ============================================================
const BASE_MATTER = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  title: 'Test Matter',
  clientName: null,
  practiceArea: null,
  phase: 'intake' as const,
  archivedAt: null,
  completedAt: null,
  createdAt: new Date('2026-06-04T00:00:00Z'),
  updatedAt: new Date('2026-06-04T00:00:00Z'),
};

describe('FOLD-ORCH-1 Inc2b — Zod Wall (MatterRow + lanes)', () => {
  it('MatterOrchestrationLanesSchema requires explicit booleans', () => {
    expect(MatterOrchestrationLanesSchema.safeParse({ claude: true, gpt: true, gemini: false, grok: false }).success).toBe(true);
    // a missing key is rejected (no silent default on the override)
    expect(MatterOrchestrationLanesSchema.safeParse({ claude: true, gpt: true, gemini: false }).success).toBe(false);
  });

  it('MatterRow parses WITHOUT orchestrationLanes (back-compat / pre-migration rows)', () => {
    expect(MatterRowSchema.safeParse(BASE_MATTER).success).toBe(true);
  });

  it('MatterRow parses with orchestrationLanes = null (no override)', () => {
    expect(MatterRowSchema.safeParse({ ...BASE_MATTER, orchestrationLanes: null }).success).toBe(true);
  });

  it('MatterRow parses with an orchestrationLanes object', () => {
    const parsed = MatterRowSchema.parse({
      ...BASE_MATTER,
      orchestrationLanes: { claude: true, gpt: false, gemini: true, grok: false },
    });
    expect(parsed.orchestrationLanes).toEqual({ claude: true, gpt: false, gemini: true, grok: false });
  });
});
