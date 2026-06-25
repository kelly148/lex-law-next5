/**
 * adoptRouter.ts — EXPRESS-AUTO-REVIEW-LOOP-1 E2: ADOPT / ESCALATE ROUTING + escalation IMMUTABILITY.
 *
 * E2 sits DIRECTLY ON TOP of the E1 locus gate (locusGate.ts). It does ONE thing: turn the gate's
 * eligibility verdict into a routing decision — 'auto_adopt' | 'escalate' — and guarantee that an
 * escalation can NEVER be quietly undone later in the loop.
 *
 * THE TWO RULINGS E2 ENFORCES (build spec §E2; E8 §2/§3):
 *
 *  1. CLASS-A SAFE HARBOR is the ONLY auto-adopt-eligible set. Of the suggestions the locus gate rules
 *     AUTO-ADOPT-ELIGIBLE (it landed in non-protected text, is not a deletion, edits no defined term),
 *     only the genuinely MECHANICAL, content-neutral fixes — whitespace/spacing normalization, an
 *     obvious typo fix, punctuation, casing of a non-operative word, numbering, verified cross-ref repair,
 *     non-operative grammar, BYTE-IDENTICAL literal-duplicate removal — may auto-adopt. ANY eligible-but-
 *     still-substantive change still escalates. The classifier is DETERMINISTIC and CONSERVATIVE: when it
 *     cannot prove a change is purely mechanical, it ESCALATES. (Over-escalation is acceptable; a silent
 *     substantive adopt is the one bug that matters — E8 ship gate.)
 *
 *  2. ESCALATION IMMUTABILITY. Once any suggestion targeting a span/range has escalated, that locus is
 *     recorded in an append-only, in-memory tracker. A LATER suggestion that targets the SAME or an
 *     OVERLAPPING range is FORCED to escalate — even if it now presents as flawless Class-A. The
 *     immutability set can ONLY GROW; an escalated locus NEVER becomes adoptable within the loop. This is
 *     the anti-laundering rail: a model cannot wear down an escalation by re-proposing the same operative
 *     change dressed as "style".
 *
 * THE SINGLE PATH TO 'auto_adopt' (proved structurally below):
 *     locus gate verdict === 'auto_adopt_eligible'   (E1 — WHERE it lands)
 *   AND classifyClassA(...) === Class-A               (E2 — mechanical & content-neutral)
 *   AND the locus is NOT in the immutability tracker  (E2 — never re-adopt an escalated locus)
 * There is no other path. The model's own "safe" label is NEVER consulted for the adopt direction —
 * the gate already ignores it (additive-only), and E2 adds no label-driven adopt path.
 *
 * PURE + deterministic over its inputs. The tracker is the ONLY mutable state and it is OWNED BY THE
 * CALLER (E5's loop owns one tracker per document/loop). No LLM, no DB, no egress, no migration, no new
 * dependency — in-loop memory only. Flag-dark with the rest of Express (isAutoReviewLoopEnabled); E2 is
 * NOT wired into any live procedure (E5 owns the loop).
 */

import { evaluateLocus, type LocusResult, type LocusSuggestion } from './locusGate.js';
import type { ProtectedSpan } from './protectedSpans.js';

/** The terminal routing decision for a single reviewer suggestion. */
export type AdoptRoute = 'auto_adopt' | 'escalate';

/**
 * The deterministic Class-A category of a mechanical, content-neutral fix. These are the ONLY categories
 * that may auto-adopt (and only after the locus gate clears the change). Anything not provably one of
 * these escalates. (Build spec §E2 safe-harbor enumeration.)
 */
export type ClassACategory =
  | 'whitespace_spacing'
  | 'punctuation'
  | 'casing_non_operative'
  | 'typo_fix'
  | 'numbering'
  | 'cross_reference_repair'
  | 'non_operative_grammar'
  | 'literal_duplicate_removal';

