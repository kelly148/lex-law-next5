/**
 * decisionLedger.ts — EXPRESS-AUTO-REVIEW-LOOP-1 E4a: the risk-ranked, UNWINDABLE decision ledger +
 * the cumulative redline — computed PURELY FROM IN-MEMORY LOOP STATE.
 *
 * E4a sits ON TOP of the E1 locus gate (locusGate.ts), the E2 router (adoptRouter.ts), and the E3 inline
 * escalation layer (inlineEscalation.ts). It records, per processed reviewer suggestion, an auditable
 * before/after decision record; ranks the records by a DETERMINISTIC risk score so the attorney triages the
 * scariest changes first; supports a pure ONE-CLICK UNWIND of a single adopted change without corrupting any
 * other recorded offset; and produces a deterministic cumulative v1->candidate REDLINE.
 *
 * THE SPLIT (build spec §E4 vs the operator gate):
 *   - E4a (THIS module) is the IN-MEMORY COMPUTATION ONLY — pure functions over loop state. A per-decision
 *     before/after record, a risk-ranked view, a one-click unwind, and the full v1->candidate redline. There
 *     is NO DATABASE here: no table, no column, no migration, no query, no persistence call.
 *   - E4b (DEFERRED, migration-gated, operator-gated — NOT in this increment) is the DURABLE PERSISTENCE of
 *     this ledger to the DB. If anything in the loop needs persistence, that is E4b; STOP and surface it.
 *
 * PURE + deterministic + no-egress + flag-dark. Same inputs -> byte-identical entries, ranking, unwind, and
 * redline. No LLM, no DB, no dependency, no migration. The ledger's append-only record is the ONLY mutable
 * state and it is OWNED BY THE CALLER (E5's loop owns exactly one ledger per document). Nothing here wires
 * into a live procedure; the whole Express program is flag-dark (AUTO_REVIEW_LOOP_ENABLED default OFF) and
 * E5 owns the wiring.
 *
 * THE ARCHITECTURAL INVARIANT (carried from E1): risk RANKING is for the attorney's REVIEW TRIAGE only. It
 * NEVER changes a route. A route is fixed by E1/E2/E3 before the entry is ever recorded; the ledger only
 * observes and orders. There is no path in this module by which a risk score adopts or escalates anything.
 */

import type { AdoptRoute, RouteResult } from './adoptRouter.js';
import type { LocusResult } from './locusGate.js';
import type { InlineEscalationEvent } from './inlineEscalation.js';
import type { ProtectedSpanLabel } from './protectedSpans.js';

// ── the per-decision ledger entry ──────────────────────────────────────────────────────────────────

/**
 * One recorded decision: everything needed to (a) audit WHY a suggestion was adopted or escalated, (b) rank
 * it for review triage, and (c) UNWIND it deterministically. Pure data; no methods, no DB identity.
 */
export interface LedgerEntry {
  /** A stable, deterministic id ('e' + round + '-' + sequence-within-round). Byte-identical across runs for
   *  the same recording order — never a random/uuid value (that would break determinism). */
  id: string;
  /** The loop pass / round number this decision was made in (E5's bounded loop; round 1, 2, ...). */
  round: number;
  /** The terminal route this suggestion received from E2/E3 (the ledger never re-decides it). */
  route: AdoptRoute;
  /** The full E1 locus verdict (intersected protected spans, deletion/defined-term rails, model-raise). */
  locus: LocusResult;
  /** The E2 Class-A classification when the locus cleared; null when the gate escalated (E2 set it null). */
  classA: RouteResult['classA'];
  /** True when E2 escalation-immutability forced this escalate (a prior pass escalated this/an overlapping
   *  locus). Recorded for audit and used as a risk signal. */
  immutabilityForced: boolean;
  /** The E3 inline-escalation event when one fired (near-boundary / low-confidence / classifier flag); null
   *  otherwise. Recorded for audit and used as a risk signal. */
  inlineEvent: InlineEscalationEvent | null;
  /** The operative diff target: the BEFORE text occupying [offsetStart, offsetEnd) at record time. */
  beforeText: string;
  /** The operative diff target: the AFTER text the suggestion put (or would put) there. For an escalate this
   *  is the proposed-but-not-applied text; for an auto_adopt it is the text actually applied. */
  afterText: string;
  /** The normalized char offset of the change in the document text AS OF this round (start). */
  offsetStart: number;
  /** The normalized char offset of the change (exclusive end of the BEFORE range). */
  offsetEnd: number;
  /** True when the suggestion removed text (carried from the locus suggestion). */
  isDeletion: boolean;
  /** True once this entry's adopted change has been reverted via unwind(); escalations are never "applied" so
   *  they are not unwindable, and this stays false for them. */
  reverted: boolean;
  /** The deterministic risk score (higher = scarier; see scoreRisk). Stable for identical input. */
  riskScore: number;
  /** The coarse risk bucket derived from riskScore (for at-a-glance triage). */
  riskBucket: RiskBucket;
}

