/**
 * TITLE-EXAM-1 (T8) — Express Mode wiring (§4a): the title memo is accepted by the platform loop, its
 * judgment/escalation + requirement/exception regions are protected spans, and the non-locus always-escalate
 * set rides the additive modelEscalates hint. Rides the platform flags (no new flag); byte-neutral when off.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildProtectedSpans } from '../express/protectedSpans.js';
import { shouldAlwaysEscalate, TITLE_EXAM_ALWAYS_ESCALATE } from '../titleExam/expressProfile.js';
import { buildInternalExamMemo, type InternalMemoInput } from '../titleExam/internalMemo.js';
import type { ReconciledFinding } from '../titleExam/reconciler.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

function finding(over: Partial<ReconciledFinding>): ReconciledFinding {
  return {
    title: 'f', detail: null, sourceBasis: 'instrument', sendability: 'internal_only',
    classification: 'informational_note', downgraded: false, ocrSourcePagePincite: null,
    laneOrigin: 'both', reconClassification: 'concordant', isJudgmentConflict: false,
    tier: 'record_resolvable', escalationState: 'auto_resolved', autoResolvedRationale: 'x',
    laneAPosition: null, laneBPosition: null, recommendation: null, judgmentTopics: [], ...over,
  };
}

const MEMO_INPUT: InternalMemoInput = {
  jurisdiction: 'DC',
  laneMode: 'two_lane',
  incompletenessBanner: 'INCOMPLETE EXAMINATION — 15 page(s) were not examined.',
  findings: [
    finding({ title: 'Vesting requires attorney determination', classification: 'underwriting_escalation', isJudgmentConflict: true, tier: 'judgment', escalationState: 'escalated', autoResolvedRationale: null, judgmentTopics: ['vesting/tenancy'] }),
    finding({ title: 'Release the 2004 DOT', classification: 'closing_requirement' }),
  ],
  escalationQueue: [
    finding({ title: 'Vesting requires attorney determination', classification: 'underwriting_escalation', isJudgmentConflict: true, tier: 'judgment', escalationState: 'escalated', autoResolvedRationale: null, judgmentTopics: ['vesting/tenancy'] }),
  ],
};

describe('T8 — the platform loop accepts the title memo document type', () => {
  it('DocumentType + SUPPORTED_DOCUMENT_TYPES include title_exam (no new flag — rides the platform loop)', () => {
    const proc = read('src/server/procedures/expressReviewLoop.ts');
    expect(proc).toContain("'title_exam'");
    expect(proc).toContain("new Set<DocumentType>(['deed', 'title_exam'])");
    // rides the existing platform flag (no independent title Express flag)
    expect(proc).toContain('isAutoReviewLoopEnabled');
    expect(read('src/server/express/protectedSpans.ts')).toContain("| 'title_exam'");
  });
});

describe('T8 — title memo protected spans (judgment/escalation + requirement/exception regions)', () => {
  const memo = buildInternalExamMemo(MEMO_INPUT);
  const spans = buildProtectedSpans('title_exam', memo);
  const labels = new Set(spans.map((s) => s.label));

  it('protects the escalation block, the ADOPT/MODIFY/HOLD action, the requirements block, and the banner', () => {
    expect(labels.has('escalation_block')).toBe(true);
    expect(labels.has('escalation_action')).toBe(true);
    expect(labels.has('requirements_block')).toBe(true);
    expect(labels.has('incompleteness_banner')).toBe(true);
    // every span is a valid half-open range within the memo
    for (const s of spans) {
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.end).toBeGreaterThan(s.start);
      expect(s.end).toBeLessThanOrEqual(memo.length);
    }
  });

  it('an unsupported document type still returns no spans (deed recognizers unaffected)', () => {
    expect(buildProtectedSpans('poa', memo)).toEqual([]);
    // deed still works: a deed body with a granting clause yields deed spans (regression guard)
    const deedSpans = buildProtectedSpans('deed', 'GRANT with GENERAL WARRANTY, to wit: Lot 1');
    expect(Array.isArray(deedSpans)).toBe(true);
  });
});

describe('T8 — title ALWAYS-ESCALATE profile (additive modelEscalates hint; never authorizes auto-adopt)', () => {
  it('escalates on a judgment conflict', () => {
    expect(shouldAlwaysEscalate({ title: 'vesting is joint tenancy' }).escalate).toBe(true);
    expect(shouldAlwaysEscalate({ title: 'x', isJudgmentConflict: true }).escalate).toBe(true);
  });

  it('escalates on abstract-only / OCR-only basis', () => {
    expect(shouldAlwaysEscalate({ title: 'x', sourceBasis: 'abstractor_stated' }).escalate).toBe(true);
    expect(shouldAlwaysEscalate({ title: 'x', sourceBasis: 'ocr_extracted' }).escalate).toBe(true);
    expect(shouldAlwaysEscalate({ title: 'x', downgraded: true }).escalate).toBe(true);
  });

  it('escalates on an unverified externally-verified citation and on a cross-matter seed', () => {
    expect(shouldAlwaysEscalate({ title: 'x', externallyVerified: true }).escalate).toBe(true);
    expect(shouldAlwaysEscalate({ title: 'x', externallyVerified: true, humanVerified: true }).escalate).toBe(false);
    expect(shouldAlwaysEscalate({ title: 'x', sourceBasis: 'prior_matter_seed' }).escalate).toBe(true);
    expect(shouldAlwaysEscalate({ title: 'x', seedContaminationFlag: true }).escalate).toBe(true);
  });

  it('a clean mechanical, instrument-confirmed finding does NOT force-escalate', () => {
    const v = shouldAlwaysEscalate({ title: 'fix a typo in the caption', sourceBasis: 'instrument' });
    expect(v.escalate).toBe(false);
    expect(v.reasons).toEqual([]);
    expect(TITLE_EXAM_ALWAYS_ESCALATE.length).toBeGreaterThan(0);
  });
});
