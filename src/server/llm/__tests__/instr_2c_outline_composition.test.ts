/**
 * INSTR-2C (Phase C) — outline master composition tests (R1-R6, R8).
 *
 * Exercises the locked spec at the composition chokepoint (resolvePromptComposition) + the outline
 * predicate, with the matter reader (setCompositionReaders) and the conflict gate (setOutlineGateReader)
 * supplied via test seams (no DB; getPromptAsset loads the committed manifest assets):
 *
 *   R1  the ALLOWLIST {draft,regenerate,chat,outline} — every other callRole returns legacy by
 *       construction, under all flag states (reviewer/evaluator/analysis/matrix/extract/format/other).
 *   R2  outline composes lawfirm/te ONLY in the valid capacity x gate cell.
 *   R3  ambiguous / unelected / NULL capacity -> legacy (never the safe-default-to-lawfirm).
 *   R4  title capacity OR a title signal -> legacy (title posture never applied in outline v1).
 *   R5  uncleared / failed gate -> legacy (fail-closed).
 *   R6  the non-suppressible addendum is verbatim + placed as a PRECEDENCE FLOOR (first).
 *   R8  reviewer/evaluator are unreachable under ALL flag states.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolvePromptComposition,
  setCompositionReaders,
  callRoleForJobType,
  MASTER_COMPOSABLE_CALLROLES,
  type PromptCallRole,
} from '../assemblePrompt.js';
import {
  resolveOutlineMaster,
  decideOutlinePreGate,
  finalizeOutlineInjection,
  setOutlineGateReader,
  OUTLINE_ADDENDUM,
  type OutlineGateReader,
} from '../outlineMasterComposition.js';
import { PRIMARY_DRAFTER_MODEL } from '../config.js';
import { getPromptAsset, MASTER_CLAUDE_TE, MASTER_CLAUDE_LAWFIRM, MASTER_CLAUDE_TITLE } from '../promptAssets.js';

const OUTLINE_FLAG = 'MASTER_OUTLINE_ENABLED';
const LAWFIRM_FLAG = 'MASTER_LAWFIRM_ENABLED';
const BLOB_FLAG = 'PROMPT_COMPOSITION_ENABLED';
const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';

// CAPACITY-ELECTION-UX (R3): the representational law_firm seat now also requires an affirmative
// election marker (engagementCapacityElectedAt != null). Elected fixtures carry it; the unelected /
// ambiguous / null-capacity fixtures (which must resolve to legacy) deliberately omit/null it.
type Matter = { engagementCapacity?: string | null; engagementCapacityElectedAt?: Date | string | null; paKey?: string | null; practiceArea?: string | null };
const ELECTED = new Date('2026-06-13T00:00:00Z');
const lawFirm: Matter = { engagementCapacity: 'law_firm', engagementCapacityElectedAt: ELECTED, paKey: null, practiceArea: null };
const te: Matter = { engagementCapacity: 'law_firm', engagementCapacityElectedAt: ELECTED, paKey: 'trusts_estates', practiceArea: null };
const titleElected: Matter = { engagementCapacity: 'title_settlement_agent', engagementCapacityElectedAt: ELECTED, paKey: null, practiceArea: null };
const titleSignal: Matter = { engagementCapacity: 'law_firm', engagementCapacityElectedAt: ELECTED, paKey: 'title_settlement', practiceArea: null };
const ambiguous: Matter = { paKey: 'corporate', practiceArea: null }; // capacity field ABSENT (unelected)
const nullCapacity: Matter = { engagementCapacity: null, paKey: 'corporate', practiceArea: null };
const lawFirmUnelected: Matter = { engagementCapacity: 'law_firm', engagementCapacityElectedAt: null, paKey: null, practiceArea: null }; // law_firm value, NEVER elected

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const f of [OUTLINE_FLAG, LAWFIRM_FLAG, BLOB_FLAG]) {
    saved[f] = process.env[f];
    delete process.env[f];
  }
  setCompositionReaders(null);
  setOutlineGateReader(null);
});
afterEach(() => {
  for (const f of [OUTLINE_FLAG, LAWFIRM_FLAG, BLOB_FLAG]) {
    if (saved[f] === undefined) delete process.env[f];
    else process.env[f] = saved[f]!;
  }
  setCompositionReaders(null);
  setOutlineGateReader(null);
});

function seam(matter: Matter | null, gateAllowed: boolean): { gateCalls: () => number } {
  let gateCalls = 0;
  setCompositionReaders({
    getMatter: async () => matter ?? undefined,
    getDocument: async () => null,
  });
  const reader: OutlineGateReader = () => {
    gateCalls += 1;
    return Promise.resolve({ allowed: gateAllowed });
  };
  setOutlineGateReader(reader);
  return { gateCalls: () => gateCalls };
}

function compose(jobType: string, model = PRIMARY_DRAFTER_MODEL) {
  return resolvePromptComposition({ jobType, modelString: model, matterId: MATTER, documentId: null, userId: USER });
}

// ─────────────────────────────────────────────────────────────────────────────
// R1 — the allowlist firewall
// ─────────────────────────────────────────────────────────────────────────────
describe('INSTR-2C R1 — composition allowlist', () => {
  it('the allowlist is EXACTLY {draft, regenerate, chat, outline} (a deliberate edit is required to change it)', () => {
    expect([...MASTER_COMPOSABLE_CALLROLES].sort()).toEqual(['chat', 'draft', 'outline', 'regenerate']);
  });

  const NON_ALLOWLISTED_JOBTYPES: Array<[string, PromptCallRole]> = [
    ['formatting', 'format'],
    ['data_extraction', 'extract'],
    ['information_request_generation', 'matrix'],
    ['review', 'review'],
    ['reviewer_feedback', 'review'],
    ['evaluator', 'evaluator'],
    ['matter_analysis', 'analysis'],
    ['chat_turn', 'other'],
    ['context_summary_generation', 'other'],
  ];

  it.each(NON_ALLOWLISTED_JOBTYPES)(
    'jobType %s (callRole %s) returns legacy under EVERY flag combination',
    async (jobType, expectedRole) => {
      expect(callRoleForJobType(jobType)).toBe(expectedRole);
      expect(MASTER_COMPOSABLE_CALLROLES.has(expectedRole)).toBe(false);
      const { gateCalls } = seam(lawFirm, true);
      for (const flags of [[], [LAWFIRM_FLAG], [OUTLINE_FLAG], [LAWFIRM_FLAG, OUTLINE_FLAG, BLOB_FLAG]]) {
        for (const f of [OUTLINE_FLAG, LAWFIRM_FLAG, BLOB_FLAG]) delete process.env[f];
        for (const f of flags) process.env[f] = 'true';
        const r = await compose(jobType);
        expect(r.source).toBe('legacy');
        expect(r.layeredMasterText).toBeNull();
        expect(r.systemText).toBeNull();
      }
      expect(gateCalls()).toBe(0); // a non-allowlisted role never reaches the outline gate
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// R2/R3/R4 — capacity x gate matrix + the pure pre-gate predicate
// ─────────────────────────────────────────────────────────────────────────────
describe('INSTR-2C R2/R3/R4 — outline capacity x gate matrix', () => {
  it('R2 [valid cell]: law_firm + gate CLEARED -> composes the representational master (lawfirm)', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    seam(lawFirm, true);
    const r = await compose('outline_generation');
    expect(r.source).toBe(MASTER_CLAUDE_LAWFIRM);
    expect(r.layeredMasterText).toContain(OUTLINE_ADDENDUM);
  });
  it('R2: an exact-match T&E matter -> the te master', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    seam(te, true);
    const r = await compose('outline_generation');
    expect(r.source).toBe(MASTER_CLAUDE_TE);
  });
  it('R2 [gate cell]: law_firm + gate NOT cleared -> legacy', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    seam(lawFirm, false);
    expect((await compose('outline_generation')).source).toBe('legacy');
  });
  it('R3: ambiguous/unelected capacity (undefined) -> legacy (never the lawfirm default)', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    seam(ambiguous, true);
    expect((await compose('outline_generation')).source).toBe('legacy');
  });
  it('R3: NULL capacity -> legacy', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    seam(nullCapacity, true);
    expect((await compose('outline_generation')).source).toBe('legacy');
  });
  it('R3 [CAPACITY-ELECTION-UX residual]: an UNELECTED law_firm matter (NULL marker) + gate CLEARED -> legacy (never the default), ZERO gate reads', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    const { gateCalls } = seam(lawFirmUnelected, true);
    expect((await compose('outline_generation')).source).toBe('legacy');
    expect(gateCalls()).toBe(0); // closed in the pure pre-gate; the conflict gate is never consulted
  });
  it('R4: a title-elected matter -> legacy (title posture never in outline v1)', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    seam(titleElected, true);
    const r = await compose('outline_generation');
    expect(r.source).toBe('legacy');
    expect(r.source).not.toBe(MASTER_CLAUDE_TITLE);
  });
  it('R4: a title SIGNAL on the law_firm seat -> legacy', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    seam(titleSignal, true);
    expect((await compose('outline_generation')).source).toBe('legacy');
  });

  it('pure decideOutlinePreGate: only law_firm + non-title is a candidate; never title; never default', () => {
    expect(decideOutlinePreGate(lawFirm)).toEqual({ candidate: true, source: MASTER_CLAUDE_LAWFIRM });
    expect(decideOutlinePreGate(te)).toEqual({ candidate: true, source: MASTER_CLAUDE_TE });
    expect(decideOutlinePreGate(titleElected).candidate).toBe(false);
    expect(decideOutlinePreGate(titleSignal).candidate).toBe(false);
    expect(decideOutlinePreGate(ambiguous).candidate).toBe(false);
    expect(decideOutlinePreGate(nullCapacity).candidate).toBe(false);
    expect(decideOutlinePreGate(lawFirmUnelected).candidate).toBe(false); // CAPACITY-ELECTION-UX residual
    expect(decideOutlinePreGate(null).candidate).toBe(false);
    // the source is NEVER the title master
    for (const m of [lawFirm, te, titleElected, titleSignal, ambiguous]) {
      const d = decideOutlinePreGate(m);
      if (d.candidate) expect(d.source).not.toBe(MASTER_CLAUDE_TITLE);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R5 — conflict-gate bind (fail-closed)
// ─────────────────────────────────────────────────────────────────────────────
describe('INSTR-2C R5 — conflict-gate bind', () => {
  it('uncleared matter -> zero injection', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    seam(lawFirm, false);
    expect((await compose('outline_generation')).source).toBe('legacy');
  });
  it('a gate-read error is FAIL-CLOSED -> legacy', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    setCompositionReaders({ getMatter: async () => lawFirm, getDocument: async () => null });
    setOutlineGateReader(() => Promise.reject(new Error('gate boom')));
    const d = await resolveOutlineMaster({ matterId: MATTER, userId: USER, matter: lawFirm });
    expect(d.inject).toBe(false);
    expect(d.reason).toBe('gate_not_cleared');
  });
  it('the gate is read for EXACTLY the bound matter, once, only for a candidate', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    const calls: Array<[string, string]> = [];
    setCompositionReaders({ getMatter: async () => lawFirm, getDocument: async () => null });
    setOutlineGateReader((m, u) => {
      calls.push([m, u]);
      return Promise.resolve({ allowed: true });
    });
    await compose('outline_generation');
    expect(calls).toEqual([[MATTER, USER]]);
    // a non-candidate (title) never reads the gate
    calls.length = 0;
    setCompositionReaders({ getMatter: async () => titleElected, getDocument: async () => null });
    await compose('outline_generation');
    expect(calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R6 — non-suppressible addendum as a precedence floor
// ─────────────────────────────────────────────────────────────────────────────
describe('INSTR-2C R6 — addendum precedence floor', () => {
  it('the addendum is the VERBATIM locked spec text', () => {
    expect(OUTLINE_ADDENDUM).toBe(
      'This output is an internal planning scaffold only, intended solely for attorney review, editing, and explicit approval. It is not a client-facing draft, does not constitute legal advice, and must not be sent or exported to any client or third party.',
    );
  });
  it('finalizeOutlineInjection places the addendum FIRST (precedence floor, not append-last), master after', () => {
    const d = finalizeOutlineInjection(MASTER_CLAUDE_LAWFIRM);
    expect(d.inject).toBe(true);
    expect(d.layeredMasterText.startsWith(OUTLINE_ADDENDUM)).toBe(true); // precedence floor: addendum FIRST
    expect(d.layeredMasterText).toContain(getPromptAsset(MASTER_CLAUDE_LAWFIRM).text);
    // and NOT append-last: the master text is not the trailing content after the addendum-only block
    expect(d.layeredMasterText.endsWith(OUTLINE_ADDENDUM)).toBe(false);
  });
  it('a composed outline master carries the addendum verbatim in its layered block', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    seam(lawFirm, true);
    const r = await compose('outline_generation');
    expect(r.layeredMasterText!.startsWith(OUTLINE_ADDENDUM)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R8 — reviewer/evaluator firewall under all flag states
// ─────────────────────────────────────────────────────────────────────────────
describe('INSTR-2C R8 — reviewer/evaluator unreachable under all flag states', () => {
  it.each(['review', 'reviewer_feedback', 'evaluator'])(
    'jobType %s never composes a master, even with the outline + lawfirm flags ON',
    async (jobType) => {
      seam(lawFirm, true);
      process.env[OUTLINE_FLAG] = 'true';
      process.env[LAWFIRM_FLAG] = 'true';
      process.env[BLOB_FLAG] = 'true';
      const r = await compose(jobType);
      expect(r.source).toBe('legacy');
      expect(r.layeredMasterText).toBeNull();
      expect(r.systemText).toBeNull();
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// R7 / blast radius — the outline flag is fully independent of draft/regenerate
// ─────────────────────────────────────────────────────────────────────────────
describe('INSTR-2C R7 — MASTER_OUTLINE_ENABLED never affects draft/regenerate', () => {
  it.each(['draft_generation', 'regeneration'])(
    '%s with ONLY the outline flag on -> legacy, flagEnabled FALSE (no draft-snapshot leak), ZERO reads',
    async (jobType) => {
      process.env[OUTLINE_FLAG] = 'true'; // lawfirm + blob OFF (cleared by beforeEach)
      let matterReads = 0;
      let gateReads = 0;
      setCompositionReaders({
        getMatter: async () => {
          matterReads += 1;
          return lawFirm;
        },
        getDocument: async () => null,
      });
      setOutlineGateReader(() => {
        gateReads += 1;
        return Promise.resolve({ allowed: true });
      });
      const r = await compose(jobType);
      expect(r.source).toBe('legacy');
      // the outline flag must NOT flip a draft job's snapshot flag_enabled (drafting A/B stays clean)
      expect(r.flagEnabled).toBe(false);
      expect(matterReads).toBe(0); // ZERO reads
      expect(gateReads).toBe(0);
    },
  );
});