/**
 * A reviewer suggestion as the ROUTER sees it. It is a strict SUPERSET of the locus gate's LocusSuggestion
 * (the gate reads only the locus fields), plus the deterministic CONTENT fields the Class-A classifier needs
 * to prove a change is mechanical. The router NEVER passes any of these content fields to the gate, and the
 * gate's verdict NEVER depends on them — E1 decides on locus alone; E2 only further RESTRICTS toward escalate.
 */
export interface RoutableSuggestion extends LocusSuggestion {
  /** The exact text currently occupying [targetStart, targetEnd) in the document (what the edit replaces). */
  beforeText?: string | undefined;
  /** The exact text the suggestion proposes to put there. */
  afterText?: string | undefined;
  /**
   * The Class-A category the suggestion CLAIMS (advisory — like the model "safe" hint, this can never by
   * itself authorize an adopt). The classifier VERIFIES the claim against before/after text; an unverifiable
   * or mismatched claim ESCALATES. A claim is REQUIRED for auto-adopt — no claim means "not asserted
   * mechanical" → escalate.
   */
  claimedClassA?: ClassACategory | undefined;
}

/** Why the Class-A classifier ruled the change mechanical (or not). Byte-identical for identical input. */
export interface ClassAResult {
  /** True only when the change is a PROVEN member of the Class-A safe harbor. */
  isClassA: boolean;
  /** The verified category when isClassA; null otherwise. */
  category: ClassACategory | null;
  /** A stable, human-readable explanation (the verification that passed, or the first reason it failed). */
  reason: string;
}

/** The auditable routing result. */
export interface RouteResult {
  route: AdoptRoute;
  /** A stable explanation leading with the deciding factor (gate escalation, immutability, or Class-A miss). */
  reason: string;
  /** The full E1 locus verdict (for the E4 ledger). */
  locus: LocusResult;
  /** The Class-A classification (only meaningful when the locus cleared; null when the gate escalated). */
  classA: ClassAResult | null;
  /** True when escalation IMMUTABILITY forced this escalate (a prior pass escalated this/an overlapping locus). */
  immutabilityForced: boolean;
}

/** Everything routeSuggestion needs from the caller, besides the suggestion. Pure inputs. */
export interface RouteContext {
  protectedSpans: readonly ProtectedSpan[];
  documentText: string;
  /** Optional defined-term tracking, forwarded verbatim to the locus gate. */
  definedTerms?: readonly string[] | undefined;
}

// ── Class-A safe-harbor classifier (deterministic, conservative) ─────────────────────────────────────

/** Collapse runs of ASCII whitespace to a single space and trim — for "same content, only spacing changed". */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Strip ASCII whitespace entirely — for "letters/digits unchanged, only spacing/case differs" comparisons. */
function stripWhitespace(s: string): string {
  return s.replace(/\s+/g, '');
}

/** The non-alphanumeric, non-space characters we treat as PUNCTUATION for the punctuation-only harbor. */
const PUNCTUATION_RE = /[.,;:!?'"()[\]{}—–/\\-]/g;

/** Letters+digits only (drop whitespace AND punctuation) — the "operative content" skeleton of a string. */
function alphaNumOnly(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, '');
}

/**
 * Deterministically VERIFY whether (beforeText -> afterText) is a genuine member of the Class-A safe harbor.
 *
 * CONSERVATIVE BY CONSTRUCTION — every harbor REQUIRES a positive proof, and ANY failure to prove falls
 * through to escalate:
 *  - the suggestion must CLAIM a Class-A category (no claim -> not asserted mechanical -> escalate),
 *  - before/after text must both be present (we cannot verify a mechanical change we cannot see),
 *  - the claim must be VERIFIED by the deterministic check for that category (a mismatched claim -> escalate),
 *  - a change that alters the alphanumeric content in any way that the claimed harbor does not explicitly
 *    permit -> escalate.
 *
 * It NEVER trusts the claim alone (the claim is exactly as weak as the model "safe" hint the gate ignores);
 * the verification is what authorizes, and only the verification.
 */
