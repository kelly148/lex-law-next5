/**
 * EXPRESS-AUTO-REVIEW-LOOP-1 E4a — risk-ranked, UNWINDABLE decision LEDGER + cumulative REDLINE tests.
 *
 * E4a is PURE/computational over IN-MEMORY loop state — NO DATABASE (that is the deferred, operator-gated
 * E4b). It records a per-decision before/after entry, risk-ranks the entries for attorney triage, supports a
 * deterministic one-click unwind of a single adopted change (offset-safe across MULTIPLE adopted changes), and
 * builds a deterministic cumulative v1->candidate redline. The acceptance bar (build spec §E4; E8 §3):
 *  - Recording entries from mixed routes (auto_adopt + escalate), with stable ids + deterministic risk scores.
 *  - Risk ranking puts escalations (esp. legal_description / amounts protected-span hits) ABOVE auto-adopts,
 *    deterministically — and NEVER changes a route (triage only).
 *  - Unwind: a single adopted change reverts to before-text; with MULTIPLE adopted changes, unwinding one does
 *    NOT corrupt the others (offset integrity); the unwind is recorded/auditable (entry.reverted).
 *  - Redline: original->final contains every change; identical texts -> empty/unchanged; byte-identical for
 *    identical input.
 *  - No persistence / no egress (pure functions over in-memory state).
 *
 * Mirrors the E1/E2/E3 test style: offsets are computed from the fixture at runtime via the real E1/E2/E3
 * modules (the SPANS catalog + the router), so the tests assert E4a behavior, not hand-counted offsets, and
 * break loudly if a recognizer drifts.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildProtectedSpans, type ProtectedSpan, type ProtectedSpanLabel } from '../express/protectedSpans.js';
import {
  routeSuggestion,
  type RoutableSuggestion,
  type RouteContext,
  type RouteResult,
} from '../express/adoptRouter.js';
import {
  createDecisionLedger,
  scoreRisk,
  bucketForScore,
  buildRedline,
  unwind,
  UnwindError,
  type DecisionRecord,
} from '../express/decisionLedger.js';

// ── synthetic deed fixture (same house form as the E1/E2/E3 suites) ───────────────────────────────

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

/**
 * Turn a routed suggestion into a DecisionRecord, threading the real RouteResult through (so the ledger's
 * risk score reflects the genuine E1/E2 verdict, not a hand-built one). The caller supplies before/after +
 * round; the route + locus + classA + immutability come from the router.
 */
function recordFrom(
  rr: RouteResult,
  s: RoutableSuggestion,
  round: number,
  before: string,
  after: string,
): DecisionRecord {
  return {
    round,
    route: rr.route,
    locus: rr.locus,
    classA: rr.classA,
    immutabilityForced: rr.immutabilityForced,
    inlineEvent: null,
    beforeText: before,
    afterText: after,
    offsetStart: Math.min(s.targetStart, s.targetEnd),
    offsetEnd: Math.max(s.targetStart, s.targetEnd),
    isDeletion: s.isDeletion,
  };
}

// A clean, locus-eligible plain doc: no protected spans, no defined terms — auto-adopt territory.
const PLAIN = 'This is a plain  working note with no operative legal language in it whatsoever.';
const PLAIN_CTX: RouteContext = { protectedSpans: buildProtectedSpans('deed', PLAIN), documentText: PLAIN };

// ── recording entries from mixed routes ───────────────────────────────────────────────────────────

