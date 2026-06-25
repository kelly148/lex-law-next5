/**
 * EXPRESS-AUTO-REVIEW-LOOP-1 E8 — LAYER 1: the DETERMINISTIC LOCUS-GATE SHIP-GATE suite.
 *
 * Layer 1 is the AUTHORITATIVE proof of GATE LOGIC (design §2/§5): the gate is deterministic by construction, so
 * its correctness is PROVABLE without any model. For the deed doc type × EACH of the 14 protected spans, this
 * suite feeds synthetic (baseDoc, diff range, classifierLabel) triples DIRECTLY into evaluateLocus (E1) +
 * routeWithImmutability (E2) and asserts the verdict. It runs every CI and must be 100% green forever.
 *
 * THE GATE ASSERTIONS (design §5, any failure blocks ship):
 *   (a) INTERSECTION axis — a diff that intersects a protected span (fully inside / straddle start by 1 /
 *       straddle end by 1 / equal to the span) -> escalate.
 *   (b) DELETION — a deletion touching operative text -> escalate.
 *   (c) DEFINED-TERM — rename one instance of a defined term / edit the definition site -> escalate.
 *   (d) DISGUISE — a Class-A label ("typo fix"/"formatting"/"duplicate removal") landing IN a protected span ->
 *       escalate REGARDLESS of the label (the architectural-ruling test: the label is NOT the gate).
 *   (e) GENUINE CLASS-A in NON-protected text -> auto_adopt eligible (the only auto-adopt-eligible set).
 *   Boundary/encoding axis (design §2): a "formatting only" edit INSIDE the legal description that alters
 *   content -> escalate; a near-duplicate (not byte-identical) "duplicate removal" -> escalate.
 *
 * THE HARDEST RULE (operator-only): this suite BUILDS + RUNS + REPORTS the gate evidence. It NEVER clears the
 * gate, never flips the flag. A real HOLE (a substantive trap that auto-adopts, OR an operative element with no
 * protected span) is a GENUINE FINDING — the test FAILS LOUDLY and the hole is reported; it is never weakened
 * to make CI green.
 *
 * Span offsets come from the REAL E1 catalog at runtime (no hand-counted magic numbers), so the suite asserts
 * GATE behavior and breaks loudly if a recognizer drifts. Corpus bases are real-structure, synthetic-content
 * (zero PII) — shared with the Layer-2 corpus via shipGateCorpus.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  buildProtectedSpans,
  DEED_PROTECTED_SPAN_LABELS,
  type ProtectedSpan,
  type ProtectedSpanLabel,
} from '../express/protectedSpans.js';
import { evaluateLocus, type LocusSuggestion } from '../express/locusGate.js';
import {
  routeWithImmutability,
  createImmutabilityTracker,
  type ClassACategory,
  type RoutableSuggestion,
  type RouteContext,
} from '../express/adoptRouter.js';
import {
  DEED_CORPUS_BASES,
  type CorpusBase,
} from '../express/shipGateCorpus.js';
import { isAutoReviewLoopEnabled } from '../config/featureFlags.js';

// ── shared helpers over a corpus base (offsets located at runtime against the REAL span catalog) ──────────

/** The located protected-span catalog for a base (the authoritative E1 catalog). */
function spansFor(base: CorpusBase): ProtectedSpan[] {
  return buildProtectedSpans(base.documentType, base.body);
}

/** First located span carrying `label` on the base; null when the span model does not cover it (a gate hole). */
function spanFor(base: CorpusBase, label: ProtectedSpanLabel): ProtectedSpan | null {
  return spansFor(base).find((s) => s.label === label) ?? null;
}

/** Build the route context for a base (real spans + defined terms — exactly what the live loop derives). */
function ctxFor(base: CorpusBase): RouteContext {
  return {
    protectedSpans: spansFor(base),
    documentText: base.body,
    definedTerms: base.definedTerms,
  };
}

/** Evaluate the raw locus verdict for a diff range on a base. */
function locus(base: CorpusBase, start: number, end: number, extra: Partial<LocusSuggestion> = {}) {
  return evaluateLocus(
    { targetStart: start, targetEnd: end, isDeletion: false, ...extra },
    spansFor(base),
    base.body,
    { definedTerms: base.definedTerms },
  );
}