export function classifyClassA(suggestion: RoutableSuggestion): ClassAResult {
  const claim = suggestion.claimedClassA;
  if (claim === undefined) {
    return { isClassA: false, category: null, reason: 'NOT-CLASS-A: no mechanical category asserted — escalate (conservative default).' };
  }
  if (suggestion.isDeletion) {
    // A deletion never reaches here (the gate escalates it first), but be defensive: removal is never Class-A.
    return { isClassA: false, category: null, reason: 'NOT-CLASS-A: a deletion is never mechanical safe-harbor — escalate.' };
  }
  const before = suggestion.beforeText;
  const after = suggestion.afterText;
  if (before === undefined || after === undefined) {
    return { isClassA: false, category: null, reason: 'NOT-CLASS-A: before/after text absent — a mechanical change cannot be verified — escalate.' };
  }
  if (before === after) {
    // A no-op is pointless to adopt; treat as not-Class-A so the loop never "adopts" nothing.
    return { isClassA: false, category: null, reason: 'NOT-CLASS-A: before === after (no change) — nothing to adopt — escalate.' };
  }

  switch (claim) {
    case 'whitespace_spacing': {
      // PROOF: the two strings are identical once whitespace is normalized — only spacing differs.
      if (normalizeWhitespace(before) === normalizeWhitespace(after)) {
        return { isClassA: true, category: 'whitespace_spacing', reason: 'CLASS-A whitespace_spacing: identical after whitespace normalization (only spacing changed).' };
      }
      return { isClassA: false, category: null, reason: 'NOT-CLASS-A: claimed whitespace-only but the non-whitespace content differs — escalate.' };
    }

    case 'casing_non_operative': {
      // PROOF: identical ignoring case (and whitespace) — only letter case changed. CONSERVATIVE: this only
      // ever runs on a locus-eligible (NON-protected, non-defined-term) span, so the case-changed word is
      // non-operative by construction (an operative term's casing lives in a protected span / defined term).
      if (stripWhitespace(before).toLowerCase() === stripWhitespace(after).toLowerCase()) {
        return { isClassA: true, category: 'casing_non_operative', reason: 'CLASS-A casing_non_operative: identical ignoring case (only non-operative casing changed).' };
      }
      return { isClassA: false, category: null, reason: 'NOT-CLASS-A: claimed casing-only but the letters/digits differ — escalate.' };
    }

    case 'punctuation': {
      // PROOF: identical once punctuation AND whitespace are removed — only punctuation/spacing changed.
      const b = stripWhitespace(before).replace(PUNCTUATION_RE, '');
      const a = stripWhitespace(after).replace(PUNCTUATION_RE, '');
      if (b === a && b.length > 0) {
        return { isClassA: true, category: 'punctuation', reason: 'CLASS-A punctuation: identical once punctuation/spacing removed (only punctuation changed).' };
      }
      return { isClassA: false, category: null, reason: 'NOT-CLASS-A: claimed punctuation-only but the alphanumeric content differs — escalate.' };
    }

    case 'numbering': {
      // PROOF: the change is confined to digit/numbering-glyph characters and surrounding punctuation; the
      // ALPHABETIC content is unchanged. CONSERVATIVE: an amount/date lives in a protected span, so a digit
      // edit there never reaches here — this harbor only ever runs on a non-protected list/numbering token.
      const beforeAlpha = before.replace(/[^A-Za-z]/g, '');
      const afterAlpha = after.replace(/[^A-Za-z]/g, '');
      if (beforeAlpha === afterAlpha && beforeAlpha.length > 0) {
        return { isClassA: true, category: 'numbering', reason: 'CLASS-A numbering: alphabetic content unchanged; only list-numbering/punctuation differs.' };
      }
      // If there is NO alphabetic content at all (a pure number), we refuse — a bare number is an amount/date
      // risk we will not auto-edit outside a recognized protected span.
      return { isClassA: false, category: null, reason: 'NOT-CLASS-A: claimed numbering but the alphabetic content changed (or it is a bare number) — escalate.' };
    }

    case 'non_operative_grammar':
    case 'cross_reference_repair':
    case 'typo_fix': {
      // PROOF for the "content-changing but tiny & mechanical" harbors. These genuinely alter letters (a typo
      // fix changes a character; a cross-ref repair changes a digit/letter). We CANNOT prove semantic
      // harmlessness deterministically, so we bound them HARD and CONSERVATIVELY:
      //   - the alphanumeric edit distance must be at most ONE token's worth of change, AND
      //   - the change must be SMALL in absolute size (<= MAX_MECHANICAL_DELTA chars of alphanumeric drift),
      //   - the change must NOT add or remove a whole word (no word-count change) for grammar/cross-ref,
      //   - and the locus gate has ALREADY proven it lands in non-protected, non-defined-term text.
      // Anything larger is "eligible but substantive" and ESCALATES — the safe harbor stays narrow.
      const bAlpha = alphaNumOnly(before);
      const aAlpha = alphaNumOnly(after);
      const drift = Math.abs(bAlpha.length - aAlpha.length);
      const editish = levenshteinBounded(bAlpha, aAlpha, MAX_MECHANICAL_DELTA + 1);

      if (editish > MAX_MECHANICAL_DELTA) {
        return { isClassA: false, category: null, reason: `NOT-CLASS-A: claimed ${claim} but the change exceeds the mechanical bound (edit ${editish} > ${MAX_MECHANICAL_DELTA}) — escalate.` };
      }
      if (drift > MAX_MECHANICAL_DELTA) {
        return { isClassA: false, category: null, reason: `NOT-CLASS-A: claimed ${claim} but too much content drifts (${drift} chars) — escalate.` };
      }
      if (claim !== 'typo_fix') {
        // grammar / cross-ref repair must not change the WORD COUNT (no clause added/removed).
        const bWords = normalizeWhitespace(before).split(' ').filter((w) => w.length > 0).length;
        const aWords = normalizeWhitespace(after).split(' ').filter((w) => w.length > 0).length;
        if (bWords !== aWords) {
          return { isClassA: false, category: null, reason: `NOT-CLASS-A: claimed ${claim} but the word count changed (${bWords} -> ${aWords}) — escalate.` };
        }
      }
      return { isClassA: true, category: claim, reason: `CLASS-A ${claim}: a bounded mechanical edit (alphanumeric edit ${editish} <= ${MAX_MECHANICAL_DELTA}) in locus-eligible text.` };
    }

    case 'literal_duplicate_removal': {
      // PROOF (E8 §2): a duplicate removal qualifies ONLY when the removed run is BYTE-IDENTICAL to retained
      // text — a NEAR-duplicate never qualifies (a near-duplicate protective clause must escalate). We model
      // "removal of a literal duplicate" as: afterText is beforeText with one BYTE-IDENTICAL contiguous repeat
      // collapsed. Conservative: any non-identical "near duplicate" fails this check and escalates.
      if (isLiteralDuplicateCollapse(before, after)) {
        return { isClassA: true, category: 'literal_duplicate_removal', reason: 'CLASS-A literal_duplicate_removal: a byte-identical contiguous repeat was collapsed (no content lost).' };
      }
      return { isClassA: false, category: null, reason: 'NOT-CLASS-A: claimed duplicate removal but the removed text is not a byte-identical duplicate (near-duplicate) — escalate.' };
    }

    default: {
      // Exhaustiveness guard — an unknown claim is never Class-A.
      const _never: never = claim;
      void _never;
      return { isClassA: false, category: null, reason: 'NOT-CLASS-A: unrecognized category — escalate.' };
    }
  }
}

