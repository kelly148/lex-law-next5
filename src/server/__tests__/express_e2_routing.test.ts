/**
 * EXPRESS-AUTO-REVIEW-LOOP-1 E2 — adopt/escalate ROUTING + escalation IMMUTABILITY tests.
 *
 * E2 routes each reviewer suggestion to 'auto_adopt' | 'escalate' ON TOP of the E1 locus gate, and guarantees
 * an escalation is IMMUTABLE within the loop. The acceptance bar (build spec §E2; E8 §2/§3):
 *  - A suggestion auto-adopts ONLY via (locus-eligible AND verified Class-A) — never any other path, never a
 *    model "safe" label.
 *  - The Class-A safe harbor is NARROW + CONSERVATIVE: an eligible-but-substantive change still escalates.
 *  - The router NEVER overrides the gate toward adopt — every protected-span / deletion / defined-term case
 *    the gate escalated stays escalated.
 *  - IMMUTABILITY: once a span escalates, the SAME or an OVERLAPPING span presented as Class-A later is STILL
 *    forced to escalate; the immutability set only grows.
 *  - DETERMINISTIC: same input -> same route + byte-identical reason.
 *
 * Span offsets are computed from the fixture at runtime (indexOf) — the tests assert ROUTER behavior, not
 * hand-counted offsets, and break loudly if the fixture or recognizers drift. Mirrors the E1 test style.
 */
import { describe, it, expect } from 'vitest';
import { buildProtectedSpans, type ProtectedSpan, type ProtectedSpanLabel } from '../express/protectedSpans.js';
import {
  routeSuggestion,
  routeWithImmutability,
  classifyClassA,
  createImmutabilityTracker,
  type RoutableSuggestion,
  type RouteContext,
} from '../express/adoptRouter.js';

// ── synthetic deed fixture (same house form as the E1 suite) ─────────────────────────────────────

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
const CTX: RouteContext = { protectedSpans: SPANS, documentText: DEED };

/** First span carrying `label`; fail loudly if the recognizer regressed. */
function spanFor(label: ProtectedSpanLabel): ProtectedSpan {
  const s = SPANS.find((sp) => sp.label === label);
  if (!s) throw new Error(`fixture/recognizer regression: no protected span located for label "${label}"`);
  return s;
}

/** Build a routable suggestion. Defaults: a non-deletion replacement with no Class-A claim. */
function sug(start: number, end: number, extra: Partial<RoutableSuggestion> = {}): RoutableSuggestion {
  return { targetStart: start, targetEnd: end, isDeletion: false, ...extra };
}

// A clean, locus-eligible region: a plain doc with NO protected spans + no defined terms.
const PLAIN = 'This is a plain working note with no operative legal language in it whatsoever.';
const PLAIN_CTX: RouteContext = { protectedSpans: buildProtectedSpans('deed', PLAIN), documentText: PLAIN };

// ── the only auto-adopt path: locus-eligible AND mechanical Class-A ──────────────────────────────

describe('E2 router — a locus-eligible MECHANICAL change AUTO-ADOPTS', () => {
  it('a whitespace-only fix in locus-eligible text -> auto_adopt', () => {
    const r = routeSuggestion(
      sug(5, 7, { beforeText: 'plain  working', afterText: 'plain working', claimedClassA: 'whitespace_spacing' }),
      PLAIN_CTX,
    );
    expect(r.route).toBe('auto_adopt');
    expect(r.classA?.category).toBe('whitespace_spacing');
    expect(r.locus.decision).toBe('auto_adopt_eligible');
  });

  it('an obvious typo fix (one-char) in locus-eligible text -> auto_adopt', () => {
    const r = routeSuggestion(
      sug(5, 7, { beforeText: 'plian', afterText: 'plain', claimedClassA: 'typo_fix' }),
      PLAIN_CTX,
    );
    expect(r.route).toBe('auto_adopt');
    expect(r.classA?.category).toBe('typo_fix');
  });

  it('a punctuation-only fix in locus-eligible text -> auto_adopt', () => {
    const r = routeSuggestion(
      sug(5, 7, { beforeText: 'note,', afterText: 'note.', claimedClassA: 'punctuation' }),
      PLAIN_CTX,
    );
    expect(r.route).toBe('auto_adopt');
    expect(r.classA?.category).toBe('punctuation');
  });

  it('a byte-identical literal-duplicate removal in locus-eligible text -> auto_adopt', () => {
    const r = routeSuggestion(
      sug(5, 7, { beforeText: 'the the note', afterText: 'the note', claimedClassA: 'literal_duplicate_removal' }),
      PLAIN_CTX,
    );
    expect(r.route).toBe('auto_adopt');
    expect(r.classA?.category).toBe('literal_duplicate_removal');
  });
});