/** Route a diff range on a base through E2 (fresh tracker per call — deterministic). */
function route(base: CorpusBase, s: RoutableSuggestion) {
  return routeWithImmutability(s, createImmutabilityTracker(), ctxFor(base));
}

// ── feature-flag invariant (the whole Express program is flag-dark) ───────────────────────────────────────

describe('E8 Layer 1 — the Express program is flag-dark (AUTO_REVIEW_LOOP_ENABLED default OFF)', () => {
  it('the gate library is exercised but the live loop stays OFF by default', () => {
    const prev = process.env['AUTO_REVIEW_LOOP_ENABLED'];
    delete process.env['AUTO_REVIEW_LOOP_ENABLED'];
    expect(isAutoReviewLoopEnabled()).toBe(false);
    if (prev === undefined) delete process.env['AUTO_REVIEW_LOOP_ENABLED'];
    else process.env['AUTO_REVIEW_LOOP_ENABLED'] = prev;
  });
});

// ── (a) INTERSECTION axis — deed × each of the 14 protected spans × 4 intersection cases -> escalate ───────

describe('E8 Layer 1 (a) — every protected span: intersect (inside / straddle-start / straddle-end / equal) -> escalate', () => {
  for (const base of DEED_CORPUS_BASES) {
    for (const label of DEED_PROTECTED_SPAN_LABELS) {
      it(`${base.name} × ${label}: all four intersection cases escalate`, () => {
        const span = spanFor(base, label);
        // GATE-HOLE GUARD (design §4): every deed protected label MUST be located on a real deed base. A missing
        // span here is NOT a test bug — it is an uncovered operative element (a gate hole). Fail loudly.
        expect(
          span,
          `GATE HOLE: no protected span located for deed label "${label}" on base "${base.name}" — an ` +
            'operative element the E1 span model fails to cover. Extend the span model; do NOT relax.',
        ).not.toBeNull();
        const s = span!;
        // Every located deed span has length >= 2; assert it so the interior case is well-defined.
        expect(s.end - s.start, `span "${label}" on "${base.name}" too short for interior case`).toBeGreaterThanOrEqual(2);
        const insideStart = s.start + 1 < s.end ? s.start + 1 : s.start; // strictly interior when possible
        const insideEnd = insideStart + 1 <= s.end ? insideStart + 1 : s.end;

        // fully inside (a 1-char edit strictly interior to the span)
        expect(locus(base, insideStart, insideEnd).decision).toBe('escalate');
        // straddle the START boundary by one char: [start-1, start+1)
        expect(locus(base, Math.max(0, s.start - 1), s.start + 1).decision).toBe('escalate');
        // straddle the END boundary by one char: [end-1, end+1)
        expect(locus(base, s.end - 1, s.end + 1).decision).toBe('escalate');
        // equal to the span exactly: [start, end)
        expect(locus(base, s.start, s.end).decision).toBe('escalate');
      });
    }
  }
});

// ── (b) DELETION — a deletion touching operative text -> escalate ─────────────────────────────────────────

describe('E8 Layer 1 (b) — a DELETION touching a protected span escalates (removal is never auto-adoptable)', () => {
  for (const base of DEED_CORPUS_BASES) {
    for (const label of DEED_PROTECTED_SPAN_LABELS) {
      it(`${base.name} × ${label}: deletion inside the span escalates`, () => {
        const s = spanFor(base, label);
        expect(s, `GATE HOLE: missing span "${label}" on "${base.name}"`).not.toBeNull();
        const span = s!;
        const r = locus(base, span.start, span.end, { isDeletion: true });
        expect(r.decision).toBe('escalate');
        expect(r.isDeletion).toBe(true);
      });
    }
  }

  it('a deletion lands escalate even via the router (deletion rail beats any Class-A claim)', () => {
    const base = DEED_CORPUS_BASES[0]!;
    const span = spanFor(base, 'legal_description')!;
    const r = route(base, {
      targetStart: span.start,
      targetEnd: span.end,
      isDeletion: true,
      beforeText: base.body.slice(span.start, span.end),
      afterText: '',
      claimedClassA: 'literal_duplicate_removal', // even a disguise label cannot rescue a deletion
    });
    expect(r.route).toBe('escalate');
  });
});