/** Coarse risk bucket for at-a-glance triage. */
export type RiskBucket = 'high' | 'medium' | 'low';

/**
 * The minimal record the caller hands the ledger for one processed suggestion. The ledger derives the
 * LedgerEntry (id, risk score/bucket) from it; the caller supplies the route + the E1/E2/E3 results + the
 * operative diff. All fields are pure data already computed upstream — the ledger adds no new decision.
 */
export interface DecisionRecord {
  round: number;
  route: AdoptRoute;
  locus: LocusResult;
  classA: RouteResult['classA'];
  immutabilityForced: boolean;
  inlineEvent: InlineEscalationEvent | null;
  beforeText: string;
  afterText: string;
  offsetStart: number;
  offsetEnd: number;
  isDeletion: boolean;
}

// ── deterministic risk ranking ──────────────────────────────────────────────────────────────────────
//
// Ranking is REVIEW-TRIAGE ONLY — it NEVER changes a route. The score orders entries so the attorney sees the
// scariest decisions first. The function is a pure, documented sum of additive signals; same input -> same
// score -> same order. The dominant axis is route (escalations always outrank auto-adopts), then WHICH
// protected span was hit, then the deletion / defined-term / immutability / inline signals.

/**
 * Per-protected-span risk weight. The most operative, hardest-to-reverse elements weigh most: the verbatim
 * legal description, the granting clause, the warranty, amounts, governing law, vesting, and the defined-term
 * DEFINITION site are the top tier; recitals and structural blocks are mid; everything else is a base weight.
 * Used only to ORDER escalations among themselves — it never flips a route.
 */
const SPAN_RISK_WEIGHT: Record<ProtectedSpanLabel, number> = {
  legal_description: 100,
  granting_clause: 95,
  warranty_covenant: 92,
  amounts: 90,
  governing_law_venue: 88,
  vesting_recital_of_title: 85,
  defined_terms_definitions: 84,
  habendum: 80,
  exceptions_reservations: 78,
  party_identities_capacity: 76,
  exemption_recital: 60,
  consideration_recital: 58,
  dates: 55,
  signature_acknowledgment_notary: 50,
};

/** The additive risk signals (documented constants so the scoring is auditable and stable). */
const RISK = {
  /** An escalation always outranks any auto-adopt: a base floor no auto-adopt can reach. */
  ESCALATION_BASE: 1000,
  /** A deletion is high risk wherever it lands (removal of operative text). */
  DELETION: 70,
  /** Touching a defined term (definition site or a tracked occurrence). */
  DEFINED_TERM: 65,
  /** Escalation-immutability forced it (a prior pass escalated this locus — anti-laundering signal). */
  IMMUTABILITY_FORCED: 40,
  /** An E3 inline near-boundary escalation (hugging operative text). */
  INLINE_NEAR_BOUNDARY: 30,
  /** An E3 low-confidence / classifier-escalate-flag inline escalation. */
  INLINE_CLASSIFIER: 20,
  /** The additive model hint raised the escalation. */
  MODEL_RAISED: 10,
} as const;

/** Risk-bucket cutoffs over the score. high: any escalation-tier or a top protected span; medium: a notable
 *  single signal; low: a clean auto-adopt. Documented + stable. */
const BUCKET_HIGH_FLOOR = RISK.ESCALATION_BASE; // any escalation is at least 'high'
const BUCKET_MEDIUM_FLOOR = 50; // an auto-adopt carrying a notable signal (rare — auto-adopts are clean)