// ── eligible-but-substantive still escalates (narrow safe harbor) ────────────────────────────────

describe('E2 router — a locus-eligible but SUBSTANTIVE change ESCALATES (safe harbor is narrow)', () => {
  it('a large content rewrite that lands in eligible text -> escalate (not mechanical)', () => {
    const r = routeSuggestion(
      sug(5, 7, {
        beforeText: 'plain working note',
        afterText: 'binding and enforceable obligation of the parties',
        claimedClassA: 'typo_fix', // claims mechanical, but it is a wholesale rewrite
      }),
      PLAIN_CTX,
    );
    expect(r.route).toBe('escalate');
    expect(r.classA?.isClassA).toBe(false);
    expect(r.locus.decision).toBe('auto_adopt_eligible'); // the LOCUS was clean; E2 still escalated
  });

  it('a suggestion that asserts NO Class-A category -> escalate (conservative default), even in clean locus', () => {
    const r = routeSuggestion(sug(5, 7, { beforeText: 'note', afterText: 'notes' }), PLAIN_CTX);
    expect(r.route).toBe('escalate');
    expect(r.classA?.isClassA).toBe(false);
  });

  it('a NEAR-duplicate removal (not byte-identical) -> escalate (only literal duplicates qualify)', () => {
    const r = routeSuggestion(
      sug(5, 7, {
        beforeText: 'the note the notes', // "note" vs "notes" — NOT byte-identical
        afterText: 'the note',
        claimedClassA: 'literal_duplicate_removal',
      }),
      PLAIN_CTX,
    );
    expect(r.route).toBe('escalate');
    expect(r.classA?.isClassA).toBe(false);
  });

  it('a claimed-whitespace fix that actually changes content -> escalate (claim verified, not trusted)', () => {
    const r = routeSuggestion(
      sug(5, 7, { beforeText: 'plain note', afterText: 'plain  notes', claimedClassA: 'whitespace_spacing' }),
      PLAIN_CTX,
    );
    expect(r.route).toBe('escalate');
    expect(r.classA?.isClassA).toBe(false);
  });
});

// ── the router NEVER overrides the gate toward adopt ─────────────────────────────────────────────

