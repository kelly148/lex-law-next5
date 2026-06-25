/**
 * deedIngestExtract.ts — DEED-DRAFT-AGENT-1 ingest pre-stage (UAT-fix-list B1 / OCR). REWORK.
 *
 * Deterministic, PURE, NO-EGRESS field extraction for the deed agent's §2.1 source-field map. Consumes a
 * document's ALREADY-EXTRACTED text (from the existing intake pipeline: pdfExtract text layer for text-native
 * PDFs, or pdfRasterize -> ocrExtract tesseract.js for scanned PDFs — all local/no-egress) and produces the
 * §2.1.2 candidate fields per deed-relevant document type. NO network, NO provider, NO hosted vision API —
 * legal document images never leave the box (the established no-egress posture; client-confidentiality).
 *
 * REWORK CONTEXT (this file replaces a rejected first attempt — see docs/deed-agent/OCR-B1_REWORK_SPEC.md):
 * the first attempt's regexes were tuned to FRIENDLY fixtures (`Grantor: NAME`) that do NOT exist in the real
 * Mason deed. The real body (DEED_KB_SEED §2.1.1) is `…by and between [GRANTOR], (the "Grantor[s]"), and
 * [GRANTEE], (the "Grantee"),` — the NAME PRECEDES a parenthetical label. Adversarial review confirmed 22
 * defects (8 HIGH / 11 MED / 3 LOW), almost all of the SAME class: a regex over-captures across a boundary
 * (a newline, a parenthetical label, a capacity clause, a role word) and surfaces the junk at full confidence.
 * This rework is STRUCTURE-AWARE, LINE/BOUNDARY-ANCHORED, and FAIL-CLOSED: a span that cannot be cleanly
 * isolated is WITHHELD + flagged, never emitted as a confident wrong value.
 *
 * FAIL-CLOSED, consistent with the recordability gates: a field detected only weakly, truncated, polluted, or
 * ambiguous falls below the shared OCR_CONFIDENCE_FLOOR and has its VALUE WITHHELD (routed to human review),
 * never silently passed — a wrong character in a recording reference or legal description is a defect, not a typo.
 *
 * HAND-OFF, not authority: this stage emits §2.1 CANDIDATES (each tagged with the §2.1.2 slot it feeds). It
 * does NOT emit a deed and does NOT bypass the recordability gates — the legal description still faces C1
 * (verbatim Exhibit A + prior-deed reconciliation) and the party set still faces C2 (Sch. B-I Req. 4 equality)
 * downstream (src/server/deed/deedDraftGates.ts). A truncated/ambiguous legal NEVER claims "verbatim."
 *
 * FIRE-B3: fiduciary signer-name VARIANTS are preserved as DISTINCT candidates (never collapsed/auto-picked)
 * so the downstream precedence (Certificate of Qualification > prior deed > commitment) can resolve them.
 *
 * #19 (mapping direction): a PRIOR vesting deed's parties are mapped to NEUTRAL prior-deed-recital roles, NOT
 * to the new deed's "Grantor name"/"Grantee name" slots — the new deed's grantor is reconciled from the
 * commitment/authority chain and the new deed's grantee comes from the commitment Sch. B-I, never auto-seeded
 * from a prior deed's positions.
 *
 * STATUS: flag-dark Phase-1 ingest pre-stage. NOT wired to any live draft path (the agent is HELD).
 */

import { OCR_CONFIDENCE_FLOOR } from '../intake/ocrExtract.js';

/** The deed-relevant document types the §2.1 ingest needs (a sale-closing seller-side packet). */
export type DeedDocType =
  | 'vesting_deed'
  | 'title_commitment'
  | 'probate_authority'
  | 'tax_record'
  | 'llc_authority'
  | 'certificate_of_trust'
  | 'unknown';

/** One extracted §2.1 candidate field. */
export interface DeedIngestField {
  key: string;
  label: string;
  /** Single best/primary value; null when not found, withheld, or genuinely multi-valued (see `values`). */
  value: string | null;
  /** The full captured set: the party list, or `[value]` for a single value, or `[]` when withheld/absent. */
  values: string[];
  /** a/k/a alias variants of the PRIMARY person, un-collapsed (FIRE-B3); `[]` for non-variant fields. */
  candidates: string[];
  /** 0-100. Clean structural captures are trustworthy; withheld captures fall below the floor. */
  confidence: number;
  /** true when a value was detected but withheld (sub-floor, truncated, polluted, or ambiguous) -> human review. */
  withheld: boolean;
  /** Per-field reasons (e.g. 'truncated', 'isolation_failed', 'low_shape', 'aka_variants_present'). */
  flags: string[];
  /** The §2.1.2 source-field-map slot this candidate feeds (neutral for prior-deed parties, #19); may be null. */
  mapsTo: string | null;
}

export interface DeedIngestResult {
  docType: DeedDocType;
  typeConfidence: number;
  overallConfidence: number;
  /** Overall below the floor, type-uncertain, OR no field surfaced -> route the document to human review. */
  lowConfidence: boolean;
  fields: DeedIngestField[];
  warnings: string[];
}

// Confidence tiers (0-100). A clean STRUCTURAL capture (anchored + boundary-validated) is trustworthy; a
// withheld capture is given a sub-floor confidence so the honesty floor reads it as "needs review."
const CONF_OK = 88;
const CONF_WITHHELD = 40; // below OCR_CONFIDENCE_FLOOR (60) -> value withheld, surfaced as a review flag

// A legal-description block longer than this is implausible for a single parcel and signals a runaway capture
// (no terminator found / OCR ran sections together) -> withhold + flag rather than silently slicing (#13).
const LEGAL_MAX = 4000;

// ── primitives ────────────────────────────────────────────────────────────────

/** Collapse all whitespace runs (incl. newlines) to a single space and trim. */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** The distinct normalized money amounts in a value ("$612,000.00" -> ["612000.00"]). A value carrying MORE
 *  than one distinct amount (e.g. two columns run together) is ambiguous and the caller withholds it (#6). */
function moneyAmounts(raw: string): string[] {
  const tokens = raw.match(/\$?\d[\d,]*(?:\.\d{1,2})?/g) ?? [];
  const norm = tokens.map((t) => t.replace(/[^\d.]/g, '')).filter((x) => /\d/.test(x));
  return [...new Set(norm)];
}

// A parcel / GPIN / tax-map id is DIGIT-DOMINANT and HYPHEN-GROUPED (e.g. 7298-44-1201, 0123-45-6789). It must
// start with a digit and contain ONLY digits + hyphens. The bare pure-digit alternative is intentionally DROPPED
// so a 6-digit money figure ("612000"/"350000"), a phone run, or a year ("2026") is NOT surfaced as an
// authoritative id (#16, #24, #26). A date-shaped token (YYYY-MM-DD or M-D-YY) is rejected by isDateShaped (#24).
const GPIN_RE = /\b(\d{2,}(?:-\d{2,})+)\b/;

/** Reject a hyphen-grouped token that is actually a date (so a date is never surfaced as a parcel id, #24). */
function isDateShaped(t: string): boolean {
  return /^\d{1,2}-\d{1,2}-\d{2,4}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t);
}