/**
 * The DETERMINISTIC risk score for one decision. Higher = scarier. PURE: same record -> same number.
 *
 * Construction (additive, auditable):
 *   - route 'escalate'        -> + ESCALATION_BASE (so EVERY escalation outranks EVERY auto-adopt), PLUS
 *                                the max protected-span weight it intersected (which span is the scariest),
 *                                PLUS deletion / defined-term / immutability / inline / model-raise signals.
 *   - route 'auto_adopt'      -> starts at 0; an auto-adopt that somehow still carries a signal (it normally
 *                                carries none — it is locus-clean + Class-A) ranks above a bare auto-adopt,
 *                                but ALWAYS below any escalation.
 *
 * Among escalations, the protected-span weight dominates the ordering (legal_description/amounts/granting at
 * the top), exactly as the build spec requires ("operative-adjacent, deletions, escalations to the top").
 */
export function scoreRisk(record: DecisionRecord): number {
  let score = 0;

  if (record.route === 'escalate') {
    score += RISK.ESCALATION_BASE;
  }

  // WHICH protected span(s) were intersected — take the MAX weight (the scariest element decides the rank).
  let maxSpanWeight = 0;
  for (const span of record.locus.intersectedSpans) {
    const w = SPAN_RISK_WEIGHT[span.label];
    if (w > maxSpanWeight) maxSpanWeight = w;
  }
  score += maxSpanWeight;

  // Deterministic rails + signals (each fires at most once; all read from already-computed upstream results).
  if (record.isDeletion || record.locus.isDeletion) score += RISK.DELETION;
  if (record.locus.touchedDefinedTerm) score += RISK.DEFINED_TERM;
  if (record.immutabilityForced) score += RISK.IMMUTABILITY_FORCED;
  if (record.locus.modelRaisedEscalation) score += RISK.MODEL_RAISED;

  if (record.inlineEvent !== null) {
    score +=
      record.inlineEvent.reasonCode === 'near_boundary' ? RISK.INLINE_NEAR_BOUNDARY : RISK.INLINE_CLASSIFIER;
  }

  return score;
}

/** Map a score to its coarse bucket. Deterministic. */
export function bucketForScore(score: number): RiskBucket {
  if (score >= BUCKET_HIGH_FLOOR) return 'high';
  if (score >= BUCKET_MEDIUM_FLOOR) return 'medium';
  return 'low';
}

// ── the in-memory, append-only ledger ────────────────────────────────────────────────────────────────

/**
 * The in-memory DECISION LEDGER: an append-only record of LedgerEntries for one document/loop. Caller-owned
 * (E5's loop owns exactly one per document). The ONLY mutable state in E4a. NO persistence — purely in-memory.
 *
 * Accessors return COPIES / sorted views so a consumer can never mutate the internal record by reference.
 */
export interface DecisionLedger {
  /** Record one processed suggestion. Derives the stable id + risk score/bucket and appends. Returns the
   *  created entry (a reference into the ledger — callers should treat it read-only). */
  record(record: DecisionRecord): LedgerEntry;
  /** All entries in RECORDING order (a defensive shallow copy). */
  entries(): LedgerEntry[];
  /** All entries RISK-RANKED (highest score first; ties broken deterministically by round, then offset, then
   *  id) — the attorney's triage view. A defensive copy; never mutates the recording order. */
  byRisk(): LedgerEntry[];
  /** Look up a single entry by its stable id; undefined if absent. */
  get(id: string): LedgerEntry | undefined;
  /** Internal: mark an entry reverted (used by unwind()). Returns the entry, or undefined if the id is absent.
   *  Exposed on the interface so unwind() — a free function — can flag the entry without a back-channel. */
  markReverted(id: string): LedgerEntry | undefined;
}