describe('E2 router — a gate-escalated suggestion NEVER routes to auto_adopt', () => {
  for (const label of [
    'legal_description',
    'granting_clause',
    'warranty_covenant',
    'amounts',
    'signature_acknowledgment_notary',
  ] as ProtectedSpanLabel[]) {
    it(`a Class-A-claiming edit INSIDE the ${label} span -> escalate (the gate already escalated; routing never overrides)`, () => {
      const span = spanFor(label);
      const start = span.start + 1;
      const r = routeSuggestion(
        // present it as the most innocent possible edit; the locus still wins
        sug(start, start + 1, { beforeText: 'x', afterText: 'x ', claimedClassA: 'whitespace_spacing', modelSaysSafe: true }),
        CTX,
      );
      expect(r.route).toBe('escalate');
      expect(r.classA).toBeNull(); // classifier is not even consulted once the gate escalated
      expect(r.locus.decision).toBe('escalate');
    });
  }

  it('a DELETION in locus-eligible text -> escalate (deletion rail fired in the gate)', () => {
    const r = routeSuggestion(
      sug(5, 9, { isDeletion: true, beforeText: 'plain', afterText: '', claimedClassA: 'literal_duplicate_removal', modelSaysSafe: true }),
      PLAIN_CTX,
    );
    expect(r.route).toBe('escalate');
    expect(r.locus.isDeletion).toBe(true);
  });

  it('a defined-term edit -> escalate (defined-term rail fired in the gate)', () => {
    const span = spanFor('defined_terms_definitions');
    const r = routeSuggestion(
      sug(span.start + 1, span.start + 3, { beforeText: 'th', afterText: 'th ', claimedClassA: 'whitespace_spacing' }),
      CTX,
    );
    expect(r.route).toBe('escalate');
    expect(r.locus.touchedDefinedTerm).toBe(true);
  });

  it('a model "safe" hint NEVER produces auto_adopt for a protected-span change', () => {
    const span = spanFor('legal_description');
    const r = routeSuggestion(
      sug(span.start + 2, span.start + 5, { beforeText: 'Lot', afterText: 'Lot', modelSaysSafe: true, claimedClassA: 'casing_non_operative' }),
      CTX,
    );
    expect(r.route).toBe('escalate');
  });
});

// ── escalation IMMUTABILITY ──────────────────────────────────────────────────────────────────────

describe('E2 immutability — an escalated locus can NEVER become adoptable later in the loop', () => {
  it('a span escalates on pass 1; the SAME span presented as Class-A on pass 2 is STILL forced to escalate', () => {
    const tracker = createImmutabilityTracker();
    const span = spanFor('warranty_covenant');

    // Pass 1 — a substantive edit lands in the warranty span -> escalate (gate), recorded in the tracker.
    const pass1 = routeWithImmutability(
      sug(span.start + 1, span.start + 6, { beforeText: 'Gener', afterText: 'Speci', claimedClassA: 'typo_fix' }),
      tracker,
      CTX,
    );
    expect(pass1.route).toBe('escalate');
    expect(tracker.escalated.length).toBe(1);

    // Pass 2 — the SAME locus, now dressed as a flawless whitespace fix. Immutability forces escalate.
    const pass2 = routeWithImmutability(
      sug(span.start + 1, span.start + 6, { beforeText: 'x  x', afterText: 'x x', claimedClassA: 'whitespace_spacing' }),
      tracker,
      CTX,
    );
    expect(pass2.route).toBe('escalate');
    expect(pass2.immutabilityForced).toBe(true);
    expect(pass2.classA).toBeNull(); // the classifier is never even consulted on a recorded locus
  });

  it('an OVERLAPPING (not identical) span on pass 2 is also forced to escalate', () => {
    const tracker = createImmutabilityTracker();
    const span = spanFor('granting_clause');

    const pass1 = routeWithImmutability(sug(span.start + 5, span.start + 15, { beforeText: 'a', afterText: 'b', claimedClassA: 'typo_fix' }), tracker, CTX);
    expect(pass1.route).toBe('escalate');

    // overlaps the recorded [start+5, start+15) range
    const pass2 = routeWithImmutability(sug(span.start + 10, span.start + 20, { beforeText: 'c c', afterText: 'c', claimedClassA: 'literal_duplicate_removal' }), tracker, CTX);
    expect(pass2.route).toBe('escalate');
    expect(pass2.immutabilityForced).toBe(true);
  });

  it('the immutability set only GROWS — every escalation is recorded, none is ever removed', () => {
    const tracker = createImmutabilityTracker();
    expect(tracker.escalated.length).toBe(0);

    const ld = spanFor('legal_description');
    routeWithImmutability(sug(ld.start + 1, ld.start + 3, {}), tracker, CTX);
    expect(tracker.escalated.length).toBe(1);

    const amt = spanFor('amounts');
    routeWithImmutability(sug(amt.start + 1, amt.start + 2, {}), tracker, CTX);
    expect(tracker.escalated.length).toBe(2);

    // re-routing a third, distinct escalating locus still only ever grows the set (no removal API exists)
    const sig = spanFor('signature_acknowledgment_notary');
    routeWithImmutability(sug(sig.start + 1, sig.start + 2, {}), tracker, CTX);
    expect(tracker.escalated.length).toBe(3);
  });

  it('a clean locus-eligible escalation is recorded too, so re-proposing it later still escalates', () => {
    const tracker = createImmutabilityTracker();
    // Pass 1: eligible locus, but no proven Class-A -> escalate, recorded.
    const pass1 = routeWithImmutability(sug(5, 7, { beforeText: 'note', afterText: 'notes' }), tracker, PLAIN_CTX);
    expect(pass1.route).toBe('escalate');
    expect(tracker.escalated.length).toBe(1);

    // Pass 2: SAME locus, now a perfect whitespace fix -> STILL escalate (immutability).
    const pass2 = routeWithImmutability(
      sug(5, 7, { beforeText: 'a  a', afterText: 'a a', claimedClassA: 'whitespace_spacing' }),
      tracker,
      PLAIN_CTX,
    );
    expect(pass2.route).toBe('escalate');
    expect(pass2.immutabilityForced).toBe(true);
  });

  it('a DIFFERENT (non-overlapping) clean locus on pass 2 can still auto-adopt — immutability is locus-scoped', () => {
    const tracker = createImmutabilityTracker();
    // escalate locus A
    routeWithImmutability(sug(5, 7, { beforeText: 'note', afterText: 'notes' }), tracker, PLAIN_CTX);
    // a DIFFERENT, non-overlapping locus B with a genuine mechanical fix -> auto_adopt (not blocked by A)
    const r = routeWithImmutability(
      sug(40, 42, { beforeText: 'in  it', afterText: 'in it', claimedClassA: 'whitespace_spacing' }),
      tracker,
      PLAIN_CTX,
    );
    expect(r.route).toBe('auto_adopt');
    expect(r.immutabilityForced).toBe(false);
  });
});