// ── (c) DEFINED-TERM — rename one instance / edit the definition -> escalate ─────────────────────────────

describe('E8 Layer 1 (c) — a defined-term edit escalates (definition site OR a single tracked occurrence)', () => {
  for (const base of DEED_CORPUS_BASES) {
    it(`${base.name}: editing the definition site of a defined term escalates`, () => {
      const defSpan = spanFor(base, 'defined_terms_definitions')!;
      expect(locus(base, defSpan.start, defSpan.end).decision).toBe('escalate');
    });

    it(`${base.name}: renaming a SINGLE occurrence of a defined term escalates (tracked-occurrence rail)`, () => {
      // Find an occurrence of the first defined term that is OUTSIDE every located protected span, so the ONLY
      // rail that can fire is the tracked defined-term occurrence rail (R4b) — proving a single-instance rename
      // escalates even outside the definition span.
      const term = base.definedTerms[0]!;
      const spans = spansFor(base);
      const body = base.body;
      const re = new RegExp(`(?<![A-Za-z0-9])${term}(?![A-Za-z0-9])`, 'g');
      let m: RegExpExecArray | null;
      let found: { start: number; end: number } | null = null;
      while ((m = re.exec(body)) !== null) {
        const occ = { start: m.index, end: m.index + m[0].length };
        const insideAnySpan = spans.some((sp) => occ.start < sp.end && sp.start < occ.end);
        const adjacentAnySpan = spans.some((sp) => occ.end === sp.start || occ.start === sp.end);
        if (!insideAnySpan && !adjacentAnySpan) {
          found = occ;
          break;
        }
      }
      // If EVERY occurrence sits inside a protected span, the intersection rail already escalates it — still a
      // pass for the gate; assert the definition-site occurrence escalates as the fallback proof.
      if (found === null) {
        const defSpan = spanFor(base, 'defined_terms_definitions')!;
        expect(locus(base, defSpan.start, defSpan.end).decision).toBe('escalate');
        return;
      }
      const r = locus(base, found.start, found.end);
      expect(r.decision).toBe('escalate');
      expect(r.touchedDefinedTerm).toBe(true);
    });
  }
});

// ── (d) DISGUISE — a Class-A label inside a protected span escalates REGARDLESS of label (the architecture) ─

describe('E8 Layer 1 (d) — a DISGUISING Class-A label in a protected span escalates regardless of label', () => {
  const DISGUISES: ClassACategory[] = ['typo_fix', 'whitespace_spacing', 'literal_duplicate_removal'];
  for (const base of DEED_CORPUS_BASES) {
    for (const label of DEED_PROTECTED_SPAN_LABELS) {
      for (const disguise of DISGUISES) {
        it(`${base.name} × ${label}: a "${disguise}"-labeled edit IN the span still escalates`, () => {
          const s = spanFor(base, label)!;
          // a 1-char edit strictly inside the span, dressed as a mechanical fix — the locus gate must escalate
          // BEFORE the Class-A classifier is ever consulted (the label cannot move the gate).
          const start = s.start;
          const end = Math.min(s.start + 1, s.end);
          const before = base.body.slice(start, end);
          const r = route(base, {
            targetStart: start,
            targetEnd: end,
            isDeletion: false,
            beforeText: before,
            afterText: before === ' ' ? '  ' : before + ' ',
            claimedClassA: disguise,
          });
          expect(r.route).toBe('escalate');
          // the escalation is on LOCUS (the gate), not a Class-A miss — prove the label never reached authority.
          expect(r.locus.decision).toBe('escalate');
        });
      }
    }
  }

  it('a "model says safe" hint can NEVER flip a protected-span escalate to auto-adopt', () => {
    const base = DEED_CORPUS_BASES[0]!;
    const span = spanFor(base, 'warranty_covenant')!;
    const r = locus(base, span.start, span.start + 1, { modelSaysSafe: true });
    expect(r.decision).toBe('escalate');
  });

  it('a "model escalates" hint can RAISE an escalation even in clean non-protected text (additive-only)', () => {
    // a clean locus that would be eligible, but the additive model hint raises it -> escalate.
    const r = evaluateLocus(
      { targetStart: 0, targetEnd: 1, isDeletion: false, modelEscalates: true },
      [],
      'plain note',
      {},
    );
    expect(r.decision).toBe('escalate');
    expect(r.modelRaisedEscalation).toBe(true);
  });
});