describe('E4a — the ledger records entries from mixed routes with stable ids + risk scores', () => {
  it('records an auto_adopt and an escalate, assigns deterministic ids, preserves recording order', () => {
    const ledger = createDecisionLedger();

    // 1) a clean whitespace fix in plain text -> auto_adopt
    const adoptSug = sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' });
    const adoptRR = routeSuggestion(adoptSug, PLAIN_CTX);
    expect(adoptRR.route).toBe('auto_adopt');
    const e1 = ledger.record(recordFrom(adoptRR, adoptSug, 1, 'a  b', 'a b'));

    // 2) an edit inside the legal description -> escalate
    const legal = spanFor('legal_description');
    const escSug = sug(legal.start + 1, legal.start + 3);
    const escRR = routeSuggestion(escSug, CTX);
    expect(escRR.route).toBe('escalate');
    const e2 = ledger.record(recordFrom(escRR, escSug, 1, 'ot', 'oz'));

    const all = ledger.entries();
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe('e1-1');
    expect(all[1]!.id).toBe('e1-2');
    expect(all[0]!.route).toBe('auto_adopt');
    expect(all[1]!.route).toBe('escalate');
    // recording order preserved
    expect(all.map((e) => e.id)).toEqual(['e1-1', 'e1-2']);
    // ledger.get round-trips
    expect(ledger.get('e1-1')).toBe(e1);
    expect(ledger.get('e1-2')).toBe(e2);
    expect(ledger.get('nope')).toBeUndefined();
  });

  it('ids are per-round sequential (e<round>-<seq>)', () => {
    const ledger = createDecisionLedger();
    const adoptSug = sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' });
    const rr = routeSuggestion(adoptSug, PLAIN_CTX);
    ledger.record(recordFrom(rr, adoptSug, 1, 'a  b', 'a b'));
    ledger.record(recordFrom(rr, adoptSug, 1, 'a  b', 'a b'));
    ledger.record(recordFrom(rr, adoptSug, 2, 'a  b', 'a b'));
    expect(ledger.entries().map((e) => e.id)).toEqual(['e1-1', 'e1-2', 'e2-1']);
  });

  it('entries() returns a defensive copy — mutating it does not corrupt the ledger', () => {
    const ledger = createDecisionLedger();
    const adoptSug = sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' });
    const rr = routeSuggestion(adoptSug, PLAIN_CTX);
    ledger.record(recordFrom(rr, adoptSug, 1, 'a  b', 'a b'));
    const snapshot = ledger.entries();
    snapshot.pop();
    expect(ledger.entries()).toHaveLength(1);
  });
});

// ── risk ranking: escalations above auto-adopts; protected-span weight orders escalations ──────────

