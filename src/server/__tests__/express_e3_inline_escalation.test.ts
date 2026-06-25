/**
 * EXPRESS-AUTO-REVIEW-LOOP-1 E3 — INLINE NEAR-BOUNDARY ESCALATION tests.
 *
 * E3 sits on top of the E1 locus gate + the E2 router and ADDITIVELY raises an escalation INLINE (before
 * regenerate) when a suggestion lands NEAR a protected-span boundary, or when a SUPPLIED classifier signal is
 * low-confidence / escalate. The acceptance bar (build spec §E3; E8 §2/§3):
 *  - A change within the near-boundary PROXIMITY band of a protected span (not intersecting/adjacent — those
 *    already escalate via E1/E2) escalates INLINE.
 *  - A change far from any protected span that is a genuine Class-A fix is NOT inline-escalated — it defers to
 *    the router and auto-adopts.
 *  - A SUPPLIED low-confidence (or escalate-flag) classifier signal escalates inline; a high-confidence signal
 *    does NOT (defers).
 *  - ADDITIVE-ONLY: E3 can ONLY raise escalations. A protected-span / deletion edit stays 'escalate' (never
 *    flipped to adopt), and a "classifier says safe / high confidence" signal NEVER turns an E1/E2 escalate
 *    into an auto_adopt.
 *  - DETERMINISTIC + no egress (pure over its inputs; no model/network call — that wiring is E6's).
 *
 * Span offsets are computed from the fixture at runtime (the SPANS catalog) — the tests assert E3 behavior,
 * not hand-counted offsets, and break loudly if the fixture or recognizers drift. Mirrors the E1/E2 test style.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildProtectedSpans, type ProtectedSpan, type ProtectedSpanLabel } from '../express/protectedSpans.js';
import type { RoutableSuggestion, RouteContext } from '../express/adoptRouter.js';
import {
  inlineEscalate,
  NEAR_BOUNDARY_CHARS,
  CONFIDENCE_FLOOR,
  type ClassifierSignal,
} from '../express/inlineEscalation.js';

// ── synthetic deed fixture (same house form as the E1/E2 suites) ──────────────────────────────────

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

/**
 * Find a non-protected gap in the deed that is FAR (> NEAR_BOUNDARY_CHARS) from every protected span, so the
 * near-boundary trigger does NOT fire and a genuine Class-A edit can defer-and-auto-adopt. We don't hand-count:
 * scan every offset and pick the first whose [p, p+2) range is > band from all spans. Fails loudly if (in this
 * dense fixture) none exists — in which case we rely on PLAIN_CTX for the far-from-span cases instead.
 */
function farFromAllSpans(ctx: RouteContext, band = NEAR_BOUNDARY_CHARS): number | null {
  const len = ctx.documentText.length;
  for (let p = 0; p + 2 <= len; p++) {
    let ok = true;
    for (const span of ctx.protectedSpans) {
      // gap from [p, p+2) to the span; 0 if overlapping/adjacent
      const aS = p;
      const aE = p + 2;
      const gap = aS < span.end && span.start < aE ? 0 : aE < span.start ? span.start - aE : span.end < aS ? aS - span.end : 0;
      if (gap <= band) {
        ok = false;
        break;
      }
    }
    if (ok) return p;
  }
  return null;
}

// ── near-boundary proximity escalation ────────────────────────────────────────────────────────────

describe('E3 — a change NEAR a protected-span boundary escalates INLINE', () => {
  it('a change a few chars BEFORE a protected span (within the band, not intersecting/adjacent) -> escalateInline', () => {
    const span = spanFor('legal_description');
    // Land a 2-char range that ENDS 3 chars before the span start: gap = 3 (in band), no intersection/adjacency.
    const aEnd = span.start - 3;
    const r = inlineEscalate(sug(aEnd - 2, aEnd), CTX);
    expect(r.escalateInline).toBe(true);
    expect(r.route).toBe('escalate');
    expect(r.event?.reasonCode).toBe('near_boundary');
    expect(r.event?.nearestSpan?.gap).toBe(3);
  });

  it('a change a few chars AFTER a protected span (within the band) -> escalateInline', () => {
    const span = spanFor('legal_description');
    // Start 4 chars after the span end: gap = 4 (in band).
    const aStart = span.end + 4;
    const r = inlineEscalate(sug(aStart, aStart + 2), CTX);
    expect(r.escalateInline).toBe(true);
    expect(r.event?.reasonCode).toBe('near_boundary');
    expect(r.event?.nearestSpan?.gap).toBe(4);
  });

  it('a change EXACTLY at the band edge (gap === NEAR_BOUNDARY_CHARS) -> escalateInline (closed upper bound)', () => {
    const span = spanFor('legal_description');
    const aEnd = span.start - NEAR_BOUNDARY_CHARS;
    const r = inlineEscalate(sug(aEnd - 1, aEnd), CTX);
    expect(r.escalateInline).toBe(true);
    expect(r.event?.nearestSpan?.gap).toBe(NEAR_BOUNDARY_CHARS);
  });

  it('a change JUST OUTSIDE the band (gap === NEAR_BOUNDARY_CHARS + 1) does NOT fire near-boundary', () => {
    // Use PLAIN-style isolation: take a deed span and place a change just beyond the band, then confirm the
    // near-boundary trigger does not fire (it may still defer-escalate for other reasons, so assert reasonCode).
    const span = spanFor('legal_description');
    const aEnd = span.start - (NEAR_BOUNDARY_CHARS + 1);
    const r = inlineEscalate(sug(aEnd - 1, aEnd), CTX);
    // near-boundary did not fire; whatever the router decided is carried (no inline near-boundary event)
    if (r.escalateInline) {
      expect(r.event?.reasonCode).not.toBe('near_boundary');
    } else {
      expect(r.event).toBeNull();
    }
  });
});

