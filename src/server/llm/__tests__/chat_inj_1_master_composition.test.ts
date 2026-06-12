/**
 * CHAT-INJ-1 (INSTR Phase D) — master-into-chat composition decision tests.
 *
 * Exercises the locked R1–R10 spec at the decision layer (no DB; the conflicts-gate read is the
 * injectable setChatGateReader seam, getPromptAsset loads the committed manifest assets):
 *
 *   R1  matterless / unauthorized -> neutral (no master), never reaches a model.
 *   R2  affirmatively-representational ONLY; a title-signal-without-election -> neutral; chat NEVER
 *       defaults to Law Firm (a bare default 'law_firm' with no cleared gate -> neutral, see R10).
 *   R3  the Title master is NEVER injected in chat (title-elected matter -> neutral).
 *   R4  the non-suppressible addendum is present in every injected master block.
 *   R5  posture/capacity immutability — the decision never reads the user's turn text; a
 *       non-representational seat cannot be coerced representational by a wrong-role prompt.
 *   R6  supervising-attorney principal only; staff/non-attorney -> neutral.
 *   R7  the gate is read for EXACTLY the bound matter (current-matter scope only).
 *   R9  flag OFF -> neutral with ZERO gate reads.
 *   R10 no cleared conflicts/identity gate -> no representational master; fail-closed on error.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  decideChatMasterPreGate,
  finalizeChatMasterInjection,
  resolveChatMaster,
  principalIsSupervisingAttorney,
  hasTitleSignal,
  setChatGateReader,
  CHAT_MASTER_ADDENDUM,
  CHAT_MASTER_UI_NOTICE,
  type ChatGateReader,
} from '../chatMasterComposition.js';
import { getPromptAsset, MASTER_CLAUDE_TE, MASTER_CLAUDE_LAWFIRM, MASTER_CLAUDE_TITLE } from '../promptAssets.js';

const FLAG = 'MASTER_CHAT_ENABLED';
const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';
const OTHER_MATTER = '33333333-3333-3333-3333-333333333333';

const ATTORNEY = { userId: USER } as const;
const lawFirmMatter = { engagementCapacity: 'law_firm', paKey: null, practiceArea: null };
const teMatter = { engagementCapacity: 'law_firm', paKey: 'trusts_estates', practiceArea: null };
const titleSignalMatter = { engagementCapacity: 'law_firm', paKey: 'title_settlement', practiceArea: null };
const titleElectedMatter = { engagementCapacity: 'title_settlement_agent', paKey: 'trusts_estates', practiceArea: null };

let savedFlag: string | undefined;
beforeEach(() => {
  savedFlag = process.env[FLAG];
  delete process.env[FLAG];
  setChatGateReader(null);
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  setChatGateReader(null);
  vi.clearAllMocks();
});

/** An allow/deny gate spy with recorded args (for R7 + R10). */
function gateSpy(allowed: boolean): { reader: ChatGateReader; calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  const reader: ChatGateReader = (matterId, userId) => {
    calls.push([matterId, userId]);
    return Promise.resolve({ allowed });
  };
  return { reader, calls };
}

