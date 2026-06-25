/**
 * EXPRESS-AUTO-REVIEW-LOOP-1 E7a — the ATTORNEY-APPROVAL STRUCTURAL INERTNESS guard tests.
 *
 * E7a is a PURE PREDICATE over the E5/E4a loop result: an Express candidate is NEVER final/sendable, the
 * attorney CANNOT mark it ready while any escalation is unresolved, and recordAttorneyApproval approves ONLY
 * when EVERY escalation carries an explicit attorney decision (adopt|reject) — never a default/implicit OK.
 *
 * Acceptance bar (build spec §E7; E8 §5 line 93 — "no path marks any candidate final/sent/filed/recorded
 * without the post-escalation attorney approval action"):
 *  - An Express candidate is always isFinal:false.
 *  - canApprove is FALSE while unresolved escalations exist (TRUE only when none remain).
 *  - The round-cap-with-pending case surfaces a distinct blocking reason (cap is never an approval signal).
 *  - recordAttorneyApproval approves ONLY on a COMPLETE explicit decision set; a missing decision -> not
 *    approved; a malformed/default value is NOT an implicit approval.
 *  - Determinism: same inputs -> byte-identical result. No persistence / no egress (a fetch-spy proves it).
 *
 * The guard is pure over a real ExpressLoopResult — we run the actual E5 loop with deterministic MOCK ports to
 * produce both an escalation-bearing result and a clean (no-escalation) result, mirroring the E5 test style.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { type ProtectedSpan } from '../express/protectedSpans.js';
import {
  runExpressLoop,
  type ExpressLoopResult,
  type LoopSuggestion,
  type ReviewPort,
  type RegeneratePort,
} from '../express/reviewLoop.js';
import {
  evaluateExpressApproval,
  recordAttorneyApproval,
  type AttorneyDecisions,
} from '../express/approvalGate.js';

// ── fixtures (same house form as the E5 suite) ────────────────────────────────────────────────────────

/** A plain note with a verified Class-A whitespace adopt locus (double space at 4..9) and NO protected spans. */
const PLAIN = 'This is  a plain working note with no operative legal language in it whatsoever.';
function plainAdoptSug(): LoopSuggestion {
  return {
    targetStart: 4,
    targetEnd: 9,
    isDeletion: false,
    beforeText: ' is  a',
    afterText: ' is a',
    claimedClassA: 'whitespace_spacing',
  };
}

/** A controlled doc with ONE protected span so a suggestion over it ESCALATES (produces an escalation). */
const MIXED_HEAD = 'Note paragraph one has a  double space near its start and lots of ordinary words after that. ';
const MIXED_PROTECTED = 'with General Warranty and English Covenants of title';
const MIXED_TAIL = ' and then some more ordinary closing prose with nothing operative in it at all here.';
const MIXED = MIXED_HEAD + MIXED_PROTECTED + MIXED_TAIL;
const MIXED_SPAN_START = MIXED_HEAD.length;
const MIXED_SPAN_END = MIXED_HEAD.length + MIXED_PROTECTED.length;
const MIXED_SPANS: ProtectedSpan[] = [{ start: MIXED_SPAN_START, end: MIXED_SPAN_END, label: 'warranty_covenant' }];
/** A suggestion that lands ON the protected warranty span -> forced to escalate by the E1/E2 locus gate. */
function protectedTouchSug(): LoopSuggestion {
  return {
    targetStart: MIXED_SPAN_START + 5,
    targetEnd: MIXED_SPAN_START + 12,
    isDeletion: false,
    beforeText: 'General',
    afterText: 'Special',
  };
}

// ── no-egress guard ────────────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

function installFetchSpy(): void {
  vi.stubGlobal('fetch', (...args: unknown[]) => {
    throw new Error(`E7a must make NO egress call — fetch was invoked with ${JSON.stringify(args).slice(0, 80)}`);
  });
}

// ── helpers: produce real loop results via the actual E5 loop + deterministic mock ports ────────────────

/** Run the loop on PLAIN with an adopt-only reviewer -> a CLEAN result (no escalations). */
async function cleanResult(): Promise<ExpressLoopResult> {
  const reviewPort: ReviewPort = () => [plainAdoptSug()];
  const regeneratePort: RegeneratePort = () => PLAIN;
  return runExpressLoop({
    documentType: 'deed',
    originalText: PLAIN,
    originalMaterials: PLAIN,
    protectedSpans: [], // pin clean: no protected spans -> the whitespace fix auto-adopts
    reviewPort,
    regeneratePort,
    maxRounds: 1,
  });
}

/** Run the loop on MIXED with a reviewer that touches the protected span -> an ESCALATION-BEARING result. */
async function escalatingResult(): Promise<ExpressLoopResult> {
  const reviewPort: ReviewPort = () => [protectedTouchSug()];
  const regeneratePort: RegeneratePort = () => MIXED;
  return runExpressLoop({
    documentType: 'deed',
    originalText: MIXED,
    originalMaterials: MIXED,
    protectedSpans: MIXED_SPANS,
    reviewPort,
    regeneratePort,
    maxRounds: 1,
  });
}

// ── tests ────────────────────────────────────────────────────────────────────────────────────────────

describe('E7a — an Express candidate is structurally non-final', () => {
  it('the loop result is always isFinal:false, and the guard re-asserts isFinal:false', async () => {
    installFetchSpy();
    const result = await escalatingResult();
    expect(result.isFinal).toBe(false);
    const evald = evaluateExpressApproval(result);
    expect(evald.isFinal).toBe(false);
  });
});