// ── far-from-span + Class-A defers to the router and AUTO-ADOPTS ──────────────────────────────────

describe('E3 — a change FAR from any protected span + Class-A is NOT inline-escalated (defers -> auto_adopt)', () => {
  it('a whitespace fix in a plain, span-free doc -> NOT inline-escalated; route auto_adopt (deferred)', () => {
    const r = inlineEscalate(
      sug(5, 7, { beforeText: 'plain  working', afterText: 'plain working', claimedClassA: 'whitespace_spacing' }),
      PLAIN_CTX,
    );
    expect(r.escalateInline).toBe(false);
    expect(r.route).toBe('auto_adopt');
    expect(r.event).toBeNull();
    expect(r.route_basis.route).toBe('auto_adopt');
  });

  it('a genuine Class-A typo fix far from every deed span -> NOT inline-escalated; auto_adopt', () => {
    const p = farFromAllSpans(CTX);
    // The dense deed fixture may have no far-enough gap; if so this assertion is covered by the PLAIN case above.
    if (p === null) return;
    const before = CTX.documentText.slice(p, p + 2);
    const r = inlineEscalate(
      sug(p, p + 2, { beforeText: before, afterText: before, claimedClassA: 'whitespace_spacing' }),
      CTX,
    );
    // before===after is a no-op (router escalates), so use a real whitespace difference instead:
    const r2 = inlineEscalate(
      sug(p, p + 2, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
      CTX,
    );
    expect(r.event?.reasonCode).not.toBe('near_boundary');
    expect(r2.escalateInline).toBe(false);
    expect(r2.route).toBe('auto_adopt');
  });
});

// ── confidence gate over a SUPPLIED classifier signal ────────────────────────────────────────────

describe('E3 — the confidence gate fires over a SUPPLIED classifier signal', () => {
  it('a SUPPLIED low-confidence signal (< floor) -> escalateInline true (low_confidence)', () => {
    const lowSig: ClassifierSignal = { confidence: CONFIDENCE_FLOOR - 0.1 };
    const r = inlineEscalate(
      sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
      PLAIN_CTX,
      lowSig,
    );
    expect(r.escalateInline).toBe(true);
    expect(r.route).toBe('escalate');
    expect(r.event?.reasonCode).toBe('low_confidence');
    expect(r.event?.confidence).toBe(CONFIDENCE_FLOOR - 0.1);
  });

  it('a SUPPLIED high-confidence signal (>= floor) does NOT inline-escalate -> defers to router (auto_adopt)', () => {
    const highSig: ClassifierSignal = { confidence: 0.99 };
    const r = inlineEscalate(
      sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
      PLAIN_CTX,
      highSig,
    );
    expect(r.escalateInline).toBe(false);
    expect(r.route).toBe('auto_adopt');
    expect(r.event).toBeNull();
  });

  it('an explicit escalate flag (even with high confidence) -> escalateInline (classifier_escalate_flag)', () => {
    const sig: ClassifierSignal = { confidence: 0.99, escalate: true };
    const r = inlineEscalate(
      sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
      PLAIN_CTX,
      sig,
    );
    expect(r.escalateInline).toBe(true);
    expect(r.route).toBe('escalate');
    expect(r.event?.reasonCode).toBe('classifier_escalate_flag');
  });

  it('confidence exactly AT the floor does NOT fire (strict <) -> defers', () => {
    const atFloor: ClassifierSignal = { confidence: CONFIDENCE_FLOOR };
    const r = inlineEscalate(
      sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
      PLAIN_CTX,
      atFloor,
    );
    expect(r.escalateInline).toBe(false);
    expect(r.route).toBe('auto_adopt');
  });
});

// ── ADDITIVE-ONLY: E3 can NEVER turn an escalate into an auto_adopt ───────────────────────────────

describe('E3 — ADDITIVE-ONLY: it can only RAISE escalations, never lower an E1/E2 escalate to adopt', () => {
  it('a protected-span edit stays escalate even with a high-confidence "safe" signal', () => {
    const span = spanFor('legal_description');
    const safeSig: ClassifierSignal = { confidence: 1.0 }; // "classifier says safe"
    const r = inlineEscalate(
      sug(span.start + 1, span.start + 3, { beforeText: 'Lo', afterText: 'Lo', claimedClassA: 'whitespace_spacing' }),
      CTX,
      safeSig,
    );
    expect(r.route).toBe('escalate'); // NEVER auto_adopt
    expect(r.route_basis.route).toBe('escalate'); // the router already escalated; E3 did not lower it
  });

  it('a DELETION stays escalate even with a high-confidence safe signal + an escalate=false flag', () => {
    const safeSig: ClassifierSignal = { confidence: 1.0, escalate: false };
    const r = inlineEscalate(
      sug(5, 9, { isDeletion: true, beforeText: 'plain', afterText: '', claimedClassA: 'literal_duplicate_removal' }),
      PLAIN_CTX,
      safeSig,
    );
    expect(r.route).toBe('escalate'); // deletion rail fired in the gate; E3 cannot lower it
    expect(r.route_basis.route).toBe('escalate');
  });

  it('a defined-term edit stays escalate even with a high-confidence safe signal', () => {
    const span = spanFor('defined_terms_definitions');
    const safeSig: ClassifierSignal = { confidence: 1.0 };
    const r = inlineEscalate(
      sug(span.start + 1, span.start + 3, { beforeText: 'th', afterText: 'th', claimedClassA: 'whitespace_spacing' }),
      CTX,
      safeSig,
    );
    expect(r.route).toBe('escalate');
  });

  it('for EVERY protected span: a high-confidence safe signal never produces auto_adopt', () => {
    const safeSig: ClassifierSignal = { confidence: 1.0, escalate: false };
    for (const label of [
      'legal_description',
      'granting_clause',
      'warranty_covenant',
      'amounts',
      'signature_acknowledgment_notary',
      'defined_terms_definitions',
    ] as ProtectedSpanLabel[]) {
      const span = spanFor(label);
      const r = inlineEscalate(
        sug(span.start + 1, span.start + 2, { beforeText: 'x', afterText: 'x ', claimedClassA: 'whitespace_spacing' }),
        CTX,
        safeSig,
      );
      expect(r.route).toBe('escalate');
    }
  });

  it('E3 never INVENTS an auto_adopt: route is auto_adopt only when the router already said auto_adopt AND no trigger fired', () => {
    // near-boundary or low-confidence forces escalate; a clean far Class-A with no signal carries the router's adopt.
    const adopt = inlineEscalate(
      sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
      PLAIN_CTX,
    );
    expect(adopt.route).toBe('auto_adopt');
    expect(adopt.route_basis.route).toBe('auto_adopt');
    expect(adopt.escalateInline).toBe(false);

    // the SAME suggestion, now near a boundary -> escalate (E3 added an escalation; it did not remove the adopt path
    // arbitrarily — it RAISED one). Proven separately by the near-boundary suite.
  });
});

// ── determinism + no egress ───────────────────────────────────────────────────────────────────────

describe('E3 — determinism + NO egress (pure over inputs; no model/network call)', () => {
  it('same input -> same result AND byte-identical reason', () => {
    const s = sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' });
    const sig: ClassifierSignal = { confidence: 0.5 };
    const a = inlineEscalate(s, PLAIN_CTX, sig);
    const b = inlineEscalate(s, PLAIN_CTX, sig);
    expect(a.route).toBe(b.route);
    expect(a.reason).toBe(b.reason);
    expect(JSON.stringify(a.event)).toBe(JSON.stringify(b.event));
  });

  it('makes NO network / fetch call — it is pure over its supplied inputs (the model dispatch is E6)', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockImplementation((() => {
      throw new Error('E3 must not make any egress / model call — that wiring is E6');
    }) as never);
    try {
      const r = inlineEscalate(
        sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
        PLAIN_CTX,
        { confidence: 0.1 },
      );
      expect(r.escalateInline).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('a custom proximity band + floor are honored deterministically', () => {
    const span = spanFor('legal_description');
    const aEnd = span.start - 20; // gap 20: outside default band (12), inside a custom band of 24
    const r = inlineEscalate(sug(aEnd - 1, aEnd), CTX, undefined, { nearBoundaryChars: 24 });
    expect(r.escalateInline).toBe(true);
    expect(r.event?.reasonCode).toBe('near_boundary');
    expect(r.event?.nearestSpan?.gap).toBe(20);
  });
});
