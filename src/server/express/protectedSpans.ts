/**
 * protectedSpans.ts — EXPRESS-AUTO-REVIEW-LOOP-1 E1: the PROTECTED-SPAN MODEL.
 *
 * The load-bearing safety core of the Express auto-review loop. A "protected span" is a contiguous
 * character RANGE within a document's text that carries operative legal weight — the granting clause, the
 * legal description, the warranty, the vesting recital, party identities, amounts, dates, definitions, the
 * signature/acknowledgment blocks, and so on. The locus gate (locusGate.ts) consumes this catalog and rules
 * that a reviewer suggestion may auto-adopt ONLY because of WHERE it lands — never because a model labeled it.
 *
 * This module is PURE + deterministic + no-egress + flag-dark (the whole Express program is gated by
 * isAutoReviewLoopEnabled(); E1 ships the model + gate in ISOLATION — nothing wires into the live review path
 * yet, that is E2–E5). It does NOT read the DB, does NOT call an LLM, and adds no dependency.
 *
 * Design goals:
 *  - DETERMINISTIC location. A span is located by anchoring on the deed house-style section markers / recital
 *    phrases the deterministic assembler emits (deedGiftAssembler / deedSellerSideAssembler share this form):
 *    "Exempt from recordation tax", "Consideration:", "DEED OF GIFT" / "THIS DEED", the granting verb
 *    "grant ... convey, with <WARRANTY>", "to wit:" (legal description follows), "For derivation of title" /
 *    "BEING the same property" (vesting/recital of title), "subject to" (exceptions/reservations),
 *    "WITNESS the following signature", "COMMONWEALTH OF VIRGINIA" / "acknowledged before me ... Notary"
 *    (signature/acknowledgment/notary blocks). Plain string/regex scanning over the document text — same input
 *    always yields the same span set (no model, no randomness).
 *  - CONSERVATIVE by construction. When a span's extent is ambiguous, the catalog errs WIDE (covering more
 *    text), because over-escalation is acceptable and under-escalation is a BUG (a protected-span change
 *    slipping to auto-adopt). An unrecognized/empty document yields no spans for that recognizer (the gate's
 *    other rails — deletion, defined-term — still hold), and the DEFINED-TERM rail (locusGate) is independent
 *    of these located spans.
 *  - EXTENSIBLE to other document types. The catalog is keyed by DocumentType; deeds are implemented here and
 *    POA/will/engagement-letter/LLC slot in later (E8 §7) by adding a recognizer set under their key. The
 *    deed §12 overlay is a strict SUBSET of these spans — enforced mechanically here, not by a separate gate.
 */

/** A protected legal span: a half-open character range [start, end) within a document's text. */
export interface ProtectedSpan {
  /** Inclusive start character offset into the document text. */
  start: number;
  /** Exclusive end character offset into the document text (start < end; the range is [start, end)). */
  end: number;
  /** The protected-element label this span represents (a member of PROTECTED_SPAN_LABELS for deeds). */
  label: ProtectedSpanLabel;
}

/**
 * The deed protected-span labels (from the EXPRESS §E1 deed set / E8 design — a strict superset of the deed
 * §12 overlay). Every operative element of a deed maps to one of these; an element with no label is a gate
 * hole (E8 §4 — reported loudly), so this list is the authoritative coverage axis for deeds.
 */
export const DEED_PROTECTED_SPAN_LABELS = [
  'granting_clause',
  'habendum',
  'legal_description',
  'warranty_covenant',
  'vesting_recital_of_title',
  'exceptions_reservations',
  'exemption_recital',
  'governing_law_venue',
  'party_identities_capacity',
  'amounts',
  'dates',
  'defined_terms_definitions',
  'signature_acknowledgment_notary',
  'consideration_recital',
] as const;

export type ProtectedSpanLabel = (typeof DEED_PROTECTED_SPAN_LABELS)[number];

/** Document types the catalog can serve. Deeds are implemented in E1; the rest are forward-declared so the
 *  catalog shape is stable as POA/will/etc. earn their recognizer sets (E8 §7). */
export type DocumentType = 'deed' | 'poa' | 'will' | 'engagement_letter' | 'llc';

// ── deterministic span location ────────────────────────────────────────────────

/**
 * A recognizer locates zero or more spans of ONE label in a document body. It is a pure function of the text:
 * the same text always yields the same spans. It returns half-open [start, end) ranges; out-of-order or
 * zero-width matches are dropped by the catalog assembler.
 */
type SpanRecognizer = (text: string) => Array<{ start: number; end: number }>;