/** Construct a fresh, empty ledger for one document/loop. */
export function createDecisionLedger(): DecisionLedger {
  const internal: LedgerEntry[] = [];
  // Per-round sequence counter for the deterministic id (e<round>-<seq>).
  const seqByRound = new Map<number, number>();

  function makeId(round: number): string {
    const next = (seqByRound.get(round) ?? 0) + 1;
    seqByRound.set(round, next);
    return `e${round}-${next}`;
  }

  function record(rec: DecisionRecord): LedgerEntry {
    const riskScore = scoreRisk(rec);
    const entry: LedgerEntry = {
      id: makeId(rec.round),
      round: rec.round,
      route: rec.route,
      locus: rec.locus,
      classA: rec.classA,
      immutabilityForced: rec.immutabilityForced,
      inlineEvent: rec.inlineEvent,
      beforeText: rec.beforeText,
      afterText: rec.afterText,
      offsetStart: rec.offsetStart,
      offsetEnd: rec.offsetEnd,
      isDeletion: rec.isDeletion,
      reverted: false,
      riskScore,
      riskBucket: bucketForScore(riskScore),
    };
    internal.push(entry);
    return entry;
  }

  function entries(): LedgerEntry[] {
    return internal.slice();
  }

  function byRisk(): LedgerEntry[] {
    // Stable, deterministic ordering: score DESC, then round ASC, then offsetStart ASC, then id ASC. Sorting a
    // copy keeps the recording order intact.
    return internal.slice().sort((a, b) => {
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      if (a.round !== b.round) return a.round - b.round;
      if (a.offsetStart !== b.offsetStart) return a.offsetStart - b.offsetStart;
      return a.id.localeCompare(b.id);
    });
  }

  function get(id: string): LedgerEntry | undefined {
    return internal.find((e) => e.id === id);
  }

  function markReverted(id: string): LedgerEntry | undefined {
    const e = internal.find((x) => x.id === id);
    if (e === undefined) return undefined;
    e.reverted = true;
    return e;
  }

  return { record, entries, byRisk, get, markReverted };
}

// ── one-click UNWIND (pure over the ledger + current text) ───────────────────────────────────────────

/** The result of unwinding a single adopted change. */
export interface UnwindResult {
  /** The document text with the one adopted change reverted (afterText -> beforeText at its located offset). */
  text: string;
  /** The entry that was reverted (now flagged reverted in the ledger). */
  reverted: LedgerEntry;
}

/** A typed error for an unwind that cannot be performed deterministically (caller decides how to surface). */
export class UnwindError extends Error {
  constructor(
    message: string,
    /** A stable machine code so callers/tests can assert the failure class. */
    readonly code:
      | 'unknown_entry'
      | 'not_adopted'
      | 'already_reverted'
      | 'after_text_not_found'
      | 'after_text_ambiguous',
  ) {
    super(message);
    this.name = 'UnwindError';
  }
}

/**
 * ONE-CLICK UNWIND of a single ADOPTED change — PURE over (ledger, entryId, currentText). It reverts exactly
 * one applied change by replacing its recorded AFTER text back with its recorded BEFORE text in `currentText`,
 * and flags the entry reverted in the ledger (the unwind is itself auditable — the entry carries the record).
 *
 * OFFSET INTEGRITY across MULTIPLE adopted changes (the load-bearing guarantee, proven in tests):
 *   The stored offsetStart was correct at RECORD time, but later adopts (or other unwinds) shift it. So unwind
 *   does NOT blindly splice at the stored offset. Instead it RECOMPUTES the location against `currentText`:
 *     1. It searches `currentText` for the recorded afterText, ANCHORED at/after the recorded offsetStart so
 *        that when the same afterText appears more than once the recorded offset disambiguates which one (the
 *        first occurrence AT-OR-AFTER the recorded start that has not drifted earlier; if none at-or-after, it
 *        falls back to the nearest occurrence to the recorded start). This makes the unwind robust to the
 *        upstream/downstream offset shift caused by other adopted changes of different lengths.
 *     2. If the afterText occurs MORE THAN ONCE and the recorded offset cannot disambiguate to a single
 *        occurrence, it refuses (after_text_ambiguous) rather than corrupt a different occurrence — caller
 *        surfaces it. (Deterministic refusal beats a silent wrong revert.)
 *     3. It splices beforeText in for that single located afterText. Because it locates by CONTENT (not a
 *        stale absolute offset), reverting one entry does NOT corrupt any OTHER entry's revertability: each
 *        other entry still locates ITS own afterText by content against the new currentText.
 *
 * Only an ADOPTED (route 'auto_adopt'), not-yet-reverted, non-deletion-with-empty-after entry is unwindable —
 * an escalation was never applied, so there is nothing to revert (not_adopted).
 */