// A recording reference ALWAYS bears a digit; the instrument-number tail requires one so a non-numeric
// placeholder ("Instrument No. SEE-ATTACHED") is not captured as a reference (#6).
const INSTR_RE =
  /\b(Deed\s+Book\s+\d+\s+(?:at\s+)?Page\s+\d+|Book\s+\d+[,\s]+Page\s+\d+|Liber\s+\d+[,\s]+Folio\s+\d+|Instrument\s+(?:No\.?|Number|#)?\s*[:#]?\s*(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{3,})/i;

const DATE_RE =
  /([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/;

// Flexible quote class so straight, curly, or OCR-mangled quotes around the parenthetical label still anchor.
const Q = String.raw`["'“”‘’]?`;

// Fiduciary capacity clause: a trailing `, <Role> of (the) Estate of <decedent>` (the real Mason form,
// §2.1.5). Anchored to the END of the (already capacity-trailing) span; the role list covers the qualified
// fiduciary forms. "and" inside "Co-Executors of Estate of …" is part of the capacity, never a party split.
const FID_ROLE = String.raw`(?:Co-)?(?:Executors?|Executrix|Administrators?|Administratrix|Personal\s+Representatives?|Trustees?)`;
const CAPACITY_RE = new RegExp(String.raw`,\s*(${FID_ROLE}\s+of\s+(?:the\s+)?Estate\s+of\s+.+)$`, 'i');

// "formerly of record as <old name>" (B4 name reconciliation) — captured to its own field, never left in the
// current legal name.
const FORMERLY_RE = /,?\s*(?:formerly\s+of\s+record\s+as|f\/k\/a|formerly\s+known\s+as)\s+([^,]+?)(?=,|$)/i;

// Marital / capacity DESCRIPTOR. Now covers the article-led forms ("an unmarried man/woman", "a single
// person", "an widower") that the first rework missed (#2). Anchored to end of span so it cannot match mid-name.
const DESCRIPTOR_BODY = String.raw`a\s+married\s+couple|husband\s+and\s+wife|wife\s+and\s+husband|married|an?\s+(?:single|unmarried)\s+(?:man|woman|person)|unmarried|an?\s+(?:widow|widower)|widow(?:er)?|spouses?`;
const DESCRIPTOR_RE = new RegExp(String.raw`,\s*(${DESCRIPTOR_BODY})\s*\.?\s*$`, 'i');
// Same descriptor body, but matched as a trailing clause anywhere (used to strip a descriptor off a commitment
// "from X to Y" required-party span before splitting, #8/#15).
const DESCRIPTOR_TAIL_RE = new RegExp(String.raw`,\s*(?:${DESCRIPTOR_BODY})\s*\.?\s*$`, 'i');

// A POST-NOMINAL that legitimately follows a comma inside ONE person's name (so the comma is NOT a party-split
// point and the tail is NOT comma-pollution): a generational suffix (Jr./Sr./II–V, ordinals 2nd/3rd…) OR a
// professional/honorary credential (M.D., Ph.D., Esq., …). Each credential allows an OPTIONAL SPACE between
// letters too, so the routine OCR form "M D" / "D D S" is protected and stays on the name instead of
// shattering into a phantom party (#3, #7, #11, #13, + re-review spaced-credential finding).
const POSTNOMINAL = String.raw`Jr\.?|Sr\.?|I{2,3}|IV|VI{0,3}|\d+(?:st|nd|rd|th)|Esq(?:\.|uire)?|M\.?\s?D\.?|Ph\.?\s?D\.?|D\.?\s?D\.?\s?S\.?|J\.?\s?D\.?|P\.?\s?E\.?|C\.?\s?P\.?\s?A\.?|R\.?\s?N\.?|M\.?\s?B\.?\s?A\.?|D\.?\s?O\.?|D\.?\s?V\.?\s?M\.?|LL\.?\s?M\.?`;
const POSTNOMINAL_ONLY_RE = new RegExp(String.raw`^(?:${POSTNOMINAL})$`, 'i');
// The lone-token reject is NARROWER than POSTNOMINAL: it only fires on UNAMBIGUOUS suffix shapes (Jr./Sr./Esq.,
// an ordinal, or a dotted initialism like "M.D.") so it never rejects a legitimate short given name that
// merely collides with a bare roman numeral / un-dotted credential ("Vi" vs VI, "Do" vs D.O.) — those
// fail-closed false-rejections are removed (#18-class for postnominals).
const LONE_POSTNOMINAL_RE = /^(?:Jr|Sr|Esq|Esquire|\d+(?:st|nd|rd|th))\.?$|^(?:[A-Za-z]\.\s?){2,}$/i;

// An ENTITY / business designator. A party span carrying one is OUT of the grounded automated seller scope
// (individual / testate-estate-fiduciary only, §2.1.4(a)) and must FAIL CLOSED — withhold + escalate, never be
// split into phantom people or emitted as a confident party (#6, #8, #9, #12, #14, #17). The corporate-suffix
// designators are word-bounded; the ampersand/dotted forms are matched WITHOUT a trailing `\b` (which can never
// anchor after `&` or `.`) so "Smith & Sons" and "ABC Co." are no longer dead branches (re-review HIGH). Bare
// "Church"/"Bank" are deliberately OMITTED — they are common surnames; entity churches/banks are caught by the
// determiner lead ("The First …") or a corporate suffix instead (re-review surname-collision finding).
const ENTITY_RE = new RegExp(
  [
    String.raw`\b(?:LLC|LLP|PLLC|Inc|Incorporated|Corp|Corporation|Compan(?:y|ies)|Co|Ltd|Limited|Trust|Trustees?|Partnership|Partners|Associates|Holdings|Properties|Group|Enterprises?|Ventures?|Realty|Industries|Investments?|Development|Builders|Brothers|Bros|Foundation)\b`,
    String.raw`\b(?:L\.L\.C|L\.L\.P|P\.L\.L\.C|P\.C|N\.A|L\.P)\.?`,
    String.raw`(?:&|\band\b)\s+Sons\b`,
  ].join('|'),
  'i',
);

// Nobiliary / locative particles that legitimately lead a surname in lowercase (von Stade, de la Cruz). A
// lowercase lead is otherwise prose ("the current record owner", "said") and is rejected (#18, #19).
const NOBILIARY_LEAD_RE = /^(?:von|van|der|den|de|del|della|da|di|du|la|le|los|las|ten|ter|bin|ibn|al|st\.?)\s+[A-Z]/;
const DETERMINER_LEAD_RE = /^(?:the|a|an|said|certain|all|those|more|same)\b/i;

// The a/k/a connector (alias of ONE person — kept un-collapsed per FIRE-B3). Distinct from `and`/`&`/`,`, which
// join DISTINCT people (co-grantors / co-fiduciaries).
const AKA_RE = /\s*,?\s*(?:a\/k\/a|a\.k\.a\.?|aka|also\s+known\s+as|n\/k\/a|now\s+known\s+as)\s*/gi;

// A captured name must NOT contain any of these — each is the signature of a boundary over-capture (the defect
// class behind the original 22 + both rework reviews). The fail-closed gate on every emitted party name.
function nameIsClean(n: string): boolean {
  if (!n) return false;
  const t = n.trim();
  if (t.length < 2 || t.length > 120) return false;
  if (/[\n\r]/.test(n)) return false; // crossed a line boundary
  if (DETERMINER_LEAD_RE.test(t)) return false; // determiner/prose lead-in, incl. capitalized "The …" (#13, #16)
  if (/^[a-z]/.test(t) && !NOBILIARY_LEAD_RE.test(t)) return false; // lowercase prose lead (but allow von/de/… , #18)
  if (LONE_POSTNOMINAL_RE.test(t)) return false; // a lone "Jr."/"M.D." is a suffix, never a whole person (#1, #11)
  if (ENTITY_RE.test(t)) return false; // entity/business party -> out of scope, fail closed (#6, #8, #12)
  if (new RegExp(String.raw`\(\s*the\s+${Q}\s*Grant`, 'i').test(t)) return false; // parenthetical label bled in
  if (/\)\s*,\s*and\b/i.test(t)) return false; // `"), and` bled in
  if (/\s+(?:and|&)\s+/i.test(t)) return false; // two distinct people glued by and/&
  if (new RegExp(String.raw`\b${FID_ROLE}\b`, 'i').test(t)) return false; // capacity/role word bled in
  if (/\b(?:a\/k\/a|aka|formerly\s+of\s+record)\b/i.test(t)) return false; // alias/reconciliation clause bled in
  if (/\bEstate\s+of\b/i.test(t)) return false; // estate-caption bled in
  // an internal comma is allowed ONLY when it precedes a post-nominal (John Q. Public, Jr. / Jane Doe, M.D.) —
  // any other internal comma means two people (or a descriptor) were glued into one token (#1, #22).
  const comma = /,\s*(.+)$/.exec(t);
  if (comma && comma[1] !== undefined && !POSTNOMINAL_ONLY_RE.test(comma[1].trim())) return false;
  if (!/[A-Za-z]/.test(t)) return false; // no letters at all -> not a name
  return true;
}

/** Trim + collapse a captured name; strip leading/trailing list punctuation (but keep internal initials' dots). */
function cleanName(s: string): string {
  return normalizeWs(s).replace(/^[\s,;:]+/, '').replace(/[\s,;:]+$/, '');
}

/** Clean a decedent / estate-caption name: drop a `, deceased`/`the decedent`/`a resident…`/`late of…`
 *  descriptor — anywhere, not just $-anchored (#9) — but KEEP a generational suffix (Jr./Sr./III) so the
 *  caption name stays intact on the chain of title (§2.1.4(c), #21). */
function cleanDecedent(s: string): string {
  let d = normalizeWs(s);
  d = d.replace(/,\s*(?:deceased|the\s+decedent|\(deceased\)|a\s+resident\b|late\s+of\b|of\s+the\s+(?:County|City)\b)[\s\S]*$/i, '');
  d = d.replace(/^[\s,;:]+/, '').replace(/[\s,;:]+$/, '');
  return d.trim();
}

// ── parsed-party model ─────────────────────────────────────────────────────────

/** One distinct person, with their own a/k/a alias spellings (FIRE-B3 — preserved, never collapsed). */
interface Person {
  /** The primary (first/fullest) spelling. */
  primary: string;
  /** All a/k/a spellings of THIS person (incl. the primary) when >1; [] for a single spelling. */
  variants: string[];
}

interface ParsedSpan {
  /** Distinct PEOPLE in the span (co-grantors / co-fiduciaries), each carrying its own a/k/a variants. */
  people: Person[];
  descriptor: string | null;
  capacity: string | null; // fiduciary capacity clause (signals a fiduciary span)
  decedent: string | null; // decedent name from "Estate of <X>" inside the capacity
  formerlyOfRecord: string | null;
  isFiduciary: boolean;
  /** false -> the span could not be cleanly isolated/validated -> fail closed (withhold, never emit junk). */
  ok: boolean;
}

const UNCLEAN_SPAN: ParsedSpan = {
  people: [], descriptor: null, capacity: null, decedent: null,
  formerlyOfRecord: null, isFiduciary: false, ok: false,
};

const NAME_SPLIT_RE = /\s+and\s+|\s*&\s*|\s*,\s*/i;

/**
 * Split a name portion into DISTINCT PEOPLE, then resolve each person's a/k/a variants. Distinct people are
 * separated by `and`/`&`/`,`. A comma that precedes a post-nominal (`, Jr.` / `, M.D.`) or an a/k/a connector
 * is NOT a person split — it is protected first. So `A, B and C` -> three people, `Dana, a/k/a Dana R.` -> one
 * person with two spellings, `John, Jr.` -> one person. Returns ok:false if the span is entity-shaped or any
 * emitted name fails the boundary gate, so a span that cannot be cleanly isolated fails closed.
 *
 * ENTITY parties fail closed: an entity/business span (LLC, Inc., Trust, …) is OUT of the grounded automated
 * seller scope (individual / testate-estate-fiduciary only, §2.1.4(a)) and is WITHHELD + escalated — never
 * split into phantom people or emitted as a confident party (#6, #8, #9, #12, #14, #17).
 */
function splitPeople(portion: string): { people: Person[]; ok: boolean } {
  // Sentinel placeholders (ASCII control chars that never occur in deed text) protect a post-nominal comma and
  // an a/k/a connector from the person splitter.
  const AKA_MARK = String.fromCharCode(1);
  const SUF_MARK = String.fromCharCode(2);
  let s = normalizeWs(portion);
  if (!s) return { people: [], ok: false };
  // Entity/business party -> fail closed before any splitting (the docstring's promise, now enforced).
  if (ENTITY_RE.test(s)) return { people: [], ok: false };
  // Protect a POST-NOMINAL comma FIRST (rejoin to the prior token). Doing this BEFORE the a/k/a replace is
  // essential: otherwise a `, Jr.` sitting immediately before an a/k/a connector would be left unprotected and
  // shatter the suffixed person into a phantom "Jr." party (#1, #2).
  s = s.replace(new RegExp(String.raw`,\s*(${POSTNOMINAL})(?=\s|,|$)`, 'gi'), SUF_MARK + '$1');
  // Then protect a/k/a connectors (consume the leading comma so it is not read as a person split).
  s = s.replace(AKA_RE, AKA_MARK);
  const tokens = s.split(NAME_SPLIT_RE).map((x) => x.trim()).filter((x) => x.length > 0);
  const people: Person[] = [];
  for (const tok of tokens) {
    const spellings = tok
      .split(AKA_MARK)
      .map((p) => cleanName(p.split(SUF_MARK).join(', ')))
      .filter((x) => x.length > 0);
    const primary = spellings[0];
    if (primary === undefined) continue;
    people.push({ primary, variants: spellings.length > 1 ? spellings : [] });
  }
  const ok = people.length > 0 && people.every((p) => nameIsClean(p.primary) && p.variants.every(nameIsClean));
  return { people, ok };
}

/** Derive the decedent from a capacity clause, bounded so a second `… and Estate of …` is not swallowed (#21). */
function decedentFromCapacity(capacity: string): string | null {
  const dm = /Estate\s+of\s+(.+?)(?=\s+and\s+(?:the\s+)?Estate\s+of\b|$)/i.exec(capacity);
  if (!dm || dm[1] === undefined) return null;
  const d = cleanDecedent(dm[1]);
  return d.length > 0 ? d : null;
}

/**
 * Parse an isolated party SPAN (already delimited by the structural anchors, i.e. the text between
 * `by and between` and `, (the "Grantor`). Peels — in priority order — the fiduciary capacity, the
 * formerly-of-record clause, and the trailing marital descriptor, THEN splits the remaining name portion into
 * distinct people + a/k/a variants. Every emitted name is boundary-validated; any pollution fails closed.
 */
function parsePartySpan(rawSpan: string): ParsedSpan {
  let span = normalizeWs(rawSpan);
  if (!span) return UNCLEAN_SPAN;

  // Defensive: if the structural anchor leaked a label/bridge into the span, refuse it outright.
  if (
    new RegExp(String.raw`\(\s*the\s+${Q}\s*Grant`, 'i').test(span) ||
    /\)\s*,\s*and\b/i.test(span)
  ) {
    return UNCLEAN_SPAN;
  }

  // 1. capacity (fiduciary) — peel from the end; derive the decedent from "Estate of <X>".
  let capacity: string | null = null;
  let decedent: string | null = null;
  let isFiduciary = false;
  const cm = CAPACITY_RE.exec(span);
  if (cm && cm[1] !== undefined) {
    capacity = normalizeWs(cm[1]);
    isFiduciary = true;
    span = span.slice(0, cm.index);
    decedent = decedentFromCapacity(capacity);
  }

  // 2. formerly-of-record — capture the old name, remove the clause from the current name.
  let formerlyOfRecord: string | null = null;
  const fm = FORMERLY_RE.exec(span);
  if (fm && fm[1] !== undefined) {
    formerlyOfRecord = cleanName(fm[1]);
    span = span.replace(FORMERLY_RE, '');
  }

  // 3. trailing marital descriptor.
  let descriptor: string | null = null;
  const sm = DESCRIPTOR_RE.exec(span);
  if (sm && sm[1] !== undefined) {
    descriptor = normalizeWs(sm[1]);
    span = span.slice(0, sm.index);
  }

  span = span.replace(/[\s,;]+$/, '').trim();

  // 4. split the name portion into distinct people + each person's a/k/a variants.
  const { people, ok } = splitPeople(span);
  if (!ok) return UNCLEAN_SPAN;

  return { people, descriptor, capacity, decedent, formerlyOfRecord, isFiduciary, ok: true };
}

// ── field builders ──────────────────────────────────────────────────────────────

interface Spec {
  key: string;
  label: string;
  mapsTo: string | null;
}

function notFound(spec: Spec): DeedIngestField {
  return { ...spec, value: null, values: [], candidates: [], confidence: 0, withheld: false, flags: [] };
}
function withheld(spec: Spec, flags: string[]): DeedIngestField {
  return { ...spec, value: null, values: [], candidates: [], confidence: CONF_WITHHELD, withheld: true, flags };
}
function single(spec: Spec, value: string): DeedIngestField {
  return { ...spec, value, values: [value], candidates: [], confidence: CONF_OK, withheld: false, flags: [] };
}
/** Build a party field from distinct people: `values` = the distinct primaries, `candidates` = every a/k/a
 *  alias spelling (FIRE-B3, un-collapsed, #20), `value` = the single primary only when there is exactly one
 *  person. Living grantor/grantee a/k/a variants are now carried too (not just the fiduciary field). */
function peopleField(spec: Spec, people: Person[], extraFlags: string[] = []): DeedIngestField {
  if (people.length === 0) return notFound(spec);
  const primaries = people.map((p) => p.primary);
  const variants = people.flatMap((p) => p.variants);
  const flags = [...extraFlags];
  if (people.some((p) => p.variants.length > 1)) flags.push('aka_variants_present');
  return {
    ...spec,
    value: primaries.length === 1 ? (primaries[0] ?? null) : null,
    values: primaries,
    candidates: variants,
    confidence: CONF_OK,
    withheld: false,
    flags,
  };
}

// ── §2.1.2 field specs (centralized labels + neutral mapsTo per #19) ─────────────

const S = {
  // vesting deed (a prior/record deed in the packet — parties map to NEUTRAL prior-deed roles, #19)
  grantor: { key: 'grantor', label: 'Grantor of record (prior deed)', mapsTo: 'Vesting recital (prior deed) — record-owner reconciliation; NOT auto-seeded as the new-deed grantor' },
  grantorDescriptor: { key: 'grantorDescriptor', label: 'Grantor marital/capacity descriptor', mapsTo: null },
  grantee: { key: 'grantee', label: 'Grantee of record (prior deed)', mapsTo: 'Vesting recital (prior deed) — prior grantee; the new-deed grantee comes from commitment Sch. B-I, NOT here' },
  granteeDescriptor: { key: 'granteeDescriptor', label: 'Grantee marital/capacity descriptor', mapsTo: null },
  tenancy: { key: 'tenancy', label: 'Tenancy / vesting', mapsTo: 'Grantee tenancy' },
  warrantyType: { key: 'warrantyType', label: 'Warranty type', mapsTo: 'Warranty type' },
  fiduciaryName: { key: 'fiduciaryName', label: 'Fiduciary signer name (FIRE-B3 variants)', mapsTo: 'Grantor name (fiduciary signer) — Certificate of Qualification controls; carry a/k/a variants' },
  fiduciaryCapacity: { key: 'fiduciaryCapacity', label: 'Fiduciary capacity', mapsTo: 'Estate-authority recital' },
  decedentName: { key: 'decedentName', label: 'Decedent / estate-caption name', mapsTo: 'Estate-authority recital — estate caption (prior vesting deed controls)' },
  formerlyOfRecord: { key: 'formerlyOfRecord', label: 'Formerly of record as', mapsTo: 'Grantor name — name reconciliation (B4: affirmative corroboration required)' },
  legalDescription: { key: 'legalDescription', label: 'Legal description (verbatim block)', mapsTo: 'Legal description' },
  condoDeclarationInstrument: { key: 'condoDeclarationInstrument', label: 'Condo Declaration instrument #', mapsTo: 'Legal description — condo Declaration instrument (C1 exact-match)' },
  condoPlatInstrument: { key: 'condoPlatInstrument', label: 'Condo Plat instrument #', mapsTo: 'Legal description — condo Plat instrument (C1 exact-match)' },
  vestingPriorDeedRef: { key: 'vestingPriorDeedRef', label: 'Vesting recital prior-deed reference', mapsTo: 'Vesting recital (prior deed)' },
  vestingPriorDeedDate: { key: 'vestingPriorDeedDate', label: 'Vesting recital prior-deed date', mapsTo: 'Vesting recital (prior deed)' },
  probateFiNumber: { key: 'probateFiNumber', label: 'Probate / FI number', mapsTo: 'Estate-authority recital' },
  powerOfSale: { key: 'powerOfSale', label: 'Power-of-sale language present', mapsTo: 'Estate-authority recital' },
  taxId: { key: 'taxId', label: 'Tax I.D. (GPIN/Map)', mapsTo: 'Tax I.D. (GPIN/Map)' },
  consideration: { key: 'consideration', label: 'Consideration (actual sale price)', mapsTo: 'Consideration' },
  policyAmount: { key: 'policyAmount', label: 'Amount of insurance (policy)', mapsTo: 'Consideration cross-check ONLY — policy amount is NOT the sale price (#22)' },
  assessedValue: { key: 'assessedValue', label: 'Assessed value', mapsTo: 'Assessed Value' },
  titleInsurer: { key: 'titleInsurer', label: 'Title insurer / issuing agent', mapsTo: 'Title insurer + return address' },
  fileNumber: { key: 'fileNumber', label: 'File number', mapsTo: 'File Number' },
  propertyLocality: { key: 'propertyLocality', label: 'Property locality', mapsTo: 'Property locality (granting clause)' },
  // title commitment
  proposedInsured: { key: 'proposedInsured', label: 'Proposed insured (Sch. A)', mapsTo: 'Grantee name + marital status' },
  requiredParties: { key: 'requiredParties', label: 'Required parties (Sch. B-I Req. 4)', mapsTo: 'Grantor name (required-party set — C2 reconciliation)' },
  exhibitALegal: { key: 'exhibitALegal', label: 'Exhibit A legal description', mapsTo: 'Legal description' },
  priorDeedRef: { key: 'priorDeedRef', label: 'Chain of title / prior deed', mapsTo: 'Vesting recital (prior deed)' },
  // tax record
  parcelId: { key: 'parcelId', label: 'Parcel / tax ID', mapsTo: 'Tax I.D. (GPIN/Map)' },
  propertyAddress: { key: 'propertyAddress', label: 'Property (situs) address', mapsTo: 'Grantee-address default (situs)' },
  // LLC authority (operating agreement + SCC entity record). The legal name is the load-bearing capture for the
  // LLC grantee (into) / grantor (out-of); the member set seeds the out-of-LLC signature block. The formation
  // state is a fail-closed gate (the (A)(10)/(A)(11) exemption basis assumes a VIRGINIA LLC).
  llcLegalName: { key: 'llcLegalName', label: 'LLC legal name (verbatim)', mapsTo: 'LLC grantee/grantor legal name (label-anchored, verbatim)' },
  llcMembers: { key: 'llcMembers', label: 'LLC member set', mapsTo: 'Out-of-LLC member grantees / signature block' },
  llcFormationState: { key: 'llcFormationState', label: 'LLC formation jurisdiction', mapsTo: 'Exemption basis ((A)(10)/(A)(11) assumes a Virginia LLC)' },
  llcEntityId: { key: 'llcEntityId', label: 'SCC / entity ID', mapsTo: 'LLC entity identifier (SCC record)' },
  llcFormationDate: { key: 'llcFormationDate', label: 'LLC formation / registration date', mapsTo: 'LLC formation date (SCC record)' },
  // certificate of trust (E6). The trust legal name is the load-bearing send-vehicle capture (label-anchored,
  // verbatim — NOT via splitPeople, which fail-closes on the trust token); the trustee individual names seed the
  // signature/notary leads; the trust date + powers reference are surfaced as research LEADS. The trusteesRecital
  // the assembler needs is ATTORNEY-SUPPLIED, never fabricated from these parts.
  trustLegalName: { key: 'trustLegalName', label: 'Trust legal name (verbatim)', mapsTo: 'Trust legal name (label-anchored, verbatim) — trustees-recital LEAD (attorney supplies the recital)' },
  trusteeNames: { key: 'trusteeNames', label: 'Trustee names', mapsTo: 'Trustee individual names — trustees-recital + notary LEAD (attorney supplies the recital)' },
  trustDate: { key: 'trustDate', label: 'Trust date', mapsTo: 'Trust date — trustees-recital LEAD (attorney supplies the recital)' },
  trustPowersReference: { key: 'trustPowersReference', label: 'Trust powers reference (low-confidence lead)', mapsTo: 'Powers article reference (NON-load-bearing — the assembler emits the canonical powers block)' },
} as const;

// ── classification ────────────────────────────────────────────────────────────

interface TypeSignal {
  type: Exclude<DeedDocType, 'unknown'>;
  patterns: RegExp[];
}
const TYPE_SIGNALS: TypeSignal[] = [
  {
    type: 'title_commitment',
    patterns: [
      /\bcommitment\s+for\s+title\s+insurance\b/i,
      /\bschedule\s+b\b/i,
      /\b(commitment\s+(no\.?|number)|proposed\s+insured)\b/i,
      /\bALTA\s+commitment\b/i,
      /\brequirements?\s+to\s+be\s+(met|satisfied)\b/i,
      /\bdeed\s+to\s+be\s+executed\s+from\b/i,
    ],
  },
  {
    type: 'probate_authority',
    patterns: [
      /\b(certificate\s+of\s+qualification|letters?\s+testamentary|letters?\s+of\s+administration)\b/i,
      /\b(executor|executrix|administrator|personal\s+representative|fiduciary)\b/i,
      /\b(last\s+will\s+and\s+testament|admitted\s+to\s+probate)\b/i,
      /\b(power\s+to\s+sell|power\s+of\s+sale|qualified\s+with\s+full\s+power)\b/i,
      /\bFI[-\s]?\d/i,
    ],
  },
  {
    type: 'tax_record',
    patterns: [
      /\b(assessed\s+value|assessment\s+(year|record)|tax\s+assessment|real\s+estate\s+assessment)\b/i,
      /\b(real\s+estate\s+tax|property\s+tax\s+(card|record)|tax\s+map|GPIN)\b/i,
      /\b(land\s+value|improvement\s+value|total\s+(assessed|assessment))\b/i,
    ],
  },
  {
    // LLC AUTHORITY — covers BOTH the operating agreement and the SCC entity record. The OA signals (operating
    // agreement / member / managing member / percentage interest) and the SCC-record signals (State Corporation
    // Commission / SCC ID / Entity ID / Limited Liability Company / Formation Date) score together; either
    // document classifies as 'llc_authority'.
    type: 'llc_authority',
    patterns: [
      /\boperating\s+agreement\b/i,
      /\bmanaging\s+member\b/i,
      /\bmembers?\b/i,
      /\bpercentage\s+interest\b|\bownership\s+interest\b/i,
      /\bState\s+Corporation\s+Commission\b/i,
      /\bSCC\s+ID\b|\bEntity\s+(?:ID|Number)\b/i,
      /\bLimited\s+Liability\s+Company\b/i,
      /\bformation\s+date\b/i,
    ],
  },
  {
    // CERTIFICATE OF TRUST (E6) — the trust send-vehicle (Va. Code § 64.2-775). Its "Certificate/Certification of
    // Trust" caption + the revocable-living-trust + trust/trustee signals classify it distinctly from a
    // probate_authority (which the bare "trustee" token would otherwise also score) or a vesting_deed.
    type: 'certificate_of_trust',
    patterns: [
      /\bcertificate\s+of\s+trust\b/i,
      /\bcertification\s+of\s+trust\b/i,
      /\brevocable\s+(?:living\s+)?trust\b/i,
      /\btrustee(?:s)?\b/i,
      /\btrust\b/i,
      /pursuant\s+to\b.{0,20}\b55\.1-136\b/i,
    ],
  },
  {
    type: 'vesting_deed',
    patterns: [
      /\bthis\s+deed\b/i,
      /\bby\s+and\s+between\b/i,
      new RegExp(String.raw`\(\s*the\s+${Q}\s*grantors?`, 'i'),
      /\b(?:do|does)\s+hereby\s+(?:grant|convey|bargain|sell)\b/i,
      /\bbeing\s+the\s+same\s+(?:property|real\s+estate)\b/i,
      /\bin\s+fee\s+simple\b/i,
      /\bto\s+wit:?/i,
    ],
  },
];

/** PURE: classify the deed-relevant document type by labeled-signal scoring. */
export function classifyDeedDocType(text: string): { type: DeedDocType; confidence: number } {
  const t = text ?? '';
  if (t.trim().length === 0) return { type: 'unknown', confidence: 0 };
  const scores = TYPE_SIGNALS.map((sig) => {
    const hits = sig.patterns.reduce((n, re) => (re.test(t) ? n + 1 : n), 0);
    return { type: sig.type as Exclude<DeedDocType, 'unknown'>, hits, total: sig.patterns.length };
  }).sort((a, b) => b.hits - a.hits);
  const best = scores[0];
  if (!best || best.hits === 0) return { type: 'unknown', confidence: 0 };
  const share = best.hits / best.total;
  const runnerUp = scores[1]?.hits ?? 0;
  let confidence = Math.round(45 + share * 50);
  if (runnerUp >= best.hits) confidence = Math.round(confidence * 0.7);
  else if (runnerUp > 0) confidence = Math.round(confidence * 0.88);
  return { type: best.type, confidence: Math.max(0, Math.min(100, confidence)) };
}

// ── shared extractors ────────────────────────────────────────────────────────

/** Value of a single-line labeled field, bounded at a 2+-space gap, the next known label, or end-of-line. */
function labeledLineValue(text: string, labelRe: RegExp): string | null {
  const m = labelRe.exec(text);
  if (!m) return null;
  // lstrip the horizontal gap after the label FIRST, so a wide "Label:  value" gap is not itself read as the
  // 2+-space column break (which would drop the value to empty) (#32, #36).
  const after = text.slice(m.index + m[0].length).replace(/^[^\S\n]+/, '');
  const lineEnd = after.search(/\r?\n/);
  const line = lineEnd === -1 ? after : after.slice(0, lineEnd);
  // stop at a 2+-space column gap (prep-block columns) so neighbouring labelled values aren't absorbed.
  const gap = line.search(/\s{2,}/);
  const val = (gap === -1 ? line : line.slice(0, gap)).trim();
  return val.length > 0 ? val : null;
}

/**
 * A parcel/GPIN/tax-map id, anchored on a label and shape-validated. Tries each label in priority order and
 * returns the FIRST label whose line-remainder contains a GPIN-shaped token — so a decoy label whose value is
 * a year/word ("Tax Map 2026 revision", "Tax I.D. Number: record") is skipped, and the field is WITHHELD if a
 * label is present but no id-shaped token follows it (#5, #12, POISON-3).
 */
function extractParcelId(text: string, spec: Spec): DeedIngestField {
  const labels = [
    /\bGPIN\s*[:#]?/i,
    /\bParcel\s+(?:No\.?|Number|ID|#)\s*[:#]?/i,
    /\bTax\s+(?:I\.?D\.?|Identification)\s*(?:Number|No\.?|#)?\s*[:#]?/i,
    /\bTax\s+Map\s*(?:No\.?|#)?\s*[:#]?/i,
    /\bMap\s+(?:No\.?|#)\s*[:#]?/i,
  ];
  let labelSeen = false;
  for (const lab of labels) {
    const m = lab.exec(text);
    if (!m) continue;
    labelSeen = true;
    // Bound the search to the label's OWN column cell (stop at the first 2+-space gap) so a number in a
    // neighbouring column is never grabbed as this id (#11, #26).
    const after = text.slice(m.index + m[0].length).replace(/^[^\S\n]+/, '');
    const lineEnd = after.search(/\r?\n/);
    const line = lineEnd === -1 ? after : after.slice(0, lineEnd);
    const colGap = line.search(/\s{2,}/);
    const cell = colGap === -1 ? line : line.slice(0, colGap);
    const g = GPIN_RE.exec(cell);
    if (g && g[1] !== undefined && !isDateShaped(g[1])) return single(spec, g[1]);
  }
  // A label was present but no id-shaped token followed -> fail closed (do not surface a word/year as an id).
  return labelSeen ? withheld(spec, ['low_shape_no_gpin']) : notFound(spec);
}

/** A money field anchored on one of the given labels; value normalized to a bare numeric. A cell carrying more
 *  than one distinct amount (two columns run together) is ambiguous -> withheld, never one merged figure (#6). */
function extractMoney(text: string, spec: Spec, labelRe: RegExp): DeedIngestField {
  const raw = labeledLineValue(text, labelRe);
  if (raw === null) return notFound(spec);
  const amounts = moneyAmounts(raw);
  if (amounts.length === 0) return withheld(spec, ['unparseable_money']);
  if (amounts.length > 1) return withheld(spec, ['multiple_amounts']);
  return single(spec, amounts[0] ?? '');
}

/** A property (situs) street address anchored on a label — the grantee-address DEFAULT source (Quick Deed
 *  Layer 1). Verbatim, column-bounded (labeledLineValue). A label present with no street-address-shaped value
 *  is WITHHELD (honesty floor), never guessed; no label -> notFound. Tax-record situs is the clean source. */
function extractAddress(text: string, spec: Spec): DeedIngestField {
  const labels = [
    /\b(?:Property|Situs|Site|Premises)\s+Address\s*[:#]/i,
    /\bProperty\s+Location\s*[:#]/i,
    /\bLocation\s+Address\s*[:#]/i,
    /\bSitus\s*[:#]/i,
  ];
  let labelSeen = false;
  for (const lab of labels) {
    const raw = labeledLineValue(text, lab);
    if (raw === null) continue;
    labelSeen = true;
    // Street-address shape: a leading street number + at least one letter on the line. Verbatim otherwise.
    if (/^\d{1,6}\s+\S/.test(raw) && /[A-Za-z]/.test(raw)) return single(spec, raw);
  }
  return labelSeen ? withheld(spec, ['low_shape_no_address']) : notFound(spec);
}

/**
 * The legal-description BLOCK: from the end of `to wit:` to the next section marker (BEING / AND BEING /
 * subject-to). Captured WHOLE across lines (no first-newline truncation, #3). If no terminator is found the
 * block is unbounded/truncated and the "verbatim" claim is WITHHELD + flagged — a truncated legal must never
 * feed C1 as a confident verbatim Exhibit A (#3, #13, POISON-1).
 */
function extractLegalBlock(text: string, spec: Spec): DeedIngestField {
  const start = /\bto\s+wit\s*[:;]?\s*/i.exec(text);
  if (!start) return notFound(spec);
  const after = text.slice(start.index + start[0].length);
  // Terminators: the STRONG, unambiguous recital openers (BEING the same / AND BEING / This conveyance is made
  // subject to / For derivation of title) fire at a line start OR after sentence-final punctuation ("…Virginia.
  // BEING the same…") — covering the routine OCR reflow that joins the vesting recital onto the legal's last
  // line (#4, #10). The WEAK opener "Subject to covenants" stays line-anchored ONLY, so an INLINE "…the parcel
  // being subject to covenants of record…" inside a metes-and-bounds legal does NOT truncate it (#4, #7, #19).
  // At a LINE START: any recital/section opener terminates (incl. the bare "BEING the same" / "AND BEING" plat
  // continuations and "Subject to covenants"). AFTER SENTENCE PUNCTUATION (the OCR-joined case): only the FULL,
  // unambiguous vesting/closing recitals terminate — "BEING the same property/real estate conveyed", the full
  // "This conveyance is made subject to", or "For derivation of title". A bare interior "AND BEING a
  // re-subdivision…" or "BEING the same lot…" therefore does NOT truncate a metes-and-bounds legal mid-block
  // (the re-review HIGH: a partial "verbatim" legal must never reach C1).
  const STRONG_LINE = String.raw`BEING\s+the\s+same|AND\s+BEING|This\s+conveyance\s+is\s+made\s+subject\s+to|For\s+derivation\s+of\s+title|Subject\s+to\s+covenants`;
  const STRONG_INLINE = String.raw`BEING\s+the\s+same\s+(?:property|real\s+estate)\s+conveyed|This\s+conveyance\s+is\s+made\s+subject\s+to|For\s+derivation\s+of\s+title`;
  const term = new RegExp(
    String.raw`(?:^|\n)[^\S\n]*(?:${STRONG_LINE})|(?<=[.;])\s+(?:${STRONG_INLINE})`,
    'i',
  ).exec(after);
  if (!term) return withheld(spec, ['legal_description_unterminated', 'truncated']);
  const block = normalizeWs(after.slice(0, term.index));
  if (!block) return withheld(spec, ['legal_description_empty']);
  if (block.length > LEGAL_MAX) return withheld(spec, ['legal_description_overlong', 'truncated']);
  return single(spec, block);
}

/** The `BEING the same property…` recital span (vesting recital), bounded at the next section/prep marker. */
function beingRecitalSpan(text: string): string | null {
  const m =
    /\bBEING\s+the\s+same\s+(?:property|real\s+estate)\b[\s\S]*?(?=\n\s*(?:This\s+conveyance|Subject\s+to|Tax\s+I\.?D|File\s+Number|Consideration|Assessed\s+Value|Title\s+Insurer|Grantee'?s?\s+Address|Prepared\s+by)\b|\n\s*\n|$)/i.exec(
      text,
    );
  return m ? m[0] : null;
}

/** Parse a role-labeled fiduciary line ("Executor: <name>, a/k/a <variant>") into distinct people (each with
 *  a/k/a variants) + the capacity. Uses splitPeople so a co-fiduciary list ("X, a/k/a X2 and Y") is split into
 *  distinct people FIRST, never glued into one a/k/a candidate (#3, #14, #18). */
function parseLabeledFiduciary(text: string): { people: Person[]; capacity: string | null } {
  const m = /\b((?:Co-)?(?:Executors?|Executrix|Administrators?|Administratrix|Personal\s+Representatives?))\s*[:#]\s*([^\n]+)/i.exec(
    text,
  );
  if (!m || m[2] === undefined) return { people: [], capacity: null };
  const capacity = m[1] !== undefined ? normalizeWs(m[1]) : null;
  // drop a trailing capacity/role tail if the name line repeats it.
  const portion = m[2].replace(/,\s*(?:Executors?|Executrix|Administrators?|Personal\s+Representatives?)\b.*$/i, '');
  const { people, ok } = splitPeople(portion);
  return ok ? { people, capacity } : { people: [], capacity };
}

/** Build the fiduciaryName field from parsed people (FIRE-B3: preserve every a/k/a, never auto-pick across
 *  distinct co-fiduciaries). value = the single primary only when there is exactly one signer. */
function fiduciaryNameField(people: Person[]): DeedIngestField {
  return peopleField(S.fiduciaryName, people, people.length > 1 ? ['co_fiduciaries'] : []);
}

// ── per-type extraction ─────────────────────────────────────────────────────────

function extractVestingDeed(text: string): DeedIngestField[] {
  const fields: DeedIngestField[] = [];

  // Parties — structural anchors (name BEFORE the parenthetical label), isolated across newlines.
  const grantorRe = new RegExp(String.raw`\bby\s+and\s+between\s+([\s\S]*?)\s*,\s*\(\s*the\s+${Q}\s*Grantors?\b`, 'i');
  const granteeRe = new RegExp(
    String.raw`\(\s*the\s+${Q}\s*Grantors?${Q}\s*\)\s*,?\s*and\s+([\s\S]*?)\s*,\s*\(\s*the\s+${Q}\s*Grantees?\b`,
    'i',
  );
  const hasFrame = /\bby\s+and\s+between\b/i.test(text);

  // --- grantor side ---
  const gm = grantorRe.exec(text);
  const grantorParsed = gm && gm[1] !== undefined ? parsePartySpan(gm[1]) : UNCLEAN_SPAN;
  if (grantorParsed.ok) {
    if (grantorParsed.isFiduciary) {
      fields.push(fiduciaryNameField(grantorParsed.people));
      fields.push(grantorParsed.capacity ? single(S.fiduciaryCapacity, grantorParsed.capacity) : notFound(S.fiduciaryCapacity));
      fields.push(grantorParsed.decedent ? single(S.decedentName, grantorParsed.decedent) : notFound(S.decedentName));
      fields.push(notFound(S.grantor));
    } else {
      fields.push(peopleField(S.grantor, grantorParsed.people));
      fields.push(notFound(S.fiduciaryName));
      fields.push(notFound(S.fiduciaryCapacity));
      fields.push(notFound(S.decedentName));
    }
    fields.push(grantorParsed.descriptor ? single(S.grantorDescriptor, grantorParsed.descriptor) : notFound(S.grantorDescriptor));
    fields.push(grantorParsed.formerlyOfRecord ? single(S.formerlyOfRecord, grantorParsed.formerlyOfRecord) : notFound(S.formerlyOfRecord));
  } else {
    // present-but-unisolable -> fail closed + flag; absent -> simply not found. Never emit junk (POISON-2).
    const g = hasFrame ? withheld(S.grantor, ['isolation_failed']) : notFound(S.grantor);
    fields.push(g, notFound(S.fiduciaryName), notFound(S.fiduciaryCapacity), notFound(S.decedentName), notFound(S.grantorDescriptor), notFound(S.formerlyOfRecord));
  }

  // --- grantee side ---
  const grm = granteeRe.exec(text);
  const granteeParsed = grm && grm[1] !== undefined ? parsePartySpan(grm[1]) : UNCLEAN_SPAN;
  if (granteeParsed.ok) {
    fields.push(peopleField(S.grantee, granteeParsed.people));
    fields.push(granteeParsed.descriptor ? single(S.granteeDescriptor, granteeParsed.descriptor) : notFound(S.granteeDescriptor));
  } else {
    const grHasGrantorLabel = new RegExp(String.raw`\(\s*the\s+${Q}\s*Grantors?`, 'i').test(text);
    fields.push(grHasGrantorLabel ? withheld(S.grantee, ['isolation_failed']) : notFound(S.grantee));
    fields.push(notFound(S.granteeDescriptor));
  }

  // Tenancy / warranty / locality (granting clause).
  const ten = /\bin\s+fee\s+simple,\s*(?:as\s+)?((?:sole\s+owner|tenants\s+by\s+the\s+entiret(?:y|ies)[^,.]*|joint\s+tenants[^,.]*|tenants\s+in\s+common))/i.exec(text);
  fields.push(ten && ten[1] !== undefined ? single(S.tenancy, normalizeWs(ten[1])) : notFound(S.tenancy));
  const war = /\bwith\s+((?:General|Special|Special\/Fiduciary|Fiduciary)\s+Warranty)\b/i.exec(text);
  fields.push(war && war[1] !== undefined ? single(S.warrantyType, normalizeWs(war[1])) : notFound(S.warrantyType));
  // Locality: handle BOTH "located in [Name] County" and the standard VA "located in the County of [Name]"
  // form, normalizing the latter to "[Name] County" (#29).
  const locOf = /\blocated\s+in\s+the\s+(County|City)\s+of\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*)/i.exec(text);
  const locPlain = /\blocated\s+in\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*\s+(?:County|City))\b/i.exec(text);
  const locality =
    locOf && locOf[1] !== undefined && locOf[2] !== undefined ? `${normalizeWs(locOf[2])} ${locOf[1]}`
    : locPlain && locPlain[1] !== undefined ? normalizeWs(locPlain[1])
    : null;
  fields.push(locality !== null ? single(S.propertyLocality, locality) : notFound(S.propertyLocality));

  // Legal description block (truncation-aware).
  fields.push(extractLegalBlock(text, S.legalDescription));

  // Condo Declaration + Plat instruments (exact; both required for a condo, C1).
  const decl = /Declaration[\s\S]{0,200}?recorded\s+as\s+Instrument\s+No\.?\s*(\d{6,})/i.exec(text);
  fields.push(decl && decl[1] !== undefined ? single(S.condoDeclarationInstrument, decl[1]) : notFound(S.condoDeclarationInstrument));
  const plat = /Plat\s+(?:at|recorded\s+as)\s+Instrument\s+No\.?\s*(\d{6,})/i.exec(text);
  fields.push(plat && plat[1] !== undefined ? single(S.condoPlatInstrument, plat[1]) : notFound(S.condoPlatInstrument));

  // Vesting prior-deed reference + date (anchored INSIDE the BEING recital — or the "For derivation of title"
  // recital some deeds use instead — so the plat reference in the legal block is never mistaken for the prior
  // deed, #12).
  const deriv = /\bFor\s+derivation\s+of\s+title\b[^\n]*(?:\n(?![\s]*\n)[^\n]*)?/i.exec(text);
  const being = beingRecitalSpan(text) ?? (deriv ? deriv[0] : null);
  if (being) {
    const ref = INSTR_RE.exec(being);
    fields.push(ref && ref[1] !== undefined ? single(S.vestingPriorDeedRef, normalizeWs(ref[1])) : notFound(S.vestingPriorDeedRef));
    const dm = /\bdated\s+/i.exec(being);
    const dateMatch = dm ? DATE_RE.exec(being.slice(dm.index)) : null;
    fields.push(dateMatch && dateMatch[1] !== undefined ? single(S.vestingPriorDeedDate, normalizeWs(dateMatch[1])) : notFound(S.vestingPriorDeedDate));
  } else {
    fields.push(notFound(S.vestingPriorDeedRef), notFound(S.vestingPriorDeedDate));
  }

  // Estate authority signals (when present).
  const fi = /\b(FI[-\s]?\d{4}[-\s]?\d+)\b/i.exec(text);
  fields.push(fi && fi[1] !== undefined ? single(S.probateFiNumber, normalizeWs(fi[1]).replace(/\s/g, '-')) : notFound(S.probateFiNumber));
  const pos = /\b(full\s+power\s+to\s+sell(?:\s+and\s+convey)?|power\s+to\s+sell\s+and\s+convey|power\s+of\s+sale)\b/i.exec(text);
  fields.push(pos && pos[1] !== undefined ? single(S.powerOfSale, normalizeWs(pos[1])) : notFound(S.powerOfSale));

  // Prep-block fields. The money/text labels REQUIRE a `:`/`#` so the caption field is matched and recital
  // prose ("…in consideration of the sum…", a nominal "$10" recital) is NOT — fail-closed disambiguation.
  fields.push(extractParcelId(text, S.taxId));
  fields.push(extractMoney(text, S.consideration, /\bConsideration\s*[:#]/i));
  fields.push(extractMoney(text, S.assessedValue, /\bAssessed\s+Value\s*[:#]/i));
  const ins = labeledLineValue(text, /\bTitle\s+Insurer\s*[:#]/i) ?? labeledLineValue(text, /\b(?:Issuing\s+(?:Agent|Office)|Underwriter)\s*[:#]/i);
  fields.push(ins !== null ? single(S.titleInsurer, ins) : notFound(S.titleInsurer));
  const fileNo = labeledLineValue(text, /\bFile\s+Number\s*[:#]/i);
  fields.push(fileNo !== null ? single(S.fileNumber, fileNo) : notFound(S.fileNumber));

  return fields;
}

function extractTitleCommitment(text: string): DeedIngestField[] {
  const fields: DeedIngestField[] = [];

  const pi = labeledLineValue(text, /\bProposed\s+Insured\s*[:#]/i);
  fields.push(pi !== null ? single(S.proposedInsured, pi) : notFound(S.proposedInsured));

  // Required parties (Sch. B-I Req. 4). SCOPE the search to the Schedule B-I / Requirements region first, so an
  // earlier Schedule-A "...conveyed from the current record owner to the proposed purchaser..." prose can never
  // be matched (#5, #13, #34); within it ANCHOR on "Deed … from X to/unto Y" while EXCLUDING "Deed of Trust";
  // peel a trailing marital descriptor (#8, #15); split distinct people (comma + and) and reject any non-name
  // token, withholding rather than feeding C2 junk (#10).
  // Recognize the common Schedule B-I / Requirements labels: "Schedule B-I", "Schedule B, Part I", "Schedule B
  // Part I", "Schedule B-1" (digit), "Schedule B Section 1", "Requirements to be met/satisfied", "Requirements:"
  // (re-review label-miss finding). If NO requirements region is identifiable, FAIL CLOSED (notFound -> the
  // critical-field router sends the commitment to review) rather than scanning the whole document and
  // re-admitting a Schedule-A "from X to Y" decoy.
  const reqRegion =
    /(?:Schedule\s+B\b[\s,.-]*(?:Part\s+)?(?:I\b|1\b|Section\s+(?:I|1)\b)|Requirements?(?:\s+to\s+be\s+(?:met|satisfied))?\s*:)/i.exec(
      text,
    );
  const rp = reqRegion
    ? /\bDeed\b(?!\s+of\s+[Tt]rust)[^.\n]*?\bfrom\s+(.+?)\s+(?:to|unto)\b/i.exec(text.slice(reqRegion.index))
    : null;
  if (rp && rp[1] !== undefined) {
    // trim trailing list punctuation first, THEN peel the trailing marital descriptor (which is $-anchored).
    const span = rp[1].replace(/[\s,;]+$/, '').replace(DESCRIPTOR_TAIL_RE, '');
    const { people, ok } = splitPeople(span);
    fields.push(ok ? peopleField(S.requiredParties, people) : withheld(S.requiredParties, ['isolation_failed']));
  } else {
    fields.push(notFound(S.requiredParties));
  }

  // Exhibit A legal — multi-line block bounded at the next LINE-ANCHORED Schedule-A caption label, a blank
  // line, or end-of-string, so neither a trailing caption label is glued into the "verbatim" legal (#5, #33)
  // nor an Exhibit-A-that-ends-the-document is silently dropped (#23).
  const eaStop = String.raw`(?:^|\n)[^\S\n]*(?:Issuing\s+Agent|Schedule\b|Requirements?\b|Underwriter|Title\s+Insurer|Commitment\s+No|Proposed\s+Insured|Sale\s+Price|Purchase\s+Price|Amount\s+of\s+Insurance|Policy\s+Amount|GPIN|Tax\s+I\.?D|Chain\s+of\s+Title|NOTE|BEING\s+the\s+same|AND\s+BEING|This\s+conveyance\s+is\s+made\s+subject\s+to|Subject\s+to\s+covenants)\b|(?<=[.;])\s+(?:BEING\s+the\s+same|AND\s+BEING)|\n[^\S\n]*\n|$`;
  const ea = new RegExp(String.raw`\bExhibit\s+A\s*[:#]?\s*([\s\S]*?)(?=${eaStop})`, 'i').exec(text);
  if (ea && ea[1] !== undefined) {
    const block = normalizeWs(ea[1]);
    // Post-validate: a residual Schedule-A label inside the block means the boundary leaked -> withhold (#33).
    const polluted = /\b(?:Commitment\s+No|Proposed\s+Insured|Issuing\s+Agent|Amount\s+of\s+Insurance|Sale\s+Price|GPIN|Chain\s+of\s+Title)\b/i.test(block);
    fields.push(
      block.length > 0 && block.length <= LEGAL_MAX && !polluted
        ? single(S.exhibitALegal, block)
        : withheld(S.exhibitALegal, [polluted ? 'label_pollution' : 'truncated']),
    );
  } else {
    fields.push(notFound(S.exhibitALegal));
  }

  fields.push(extractParcelId(text, S.taxId));

  // Consideration = actual sale/contract price ONLY — never the policy "amount of insurance" (#22).
  fields.push(extractMoney(text, S.consideration, /\b(?:sale\s+price|purchase\s+price|contract\s+(?:sales\s+)?price|consideration)\s*[:#]/i));
  fields.push(extractMoney(text, S.policyAmount, /\b(?:amount\s+of\s+insurance|policy\s+amount)\s*[:#]/i));

  const ins = labeledLineValue(text, /\b(?:Issuing\s+(?:Agent|Office)|Underwriter|Title\s+Insurer)\s*[:#]/i);
  fields.push(ins !== null ? single(S.titleInsurer, ins) : notFound(S.titleInsurer));

  // Prior-deed reference — anchor to the chain-of-title context first so the Exhibit A legal's OWN recording
  // reference is not mis-mapped as the prior vesting deed; fall back to a document-wide scan only if no
  // chain-of-title label exists (#27, #35).
  const cot = /\b(?:Chain\s+of\s+Title|prior\s+vesting|last\s+deed(?:\s+into\s+(?:the\s+)?grantor)?)\b[^\n]*/i.exec(text);
  const ref = (cot ? INSTR_RE.exec(cot[0]) : null) ?? INSTR_RE.exec(text);
  fields.push(ref && ref[1] !== undefined ? single(S.priorDeedRef, normalizeWs(ref[1])) : notFound(S.priorDeedRef));

  return fields;
}

function extractProbateAuthority(text: string): DeedIngestField[] {
  const fields: DeedIngestField[] = [];

  // Decedent: "Estate of <X>" but NOT "real estate of <X>" (#7); keep a generational suffix (#21).
  const dre = /\b(real\s+)?estate\s+of\s+(.+?)(?=,\s*(?:deceased|the\s+decedent)\b|\r?\n|$)/gi;
  let dm: RegExpExecArray | null;
  let decedent: string | null = null;
  while ((dm = dre.exec(text)) !== null) {
    if (dm[1] === undefined && dm[2] !== undefined) {
      const cand = cleanDecedent(dm[2]);
      if (cand.length > 0) { decedent = cand; break; }
    }
  }
  fields.push(decedent !== null ? single(S.decedentName, decedent) : notFound(S.decedentName));

  const fi = /\b(FI[-\s]?\d{4}[-\s]?\d+)\b/i.exec(text);
  fields.push(fi && fi[1] !== undefined ? single(S.probateFiNumber, normalizeWs(fi[1]).replace(/\s/g, '-')) : notFound(S.probateFiNumber));

  const lf = parseLabeledFiduciary(text);
  fields.push(fiduciaryNameField(lf.people));
  fields.push(lf.capacity !== null ? single(S.fiduciaryCapacity, lf.capacity) : notFound(S.fiduciaryCapacity));

  const pos = /\b(full\s+power\s+to\s+sell(?:\s+and\s+convey)?|power\s+to\s+sell\s+and\s+convey|power\s+of\s+sale)\b/i.exec(text);
  fields.push(pos && pos[1] !== undefined ? single(S.powerOfSale, normalizeWs(pos[1])) : notFound(S.powerOfSale));

  return fields;
}

function extractTaxRecord(text: string): DeedIngestField[] {
  const fields: DeedIngestField[] = [];
  fields.push(extractParcelId(text, S.parcelId));
  // "(Total) Assessed Value" is the primary label; "Total Assessment" is the fallback wording. A WITHHELD
  // primary (e.g. ambiguous multi-amount) is preserved — never silently downgraded to the fallback/notFound (#28).
  const assessed = extractMoney(text, S.assessedValue, /\b(?:total\s+)?assessed\s+value\s*[:#]/i);
  fields.push(assessed.withheld || assessed.value !== null ? assessed : extractMoney(text, S.assessedValue, /\btotal\s+assessment\s*[:#]/i));
  fields.push(extractAddress(text, S.propertyAddress));
  return fields;
}

// An LLC legal name must read like an entity name (a corporate designator somewhere in it) and be clean: no
// label/bridge bleed, no line crossing, plausible length. This is the fail-closed gate for the label-anchored
// llcLegalName capture (the legal name is NOT run through splitPeople, which would fail-close on the very
// LLC/Inc/Trust designator that makes it a valid entity name).
function llcLegalNameIsClean(n: string): boolean {
  const t = n.trim();
  if (t.length < 3 || t.length > 160) return false;
  if (/[\n\r]/.test(t)) return false; // crossed a line boundary
  if (new RegExp(String.raw`\(\s*the\s+${Q}`, 'i').test(t)) return false; // a parenthetical label bled in
  if (/\)\s*,\s*and\b/i.test(t)) return false; // a `"), and` bridge bled in
  if (!ENTITY_RE.test(t)) return false; // no corporate designator -> not an LLC/entity legal name
  if (!/[A-Za-z]/.test(t)) return false;
  return true;
}

// A formation/registration jurisdiction is VIRGINIA iff it reads "Virginia" or the bare "VA" state code. Any
// other named jurisdiction (Delaware, Maryland, "DE", …) is NON-VA and the (A)(10)/(A)(11) exemption basis no
// longer holds -> the formation-state field is WITHHELD + flagged (a foreign-state LLC surfaced as confident
// would feed a wrong exemption cite).
function isVirginiaFormation(state: string): boolean {
  const t = state.trim();
  return /^Virginia$/i.test(t) || /^VA$/.test(t) || /\bVirginia\b/i.test(t) || /(^|[,\s])VA([,\s]|$)/.test(t);
}

function extractLlcAuthority(text: string): DeedIngestField[] {
  const fields: DeedIngestField[] = [];

  // ── LLC legal name (label-anchored, VERBATIM) ──
  // Try, in priority order, the SCC "Entity Name:" label, the OA "OPERATING AGREEMENT OF <name>" caption, and a
  // generic "Company/LLC Name:" label. The name is captured VERBATIM and boundary-validated (NOT via splitPeople,
  // which fail-closes on the entity designator). A label present but unclean is WITHHELD (honesty floor).
  let llcName: string | null = null;
  let llcNameLabelSeen = false;
  const entityLabel = labeledLineValue(text, /\bEntity\s+Name\s*[:#]/i) ?? labeledLineValue(text, /\b(?:Company|LLC)\s+Name\s*[:#]/i);
  if (entityLabel !== null) {
    llcNameLabelSeen = true;
    if (llcLegalNameIsClean(entityLabel)) llcName = normalizeWs(entityLabel);
  }
  if (llcName === null) {
    const oa = /\bOPERATING\s+AGREEMENT\s+OF\s+(.+?)(?=\r?\n|$)/i.exec(text);
    if (oa && oa[1] !== undefined) {
      llcNameLabelSeen = true;
      const cand = normalizeWs(oa[1]);
      if (llcLegalNameIsClean(cand)) llcName = cand;
    }
  }
  fields.push(
    llcName !== null ? single(S.llcLegalName, llcName)
    : llcNameLabelSeen ? withheld(S.llcLegalName, ['llc_legal_name_unclean'])
    : notFound(S.llcLegalName),
  );

  // ── LLC members (individual names; splitPeople — a/k/a variants preserved) ──
  // Two member-bearing forms: the SCHEDULE A member row(s), and the OA "entered into by <Person> (the "Member")"
  // recital. Members are INDIVIDUALS, so splitPeople applies (it fail-closes only on entity-shaped spans, which a
  // member name is not). A member span that cannot be cleanly isolated is WITHHELD (never emitted as junk).
  let memberPeople: Person[] = [];
  let memberLabelSeen = false;
  const memberLine =
    labeledLineValue(text, /\bMembers?\s*[:#]/i) ??
    labeledLineValue(text, /\bManaging\s+Members?\s*[:#]/i);
  if (memberLine !== null) {
    memberLabelSeen = true;
    const { people, ok } = splitPeople(memberLine);
    if (ok) memberPeople = people;
  }
  if (memberPeople.length === 0) {
    const enteredBy = /\bentered\s+into\s+by\s+(.+?)\s*\(\s*the\s+["'“”]?\s*Members?\b/i.exec(text);
    if (enteredBy && enteredBy[1] !== undefined) {
      memberLabelSeen = true;
      const { people, ok } = splitPeople(enteredBy[1]);
      if (ok) memberPeople = people;
    }
  }
  fields.push(
    memberPeople.length > 0 ? peopleField(S.llcMembers, memberPeople)
    : memberLabelSeen ? withheld(S.llcMembers, ['isolation_failed'])
    : notFound(S.llcMembers),
  );

  // ── LLC formation state (VA gate) ──
  // The formation jurisdiction anchors the exemption basis. Captured from an explicit "Jurisdiction:"/"Formation
  // State:" label, the SCC "VA Qualification" context, or the OA "a Virginia limited liability company" recital.
  // A NON-Virginia jurisdiction is WITHHELD + flagged (never surfaced as a confident value that would feed a wrong
  // cite); a present-but-Virginia value passes.
  let formationState: string | null = null;
  let formationLabelSeen = false;
  const stateLabel =
    labeledLineValue(text, /\b(?:Formation\s+State|State\s+of\s+Formation|Jurisdiction)\s*[:#]/i);
  if (stateLabel !== null) {
    formationLabelSeen = true;
    if (isVirginiaFormation(stateLabel)) formationState = normalizeWs(stateLabel);
  }
  if (formationState === null && !formationLabelSeen) {
    // OA recital "a Virginia limited liability company" — VA-only (a foreign recital would name its own state).
    const recital = /\ba\s+(Virginia)\s+limited\s+liability\s+company\b/i.exec(text);
    if (recital && recital[1] !== undefined) {
      formationLabelSeen = true;
      formationState = normalizeWs(recital[1]);
    }
  }
  fields.push(
    formationState !== null ? single(S.llcFormationState, formationState)
    : formationLabelSeen ? withheld(S.llcFormationState, ['non_virginia_formation_state'])
    : notFound(S.llcFormationState),
  );

  // ── SCC / entity ID ──
  const idLabel =
    labeledLineValue(text, /\bSCC\s+ID\s*[:#]/i) ??
    labeledLineValue(text, /\bEntity\s+(?:ID|Number)\s*[:#]/i);
  let entityId: string | null = null;
  if (idLabel !== null) {
    const m = /\b([A-Za-z]?\d[\d-]{3,})\b/.exec(idLabel);
    if (m && m[1] !== undefined) entityId = m[1];
  }
  fields.push(entityId !== null ? single(S.llcEntityId, entityId) : notFound(S.llcEntityId));

  // ── formation / registration date ──
  const dateLabel =
    labeledLineValue(text, /\b(?:Formation|Registration)\s+Date\s*[:#]/i) ??
    labeledLineValue(text, /\bDate\s+of\s+Formation\s*[:#]/i);
  let formationDate: string | null = null;
  if (dateLabel !== null) {
    const dm = DATE_RE.exec(dateLabel);
    if (dm && dm[1] !== undefined) formationDate = normalizeWs(dm[1]);
  }
  fields.push(formationDate !== null ? single(S.llcFormationDate, formationDate) : notFound(S.llcFormationDate));

  return fields;
}

// A trust legal name VERY OFTEN leads with the determiner "The" ("The Jane A. Doe Revocable Living Trust"); the
// DETERMINER_LEAD_RE reject would otherwise fail-close every such name. This is the fail-closed clean gate for the
// label-anchored trustLegalName capture (a trust name is NOT run through splitPeople, which would fail-close on the
// very Trust token that makes it a valid trust name — mirrors llcLegalNameIsClean). A single leading "The " that
// introduces the trust caption is legitimate (it is part of the trust's legal name), unlike the prose "the current
// record owner"; a determiner OTHER than that leading "The" is prose and is rejected.
function trustNameCandidateClean(raw: string): boolean {
  const t = raw.trim();
  // Allow a single leading "The " (the trust caption determiner), then re-run the clean gate on the remainder
  // logic by checking the non-leading-determiner version directly.
  const withoutLead = /^the\s+/i.test(t) ? t.replace(/^the\s+/i, '') : t;
  if (t.length < 3 || t.length > 160) return false;
  if (/[\n\r]/.test(t)) return false;
  if (!/\bTrust\b/i.test(t)) return false;
  if (/\b(?:Settlors?|Trustees?|established|known\s+as)\b/i.test(t)) return false; // a label/clause bled in
  // a determiner OTHER than the leading "The" is prose (e.g. "said", "a certain") -> reject on the remainder.
  if (DETERMINER_LEAD_RE.test(withoutLead)) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  return true;
}

function extractCertificateOfTrust(text: string): DeedIngestField[] {
  const fields: DeedIngestField[] = [];

  // ── trust legal name (label-anchored, VERBATIM) ──
  // Try, in priority order: the "Trust Name and Date:" recital ("The Trust is known as <NAME>, established by..."),
  // a generic "Trust Name:" label, and the "...to certify the existence and terms of <NAME> (the \"Trust\")"
  // recital. The name is captured VERBATIM and boundary-validated (NOT via splitPeople, which fail-closes on the
  // Trust token). A label present but unclean is WITHHELD (honesty floor).
  let trustName: string | null = null;
  let trustNameLabelSeen = false;
  // (a) "The Trust is known as <NAME>, established by ..." (or ", dated ...", or end of line).
  const knownAs = /\bThe\s+Trust\s+is\s+known\s+as\s+(.+?)(?=,\s*(?:established|dated)\b|\r?\n|$)/i.exec(text);
  if (knownAs && knownAs[1] !== undefined) {
    trustNameLabelSeen = true;
    const cand = normalizeWs(knownAs[1]);
    if (trustNameCandidateClean(cand)) trustName = cand;
  }
  // (b) a generic "Trust Name:" labeled line (NOT the combined "Trust Name and Date:" recital head, which the
  //     (a) branch already handles; the labeledLineValue here only fires on a bare "Trust Name:" cell value).
  if (trustName === null) {
    const labeled = labeledLineValue(text, /\bTrust\s+Name\s*[:#]/i);
    if (labeled !== null) {
      trustNameLabelSeen = true;
      const cand = normalizeWs(labeled);
      if (trustNameCandidateClean(cand)) trustName = cand;
    }
  }
  // (c) "...to certify the existence and terms of <NAME> (the \"Trust\")" recital.
  if (trustName === null) {
    const certifyRecital = /\bexistence\s+and\s+terms\s+of\s+(.+?)\s*\(\s*the\s+["'“”]?\s*Trust\b/i.exec(text);
    if (certifyRecital && certifyRecital[1] !== undefined) {
      trustNameLabelSeen = true;
      const cand = normalizeWs(certifyRecital[1]);
      if (trustNameCandidateClean(cand)) trustName = cand;
    }
  }
  fields.push(
    trustName !== null ? single(S.trustLegalName, trustName)
    : trustNameLabelSeen ? withheld(S.trustLegalName, ['trust_legal_name_unclean'])
    : notFound(S.trustLegalName),
  );

  // ── trustee names (individual names; splitPeople — a/k/a variants preserved) ──
  // The "Current Trustees:" recital ("The currently acting Trustees are X and Y, serving as Co-Trustees...") and
  // the bare "Trustees:" label. Trustees are INDIVIDUALS, so splitPeople applies (it fail-closes only on
  // entity-shaped spans). A span that cannot be cleanly isolated is WITHHELD (never emitted as junk). A trailing
  // capacity clause ("serving as Co-Trustees...") is peeled before splitting so it is not glued into a name.
  let trusteePeople: Person[] = [];
  let trusteeLabelSeen = false;
  // "The currently acting Trustee(s) is/are <NAMES>, serving as ..." — both the plural ("Trustees are") and the
  // single-trustee ("Trustee is") forms; bounded before the ", serving"/", as Co-Trustees" capacity tail.
  const currentTrustees =
    /\b(?:currently\s+)?acting\s+Trustees?\s+(?:is|are)\s+(.+?)(?=,\s*serving\b|,\s*as\s+(?:Co-)?Trustees?\b|,\s*sole\s+Trustee\b|\r?\n|$)/i.exec(
      text,
    );
  if (currentTrustees && currentTrustees[1] !== undefined) {
    trusteeLabelSeen = true;
    const { people, ok } = splitPeople(currentTrustees[1]);
    if (ok) trusteePeople = people;
  }
  if (trusteePeople.length === 0) {
    const labeled =
      labeledLineValue(text, /\bCurrent\s+Trustees?\s*[:#]/i) ??
      labeledLineValue(text, /\bTrustees?\s*[:#]/i);
    if (labeled !== null) {
      trusteeLabelSeen = true;
      // peel a leading "(The )(currently )acting Trustee(s) is/are " prose lead, then a trailing "serving as ..." /
      // ", as Co-Trustees ..." / ", sole Trustee" capacity tail, before splitting into distinct people.
      const portion = labeled
        .replace(/^\s*(?:the\s+)?(?:currently\s+)?acting\s+Trustees?\s+(?:is|are)\s+/i, '')
        .replace(/,\s*(?:serving\b|as\s+(?:Co-)?Trustees?\b|sole\s+Trustee\b).*$/i, '');
      const { people, ok } = splitPeople(portion);
      if (ok) trusteePeople = people;
    }
  }
  fields.push(
    trusteePeople.length > 0 ? peopleField(S.trusteeNames, trusteePeople)
    : trusteeLabelSeen ? withheld(S.trusteeNames, ['isolation_failed'])
    : notFound(S.trusteeNames),
  );

  // ── trust date (label-anchored: "dated <DATE>" / "Date of Trust:" / "as of this <Nth> day of <Month>, <Year>") ──
  let trustDate: string | null = null;
  const datedClause =
    /\bestablished\s+by\s+a\s+Trust\s+Agreement\s+dated\s+/i.exec(text) ??
    /\bTrust\s+Agreement\s+dated\s+/i.exec(text) ??
    /\bdate\s+of\s+trust\s*[:#]\s*/i.exec(text) ??
    /\bdated\s+/i.exec(text);
  if (datedClause) {
    const dm = DATE_RE.exec(text.slice(datedClause.index + datedClause[0].length));
    if (dm && dm[1] !== undefined) trustDate = normalizeWs(dm[1]);
  }
  fields.push(trustDate !== null ? single(S.trustDate, trustDate) : notFound(S.trustDate));

  // ── trust powers reference (OPTIONAL, low-confidence, NEVER load-bearing) ──
  // A reference to the powers article/section (e.g. "Article IX" or "full power to sell"). The assembler ALWAYS
  // emits the canonical powers block, so this is a non-binding research lead only. Surfaced at OK confidence when
  // a clear article reference is present; absent otherwise (never withheld — it is not a critical field).
  const powersArticle =
    /\b(?:broad\s+powers\s+under\s+(Article\s+[IVXLC]+)|powers?\s+(?:are\s+)?(?:set\s+forth\s+|described\s+)?in\s+(Article\s+[IVXLC]+))\b/i.exec(text);
  const powersPhrase = /\b(full\s+power\s+to\s+sell(?:\s+and\s+convey)?|power\s+to\s+sell\s+and\s+convey|power\s+of\s+sale)\b/i.exec(text);
  const powersRef =
    powersArticle && (powersArticle[1] ?? powersArticle[2]) !== undefined
      ? normalizeWs((powersArticle[1] ?? powersArticle[2])!)
      : powersPhrase && powersPhrase[1] !== undefined
        ? normalizeWs(powersPhrase[1])
        : null;
  fields.push(powersRef !== null ? single(S.trustPowersReference, powersRef) : notFound(S.trustPowersReference));

  return fields;
}

// The C1/C2-feeding source field(s) per document type: if one is withheld or absent, the WHOLE document is
// routed to human review (it cannot be a confident extraction without its load-bearing field) (#37).
const CRITICAL_KEYS: Record<Exclude<DeedDocType, 'unknown'>, string[]> = {
  vesting_deed: ['legalDescription'],
  title_commitment: ['exhibitALegal', 'requiredParties'],
  probate_authority: [],
  tax_record: [],
  // A missing member set OR legal name forces document review (the load-bearing LLC captures).
  llc_authority: ['llcMembers', 'llcLegalName'],
  // A missing trust legal name OR trustee set forces document review (the load-bearing trust captures). The
  // trustees recital the assembler needs is attorney-supplied, but these are the source-of-truth LEADS.
  certificate_of_trust: ['trustLegalName', 'trusteeNames'],
};

/**
 * PURE: classify + extract the §2.1 candidate fields from a deed-packet document's already-extracted text.
 * Surfaces per-field confidence + the honesty-floor low-confidence signal; never throws on empty/unknown
 * input. Fail-closed: a type-uncertain document, a zero-field extraction, a missing critical field, or a
 * sub-floor overall is routed to human review (lowConfidence true); any truncated/polluted/ambiguous field is
 * withheld.
 */
export function extractDeedIngest(text: string): DeedIngestResult {
  const t = text ?? '';
  const { type, confidence: typeConfidence } = classifyDeedDocType(t);
  const warnings: string[] = [];

  if (type === 'unknown') {
    warnings.push('document_type_unrecognized');
    return { docType: 'unknown', typeConfidence: 0, overallConfidence: 0, lowConfidence: true, fields: [], warnings };
  }

  const fields =
    type === 'vesting_deed' ? extractVestingDeed(t)
    : type === 'title_commitment' ? extractTitleCommitment(t)
    : type === 'probate_authority' ? extractProbateAuthority(t)
    : type === 'llc_authority' ? extractLlcAuthority(t)
    : type === 'certificate_of_trust' ? extractCertificateOfTrust(t)
    : extractTaxRecord(t);

  const surfaced = fields.filter((f) => f.value !== null || f.values.length > 0);
  const withheldFields = fields.filter((f) => f.withheld);

  if (typeConfidence < OCR_CONFIDENCE_FLOOR) warnings.push('document_type_uncertain');
  if (surfaced.length === 0) warnings.push('no_fields_extracted');
  if (withheldFields.length > 0) warnings.push(`fields_withheld:${withheldFields.map((f) => f.key).join(',')}`);
  const akaUnresolved = fields.filter((f) => f.candidates.length > 1).map((f) => f.key);
  if (akaUnresolved.length > 0) warnings.push(`aka_variants_unresolved:${akaUnresolved.join(',')}`);
  const coFiduciary = fields.filter((f) => f.flags.includes('co_fiduciaries')).map((f) => f.key);
  if (coFiduciary.length > 0) warnings.push(`co_fiduciaries_unresolved:${coFiduciary.join(',')}`);

  // A withheld OR absent CRITICAL field (the C1/C2-feeding source for this doc type) forces document-level
  // review even if other fields surfaced — a deed with no verbatim legal, or a commitment with no Exhibit A /
  // required-party set, must never read as a confident extraction (#37).
  const criticalMissing = CRITICAL_KEYS[type].filter((k) => {
    const f = fields.find((x) => x.key === k);
    return !f || f.withheld || (f.value === null && f.values.length === 0);
  });
  if (criticalMissing.length > 0) warnings.push(`critical_field_unresolved:${criticalMissing.join(',')}`);

  // overallConfidence reflects EXTRACTION COMPLETENESS, not just the mean of surfaced fields: withheld and
  // missing fields drag it toward the floor (#10). Denominator = surfaced + withheld attempts.
  const considered = [...surfaced, ...withheldFields];
  const meanConsidered = considered.length > 0 ? considered.reduce((s, f) => s + f.confidence, 0) / considered.length : 0;
  let overallConfidence = Math.round(0.4 * typeConfidence + 0.6 * meanConsidered);
  if (surfaced.length === 0) overallConfidence = Math.min(overallConfidence, 40);
  overallConfidence = Math.max(0, Math.min(100, overallConfidence));

  // Fail-closed routing: type-uncertain OR zero surfaced OR sub-floor overall OR a missing critical field all
  // force human review (#10, #37).
  const lowConfidence =
    overallConfidence < OCR_CONFIDENCE_FLOOR || typeConfidence < OCR_CONFIDENCE_FLOOR || surfaced.length === 0 || criticalMissing.length > 0;
  if (lowConfidence && !warnings.includes('document_type_uncertain') && !warnings.includes('no_fields_extracted')) {
    warnings.push('low_confidence_extraction');
  }

  return { docType: type, typeConfidence, overallConfidence, lowConfidence, fields, warnings };
}