/** All matches of a (global) regex, as [start, end) ranges over the WHOLE match. Deterministic; never throws. */
function rangesOf(text: string, re: RegExp): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  // Clone with the global flag so .exec walks every match and we never mutate a caller's lastIndex.
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (end > start) out.push({ start, end });
    if (m[0].length === 0) g.lastIndex++; // guard against zero-width infinite loop
  }
  return out;
}

/**
 * Span from an OPENING anchor up to (but excluding) the FIRST of a set of terminator phrases that occur after
 * it — used for block-shaped spans (e.g. the legal description runs from "to wit:" to the next structural
 * marker). Conservative: if no terminator is found, the span runs to end-of-document (cover wide). The opening
 * anchor's own text is included in the span.
 */
function blockFrom(
  text: string,
  openRe: RegExp,
  terminators: RegExp[],
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const g = new RegExp(openRe.source, openRe.flags.includes('g') ? openRe.flags : openRe.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null) {
    const start = m.index;
    const afterOpen = m.index + m[0].length;
    let end = text.length;
    for (const t of terminators) {
      const tg = new RegExp(t.source, t.flags.includes('g') ? t.flags : t.flags + 'g');
      tg.lastIndex = afterOpen;
      const tm = tg.exec(text);
      if (tm && tm.index < end) end = tm.index;
    }
    if (end > start) out.push({ start, end });
    if (m[0].length === 0) g.lastIndex++;
  }
  return out;
}

// Structural terminators that end one operative block and begin the next, in the deterministic deed house form.
// Kept WIDE on purpose (more text protected) — over-escalation is acceptable; under-escalation is a bug.
const DEED_BLOCK_TERMINATORS: RegExp[] = [
  /For derivation of title/i,
  /BEING the same property/i,
  /This conveyance is made subject to/i,
  /WITNESS the following signature/i,
  /COMMONWEALTH OF VIRGINIA/i,
  /After recording, return to/i,
];

/**
 * Per-label deed recognizers. Each anchors on the house-style markers/recital phrases the deterministic
 * assemblers emit. These are deliberately broad; a borderline over-match only causes (acceptable)
 * over-escalation.
 */
