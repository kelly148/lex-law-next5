/**
 * TITLE-EXAM-1 (T3) — two-lane exam orchestration: §4b provider-agnostic role bindings, the ported lane
 * instructions, the PB-3 retrieval egress guard, the lane output contract, and the two-lane orchestrator
 * (identical record set; single-lane fallback banner, NC-10). All mocks/fixtures — no live provider call.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolveTitleExamModel, resolveTitleExamRoleKey, resolveReviewerModel } from '../llm/config.js';
import {
  TITLE_EXAM_LANE_A_SYSTEM_PROMPT,
  TITLE_EXAM_LANE_B_SYSTEM_PROMPT,
  buildLaneSystemPrompt,
  buildExamRecordSet,
} from '../titleExam/lanePrompts.js';
import { checkRetrievalQuery, PB3_EGRESS_RULE } from '../titleExam/laneEgressGuard.js';
import { parseTitleExamLaneOutput, TitleExamLaneOutputError } from '../titleExam/laneOutput.js';
import { runTwoLaneExam, type LaneExaminer } from '../titleExam/examOrchestrator.js';

describe('T3 — §4b provider-agnostic role bindings (resolved from config, never a literal)', () => {
  const prev = process.env['TITLE_EXAM_EXAMINER_A_MODEL'];
  afterEach(() => {
    if (prev === undefined) delete process.env['TITLE_EXAM_EXAMINER_A_MODEL'];
    else process.env['TITLE_EXAM_EXAMINER_A_MODEL'] = prev;
  });

  it('default bindings: examiner-A = Claude lane (manual-anchored), examiner-B = GPT lane (research-capable)', () => {
    expect(resolveTitleExamRoleKey('examiner_a')).toBe('claude');
    expect(resolveTitleExamRoleKey('examiner_b')).toBe('gpt');
    expect(resolveTitleExamModel('examiner_a')).toBe(resolveReviewerModel('claude'));
    expect(resolveTitleExamModel('examiner_b')).toBe(resolveReviewerModel('gpt'));
  });

  it('any provider can fill any role by env config alone (no code change)', () => {
    process.env['TITLE_EXAM_EXAMINER_A_MODEL'] = 'gemini';
    expect(resolveTitleExamRoleKey('examiner_a')).toBe('gemini');
    expect(resolveTitleExamModel('examiner_a')).toBe(resolveReviewerModel('gemini'));
  });

  it('an unrecognized override falls back to the default binding (never a hard resolve failure)', () => {
    process.env['TITLE_EXAM_EXAMINER_A_MODEL'] = 'not-a-real-key';
    expect(resolveTitleExamRoleKey('examiner_a')).toBe('claude');
  });
});

describe('T3 — lane instructions carry the load-bearing doctrine', () => {
  it('both lanes: recorded instrument controls over any summary + the escalation five-field format', () => {
    for (const p of [TITLE_EXAM_LANE_A_SYSTEM_PROMPT, TITLE_EXAM_LANE_B_SYSTEM_PROMPT]) {
      expect(p).toContain('RECORDED INSTRUMENT ITSELF CONTROLS');
      expect(p).toContain('five-field format');
      expect(p).toContain('never blend VA');
    }
  });

  it('examiner-A is manual-anchored (no live research); examiner-B carries the PB-3 egress rule', () => {
    expect(TITLE_EXAM_LANE_A_SYSTEM_PROMPT).toContain('MANUAL-ANCHORED');
    expect(TITLE_EXAM_LANE_A_SYSTEM_PROMPT).toContain('do NOT have or use live research');
    expect(TITLE_EXAM_LANE_B_SYSTEM_PROMPT).toContain('RESEARCH-CAPABLE');
    expect(TITLE_EXAM_LANE_B_SYSTEM_PROMPT).toContain('RETRIEVAL EGRESS RULE');
    expect(TITLE_EXAM_LANE_B_SYSTEM_PROMPT).toContain(PB3_EGRESS_RULE);
    // A must NOT carry the research egress rule.
    expect(TITLE_EXAM_LANE_A_SYSTEM_PROMPT).not.toContain('RETRIEVAL EGRESS RULE');
  });

  it('buildLaneSystemPrompt maps the two examiner roles and rejects a non-lane role', () => {
    expect(buildLaneSystemPrompt('examiner_a')).toBe(TITLE_EXAM_LANE_A_SYSTEM_PROMPT);
    expect(buildLaneSystemPrompt('examiner_b')).toBe(TITLE_EXAM_LANE_B_SYSTEM_PROMPT);
    // 'reconciler' is a valid TitleExamRole but not an exam lane — the builder rejects it at runtime.
    expect(() => buildLaneSystemPrompt('reconciler')).toThrow();
  });

  it('the record set labels operator seed facts as unverified hypotheses (NC-7) and carries the incompleteness banner', () => {
    const rec = buildExamRecordSet({
      jurisdiction: 'DC',
      abstractText: 'ABSTRACT BODY',
      seedFacts: [{ sourceMatterId: 'M-123', text: 'prior payoff of the 2004 DOT' }],
      incompletenessBanner: 'INCOMPLETE EXAMINATION — 15 page(s) were not examined.',
    });
    expect(rec).toContain('UNVERIFIED HYPOTHESES');
    expect(rec).toContain('[from matter M-123]');
    expect(rec).toContain('INCOMPLETE EXAMINATION');
    expect(rec).toContain('ABSTRACT BODY');
  });
});

describe('T3 — PB-3 retrieval egress guard (no client identifiers in a research query)', () => {
  it('allows a de-identified legal-proposition query', () => {
    const r = checkRetrievalQuery('DC personal representative deed requirement post-1995 death marketable title');
    expect(r.allowed).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('flags a property address', () => {
    const r = checkRetrievalQuery('title history for 7905 13th Street NW');
    expect(r.allowed).toBe(false);
    expect(r.violations.some((v) => v.kind === 'address')).toBe(true);
  });

  it('flags a case number and an instrument reference', () => {
    expect(checkRetrievalQuery('estate docket 06-0416339 status').allowed).toBe(false);
    expect(checkRetrievalQuery('release of DB 1234 PG 56').violations.some((v) => v.kind === 'instrument_number')).toBe(true);
  });

  it('flags a known party name (and a bare surname) supplied from the matter', () => {
    const r = checkRetrievalQuery('is Marguerite Satterwhite the heir', { partyNames: ['Marguerite Satterwhite'] });
    expect(r.allowed).toBe(false);
    expect(r.violations.some((v) => v.kind === 'party_name')).toBe(true);
    expect(checkRetrievalQuery('what did Satterwhite convey', { partyNames: ['Marguerite Satterwhite'] }).allowed).toBe(false);
  });
});

describe('T3 — lane output contract (fail-loud; empty array valid)', () => {
  it('parses a valid finding array (and strips a code fence)', () => {
    const raw = '```json\n[{"title":"Unreleased 2004 DOT","sourceBasis":"instrument","sendability":"internal_only","classification":"closing_requirement"}]\n```';
    const findings = parseTitleExamLaneOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.sourceBasis).toBe('instrument');
  });

  it('an empty array is valid (a clean lane — affirmative zero)', () => {
    expect(parseTitleExamLaneOutput('[]')).toEqual([]);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseTitleExamLaneOutput('not json at all')).toThrow(TitleExamLaneOutputError);
  });

  it('throws on an out-of-taxonomy source basis', () => {
    const raw = '[{"title":"x","sourceBasis":"rumor","sendability":"internal_only","classification":"closing_requirement"}]';
    expect(() => parseTitleExamLaneOutput(raw)).toThrow(TitleExamLaneOutputError);
  });
});

describe('T3 — two-lane orchestrator (identical record set; NC-10 single-lane fallback)', () => {
  const OK = '[{"title":"finding","sourceBasis":"instrument","sendability":"internal_only","classification":"closing_requirement"}]';

  it('hands a BYTE-IDENTICAL record set to both lanes', async () => {
    const seen: Record<string, string> = {};
    const examiner: LaneExaminer = async ({ role, recordSet }) => {
      seen[role] = recordSet;
      return OK;
    };
    const res = await runTwoLaneExam({ examiner }, { recordSet: 'THE RECORD', models: { examiner_a: 'm-a', examiner_b: 'm-b' } });
    expect(seen['examiner_a']).toBe('THE RECORD');
    expect(seen['examiner_b']).toBe('THE RECORD');
    expect(seen['examiner_a']).toBe(seen['examiner_b']);
    expect(res.laneMode).toBe('two_lane');
    expect(res.laneFailureBanner).toBeNull();
    expect(res.okLaneCount).toBe(2);
    // provenance: each lane records its resolved model
    expect(res.lanes.find((l) => l.role === 'examiner_a')!.modelString).toBe('m-a');
  });

  it('one lane erroring → single-lane mode with a PROMINENT banner (never silent)', async () => {
    const examiner: LaneExaminer = async ({ role }) => {
      if (role === 'examiner_b') throw new Error('provider timeout');
      return OK;
    };
    const res = await runTwoLaneExam({ examiner }, { recordSet: 'R', models: { examiner_a: 'a', examiner_b: 'b' } });
    expect(res.laneMode).toBe('single_lane');
    expect(res.okLaneCount).toBe(1);
    expect(res.laneFailureBanner).toContain('SINGLE-LANE EXAMINATION');
    expect(res.laneFailureBanner).toContain('research-capable (B) lane failed');
    expect(res.laneFailureBanner).toContain('provider timeout');
  });

  it('a lane with malformed output is a lane FAILURE (single-lane banner), never a silent drop', async () => {
    const examiner: LaneExaminer = async ({ role }) => (role === 'examiner_a' ? 'garbage-not-json' : OK);
    const res = await runTwoLaneExam({ examiner }, { recordSet: 'R', models: { examiner_a: 'a', examiner_b: 'b' } });
    expect(res.laneMode).toBe('single_lane');
    expect(res.lanes.find((l) => l.role === 'examiner_a')!.status).toBe('failed');
    expect(res.laneFailureBanner).toContain('manual-anchored (A) lane failed');
  });

  it('both lanes failing surfaces a total-failure banner and zero ok lanes', async () => {
    const examiner: LaneExaminer = async () => {
      throw new Error('down');
    };
    const res = await runTwoLaneExam({ examiner }, { recordSet: 'R', models: { examiner_a: 'a', examiner_b: 'b' } });
    expect(res.okLaneCount).toBe(0);
    expect(res.laneFailureBanner).toContain('EXAMINATION FAILED');
  });
});