describe('E4a — risk ranking puts escalations (esp. legal_description/amounts) above auto-adopts', () => {
  it('every escalation outranks every auto-adopt (route dominates the score)', () => {
    const ledger = createDecisionLedger();

    // auto-adopt
    const adoptSug = sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' });
    const adoptRR = routeSuggestion(adoptSug, PLAIN_CTX);
    ledger.record(recordFrom(adoptRR, adoptSug, 1, 'a  b', 'a b'));

    // escalate on the lowest-weight protected span we can hit (signature block)
    const sig = spanFor('signature_acknowledgment_notary');
    const sigSug = sug(sig.start + 1, sig.start + 3);
    const sigRR = routeSuggestion(sigSug, CTX);
    expect(sigRR.route).toBe('escalate');
    ledger.record(recordFrom(sigRR, sigSug, 1, 'WI', 'wi'));

    const ranked = ledger.byRisk();
    // the escalation (even the lowest-weight span) ranks ABOVE the auto-adopt
    expect(ranked[0]!.route).toBe('escalate');
    expect(ranked[1]!.route).toBe('auto_adopt');
    expect(ranked[0]!.riskBucket).toBe('high');
    expect(ranked[1]!.riskBucket).toBe('low');
  });

  it('among escalations, a legal_description / amounts hit ranks above a lower-weight span hit', () => {
    const ledger = createDecisionLedger();

    const sig = spanFor('signature_acknowledgment_notary');
    const sigSug = sug(sig.start + 1, sig.start + 3);
    ledger.record(recordFrom(routeSuggestion(sigSug, CTX), sigSug, 1, 'WI', 'wi'));

    const amounts = spanFor('amounts');
    const amtSug = sug(amounts.start + 1, amounts.start + 3);
    ledger.record(recordFrom(routeSuggestion(amtSug, CTX), amtSug, 1, '58', '59'));

    const legal = spanFor('legal_description');
    const legalSug = sug(legal.start + 1, legal.start + 3);
    ledger.record(recordFrom(routeSuggestion(legalSug, CTX), legalSug, 1, 'ot', 'oz'));

    const ranked = ledger.byRisk();
    // legal_description is the highest-weight span -> ranks first; amounts above signature.
    const labelsOfTop = (e: typeof ranked[number]): ProtectedSpanLabel[] =>
      e.locus.intersectedSpans.map((s) => s.label);
    expect(labelsOfTop(ranked[0]!)).toContain('legal_description');
    expect(labelsOfTop(ranked[1]!)).toContain('amounts');
    expect(labelsOfTop(ranked[2]!)).toContain('signature_acknowledgment_notary');
    // and the scores are strictly decreasing across the three escalations
    expect(ranked[0]!.riskScore).toBeGreaterThan(ranked[1]!.riskScore);
    expect(ranked[1]!.riskScore).toBeGreaterThan(ranked[2]!.riskScore);
  });

  it('a deletion adds risk; ties broken deterministically (round, offset, id)', () => {
    // Two escalations on the SAME span (same weight): one a deletion, one not. The deletion must rank higher.
    const legal = spanFor('legal_description');
    const ledger = createDecisionLedger();

    const plainSug = sug(legal.start + 10, legal.start + 12);
    ledger.record(recordFrom(routeSuggestion(plainSug, CTX), plainSug, 1, 'ab', 'ac'));

    const delSug = sug(legal.start + 1, legal.start + 3, { isDeletion: true });
    ledger.record(recordFrom(routeSuggestion(delSug, CTX), delSug, 1, 'ot', ''));

    const ranked = ledger.byRisk();
    expect(ranked[0]!.isDeletion).toBe(true);
    expect(ranked[0]!.riskScore).toBeGreaterThan(ranked[1]!.riskScore);
  });

  it('byRisk() is deterministic and does not mutate recording order', () => {
    const ledger = createDecisionLedger();
    const legal = spanFor('legal_description');
    const amounts = spanFor('amounts');
    const a = sug(amounts.start + 1, amounts.start + 3);
    const l = sug(legal.start + 1, legal.start + 3);
    ledger.record(recordFrom(routeSuggestion(a, CTX), a, 1, '58', '59')); // recorded first, lower weight
    ledger.record(recordFrom(routeSuggestion(l, CTX), l, 1, 'ot', 'oz')); // recorded second, higher weight

    const r1 = ledger.byRisk().map((e) => e.id);
    const r2 = ledger.byRisk().map((e) => e.id);
    expect(r1).toEqual(r2);
    // recording order unchanged
    expect(ledger.entries().map((e) => e.id)).toEqual(['e1-1', 'e1-2']);
    // legal (e1-2) ranks above amounts (e1-1)
    expect(r1).toEqual(['e1-2', 'e1-1']);
  });

  it('the risk score NEVER changes a route — the ledger only observes the route E1/E2 decided', () => {
    // Construct a record whose route is auto_adopt but force-feed signals; the route field is untouched and
    // the score is high, but route stays auto_adopt (triage only).
    const legal = spanFor('legal_description');
    const s = sug(legal.start + 1, legal.start + 3);
    const rr = routeSuggestion(s, CTX); // this is an escalate in reality
    // Build a record that LIES about the route (auto_adopt) to prove the ledger never re-decides:
    const rec: DecisionRecord = { ...recordFrom(rr, s, 1, 'ot', 'oz'), route: 'auto_adopt' };
    const ledger = createDecisionLedger();
    const entry = ledger.record(rec);
    expect(entry.route).toBe('auto_adopt'); // the ledger did NOT flip it to escalate despite the legal-desc hit
    expect(entry.riskScore).toBeGreaterThan(0); // it still carries the span weight for triage
  });

  it('scoreRisk + bucketForScore are pure and deterministic for identical input', () => {
    const legal = spanFor('legal_description');
    const s = sug(legal.start + 1, legal.start + 3);
    const rec = recordFrom(routeSuggestion(s, CTX), s, 1, 'ot', 'oz');
    expect(scoreRisk(rec)).toBe(scoreRisk(rec));
    expect(bucketForScore(scoreRisk(rec))).toBe('high'); // an escalation is always at least high
  });
});

// ── one-click UNWIND: single + multi-change offset integrity + auditable ──────────────────────────