const DEED_RECOGNIZERS: ReadonlyArray<{ label: ProtectedSpanLabel; recognize: SpanRecognizer }> = [
  // Consideration recital — the "Consideration: $..." header line AND the in-witnesseth consideration clause.
  {
    label: 'consideration_recital',
    recognize: (t) => [
      ...rangesOf(t, /Consideration:[^\n]*/i),
      ...rangesOf(t, /for and in consideration of[^\n.]*/i),
    ],
  },
  // Exemption recital — the recordation-tax exemption sentence (§ 58.1-811(D) etc.).
  {
    label: 'exemption_recital',
    recognize: (t) => rangesOf(t, /Exempt from recordation tax[^\n]*/i),
  },
  // Party identities + capacity — the "by and between ... (the "Grantor(s)"), and ... (the "Grantee(s)")"
  // clause (the operative identity/capacity recital), and any signatory name line.
  {
    label: 'party_identities_capacity',
    recognize: (t) => [
      // The whole party-recital block from "by and between" up to "WITNESSETH" (the identities + capacity).
      ...blockFrom(t, /by and between/i, [/WITNESSETH/i, /That for and in consideration/i]),
    ],
  },
  // Granting clause — the operative granting verb + its object, up to "to wit:" (the legal description follows).
  // Anchored on "grant ... convey" (covers "grant and convey" and "grant, bargain, sell and convey").
  {
    label: 'granting_clause',
    recognize: (t) => blockFrom(t, /\bgrant\b[^\n]*?\bconvey\b/i, [/to wit:/i, /\n\n/]),
  },
  // Habendum / "in fee simple, as <vesting>" tenure clause (often co-located with granting; cover the
  // "in fee simple" phrase + its vesting tail).
  {
    label: 'habendum',
    recognize: (t) => rangesOf(t, /in fee simple,[^\n]*/i),
  },
  // Warranty / covenant language — "with <WARRANTY> [and English Covenants of title]".
  {
    label: 'warranty_covenant',
    recognize: (t) => [
      ...rangesOf(t, /with\s+(?:General|Special|Limited|Fiduciary|Quitclaim)\s+Warranty[^\n,]*/i),
      ...rangesOf(t, /English Covenants of title/i),
    ],
  },
  // Legal description — the verbatim metes-and-bounds / lot-block block running from "to wit:" to the next
  // structural marker (derivation / BEING / subject-to / signatures). The verbatim invariant: any intersection
  // here escalates, even a single character.
  {
    label: 'legal_description',
    recognize: (t) => blockFrom(t, /to wit:/i, DEED_BLOCK_TERMINATORS),
  },
  // Vesting / recital of title — the derivation ("For derivation of title" / "BEING the same property")
  // recital that establishes the chain of title.
  {
    label: 'vesting_recital_of_title',
    recognize: (t) => [
      ...rangesOf(t, /For derivation of title[^\n]*/i),
      ...rangesOf(t, /BEING the same property[^\n]*/i),
    ],
  },
  // Exceptions / reservations — the "subject to ..." protective clause.
  {
    label: 'exceptions_reservations',
    recognize: (t) => rangesOf(t, /(?:This conveyance is made )?subject to[^\n]*/i),
  },
  // Governing law / venue — explicit governing-law / venue language (deed §12: always escalate).
  {
    label: 'governing_law_venue',
    recognize: (t) => [
      ...rangesOf(t, /governed by the laws of[^\n.]*/i),
      ...rangesOf(t, /Commonwealth of Virginia[^\n]*/i),
      ...rangesOf(t, /venue[^\n.]*/i),
    ],
  },
  // Amounts — any dollar amount and any spelled-out monetary sum. Cover the figure plus a short tail so a
  // respacing/typo "fix" of an amount intersects.
  {
    label: 'amounts',
    recognize: (t) => [
      ...rangesOf(t, /\$\s?[\d,]+(?:\.\d{2})?/),
      ...rangesOf(t, /\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b/),
    ],
  },
  // Dates — "this ___ day of ____________, 20___" execution/acknowledgment date frames AND explicit dates.
  {
    label: 'dates',
    recognize: (t) => [
      ...rangesOf(t, /this[^\n]*day of[^\n]*?20[_\d][_\d]?/i),
      ...rangesOf(t, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/),
      ...rangesOf(t, /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i),
    ],
  },
  // Signature / acknowledgment / notary block — from "WITNESS the following signature" to end-of-document
  // (covers the SEAL lines, the COMMONWEALTH/acknowledgment recital, and the Notary block).
  {
    label: 'signature_acknowledgment_notary',
    recognize: (t) => [
      ...blockFrom(t, /WITNESS the following signature/i, []),
      // also explicitly cover an acknowledgment that begins without the witness line
      ...rangesOf(t, /The foregoing instrument was acknowledged before me[^\n]*/i),
      ...rangesOf(t, /Notary Public/i),
    ],
  },
  // Defined terms + their definitions — the parenthetical (the "Grantor"/"Grantee"/...) DEFINITIONS that bind
  // a defined term to a party/concept. (Single-instance USES of a defined term are caught by the locus gate's
  // independent defined-term rail; this span protects the DEFINITION site itself.)
  {
    label: 'defined_terms_definitions',
    recognize: (t) => rangesOf(t, /\(\s*(?:the\s+)?"[^"]+"\s*\)/),
  },
];

const DEED_TYPE_LABEL_REGEX = /\bDEED OF (?:GIFT|TRUST)\b|\bTHIS DEED\b/i;

/**
 * Build the protected-span catalog for a document of `docType` over its `documentText`. PURE + deterministic:
 * the same (docType, text) always yields the same span set (sorted, de-overlapped by union per label is NOT
 * done — overlapping spans are fine; the gate only needs intersection, and keeping per-recognizer ranges keeps
 * the audit trail "which element" precise).
 *
 * Only 'deed' has recognizers in E1; an unimplemented type returns [] (which makes the locus gate's other rails
 * — deletion + defined-term — the only protection until that type's recognizers land; a type with no spans is
 * never silently treated as "all-safe" because the caller controls whether auto-adopt is even offered).
 */
export function buildProtectedSpans(docType: DocumentType, documentText: string): ProtectedSpan[] {
  if (docType !== 'deed') return [];
  const text = documentText ?? '';
  if (text.length === 0) return [];
  const spans: ProtectedSpan[] = [];
  for (const { label, recognize } of DEED_RECOGNIZERS) {
    for (const r of recognize(text)) {
      const start = Math.max(0, Math.min(r.start, text.length));
      const end = Math.max(start, Math.min(r.end, text.length));
      if (end > start) spans.push({ start, end, label });
    }
  }
  // Deterministic order: by start, then end, then label — so the catalog (and the gate's first-intersection
  // reason) is byte-identical across runs.
  spans.sort((a, b) => a.start - b.start || a.end - b.end || a.label.localeCompare(b.label));
  return spans;
}

/** True when the body parses as a deed (carries a deed type label). Convenience for callers that must pick a
 *  docType; the gate itself takes an explicit docType. Pure. */
export function looksLikeDeed(documentText: string): boolean {
  return DEED_TYPE_LABEL_REGEX.test(documentText ?? '');
}