// ── determinism ──────────────────────────────────────────────────────────────────────────────────

describe('E2 router — determinism', () => {
  it('same input -> same route AND byte-identical reason', () => {
    const s = sug(5, 7, { beforeText: 'plian', afterText: 'plain', claimedClassA: 'typo_fix' });
    const a = routeSuggestion(s, PLAIN_CTX);
    const b = routeSuggestion(s, PLAIN_CTX);
    expect(a.route).toBe(b.route);
    expect(a.reason).toBe(b.reason);
    expect(JSON.stringify(a.classA)).toBe(JSON.stringify(b.classA));
  });

  it('the Class-A classifier is deterministic on its own', () => {
    const s = sug(0, 1, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' });
    expect(JSON.stringify(classifyClassA(s))).toBe(JSON.stringify(classifyClassA(s)));
  });
});

// ── the architectural ruling, restated at the routing layer ─────────────────────────────────────

describe('E2 router — auto_adopt is reachable ONLY via (locus-eligible AND verified Class-A)', () => {
  it('locus escalate + Class-A claim -> escalate (locus dominates)', () => {
    const span = spanFor('legal_description');
    const r = routeSuggestion(sug(span.start + 1, span.start + 2, { beforeText: 'L', afterText: 'l', claimedClassA: 'casing_non_operative' }), CTX);
    expect(r.route).toBe('escalate');
  });

  it('locus eligible + NO verified Class-A -> escalate (Class-A required)', () => {
    const r = routeSuggestion(sug(5, 7, { beforeText: 'a', afterText: 'bcdefgh' }), PLAIN_CTX);
    expect(r.route).toBe('escalate');
  });

  it('locus eligible + verified Class-A -> auto_adopt (the one and only adopt path)', () => {
    const r = routeSuggestion(sug(5, 7, { beforeText: 'a  a', afterText: 'a a', claimedClassA: 'whitespace_spacing' }), PLAIN_CTX);
    expect(r.route).toBe('auto_adopt');
  });
});