// ── (e) GENUINE CLASS-A in NON-protected text -> auto_adopt eligible (the only auto-adopt-eligible set) ────

describe('E8 Layer 1 (e) — a GENUINE Class-A fix in NON-protected text is auto-adopt eligible', () => {
  // A clean working note with NO operative legal language and a fixable double-space. We pin protectedSpans:[]
  // so the locus is provably clean (the note carries no deed markers anyway).
  const PLAIN = 'This is  a plain working note with no operative legal language in it whatsoever.';
  const cleanCtx: RouteContext = { protectedSpans: [], documentText: PLAIN };

  it('a whitespace_spacing fix in clean text auto-adopts (locus-eligible AND verified Class-A)', () => {
    const r = routeWithImmutability(
      { targetStart: 4, targetEnd: 9, isDeletion: false, beforeText: ' is  a', afterText: ' is a', claimedClassA: 'whitespace_spacing' },
      createImmutabilityTracker(),
      cleanCtx,
    );
    expect(r.route).toBe('auto_adopt');
  });

  it('an eligible-but-SUBSTANTIVE change in clean text still escalates (the safe harbor is narrow)', () => {
    // locus-clean, but the change is a real content edit with no provable mechanical category -> escalate.
    const r = routeWithImmutability(
      { targetStart: 4, targetEnd: 9, isDeletion: false, beforeText: ' is  a', afterText: ' was the', claimedClassA: 'typo_fix' },
      createImmutabilityTracker(),
      cleanCtx,
    );
    expect(r.route).toBe('escalate');
  });

  it('a Class-A fix with NO claim escalates (no claim = not asserted mechanical = conservative escalate)', () => {
    const r = routeWithImmutability(
      { targetStart: 4, targetEnd: 9, isDeletion: false, beforeText: ' is  a', afterText: ' is a' },
      createImmutabilityTracker(),
      cleanCtx,
    );
    expect(r.route).toBe('escalate');
  });
});

// ── boundary / encoding adversarial axis (design §2 — off-by-one + disguise blind spots) ──────────────────

describe('E8 Layer 1 — boundary/encoding axis: content edits inside the legal description + near-duplicates', () => {
  for (const base of DEED_CORPUS_BASES) {
    it(`${base.name}: a "formatting only" edit INSIDE the legal description that alters content escalates`, () => {
      const legal = spanFor(base, 'legal_description')!;
      // drop one char inside the metes-and-bounds, dressed as punctuation/whitespace — ANY intersection with the
      // legal-description span escalates (the verbatim invariant), regardless of the formatting claim.
      const start = legal.start + 3;
      const end = legal.start + 4;
      const before = base.body.slice(start, end);
      const r = route(base, {
        targetStart: start,
        targetEnd: end,
        isDeletion: false,
        beforeText: before,
        afterText: before + ' ',
        claimedClassA: 'punctuation',
      });
      expect(r.route).toBe('escalate');
      expect(r.locus.intersectedSpans.some((sp) => sp.label === 'legal_description')).toBe(true);
    });
  }

  it('a NEAR-duplicate (not byte-identical) "duplicate removal" does NOT qualify for the safe harbor -> escalate', () => {
    // clean locus, claimed literal_duplicate_removal, but the removed run is NOT a byte-identical adjacent
    // repeat (a near-duplicate protective clause) -> the Class-A verification fails -> escalate.
    const text = 'note: clause A and clause B follow here in plain non-operative prose with nothing legal.';
    const r = routeWithImmutability(
      {
        targetStart: 6,
        targetEnd: 30,
        isDeletion: false,
        beforeText: 'clause A and clause B',
        afterText: 'clause A', // NOT a byte-identical adjacent repeat collapse — a near-duplicate
        claimedClassA: 'literal_duplicate_removal',
      },
      createImmutabilityTracker(),
      { protectedSpans: [], documentText: text },
    );
    expect(r.route).toBe('escalate');
  });

  it('a TRUE byte-identical literal-duplicate collapse in clean text DOES auto-adopt (the safe harbor exists)', () => {
    const text = 'note note follows here in plain non-operative prose with nothing legal in it at all today.';
    const r = routeWithImmutability(
      {
        targetStart: 0,
        targetEnd: 10,
        isDeletion: false,
        beforeText: 'note note ',
        afterText: 'note ', // a byte-identical adjacent repeat collapsed
        claimedClassA: 'literal_duplicate_removal',
      },
      createImmutabilityTracker(),
      { protectedSpans: [], documentText: text },
    );
    expect(r.route).toBe('auto_adopt');
  });
});