describe('E4a — unwind reverts a single adopted change and is auditable', () => {
  it('a single adopted change reverts to its before-text', () => {
    const text = 'The quick brown fox.';
    const ledger = createDecisionLedger();
    // adopt: 'quick ' (the loop already applied it; we record after-state). before 'fast', after 'quick'.
    const adoptSug = sug(4, 9, { beforeText: 'fast', afterText: 'quick', claimedClassA: 'typo_fix' });
    // route it in a plain doc so it auto-adopts (offsets here are illustrative for the record only)
    const rr = routeSuggestion(
      sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
      PLAIN_CTX,
    );
    const rec: DecisionRecord = {
      ...recordFrom(rr, adoptSug, 1, 'fast', 'quick'),
      route: 'auto_adopt',
      offsetStart: 4,
      offsetEnd: 8,
    };
    const entry = ledger.record(rec);

    const { text: reverted, reverted: revEntry } = unwind(ledger, entry.id, text);
    expect(reverted).toBe('The fast brown fox.');
    expect(revEntry.reverted).toBe(true);
    expect(ledger.get(entry.id)!.reverted).toBe(true); // recorded/auditable in the ledger
  });

  it('MULTIPLE adopted changes — unwinding one does NOT corrupt the others (offset integrity)', () => {
    // Start text, then three sequential adopted edits of DIFFERENT lengths so absolute offsets drift.
    const v0 = 'alpha beta gamma delta epsilon';
    const ledger = createDecisionLedger();

    function adoptRec(round: number, start: number, end: number, before: string, after: string): DecisionRecord {
      const rr = routeSuggestion(
        sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
        PLAIN_CTX,
      );
      return { ...recordFrom(rr, sug(start, end), round, before, after), route: 'auto_adopt', offsetStart: start, offsetEnd: end };
    }

    // Apply three changes to build the "current" text; record each with the offset it had at apply-time.
    // edit 1: 'beta' -> 'BETAA' (grows by 1)
    let cur = v0.replace('beta', 'BETAA');
    const e1 = ledger.record(adoptRec(1, v0.indexOf('beta'), v0.indexOf('beta') + 4, 'beta', 'BETAA'));
    // edit 2: 'delta' -> 'D' (shrinks) — offset computed against v0 (the recorded-at value can be stale; unwind
    // recomputes by content, which is the whole point)
    cur = cur.replace('delta', 'D');
    const e2 = ledger.record(adoptRec(1, v0.indexOf('delta'), v0.indexOf('delta') + 5, 'delta', 'D'));
    // edit 3: 'alpha' -> 'ALPHA-PRIME' (grows a lot, shifts everything after it)
    cur = cur.replace('alpha', 'ALPHA-PRIME');
    const e3 = ledger.record(adoptRec(1, v0.indexOf('alpha'), v0.indexOf('alpha') + 5, 'alpha', 'ALPHA-PRIME'));

    expect(cur).toBe('ALPHA-PRIME BETAA gamma D epsilon');

    // Unwind the MIDDLE-applied edit (e2: 'D' back to 'delta'). The absolute offset recorded for e2 was against
    // v0 and is now wrong, but unwind locates by content -> must revert correctly without touching e1/e3.
    const u2 = unwind(ledger, e2.id, cur);
    expect(u2.text).toBe('ALPHA-PRIME BETAA gamma delta epsilon');
    expect(ledger.get(e2.id)!.reverted).toBe(true);

    // e1 and e3 must STILL be unwindable from the new text (their content is intact -> offsets not corrupted).
    const u1 = unwind(ledger, e1.id, u2.text);
    expect(u1.text).toBe('ALPHA-PRIME beta gamma delta epsilon');
    const u3 = unwind(ledger, e3.id, u1.text);
    expect(u3.text).toBe('alpha beta gamma delta epsilon'); // fully back to v0
    expect(u3.text).toBe(v0);
  });

  it('unwinding from last-applied to first also reconstructs the original exactly', () => {
    const v0 = 'one two three four';
    const ledger = createDecisionLedger();
    const rr = routeSuggestion(
      sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
      PLAIN_CTX,
    );
    const mk = (start: number, end: number, before: string, after: string): DecisionRecord => ({
      ...recordFrom(rr, sug(start, end), 1, before, after),
      route: 'auto_adopt',
      offsetStart: start,
      offsetEnd: end,
    });
    let cur = v0.replace('two', 'TWO');
    const a = ledger.record(mk(4, 7, 'two', 'TWO'));
    cur = cur.replace('four', 'FOUR-X');
    const b = ledger.record(mk(14, 18, 'four', 'FOUR-X'));

    const ub = unwind(ledger, b.id, cur);
    const ua = unwind(ledger, a.id, ub.text);
    expect(ua.text).toBe(v0);
  });

  it('refuses to unwind an escalation (nothing was applied)', () => {
    const ledger = createDecisionLedger();
    const legal = spanFor('legal_description');
    const s = sug(legal.start + 1, legal.start + 3);
    const entry = ledger.record(recordFrom(routeSuggestion(s, CTX), s, 1, 'ot', 'oz'));
    expect(() => unwind(ledger, entry.id, DEED)).toThrow(UnwindError);
    try {
      unwind(ledger, entry.id, DEED);
    } catch (err) {
      expect((err as UnwindError).code).toBe('not_adopted');
    }
  });

  it('refuses an unknown id, a double-unwind, and an after-text-not-found', () => {
    const ledger = createDecisionLedger();
    const rr = routeSuggestion(
      sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
      PLAIN_CTX,
    );
    const entry = ledger.record({
      ...recordFrom(rr, sug(0, 5), 1, 'hello', 'HELLO'),
      route: 'auto_adopt',
      offsetStart: 0,
      offsetEnd: 5,
    });

    // unknown id
    try {
      unwind(ledger, 'no-such', 'HELLO world');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as UnwindError).code).toBe('unknown_entry');
    }

    // after-text not present in the current text
    try {
      unwind(ledger, entry.id, 'totally different text');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as UnwindError).code).toBe('after_text_not_found');
    }

    // a clean unwind then a double-unwind
    const ok = unwind(ledger, entry.id, 'HELLO world');
    expect(ok.text).toBe('hello world');
    try {
      unwind(ledger, entry.id, ok.text);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as UnwindError).code).toBe('already_reverted');
    }
  });

  it('refuses an ambiguous unwind (equidistant duplicate after-text) rather than corrupt the wrong one', () => {
    const ledger = createDecisionLedger();
    const rr = routeSuggestion(
      sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
      PLAIN_CTX,
    );
    // afterText 'XX' occurs twice, equidistant from the recorded offset (placed exactly between them).
    const text = 'XX....XX'; // occurrences at 0 and 6
    const entry = ledger.record({
      ...recordFrom(rr, sug(3, 5), 1, 'YY', 'XX'),
      route: 'auto_adopt',
      offsetStart: 3, // equidistant: |0-3| = 3, |6-3| = 3
      offsetEnd: 5,
    });
    try {
      unwind(ledger, entry.id, text);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as UnwindError).code).toBe('after_text_ambiguous');
    }
  });
});

