/**
 * EXPRESS-AUTO-REVIEW-LOOP-1 E5 — the BOUNDED ANTI-DRIFT LOOP ORCHESTRATOR tests.
 *
 * E5 ties E1–E4a into the loop: review -> route (adopt Class-A / escalate the rest) -> regenerate -> repeat,
 * bounded to <=2 rounds by default (HARD CAP 3 in code), RE-FEEDING the ORIGINAL materials each pass (anti-
 * drift — never compound on the drifting candidate), and ESCALATING any same-span re-touch (anti-ping-pong via
 * the E2 immutability tracker). E5 is DETERMINISTIC and NO-EGRESS: the reviewer + regenerate dispatch are
 * INJECTED as ports (E6 wires the real egress-backed versions). These tests inject deterministic MOCK ports.
 *
 * Acceptance bar (build spec §E5; E8 §3/§5):
 *  - HARD CAP: a port that always returns a fresh auto-adoptable suggestion STOPS at the cap (<=2 default; never
 *    >3 even if maxRounds=99 is passed — clamp).
 *  - CONVERGENCE: a port that returns nothing on round 2 stops at round 2, converged (efficiency only).
 *  - ANTI-DRIFT: regeneratePort is called with the ORIGINAL materials each round (NOT the prior candidate).
 *  - SAME-SPAN RE-TOUCH: a round-2 suggestion touching a span escalated in round 1 is FORCED to escalate
 *    (immutability), recorded in the ledger.
 *  - The ledger accumulates EVERY decision across rounds; escalations are surfaced; the candidate is NON-FINAL.
 *  - Determinism + NO egress: a fetch-spy asserts zero network calls; the only I/O is the injected mock ports.
 *
 * Mirrors the E1/E2/E3/E4a test style: offsets come from the real E1 SPANS catalog at runtime, so the tests
 * assert E5 behavior (not hand-counted offsets) and break loudly if a recognizer drifts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildProtectedSpans, type ProtectedSpan, type ProtectedSpanLabel } from '../express/protectedSpans.js';
import type { RoutableSuggestion } from '../express/adoptRouter.js';
import {
  runExpressLoop,
  clampRounds,
  HARD_CAP_ROUNDS,
  DEFAULT_MAX_ROUNDS,
  type LoopSuggestion,
  type ReviewPort,
  type RegeneratePort,
  type AdoptedChange,
} from '../express/reviewLoop.js';

// ── synthetic deed fixture (same house form as the E1/E2/E3/E4a suites) ────────────────────────────

const LEGAL =
  'Lot 12, Section 3, CEDAR RUN ESTATES, as the same appears duly dedicated, platted and recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.';

const DEED = [
  'Exempt from recordation tax pursuant to Va. Code § 58.1-811(D), 1950 Code of Virginia, as amended.',
  'File Number: 36-2026-0188\nGrantee\'s Address: 14 Cedar Run Lane, Manassas, VA 20110\nTax I.D. Number: 7298-44-1201\nAssessed Value: $588,400.00\nConsideration: $0.00',
  'DEED OF GIFT',
  'THIS DEED OF GIFT, made this ___ day of ____________, 20___, by and between Marcus T. Ellison and Priya Ellison, husband and wife, (the "Grantors"), and Dylan Ellison, the Grantors\' son, (the "Grantee"),',
  'WITNESSETH:',
  'That for and in consideration of good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantors do hereby grant and convey, with General Warranty and English Covenants of title, unto the said Grantee, in fee simple, as joint tenants with the common law right of survivorship and not as tenants in common, all of the following described real property, together with the improvements thereon and the appurtenances thereunto belonging, located in Prince William County, Commonwealth of Virginia, to wit:',
  LEGAL,
  'For derivation of title see Deed recorded in Deed Book 6011 at Page 244.',
  'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record, to the extent the same lawfully apply.',
  'WITNESS the following signature(s) and seal(s):',
  '_______________________________ (SEAL)\nMarcus T. Ellison',
  'COMMONWEALTH OF VIRGINIA\nCITY/COUNTY OF ____________________, to-wit:',
  'The foregoing instrument was acknowledged before me this ___ day of ____________, 20___, by Marcus T. Ellison and Priya Ellison.',
  'My commission expires: ____________________\n_______________________________\nNotary Public',
  'After recording, return to: Universal Title.',
].join('\n\n');

const SPANS = buildProtectedSpans('deed', DEED);

/** First span carrying `label`; fail loudly if the recognizer regressed. */
function spanFor(label: ProtectedSpanLabel): ProtectedSpan {
  const s = SPANS.find((sp) => sp.label === label);
  if (!s) throw new Error(`fixture/recognizer regression: no protected span located for label "${label}"`);
  return s;
}