export function unwind(ledger: DecisionLedger, entryId: string, currentText: string): UnwindResult {
  const entry = ledger.get(entryId);
  if (entry === undefined) {
    throw new UnwindError(`No ledger entry with id "${entryId}".`, 'unknown_entry');
  }
  if (entry.route !== 'auto_adopt') {
    throw new UnwindError(
      `Entry "${entryId}" was escalated, not adopted — nothing was applied, so there is nothing to unwind.`,
      'not_adopted',
    );
  }
  if (entry.reverted) {
    throw new UnwindError(`Entry "${entryId}" was already reverted.`, 'already_reverted');
  }

  const located = locateAfterText(currentText, entry.afterText, entry.offsetStart);
  if (located === 'not_found') {
    throw new UnwindError(
      `Could not locate the adopted text for entry "${entryId}" in the current document — it may have been ` +
        'further edited; unwind refuses rather than corrupt the text.',
      'after_text_not_found',
    );
  }
  if (located === 'ambiguous') {
    throw new UnwindError(
      `The adopted text for entry "${entryId}" occurs multiple times and the recorded offset cannot ` +
        'disambiguate which to revert; unwind refuses rather than corrupt a different occurrence.',
      'after_text_ambiguous',
    );
  }

  const at = located.index;
  const text = currentText.slice(0, at) + entry.beforeText + currentText.slice(at + entry.afterText.length);

  const reverted = ledger.markReverted(entryId);
  // markReverted returns the same entry we already fetched (ledger.get found it); narrow defensively.
  return { text, reverted: reverted ?? entry };
}

/**
 * Locate the single occurrence of `afterText` in `currentText` to revert, using the recorded `offsetStart` to
 * disambiguate. PURE + deterministic.
 *
 * - An EMPTY afterText (a pure insertion's other side, or a degenerate record) is not locatable by content;
 *   we treat it as not_found (caller cannot deterministically pick a zero-width point after drift).
 * - ONE occurrence -> use it (the offset is irrelevant; content is unique).
 * - MULTIPLE occurrences -> pick the occurrence NEAREST the recorded offsetStart (smallest |index - start|);
 *   if two occurrences are EQUIDISTANT (a genuine tie) it is ambiguous -> refuse. This keeps the choice
 *   deterministic and content-anchored, robust to the offset drift other adopts introduce, while refusing the
 *   rare true ambiguity instead of guessing.
 */
function locateAfterText(
  currentText: string,
  afterText: string,
  recordedStart: number,
): { index: number } | 'not_found' | 'ambiguous' {
  if (afterText.length === 0) return 'not_found';

  const occurrences: number[] = [];
  let from = 0;
  for (;;) {
    const idx = currentText.indexOf(afterText, from);
    if (idx === -1) break;
    occurrences.push(idx);
    from = idx + 1; // allow overlapping occurrences (conservative; ambiguity is refused anyway)
  }

  if (occurrences.length === 0) return 'not_found';
  if (occurrences.length === 1) return { index: occurrences[0]! };

  // Multiple occurrences: choose the one nearest the recorded start; a distance tie is a true ambiguity.
  let best = occurrences[0]!;
  let bestDist = Math.abs(best - recordedStart);
  let tie = false;
  for (let i = 1; i < occurrences.length; i++) {
    const d = Math.abs(occurrences[i]! - recordedStart);
    if (d < bestDist) {
      best = occurrences[i]!;
      bestDist = d;
      tie = false;
    } else if (d === bestDist) {
      tie = true;
    }
  }
  if (tie) return 'ambiguous';
  return { index: best };
}

// ── cumulative redline (pure word-level diff, no dependency) ──────────────────────────────────────────

/** One segment of the structured redline. 'equal' text is unchanged; 'delete' was in the original and is
 *  gone; 'insert' is new in the final. A change is a 'delete' immediately followed by an 'insert'. */
export interface RedlineSegment {
  op: 'equal' | 'delete' | 'insert';
  /** The text of this segment (a run of one or more original tokens for equal/delete, or final tokens for
   *  insert), reconstructed verbatim including the whitespace between tokens. */
  text: string;
}

/** The structured cumulative redline: the ordered segments plus a couldn't-be-simpler change flag. */
export interface Redline {
  segments: RedlineSegment[];
  /** True when original === final (no change at all) — segments is then a single 'equal' (or empty). */
  unchanged: boolean;
}

/**
 * Tokenize into a sequence of [token, trailingWhitespace] pairs so the diff is WORD-level (readable for an
 * attorney) yet REVERSIBLE — concatenating token+trailing across the sequence reproduces the input verbatim.
 * Deterministic. A token is a maximal run of non-whitespace; trailing is the whitespace run after it (possibly
 * empty at end-of-text). A leading-whitespace-only input yields one empty-token pair carrying the whitespace.
 */