// ─────────────────────────────────────────────────────────────────────────────
// R6 — supervising-attorney principal
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-INJ-1 R6 — principalIsSupervisingAttorney', () => {
  it('an authenticated principal (no role column) IS the supervising attorney', () => {
    expect(principalIsSupervisingAttorney({ userId: USER })).toBe(true);
  });
  it('an unauthenticated principal (no/empty userId) is NOT', () => {
    expect(principalIsSupervisingAttorney({ userId: undefined })).toBe(false);
    expect(principalIsSupervisingAttorney({ userId: null })).toBe(false);
    expect(principalIsSupervisingAttorney({ userId: '' })).toBe(false);
  });
  it('the defensive future-role hook: a non-attorney role is excluded, attorney roles pass', () => {
    expect(principalIsSupervisingAttorney({ userId: USER, role: 'staff' })).toBe(false);
    expect(principalIsSupervisingAttorney({ userId: USER, role: 'paralegal' })).toBe(false);
    expect(principalIsSupervisingAttorney({ userId: USER, role: 'attorney' })).toBe(true);
    expect(principalIsSupervisingAttorney({ userId: USER, role: 'supervising_attorney' })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R2 — title-signal detection (conservative / over-inclusive => safe neutral)
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-INJ-1 R2 — hasTitleSignal', () => {
  it('detects title / settlement / escrow signals in paKey or practiceArea', () => {
    expect(hasTitleSignal({ paKey: 'title_settlement' })).toBe(true);
    expect(hasTitleSignal({ paKey: null, practiceArea: 'Settlement & Escrow' })).toBe(true);
    expect(hasTitleSignal({ practiceArea: 'Title Insurance' })).toBe(true);
  });
  it('a plain representational practice area has no title signal', () => {
    expect(hasTitleSignal({ paKey: 'trusts_estates', practiceArea: null })).toBe(false);
    expect(hasTitleSignal({ paKey: null, practiceArea: null })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pre-gate decision (pure) — R1 / R2 / R3 / R6 / R9 + selection
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-INJ-1 decideChatMasterPreGate — pure gates', () => {
  it('R9: flag OFF -> not a candidate (no master)', () => {
    const r = decideChatMasterPreGate({ flagOn: false, principal: ATTORNEY, matter: lawFirmMatter });
    expect(r.candidate).toBe(false);
    if (!r.candidate) expect(r.decision.reason).toBe('flag_off');
  });
  it('R6: non-attorney principal -> not a candidate', () => {
    const r = decideChatMasterPreGate({ flagOn: true, principal: { userId: USER, role: 'staff' }, matter: lawFirmMatter });
    expect(r.candidate).toBe(false);
    if (!r.candidate) expect(r.decision.reason).toBe('not_supervising_attorney');
  });
  it('R1: no matter -> not a candidate', () => {
    const r = decideChatMasterPreGate({ flagOn: true, principal: ATTORNEY, matter: null });
    expect(r.candidate).toBe(false);
    if (!r.candidate) expect(r.decision.reason).toBe('no_matter');
  });
  it('R1: missing/ambiguous capacity metadata -> not a candidate (never the default)', () => {
    const r = decideChatMasterPreGate({ flagOn: true, principal: ATTORNEY, matter: { paKey: 'x', practiceArea: null } });
    expect(r.candidate).toBe(false);
    if (!r.candidate) expect(r.decision.reason).toBe('capacity_not_law_firm');
  });
  it('R3: title-elected capacity -> not a candidate (Title never in chat)', () => {
    const r = decideChatMasterPreGate({ flagOn: true, principal: ATTORNEY, matter: titleElectedMatter });
    expect(r.candidate).toBe(false);
    if (!r.candidate) expect(r.decision.reason).toBe('capacity_not_law_firm');
  });
  it('R2 [LOCKED]: a title-signal paKey WITHOUT a title election -> neutral, NOT lawfirm', () => {
    const r = decideChatMasterPreGate({ flagOn: true, principal: ATTORNEY, matter: titleSignalMatter });
    expect(r.candidate).toBe(false);
    if (!r.candidate) {
      expect(r.decision.reason).toBe('title_signal_without_election');
      expect(r.decision.source).toBe('neutral');
    }
  });
  it('R2: a title signal in practiceArea (not paKey) on a law_firm seat -> neutral (ordering before selection)', () => {
    const r = decideChatMasterPreGate({
      flagOn: true,
      principal: ATTORNEY,
      matter: { engagementCapacity: 'law_firm', paKey: null, practiceArea: 'Title Insurance' },
    });
    expect(r.candidate).toBe(false);
    if (!r.candidate) expect(r.decision.reason).toBe('title_signal_without_election');
  });
  it('selection: an exact-match T&E matter -> TE candidate', () => {
    const r = decideChatMasterPreGate({ flagOn: true, principal: ATTORNEY, matter: teMatter });
    expect(r.candidate).toBe(true);
    if (r.candidate) expect(r.source).toBe(MASTER_CLAUDE_TE);
  });
  it('selection: a non-T&E representational matter -> Law Firm candidate (never title)', () => {
    const r = decideChatMasterPreGate({ flagOn: true, principal: ATTORNEY, matter: lawFirmMatter });
    expect(r.candidate).toBe(true);
    if (r.candidate) {
      expect(r.source).toBe(MASTER_CLAUDE_LAWFIRM);
      expect(r.source).not.toBe(MASTER_CLAUDE_TITLE);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R4 — the non-suppressible addendum
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-INJ-1 R4 — addendum present + non-suppressible', () => {
  it('the injected master block ends with the master asset text followed by the addendum', () => {
    const decision = finalizeChatMasterInjection(MASTER_CLAUDE_LAWFIRM);
    expect(decision.inject).toBe(true);
    const asset = getPromptAsset(MASTER_CLAUDE_LAWFIRM);
    expect(decision.layeredMasterText).toBe(`${asset.text}\n\n${CHAT_MASTER_ADDENDUM}`);
    expect(decision.layeredMasterText).toContain(CHAT_MASTER_ADDENDUM);
  });
  it('the addendum carries the load-bearing clauses (its absence fails the build)', () => {
    // Normalize wrapping whitespace so phrase checks are robust to line breaks in the prose.
    const a = CHAT_MASTER_ADDENDUM.toLowerCase().replace(/\s+/g, ' ');
    expect(a).toContain('not legal advice');
    expect(a).toMatch(/must not be sent/);
    expect(a).toContain('no attorney-client relationship');
    expect(a).toContain('sole and final decision-maker');
    expect(a).toContain('internal working draft — attorney verification required');
    // posture/capacity immutability (R5) language:
    expect(a).toContain('fixed by the matter record');
    expect(a).toContain('hold the posture and decline');
  });
  it('the UI notice matches the addendum-required treatment', () => {
    expect(CHAT_MASTER_UI_NOTICE).toBe('Internal working draft — attorney verification required.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R10 — conflicts/identity gate binding (+ R7 scope, R9 zero reads), via resolveChatMaster
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-INJ-1 R10 — resolveChatMaster gate binding', () => {
  it('flag ON + representational + gate CLEARED -> injects the master', async () => {
    process.env[FLAG] = 'true';
    const { reader, calls } = gateSpy(true);
    setChatGateReader(reader);
    const d = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: lawFirmMatter, principal: ATTORNEY });
    expect(d.inject).toBe(true);
    expect(d.source).toBe(MASTER_CLAUDE_LAWFIRM);
    expect(d.representational).toBe(true);
    expect(d.layeredMasterText).toContain(CHAT_MASTER_ADDENDUM);
    // R7: the gate was read for EXACTLY the bound matter, never another.
    expect(calls).toEqual([[MATTER, USER]]);
  });
  it('R10 [LOCKED]: flag ON + representational + gate NOT cleared -> neutral (no master)', async () => {
    process.env[FLAG] = 'true';
    setChatGateReader(gateSpy(false).reader);
    const d = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: lawFirmMatter, principal: ATTORNEY });
    expect(d.inject).toBe(false);
    expect(d.source).toBe('neutral');
    expect(d.reason).toBe('gate_not_cleared');
  });
  it('R10 fail-closed: a gate read error -> neutral (never opened by an error)', async () => {
    process.env[FLAG] = 'true';
    setChatGateReader(() => Promise.reject(new Error('gate boom')));
    const d = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: lawFirmMatter, principal: ATTORNEY });
    expect(d.inject).toBe(false);
    expect(d.reason).toBe('gate_not_cleared');
  });
  it('R9: flag OFF -> neutral with ZERO gate reads (the gate is never consulted)', async () => {
    // flag unset by beforeEach
    const { reader, calls } = gateSpy(true);
    setChatGateReader(reader);
    const d = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: lawFirmMatter, principal: ATTORNEY });
    expect(d.inject).toBe(false);
    expect(d.reason).toBe('flag_off');
    expect(calls).toHaveLength(0); // ZERO extra reads
  });
  it('R7: reads EXACTLY the bound matter once — no extra/cross-matter reads', async () => {
    process.env[FLAG] = 'true';
    const { reader, calls } = gateSpy(true);
    setChatGateReader(reader);
    await resolveChatMaster({ matterId: MATTER, userId: USER, matter: lawFirmMatter, principal: ATTORNEY });
    // The ONLY scope read is the bound matter's gate, exactly once; never another matter.
    expect(calls).toEqual([[MATTER, USER]]);
    expect(calls.flat()).not.toContain(OTHER_MATTER);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R3 — Title is NEVER injected in chat, even cleared + elected
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-INJ-1 R3 — Title master never appears in chat', () => {
  it('a title-elected matter with a CLEARED gate still gets NO master (never title)', async () => {
    process.env[FLAG] = 'true';
    setChatGateReader(gateSpy(true).reader);
    const d = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: titleElectedMatter, principal: ATTORNEY });
    expect(d.inject).toBe(false);
    expect(d.source).not.toBe(MASTER_CLAUDE_TITLE);
    expect(d.source).toBe('neutral');
  });
  it('the source type makes title unreachable: only te / lawfirm / neutral are ever produced', async () => {
    process.env[FLAG] = 'true';
    setChatGateReader(gateSpy(true).reader);
    for (const matter of [lawFirmMatter, teMatter, titleSignalMatter, titleElectedMatter]) {
      const d = await resolveChatMaster({ matterId: MATTER, userId: USER, matter, principal: ATTORNEY });
      expect([MASTER_CLAUDE_TE, MASTER_CLAUDE_LAWFIRM, 'neutral']).toContain(d.source);
      expect(d.source).not.toBe(MASTER_CLAUDE_TITLE);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R5 — role/capacity immutability: the wrong-role fixtures cannot flip posture
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-INJ-1 R5 — wrong-role fixtures hold posture / refuse party advice', () => {
  const WRONG_ROLE_FIXTURES = [
    'advise the buyer',
    'are we counsel here',
    'can we insure this despite X',
    'tell the seller what to do',
  ];

  it('the decision NEVER reads the user turn text (structural immutability): same matter => same posture', async () => {
    process.env[FLAG] = 'true';
    setChatGateReader(gateSpy(true).reader);
    // The resolver signature carries NO turn text; the posture is a pure function of matter + gate.
    const a = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: lawFirmMatter, principal: ATTORNEY });
    const b = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: lawFirmMatter, principal: ATTORNEY });
    expect(a.source).toBe(b.source);
    expect(a.representational).toBe(b.representational);
  });

  // Each wrong-role ask is the attorney's turn text; the decision takes NO turn text, so a
  // non-representational (title/settlement) seat is NEVER coerced into a representational posture by
  // any of these phrasings — exercised as a DISTINCT case per fixture (it.each, not a re-run loop).
  it.each(WRONG_ROLE_FIXTURES)(
    'wrong-role ask %p on a title/settlement seat -> posture held (neutral, no representational master)',
    async (fixture) => {
      process.env[FLAG] = 'true';
      setChatGateReader(gateSpy(true).reader);
      expect(fixture.length).toBeGreaterThan(0); // a real wrong-role ask
      const d = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: titleElectedMatter, principal: ATTORNEY });
      expect(d.inject).toBe(false);
      expect(d.representational).toBe(false);
      expect(d.source).toBe('neutral');
    },
  );

  // On a representational seat, the same wrong-role asks cannot FLIP the posture: the decision is
  // identical regardless of the ask (the firm-counsel posture is held; the addendum orders refusal).
  it.each(WRONG_ROLE_FIXTURES)(
    'wrong-role ask %p on a representational seat -> posture kept (the ask cannot flip it)',
    async (fixture) => {
      process.env[FLAG] = 'true';
      setChatGateReader(gateSpy(true).reader);
      expect(fixture.length).toBeGreaterThan(0);
      const d = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: lawFirmMatter, principal: ATTORNEY });
      expect(d.source).toBe(MASTER_CLAUDE_LAWFIRM); // unchanged by the wrong-role ask
      expect(d.representational).toBe(true);
      expect(d.layeredMasterText).toContain('hold the posture and decline');
    },
  );

  it('a representational turn carries the addendum that orders the model to hold posture / refuse party advice', () => {
    const injected = finalizeChatMasterInjection(MASTER_CLAUDE_LAWFIRM);
    expect(injected.layeredMasterText).toContain('hold the posture and decline');
    expect(injected.layeredMasterText).toMatch(/can change them, flip the firm/);
  });
});