/** Build a loop suggestion. Defaults: a non-deletion replacement with no Class-A claim. */
function sug(start: number, end: number, extra: Partial<LoopSuggestion> = {}): LoopSuggestion {
  return { targetStart: start, targetEnd: end, isDeletion: false, ...extra };
}

/**
 * A plain (no protected spans, no defined terms) candidate with a known whitespace-fixable locus. The
 * double-space at index 4..7 ("is  a") is genuine Class-A whitespace_spacing in locus-eligible text, so a
 * suggestion over it auto-adopts. We pin protectedSpans:[] so the locus is provably clean.
 */
const PLAIN = 'This is  a plain working note with no operative legal language in it whatsoever.';
/** A reusable auto-adoptable suggestion over the PLAIN double-space (verified Class-A whitespace fix). */
function plainAdoptSug(): LoopSuggestion {
  return sug(4, 9, { beforeText: ' is  a', afterText: ' is a', claimedClassA: 'whitespace_spacing' });
}

/**
 * A CONTROLLED mixed document for the cross-round tests that need BOTH a protected span (to escalate) AND a
 * clean adopt locus FAR (>12 chars, beyond the E3 near-boundary band) from every span. The dense real DEED has
 * no such gap, so we pin an EXPLICIT synthetic protected-span catalog over a doc we control. The locus gate
 * operates purely on offsets, so an explicit ProtectedSpan[] is exact + deterministic.
 *
 * Layout: a long clean prose head, then a single protected span deep inside, then more clean prose. The
 * clean-adopt locus (a double space at index ADOPT_AT) sits well before the span and well after the band.
 */
const MIXED_HEAD = 'Note paragraph one has a  double space near its start and lots of ordinary words after that. '; // double space at index 23..25
const MIXED_PROTECTED = 'with General Warranty and English Covenants of title'; // the protected payload
const MIXED_TAIL = ' and then some more ordinary closing prose with nothing operative in it at all here.';
const MIXED = MIXED_HEAD + MIXED_PROTECTED + MIXED_TAIL;
const MIXED_SPAN_START = MIXED_HEAD.length;
const MIXED_SPAN_END = MIXED_HEAD.length + MIXED_PROTECTED.length;
/** The explicit synthetic protected-span catalog for MIXED — one warranty_covenant span over the payload. */
const MIXED_SPANS: ProtectedSpan[] = [
  { start: MIXED_SPAN_START, end: MIXED_SPAN_END, label: 'warranty_covenant' },
];
/** The clean adopt locus in MIXED: the "  " double space at index 23..25 (far from the span + band). */
const MIXED_ADOPT_AT = MIXED_HEAD.indexOf('  ');
/** A verified Class-A whitespace adopt over MIXED's clean double-space — far from the protected span. */
function mixedCleanAdopt(): LoopSuggestion {
  return sug(MIXED_ADOPT_AT, MIXED_ADOPT_AT + 2, {
    beforeText: 'a  d',
    afterText: 'a d',
    claimedClassA: 'whitespace_spacing',
  });
}

// ── no-egress guard: a fetch-spy that fails the test if ANY network call is made ──────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

/** Install a fetch spy that throws if called — proving E5 makes no network/egress call (ports are the only I/O). */
function installFetchSpy(): { calls: () => number } {
  let count = 0;
  vi.stubGlobal('fetch', (...args: unknown[]) => {
    count++;
    throw new Error(`E5 must make NO egress call — fetch was invoked with ${JSON.stringify(args).slice(0, 80)}`);
  });
  return { calls: () => count };
}

// ── clampRounds — the absolute hard-cap ceiling ───────────────────────────────────────────────────────