/** The hard cap on how much alphanumeric content a typo/grammar/cross-ref "mechanical" edit may move. Tiny on
 *  purpose: the safe harbor is narrow; bigger changes are "eligible but substantive" and escalate. */
const MAX_MECHANICAL_DELTA = 3;

/** Bounded Levenshtein: returns the true edit distance, or (cap) if it provably exceeds `cap` (cheap early-out
 *  so we never do expensive work for a large change we will reject anyway). Deterministic + pure. */
function levenshteinBounded(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > cap) return cap; // every cell in this row already exceeds the cap — bail
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return Math.min(prev[b.length]!, cap);
}

/**
 * Is `after` exactly `before` with ONE byte-identical contiguous repeat collapsed? Deterministic.
 * We look for a non-empty run R such that before contains "RR" (back-to-back identical copies) at some
 * position and after is before with one "RR" reduced to "R". This is the ONLY duplicate-removal we honor —
 * a near-duplicate (any byte difference) does not match, by construction. Pure.
 */
function isLiteralDuplicateCollapse(before: string, after: string): boolean {
  if (after.length >= before.length) return false; // a removal must shrink the text
  const removedLen = before.length - after.length;
  if (removedLen <= 0) return false;
  // Try every position p where a removed run of length `removedLen` could start. Reconstruct what `before`
  // would be if we DUPLICATED after[p..p+removedLen) at p, and see if it equals `before`. That proves the
  // removed run was a byte-identical adjacent repeat of retained text.
  for (let p = 0; p + removedLen <= after.length; p++) {
    const run = after.slice(p, p + removedLen);
    const reconstructed = after.slice(0, p) + run + after.slice(p);
    if (reconstructed === before) return true;
  }
  return false;
}