describe('E7a — canApprove is FALSE while unresolved escalations exist', () => {
  it('an escalation-bearing result cannot be approved; the escalation is surfaced risk-ranked', async () => {
    installFetchSpy();
    const result = await escalatingResult();
    expect(result.escalations.length).toBeGreaterThan(0);

    const evald = evaluateExpressApproval(result);
    expect(evald.canApprove).toBe(false);
    expect(evald.unresolvedEscalations).toHaveLength(result.escalations.length);
    // The unresolved set IS the loop's risk-ranked escalation set.
    expect(evald.unresolvedEscalations.map((e) => e.id)).toEqual(result.escalations.map((e) => e.id));
    expect(evald.blockingReasons.length).toBeGreaterThan(0);
    expect(evald.blockingReasons.join(' ')).toMatch(/explicit attorney decision/i);
  });

  it('a CLEAN result (no escalations) is structurally approvable (canApprove true, no blocking reasons)', async () => {
    installFetchSpy();
    const result = await cleanResult();
    expect(result.escalations).toHaveLength(0);

    const evald = evaluateExpressApproval(result);
    expect(evald.canApprove).toBe(true);
    expect(evald.unresolvedEscalations).toHaveLength(0);
    expect(evald.blockingReasons).toHaveLength(0);
    // still never final
    expect(evald.isFinal).toBe(false);
  });

  it('round-cap WITH pending escalations surfaces a distinct blocking reason (cap is never approval)', async () => {
    installFetchSpy();
    // Force the loop to hit the cap by always adopting (so it never converges) while ALSO escalating the
    // protected touch. The reviewer returns BOTH a clean far adopt and a protected-span touch each round.
    const MIXED_ADOPT_AT = MIXED_HEAD.indexOf('  ');
    const cleanAdopt: LoopSuggestion = {
      targetStart: MIXED_ADOPT_AT,
      targetEnd: MIXED_ADOPT_AT + 2,
      isDeletion: false,
      beforeText: 'a  d',
      afterText: 'a d',
      claimedClassA: 'whitespace_spacing',
    };
    const reviewPort: ReviewPort = () => [cleanAdopt, protectedTouchSug()];
    const regeneratePort: RegeneratePort = () => MIXED;
    const result = await runExpressLoop({
      documentType: 'deed',
      originalText: MIXED,
      originalMaterials: MIXED,
      protectedSpans: MIXED_SPANS,
      reviewPort,
      regeneratePort,
      maxRounds: 2,
    });
    expect(result.hitCap).toBe(true);
    expect(result.escalations.length).toBeGreaterThan(0);

    const evald = evaluateExpressApproval(result);
    expect(evald.canApprove).toBe(false);
    expect(evald.blockingReasons.join(' ')).toMatch(/round cap/i);
  });
});

describe('E7a — recordAttorneyApproval requires a COMPLETE explicit decision set (no implicit approval)', () => {
  it('approves ONLY when EVERY escalation has an explicit adopt/reject', async () => {
    installFetchSpy();
    const result = await escalatingResult();
    const ids = result.escalations.map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);

    const decisions: AttorneyDecisions = Object.fromEntries(ids.map((id) => [id, 'adopt' as const]));
    const out = recordAttorneyApproval(result, decisions);
    expect(out.approved).toBe(true);
    expect(out.undispositionedEscalationIds).toHaveLength(0);
  });

  it('a MISSING decision for any escalation -> NOT approved (the un-dispositioned id is reported)', async () => {
    installFetchSpy();
    const result = await escalatingResult();
    const ids = result.escalations.map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);

    // Disposition all BUT the first escalation -> incomplete -> not approved.
    const partial: AttorneyDecisions = Object.fromEntries(ids.slice(1).map((id) => [id, 'reject' as const]));
    const out = recordAttorneyApproval(result, partial);
    expect(out.approved).toBe(false);
    expect(out.undispositionedEscalationIds).toContain(ids[0]);
    expect(out.reason).toMatch(/explicit attorney decision/i);
  });

  it('an EMPTY decision set over escalations is NOT an implicit approval', async () => {
    installFetchSpy();
    const result = await escalatingResult();
    expect(result.escalations.length).toBeGreaterThan(0);

    const out = recordAttorneyApproval(result, {});
    expect(out.approved).toBe(false);
    expect(out.undispositionedEscalationIds).toEqual(result.escalations.map((e) => e.id));
  });

  it('a MALFORMED decision value is treated as no decision (never an implicit approval)', async () => {
    installFetchSpy();
    const result = await escalatingResult();
    const ids = result.escalations.map((e) => e.id);

    // A garbage value for the escalation must NOT count as adopt/reject.
    const malformed = { [ids[0]!]: 'maybe' } as unknown as AttorneyDecisions;
    const out = recordAttorneyApproval(result, malformed);
    expect(out.approved).toBe(false);
    expect(out.undispositionedEscalationIds).toContain(ids[0]);
  });

  it('a clean result (no escalations) approves — there is nothing left to disposition', async () => {
    installFetchSpy();
    const result = await cleanResult();
    expect(result.escalations).toHaveLength(0);
    const out = recordAttorneyApproval(result, {});
    expect(out.approved).toBe(true);
    expect(out.undispositionedEscalationIds).toHaveLength(0);
  });
});

describe('E7a — determinism', () => {
  it('evaluateExpressApproval + recordAttorneyApproval are byte-identical across repeated calls', async () => {
    installFetchSpy();
    const result = await escalatingResult();
    const ids = result.escalations.map((e) => e.id);
    const decisions: AttorneyDecisions = Object.fromEntries(ids.map((id) => [id, 'reject' as const]));

    const e1 = evaluateExpressApproval(result);
    const e2 = evaluateExpressApproval(result);
    expect(JSON.stringify(e1)).toBe(JSON.stringify(e2));

    const a1 = recordAttorneyApproval(result, decisions);
    const a2 = recordAttorneyApproval(result, decisions);
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
  });
});