describe('E5 — clampRounds enforces the absolute hard cap (3) and the default (2)', () => {
  it('defaults to 2 when unspecified', () => {
    expect(clampRounds(undefined)).toBe(DEFAULT_MAX_ROUNDS);
    expect(DEFAULT_MAX_ROUNDS).toBe(2);
  });
  it('clamps any larger request down to the hard cap (3) — never higher', () => {
    expect(clampRounds(3)).toBe(3);
    expect(clampRounds(4)).toBe(HARD_CAP_ROUNDS);
    expect(clampRounds(99)).toBe(HARD_CAP_ROUNDS);
    expect(clampRounds(Number.POSITIVE_INFINITY)).toBe(HARD_CAP_ROUNDS);
    expect(HARD_CAP_ROUNDS).toBe(3);
  });
  it('honors a smaller request (1) and degrades a nonsense request to the clamped default', () => {
    expect(clampRounds(1)).toBe(1);
    expect(clampRounds(0)).toBe(DEFAULT_MAX_ROUNDS); // < 1 -> default -> clamp
    expect(clampRounds(-5)).toBe(DEFAULT_MAX_ROUNDS);
    expect(clampRounds(Number.NaN)).toBe(DEFAULT_MAX_ROUNDS);
  });
});

// ── HARD CAP: an always-adoptable reviewer stops at the cap ────────────────────────────────────────────

describe('E5 — HARD CAP: an always-auto-adoptable reviewer stops at the round cap', () => {
  it('default cap: a reviewPort that ALWAYS returns a fresh auto-adoptable suggestion stops at 2 rounds', async () => {
    installFetchSpy();
    const reviewPort: ReviewPort = () => [plainAdoptSug()];
    const regenSpy = vi.fn((): string => PLAIN); // regenerate to the same clean candidate

    const result = await runExpressLoop({
      documentType: 'deed',
      originalText: PLAIN,
      originalMaterials: 'ORIGINAL-MATERIALS',
      protectedSpans: [], // pin a clean locus so the suggestion is provably auto-adoptable
      reviewPort,
      regeneratePort: regenSpy,
      // maxRounds omitted -> default 2
    });

    expect(result.rounds).toBe(2);
    expect(result.hitCap).toBe(true);
    expect(result.converged).toBe(false);
    // regenerate ran once (between round 1 and round 2); after round 2 (the cap) it does NOT regenerate again.
    expect(regenSpy).toHaveBeenCalledTimes(1);
  });

  it('hard cap absolute: maxRounds=99 is clamped to 3 — the loop never exceeds 3 rounds', async () => {
    installFetchSpy();
    const reviewPort: ReviewPort = () => [plainAdoptSug()];
    const regenSpy = vi.fn((): string => PLAIN);

    const result = await runExpressLoop({
      documentType: 'deed',
      originalText: PLAIN,
      originalMaterials: 'ORIGINAL-MATERIALS',
      protectedSpans: [],
      reviewPort,
      regeneratePort: regenSpy,
      maxRounds: 99, // must be clamped to HARD_CAP_ROUNDS = 3
    });

    expect(result.rounds).toBe(3);
    expect(result.rounds).toBeLessThanOrEqual(HARD_CAP_ROUNDS);
    expect(result.hitCap).toBe(true);
    // 3 rounds -> 2 regenerates (after round 1 and round 2); none after the capping round 3.
    expect(regenSpy).toHaveBeenCalledTimes(2);
  });
});

// ── CONVERGENCE: a no-adopt round stops the loop ───────────────────────────────────────────────────────