// ── escalation immutability tracker (in-memory, append-only, caller-owned) ───────────────────────────

/** One escalated locus range, recorded so it can never later be re-classified as adoptable. */
interface EscalatedLocus {
  start: number;
  end: number;
}

/**
 * The per-document/loop ESCALATION IMMUTABILITY tracker. APPEND-ONLY: ranges only ever get ADDED. There is
 * deliberately NO removal API — an escalated locus can never become adoptable within the loop. The caller
 * (E5's loop) owns exactly one of these per document and threads it through every pass; it is the ONLY mutable
 * state in E2. Construct with createImmutabilityTracker().
 */
export interface ImmutabilityTracker {
  /** The recorded escalated ranges, in insertion order. Read-only to consumers (append happens via record()). */
  readonly escalated: readonly EscalatedLocus[];
}

/** Internal mutable shape (the public type exposes `escalated` read-only). */
interface MutableImmutabilityTracker {
  escalated: EscalatedLocus[];
}

/** Create a fresh, empty immutability tracker for one document/loop. */
export function createImmutabilityTracker(): ImmutabilityTracker {
  return { escalated: [] } as MutableImmutabilityTracker;
}

/** Half-open overlap test, matching the locus gate's intersection semantics, with zero-width handled like the
 *  gate (a point intersects strictly-interior; a point at a boundary is treated as overlapping a recorded
 *  range so an insertion at an escalated boundary is also forced to escalate — conservative). Pure. */
function locusOverlaps(aStart: number, aEnd: number, e: EscalatedLocus): boolean {
  const s = Math.min(aStart, aEnd);
  const en = Math.max(aStart, aEnd);
  if (s === en) {
    // zero-width point: overlaps if interior OR exactly on either recorded boundary (conservative)
    return s >= e.start && s <= e.end;
  }
  return s < e.end && e.start < en;
}

/** Does the suggestion's target range hit ANY already-escalated locus in the tracker? Pure read. */
function trackerForcesEscalate(suggestion: LocusSuggestion, tracker: ImmutabilityTracker): boolean {
  const aStart = Math.min(suggestion.targetStart, suggestion.targetEnd);
  const aEnd = Math.max(suggestion.targetStart, suggestion.targetEnd);
  for (const e of tracker.escalated) {
    if (locusOverlaps(aStart, aEnd, e)) return true;
  }
  return false;
}

/** Append the suggestion's target range to the tracker (the set only ever grows). Idempotent-safe: a duplicate
 *  range is harmless (overlap detection still works), but we de-dup exact repeats to keep the audit clean. */
function recordEscalation(suggestion: LocusSuggestion, tracker: ImmutabilityTracker): void {
  const start = Math.min(suggestion.targetStart, suggestion.targetEnd);
  const end = Math.max(suggestion.targetStart, suggestion.targetEnd);
  const t = tracker as MutableImmutabilityTracker;
  if (t.escalated.some((e) => e.start === start && e.end === end)) return;
  t.escalated.push({ start, end });
}