function tokenize(text: string): Array<{ tok: string; ws: string }> {
  const out: Array<{ tok: string; ws: string }> = [];
  const re = /(\S+)(\s*)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ tok: m[1]!, ws: m[2]! });
    lastIndex = re.lastIndex;
  }
  // Capture any leading/trailing whitespace-only remainder (e.g. a string that is ONLY whitespace).
  if (out.length === 0 && text.length > 0) {
    out.push({ tok: '', ws: text });
  } else if (lastIndex < text.length) {
    // Should not happen with the regex above, but keep the round-trip exact if it ever does.
    out.push({ tok: '', ws: text.slice(lastIndex) });
  }
  return out;
}

/**
 * The full text a token-pair contributes (token then its trailing whitespace) — used to reconstruct segment
 * text verbatim so the redline round-trips.
 */
function pairText(p: { tok: string; ws: string }): string {
  return p.tok + p.ws;
}

/**
 * Longest-common-subsequence over the TOKEN strings (ignoring trailing whitespace for the MATCH, but carrying
 * it for reconstruction). Classic DP LCS — deterministic, no dependency. Returns the LCS as a list of matched
 * index pairs (i in original, j in final), in order.
 */
function lcsMatches(a: Array<{ tok: string }>, b: Array<{ tok: string }>): Array<{ i: number; j: number }> {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:]. (n+1) x (m+1). Small loop inputs (a document's tokens).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i]!.tok === b[j]!.tok ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: Array<{ i: number; j: number }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i]!.tok === b[j]!.tok) {
      out.push({ i, j });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

/**
 * BUILD the cumulative v1->candidate REDLINE — a deterministic, word-level structured diff suitable for an
 * attorney to read. PURE; NO new dependency (a small LCS written here). Identical texts -> a single 'equal'
 * segment (or empty) with unchanged=true; deterministic (byte-identical Redline for identical input).
 *
 * The segments, concatenated, round-trip: the 'equal' + 'delete' segments reconstruct the ORIGINAL verbatim,
 * and the 'equal' + 'insert' segments reconstruct the FINAL verbatim — so an attorney sees EVERY change and a
 * test can prove no text was silently dropped.
 */
export function buildRedline(originalText: string, finalText: string): Redline {
  if (originalText === finalText) {
    return {
      segments: originalText.length > 0 ? [{ op: 'equal', text: originalText }] : [],
      unchanged: true,
    };
  }

  const a = tokenize(originalText);
  const b = tokenize(finalText);
  const matches = lcsMatches(a, b);

  const segments: RedlineSegment[] = [];
  let ai = 0;
  let bi = 0;

  /** Append text to a segment of the given op, MERGING with the previous segment if it shares the op (so runs
   *  of deletes/inserts/equals coalesce into readable blocks). */
  const push = (op: RedlineSegment['op'], text: string): void => {
    if (text.length === 0) return;
    const last = segments[segments.length - 1];
    if (last !== undefined && last.op === op) {
      last.text += text;
    } else {
      segments.push({ op, text });
    }
  };

  for (const match of matches) {
    // Everything in `a` before this match index is a DELETE; everything in `b` before is an INSERT.
    while (ai < match.i) {
      push('delete', pairText(a[ai]!));
      ai++;
    }
    while (bi < match.j) {
      push('insert', pairText(b[bi]!));
      bi++;
    }
    // The matched TOKEN is EQUAL. Its trailing WHITESPACE, however, can differ between the two sides (e.g. the
    // token is mid-line in one and end-of-text in the other). To keep BOTH sides' reconstruction verbatim, emit
    // the token as 'equal', then reconcile the whitespace: identical -> 'equal'; differing -> the original's ws
    // is a 'delete' and the final's ws an 'insert'. (A pure-whitespace change thus surfaces explicitly while the
    // word stays equal — the intended word-level granularity, with no silent text loss on either side.)
    const ap = a[ai]!;
    const bp = b[bi]!;
    push('equal', ap.tok);
    if (ap.ws === bp.ws) {
      push('equal', ap.ws);
    } else {
      push('delete', ap.ws);
      push('insert', bp.ws);
    }
    ai++;
    bi++;
  }
  // Trailing remainder after the last match.
  while (ai < a.length) {
    push('delete', pairText(a[ai]!));
    ai++;
  }
  while (bi < b.length) {
    push('insert', pairText(b[bi]!));
    bi++;
  }

  return { segments, unchanged: false };
}