describe('E5 — CONVERGENCE: a round with no adopt stops the loop (efficiency only)', () => {
  it('reviewPort adopts on round 1, returns nothing on round 2 -> stops at round 2, converged', async () => {
    installFetchSpy();
    let call = 0;
    const reviewPort: ReviewPort = () => {
      call++;
      return call === 1 ? [plainAdoptSug()] : []; // round 1 adopts; round 2 has nothing
    };
    const regenSpy = vi.fn((): string => PLAIN);

    const result = await runExpressLoop({
      documentType: 'deed',
      originalText: PLAIN,
      originalMaterials: 'ORIGINAL-MATERIALS',
      protectedSpans: [],
      reviewPort,
      regeneratePort: regenSpy,
      maxRounds: 3,
    });

    expect(result.rounds).toBe(2);
    expect(result.converged).toBe(true);
    expect(result.hitCap).toBe(false);
    // regenerated once (after the adopting round 1); round 2 produced no adopt -> stop without regenerating.
    expect(regenSpy).toHaveBeenCalledTimes(1);
    // convergence is an efficiency stop, never an approval — the candidate is still NON-FINAL.
    expect(result.isFinal).toBe(false);
  });

  it('an immediate no-adopt round 1 (all escalations) converges at round 1 with no regenerate', async () => {
    installFetchSpy();
    const legal = spanFor('legal_description');
    const reviewPort: ReviewPort = () => [sug(legal.start + 1, legal.start + 4)]; // inside legal desc -> escalate
    const regenSpy = vi.fn((): string => DEED);

    const result = await runExpressLoop({
      documentType: 'deed',
      originalText: DEED,
      originalMaterials: 'ORIGINAL-MATERIALS',
      protectedSpans: SPANS,
      reviewPort,
      regeneratePort: regenSpy,
    });

    expect(result.rounds).toBe(1);
    expect(result.converged).toBe(true);
    expect(regenSpy).not.toHaveBeenCalled();
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]!.route).toBe('escalate');
  });
});

// ── ANTI-DRIFT: regenerate is fed the ORIGINAL materials each round, never the prior candidate ─────────

describe('E5 — ANTI-DRIFT: regeneratePort receives the ORIGINAL materials each round, not the prior candidate', () => {
  it('captures regeneratePort args and proves the ORIGINAL materials are re-fed (never the candidate)', async () => {
    installFetchSpy();
    const ORIGINAL_MATERIALS = 'THE-ORIGINAL-MATERIALS-AND-INSTRUCTION';

    // Each round produces a DIFFERENT candidate so we can prove the prior candidate is NOT what gets fed back.
    const candidates = [PLAIN, PLAIN + ' v2', PLAIN + ' v3'];
    let regen = 0;
    const regenArgs: Array<{ materials: string; adopted: readonly AdoptedChange[] }> = [];
    const regeneratePort: RegeneratePort = (materials, adopted) => {
      regenArgs.push({ materials, adopted: adopted.slice() });
      regen++;
      return candidates[Math.min(regen, candidates.length - 1)]!;
    };
    // always one fresh auto-adoptable suggestion (so the loop runs to the cap and regenerates each round)
    const reviewPort: ReviewPort = () => [plainAdoptSug()];

    const result = await runExpressLoop({
      documentType: 'deed',
      originalText: candidates[0]!,
      originalMaterials: ORIGINAL_MATERIALS,
      protectedSpans: [],
      reviewPort,
      regeneratePort,
      maxRounds: 3,
    });

    // 3 rounds -> 2 regenerates; EVERY regenerate got the ORIGINAL materials verbatim, never a candidate.
    expect(regenArgs).toHaveLength(2);
    for (const a of regenArgs) {
      expect(a.materials).toBe(ORIGINAL_MATERIALS);
      // the materials must NOT be any candidate text (anti-drift: the prior draft is never the regenerate input)
      expect(candidates).not.toContain(a.materials);
    }
    // the cumulative adopted set GROWS across regenerates (round-1 adopt fed to regen #1; rounds 1+2 to regen #2).
    expect(regenArgs[0]!.adopted.length).toBe(1);
    expect(regenArgs[1]!.adopted.length).toBe(2);
    expect(regenArgs[1]!.adopted[0]!.round).toBe(1);
    expect(regenArgs[1]!.adopted[1]!.round).toBe(2);
    expect(result.rounds).toBe(3);
  });
});

// ── SAME-SPAN RE-TOUCH: a span escalated in round 1 is forced to escalate in round 2 ───────────────────