// ── the router ───────────────────────────────────────────────────────────────────────────────────────

/**
 * ROUTE a single reviewer suggestion WITHOUT immutability (stateless). Use this only when there is no loop
 * tracker (a one-shot route); the loop ALWAYS uses routeWithImmutability so escalations stick across passes.
 *
 * THE ONLY PATH TO 'auto_adopt':  locus === 'auto_adopt_eligible'  AND  classifyClassA === Class-A.
 * Every other outcome routes 'escalate'. The router NEVER overrides the gate toward adopt, and NEVER lets a
 * model label produce an adopt — the only adopt authority is (E1 locus-eligible) ∧ (E2 verified Class-A).
 */
export function routeSuggestion(suggestion: RoutableSuggestion, ctx: RouteContext): RouteResult {
  const locus = evaluateLocus(
    suggestion,
    ctx.protectedSpans,
    ctx.documentText,
    ctx.definedTerms !== undefined ? { definedTerms: ctx.definedTerms } : {},
  );

  // E1 escalated on locus -> route escalate. The router can NEVER move this toward adopt.
  if (locus.decision === 'escalate') {
    return {
      route: 'escalate',
      reason: `ESCALATE (locus gate): ${locus.reason}`,
      locus,
      classA: null,
      immutabilityForced: false,
    };
  }

  // Locus-eligible. Now — and ONLY now — consult the conservative Class-A classifier.
  const classA = classifyClassA(suggestion);
  if (classA.isClassA) {
    return {
      route: 'auto_adopt',
      reason: `AUTO-ADOPT: locus-eligible AND Class-A. ${classA.reason}`,
      locus,
      classA,
      immutabilityForced: false,
    };
  }

  // Eligible by locus but NOT a proven mechanical fix -> still escalate (the safe harbor is narrow).
  return {
    route: 'escalate',
    reason: `ESCALATE (eligible-but-substantive): the locus is clean but the change is not a proven Class-A mechanical fix. ${classA.reason}`,
    locus,
    classA,
    immutabilityForced: false,
  };
}

/**
 * ROUTE a single reviewer suggestion WITH escalation immutability — the loop entry point. Consults the
 * tracker FIRST (an already-escalated locus is forced to escalate, no matter how it now presents), routes via
 * the gate + Class-A classifier otherwise, and RECORDS every escalation into the tracker (append-only). The
 * tracker is the only mutable state and it is owned by the caller; this function is otherwise pure.
 *
 * IMMUTABILITY GUARANTEE: any suggestion whose target range overlaps a previously-escalated locus routes
 * 'escalate' BEFORE the Class-A classifier is even consulted — so a model cannot launder an escalation by
 * re-proposing the same operative change as "style". And because every escalate (forced or fresh) is
 * recorded, the immutability set only ever grows.
 */
export function routeWithImmutability(suggestion: RoutableSuggestion, tracker: ImmutabilityTracker, ctx: RouteContext): RouteResult {
  // 1) IMMUTABILITY FIRST — an escalated locus can never become adoptable, regardless of the new presentation.
  if (trackerForcesEscalate(suggestion, tracker)) {
    const locus = evaluateLocus(
      suggestion,
      ctx.protectedSpans,
      ctx.documentText,
      ctx.definedTerms !== undefined ? { definedTerms: ctx.definedTerms } : {},
    );
    recordEscalation(suggestion, tracker); // record this overlapping range too — the set only grows
    return {
      route: 'escalate',
      reason:
        'ESCALATE (immutability): this locus (or an overlapping range) was escalated on a prior pass — an ' +
        'escalated locus can never be re-classified as auto-adoptable within the loop (anti-laundering).',
      locus,
      classA: null,
      immutabilityForced: true,
    };
  }

  // 2) Otherwise route normally via the gate + conservative Class-A classifier.
  const result = routeSuggestion(suggestion, ctx);

  // 3) RECORD every escalation so a later pass can never re-adopt this locus.
  if (result.route === 'escalate') {
    recordEscalation(suggestion, tracker);
  }
  return result;
}