// ── SHIP-GATE EVIDENCE summary (REPORT, not a gate) ───────────────────────────────────────────────────────

describe('E8 Layer 1 — SHIP-GATE EVIDENCE summary (report)', () => {
  it('reports the deterministic-layer case counts (all escalate; no gate hole)', () => {
    let intersectionCases = 0;
    let deletionCases = 0;
    let disguiseCases = 0;
    let holes = 0;
    const DISGUISES: ClassACategory[] = ['typo_fix', 'whitespace_spacing', 'literal_duplicate_removal'];

    for (const base of DEED_CORPUS_BASES) {
      for (const label of DEED_PROTECTED_SPAN_LABELS) {
        const s = spanFor(base, label);
        if (s === null) {
          holes++;
          continue;
        }
        // 4 intersection cases all escalate
        const four = [
          locus(base, s.start, Math.min(s.start + 1, s.end)).decision,
          locus(base, Math.max(0, s.start - 1), s.start + 1).decision,
          locus(base, s.end - 1, s.end + 1).decision,
          locus(base, s.start, s.end).decision,
        ];
        expect(four.every((d) => d === 'escalate')).toBe(true);
        intersectionCases += 4;
        // deletion escalates
        expect(locus(base, s.start, s.end, { isDeletion: true }).decision).toBe('escalate');
        deletionCases += 1;
        // each disguise escalates
        for (const disguise of DISGUISES) {
          const r = route(base, {
            targetStart: s.start,
            targetEnd: Math.min(s.start + 1, s.end),
            isDeletion: false,
            beforeText: base.body.slice(s.start, Math.min(s.start + 1, s.end)),
            afterText: base.body.slice(s.start, Math.min(s.start + 1, s.end)) + ' ',
            claimedClassA: disguise,
          });
          expect(r.route).toBe('escalate');
          disguiseCases += 1;
        }
      }
    }

    const totalSpanCases = intersectionCases + deletionCases + disguiseCases;
    // eslint-disable-next-line no-console
    console.log(
      '\n===== E8 SHIP-GATE EVIDENCE — LAYER 1 (deterministic locus gate) =====\n' +
        `  bases: ${DEED_CORPUS_BASES.length} (deed)   spans/base: ${DEED_PROTECTED_SPAN_LABELS.length}\n` +
        `  intersection cases (inside/straddle-start/straddle-end/equal): ${intersectionCases} -> ALL escalate\n` +
        `  deletion cases: ${deletionCases} -> ALL escalate\n` +
        `  disguise cases (Class-A label in a protected span): ${disguiseCases} -> ALL escalate regardless of label\n` +
        `  total (doc-type × span × case) gate assertions: ${totalSpanCases} -> 100% escalate\n` +
        `  GATE HOLES (operative element with no protected span): ${holes}\n` +
        '  NOTE: this suite REPORTS evidence; it does NOT clear the gate (operator-only).\n' +
        '======================================================================\n',
    );
    // The gate evidence: zero holes, and a non-trivial number of assertions all escalated.
    expect(holes).toBe(0);
    expect(totalSpanCases).toBeGreaterThan(100);
  });
});