describe('E5 — SAME-SPAN RE-TOUCH: an escalated span is immutable across rounds (anti-laundering)', () => {
  it('round 1 escalates a span; round 2 re-touches it as "style" -> forced escalate, recorded in the ledger', async () => {
    installFetchSpy();
    // Round 1: an edit INSIDE the (synthetic) warranty span -> escalate (records the locus in the tracker),
    // PLUS a clean adopt FAR from the span so round 1 is NOT a convergence stop and the loop proceeds to round 2.
    // Round 2: re-touch the SAME warranty span, now dressed as a Class-A whitespace fix -> MUST still escalate.
    let call = 0;
    const reviewPort: ReviewPort = () => {
      call++;
      if (call === 1) {
        return [
          sug(MIXED_SPAN_START + 1, MIXED_SPAN_START + 5), // operative edit inside the warranty span -> escalate
          mixedCleanAdopt(), // a clean adopt far from the span -> round 1 adopts -> regenerate -> round 2 runs
        ];
      }
      // round 2: the laundering re-touch — same warranty span, disguised as whitespace Class-A.
      return [
        sug(MIXED_SPAN_START + 1, MIXED_SPAN_START + 5, {
          beforeText: 'with',
          afterText: 'with',
          claimedClassA: 'whitespace_spacing',
        }),
      ];
    };
    // regenerate returns the SAME MIXED text so the warranty span offsets are stable across rounds.
    const regenSpy = vi.fn((): string => MIXED);

    const result = await runExpressLoop({
      documentType: 'deed',
      originalText: MIXED,
      originalMaterials: 'ORIGINAL-MATERIALS',
      protectedSpans: MIXED_SPANS,
      reviewPort,
      regeneratePort: regenSpy,
      maxRounds: 2,
    });

    expect(result.rounds).toBe(2);
    const all = result.ledger.entries();
    // round 2's re-touch of the warranty span must be an escalate, immutability-forced.
    const round2 = all.filter((e) => e.round === 2);
    expect(round2).toHaveLength(1);
    expect(round2[0]!.route).toBe('escalate');
    expect(round2[0]!.immutabilityForced).toBe(true);
    // it is surfaced in the risk-ranked escalations.
    expect(result.escalations.some((e) => e.round === 2 && e.immutabilityForced)).toBe(true);
  });
});

// ── LEDGER accumulation + NON-FINAL candidate + redline ────────────────────────────────────────────────

describe('E5 — the ledger accumulates every decision across rounds; the candidate is NON-FINAL', () => {
  it('records every suggestion from every round with per-round ids; returns a non-final candidate + redline', async () => {
    installFetchSpy();
    let call = 0;
    const reviewPort: ReviewPort = () => {
      call++;
      // round 1: one adopt (far from the span) + one escalate (inside the span); round 2: one escalate, no adopt
      // -> converge. A second-round escalate inside the same span is also immutability-forced.
      if (call === 1) {
        return [mixedCleanAdopt(), sug(MIXED_SPAN_START + 1, MIXED_SPAN_START + 3)];
      }
      return [sug(MIXED_SPAN_START + 6, MIXED_SPAN_START + 8)];
    };
    const regeneratePort: RegeneratePort = () => MIXED; // stable text -> stable span offsets

    const result = await runExpressLoop({
      documentType: 'deed',
      originalText: MIXED,
      originalMaterials: 'ORIGINAL-MATERIALS',
      protectedSpans: MIXED_SPANS,
      reviewPort,
      regeneratePort,
      maxRounds: 3,
    });

    // round 1 had 2 decisions, round 2 had 1 (then converged: no adopt in round 2).
    const all = result.ledger.entries();
    expect(all.filter((e) => e.round === 1)).toHaveLength(2);
    expect(all.filter((e) => e.round === 2)).toHaveLength(1);
    // per-round sequential ids from the E4a ledger
    expect(all.filter((e) => e.round === 1).map((e) => e.id)).toEqual(['e1-1', 'e1-2']);
    expect(all.filter((e) => e.round === 2).map((e) => e.id)).toEqual(['e2-1']);

    expect(result.converged).toBe(true);
    expect(result.rounds).toBe(2);

    // escalations are surfaced, risk-ranked (escalations only).
    expect(result.escalations.length).toBeGreaterThanOrEqual(2);
    expect(result.escalations.every((e) => e.route === 'escalate')).toBe(true);

    // the candidate is explicitly NON-FINAL.
    expect(result.isFinal).toBe(false);
    expect(typeof result.candidate).toBe('string');

    // the redline is the cumulative v1->candidate diff via E4a buildRedline (here unchanged: regen returns DEED).
    expect(result.redline.unchanged).toBe(true);
  });

  it('a candidate that drifts produces a non-empty cumulative redline (v1 -> candidate)', async () => {
    installFetchSpy();
    let call = 0;
    const reviewPort: ReviewPort = () => {
      call++;
      return call === 1 ? [plainAdoptSug()] : []; // adopt once then converge
    };
    const DRIFTED = PLAIN + ' WITH A CHANGED TAIL.';
    const regeneratePort: RegeneratePort = () => DRIFTED;

    const result = await runExpressLoop({
      documentType: 'deed',
      originalText: PLAIN,
      originalMaterials: 'ORIGINAL-MATERIALS',
      protectedSpans: [],
      reviewPort,
      regeneratePort,
      maxRounds: 3,
    });

    expect(result.candidate).toBe(DRIFTED);
    expect(result.redline.unchanged).toBe(false);
    // the redline reconstructs the FINAL verbatim from its equal+insert segments (no silent text loss).
    const finalFromRedline = result.redline.segments
      .filter((s) => s.op === 'equal' || s.op === 'insert')
      .map((s) => s.text)
      .join('');
    expect(finalFromRedline).toBe(DRIFTED);
  });
});