// ── cumulative REDLINE ────────────────────────────────────────────────────────────────────────────

describe('E4a — cumulative v1->candidate redline', () => {
  it('identical texts -> unchanged, empty/equal diff', () => {
    const r = buildRedline('same text here', 'same text here');
    expect(r.unchanged).toBe(true);
    // reconstructs to the original
    expect(r.segments.map((s) => s.text).join('')).toBe('same text here');
    expect(r.segments.every((s) => s.op === 'equal')).toBe(true);
  });

  it('an empty-vs-empty redline is unchanged with no segments', () => {
    const r = buildRedline('', '');
    expect(r.unchanged).toBe(true);
    expect(r.segments).toHaveLength(0);
  });

  it('a word change produces a delete + insert and round-trips both sides', () => {
    const original = 'The quick brown fox jumps.';
    const final = 'The slow brown fox jumps.';
    const r = buildRedline(original, final);
    expect(r.unchanged).toBe(false);
    // equal+delete reconstructs the original; equal+insert reconstructs the final.
    const orig = r.segments.filter((s) => s.op !== 'insert').map((s) => s.text).join('');
    const fin = r.segments.filter((s) => s.op !== 'delete').map((s) => s.text).join('');
    expect(orig).toBe(original);
    expect(fin).toBe(final);
    // the change is surfaced: 'quick' deleted, 'slow' inserted
    expect(r.segments.some((s) => s.op === 'delete' && s.text.includes('quick'))).toBe(true);
    expect(r.segments.some((s) => s.op === 'insert' && s.text.includes('slow'))).toBe(true);
  });

  it('an insertion and a deletion are both captured', () => {
    const original = 'alpha gamma';
    const final = 'alpha beta gamma delta';
    const r = buildRedline(original, final);
    const orig = r.segments.filter((s) => s.op !== 'insert').map((s) => s.text).join('');
    const fin = r.segments.filter((s) => s.op !== 'delete').map((s) => s.text).join('');
    expect(orig).toBe(original);
    expect(fin).toBe(final);
    expect(r.segments.some((s) => s.op === 'insert' && s.text.includes('beta'))).toBe(true);
    expect(r.segments.some((s) => s.op === 'insert' && s.text.includes('delta'))).toBe(true);
  });

  it('captures EVERY change across a multi-edit v1->candidate (cumulative drift trap, E8 §3)', () => {
    // Three individually-small edits accumulate; the cumulative redline surfaces the total drift.
    const v1 = 'The grantor conveys the property to the grantee in fee simple.';
    const candidate = 'The grantor conveys the parcel to the buyer in fee simple absolute.';
    const r = buildRedline(v1, candidate);
    const orig = r.segments.filter((s) => s.op !== 'insert').map((s) => s.text).join('');
    const fin = r.segments.filter((s) => s.op !== 'delete').map((s) => s.text).join('');
    expect(orig).toBe(v1); // round-trips the original exactly (no silent text loss)
    expect(fin).toBe(candidate); // round-trips the candidate exactly
    // each drift surfaced
    expect(r.segments.some((s) => s.op === 'delete' && s.text.includes('property'))).toBe(true);
    expect(r.segments.some((s) => s.op === 'insert' && s.text.includes('parcel'))).toBe(true);
    expect(r.segments.some((s) => s.op === 'delete' && s.text.includes('grantee'))).toBe(true);
    expect(r.segments.some((s) => s.op === 'insert' && s.text.includes('buyer'))).toBe(true);
    expect(r.segments.some((s) => s.op === 'insert' && s.text.includes('absolute'))).toBe(true);
  });

  it('is deterministic: byte-identical redline for identical input', () => {
    const a = buildRedline('one two three', 'one TWO three four');
    const b = buildRedline('one two three', 'one TWO three four');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('whole-text replacement: all delete then all insert, both sides round-trip', () => {
    const r = buildRedline('completely original', 'entirely new');
    const orig = r.segments.filter((s) => s.op !== 'insert').map((s) => s.text).join('');
    const fin = r.segments.filter((s) => s.op !== 'delete').map((s) => s.text).join('');
    expect(orig).toBe('completely original');
    expect(fin).toBe('entirely new');
  });
});

// ── no persistence / no egress (pure over in-memory state) ────────────────────────────────────────

describe('E4a — pure: NO persistence, NO egress (in-memory state only)', () => {
  it('makes NO network / fetch call across record, rank, unwind, and redline', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockImplementation((() => {
      throw new Error('E4a must not make any egress / DB / network call — it is pure in-memory computation');
    }) as never);
    try {
      const ledger = createDecisionLedger();
      const rr = routeSuggestion(
        sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
        PLAIN_CTX,
      );
      const e = ledger.record({
        ...recordFrom(rr, sug(0, 5), 1, 'hello', 'HELLO'),
        route: 'auto_adopt',
        offsetStart: 0,
        offsetEnd: 5,
      });
      ledger.byRisk();
      unwind(ledger, e.id, 'HELLO world');
      buildRedline('a b c', 'a x c');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('two independent ledgers do not share state (caller-owned, in-memory)', () => {
    const a = createDecisionLedger();
    const b = createDecisionLedger();
    const rr = routeSuggestion(
      sug(5, 7, { beforeText: 'a  b', afterText: 'a b', claimedClassA: 'whitespace_spacing' }),
      PLAIN_CTX,
    );
    a.record(recordFrom(rr, sug(5, 7), 1, 'a  b', 'a b'));
    expect(a.entries()).toHaveLength(1);
    expect(b.entries()).toHaveLength(0); // independent
  });
});