// ── DETERMINISM + NO EGRESS ─────────────────────────────────────────────────────────────────────────────

describe('E5 — determinism + no egress', () => {
  it('is deterministic: identical inputs + ports -> byte-identical candidate, rounds, ledger ids, escalations', async () => {
    installFetchSpy();
    const makeReview = (): ReviewPort => {
      let c = 0;
      return () => {
        c++;
        return c === 1 ? [mixedCleanAdopt(), sug(MIXED_SPAN_START + 1, MIXED_SPAN_START + 3)] : [];
      };
    };
    const run = () =>
      runExpressLoop({
        documentType: 'deed',
        originalText: MIXED,
        originalMaterials: 'ORIGINAL-MATERIALS',
        protectedSpans: MIXED_SPANS,
        reviewPort: makeReview(),
        regeneratePort: () => MIXED,
        maxRounds: 3,
      });

    const a = await run();
    const b = await run();
    expect(a.candidate).toBe(b.candidate);
    expect(a.rounds).toBe(b.rounds);
    expect(a.converged).toBe(b.converged);
    expect(a.ledger.entries().map((e) => e.id)).toEqual(b.ledger.entries().map((e) => e.id));
    expect(a.escalations.map((e) => e.id)).toEqual(b.escalations.map((e) => e.id));
  });

  it('makes NO network/egress call — the injected ports are the only I/O (fetch-spy stays at zero)', async () => {
    const spy = installFetchSpy();
    const reviewPort: ReviewPort = () => [plainAdoptSug()];
    const regeneratePort: RegeneratePort = () => PLAIN;

    await runExpressLoop({
      documentType: 'deed',
      originalText: PLAIN,
      originalMaterials: 'ORIGINAL-MATERIALS',
      protectedSpans: [],
      reviewPort,
      regeneratePort,
      maxRounds: 3,
    });

    expect(spy.calls()).toBe(0); // fetch was never invoked
  });

  it('derives protected spans per round from the candidate when none is pinned (no caller catalog needed)', async () => {
    installFetchSpy();
    // No protectedSpans passed -> the loop derives them from the DEED candidate each round; an edit inside the
    // legal description must still escalate (proving the per-round derivation wires the real E1 recognizers).
    const legal = spanFor('legal_description');
    const reviewPort: ReviewPort = () => [sug(legal.start + 1, legal.start + 4)];
    const result = await runExpressLoop({
      documentType: 'deed',
      originalText: DEED,
      originalMaterials: 'ORIGINAL-MATERIALS',
      reviewPort,
      regeneratePort: () => DEED,
    });
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]!.route).toBe('escalate');
  });
});

// type-only sanity: RoutableSuggestion is a supertype of LoopSuggestion (compile check, no runtime cost).
const _typecheck: RoutableSuggestion = sug(0, 1);
void _typecheck;
