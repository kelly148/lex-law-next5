/**
 * Deterministic recordability gates for DEED-DRAFT-AGENT-1 (§2.1.6).
 *
 * Encodes the FIRE §3.1 disposition's hard, fail-closed §2.1.6 gates as PURE, deterministic, reproducible
 * functions — NO LLM-as-judge anywhere (a recordability lint must be reproducible). See
 * docs/reviews/DEED-DRAFT-AGENT-1_FIRE_disposition.md and docs/deed-agent/DEED_KB_SEED.md §2.1.6.
 *
 *   C1 — two-prong legal-description verification (verbatim from commitment Exhibit A + reconciled to the
 *        prior vesting deed; condo Declaration + Plat instrument numbers must match exactly).
 *   C2 — required-party / authority reconciliation ({grantor set} == {Sch. B-I Req. 4 set}, each grantor
 *        carrying a recorded authority basis).
 *   B6 — annotation-leak floor (deterministic allowlist render + denylist: NOTE:/TODO/[bracketed]/{{ }}/
 *        <!-- -->/residual markdown). Cross-filed to EXPORT-FORMAT-FIX-1 as the single chokepoint.
 *   format lints — county-token spacing, "with full power(s)" not "will", vesting "from" not "form".
 *
 * FAIL-CLOSED is the law of this module: missing inputs, divergence, or any unresolved token BLOCK emission
 * (ok:false). Silence/absence of evidence never passes. These gates decide whether a deed records and insures.
 *
 * STATUS: flag-dark Phase-1 infrastructure. NOT wired to any live agent, export, or client-facing path (the
 * client-facing build is HELD behind the release gate). Standalone gate logic + tests only.
 */

/** Which gate produced the result. */
export type GateId = 'C1' | 'C2' | 'B6' | 'format';

/** A single gate verdict. ok:false BLOCKS emission (fail-closed); `failures` lists every reason. */
export interface GateResult {
  gate: GateId;
  /** true = the gate passes and the draft may proceed; false = fail-closed, block + escalate to human. */
  ok: boolean;
  failures: string[];
}

// ── normalization helpers ─────────────────────────────────────────────────────

/** Collapse all whitespace runs to a single space and trim. Used for "verbatim" comparison so trivial
 *  reflow (line wrapping) does not mask a match — but every other character difference still fails. */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Whitespace-normalized AND case-folded — used for cross-document RECONCILIATION (the same parcel may be
 *  cased differently between the commitment and the prior deed); substantive divergence still fails. */
function normalizeReconcile(s: string): string {
  return normalizeWs(s).toLowerCase();
}

/** Normalize a party name for set comparison (whitespace, case, trailing punctuation). */
function normalizeName(s: string): string {
  return normalizeWs(s).toLowerCase().replace(/[.,]+$/, '');
}

// ── C1 — two-prong legal-description verification ─────────────────────────────

export interface LegalDescriptionInput {
  /** The legal description as it appears on the assembled draft deed. */
  draftLegal: string;
  /** The legal description from the title commitment Exhibit A (the controlling source). */
  commitmentExhibitA: string;
  /** The legal description from the prior vesting deed (the reconciliation source). */
  priorDeedLegal: string;
  /** Set true for a condominium conveyance — forces the Declaration + Plat instrument exact-match, and
   *  fail-closes if the instrument data is absent. Also auto-detected when the legal says "condominium",
   *  so a condo deed can never slip past the instrument check by omitting `condo`. */
  isCondo?: boolean;
  /** Condo only: the Declaration + Plat instrument numbers on the draft vs. the source. */
  condo?: {
    draftDeclarationInstrument: string;
    draftPlatInstrument: string;
    sourceDeclarationInstrument: string;
    sourcePlatInstrument: string;
  };
}

/**
 * C1: the legal description must be (a) verbatim from commitment Exhibit A AND (b) reconciled to the prior
 * vesting deed. Any divergence forces human resolution before emission (fail-closed). Condos: the
 * Declaration + Plat instrument numbers must match exactly.
 */
export function checkLegalDescription(input: LegalDescriptionInput): GateResult {
  const failures: string[] = [];

  // Fail-closed on missing inputs — a gate cannot certify what it was not given.
  if (!input.draftLegal || !normalizeWs(input.draftLegal)) {
    failures.push('draft legal description is missing');
  }
  if (!input.commitmentExhibitA || !normalizeWs(input.commitmentExhibitA)) {
    failures.push('commitment Exhibit A legal description is missing — cannot verify verbatim source');
  }
  if (!input.priorDeedLegal || !normalizeWs(input.priorDeedLegal)) {
    failures.push('prior vesting deed legal description is missing — cannot reconcile');
  }

  if (failures.length === 0) {
    // Prong (a) — verbatim from the commitment (the controlling source). Case-sensitive; only reflow tolerated.
    if (normalizeWs(input.draftLegal) !== normalizeWs(input.commitmentExhibitA)) {
      failures.push('prong (a): draft legal description is NOT verbatim from commitment Exhibit A');
    }
    // Prong (b) — reconcile the commitment to the prior vesting deed; any divergence → human resolution.
    if (normalizeReconcile(input.commitmentExhibitA) !== normalizeReconcile(input.priorDeedLegal)) {
      failures.push('prong (b): commitment Exhibit A does not reconcile to the prior vesting deed — human resolution required');
    }
  }

  // Condo: Declaration + Plat instrument numbers must match EXACTLY (corpus showed a botched plat cite).
  // Fail-CLOSED: a condo conveyance (flagged OR auto-detected from "condominium" in the legal) MUST carry the
  // instrument quartet — omitting `condo` no longer slips the check (the prior fail-open bug).
  const looksCondo = /\bcondominium\b/i.test(`${input.draftLegal ?? ''} ${input.commitmentExhibitA ?? ''}`);
  if (input.isCondo || looksCondo || input.condo) {
    const c = input.condo;
    if (!c) {
      failures.push('condo conveyance but Declaration + Plat instrument data was not provided — fail-closed');
    } else {
      const exact = (a: string, b: string): boolean => a.trim() !== '' && a.trim() === b.trim();
      if (!exact(c.draftDeclarationInstrument, c.sourceDeclarationInstrument)) {
        failures.push('condo: Declaration instrument number does not match exactly');
      }
      if (!exact(c.draftPlatInstrument, c.sourcePlatInstrument)) {
        failures.push('condo: Plat instrument number does not match exactly');
      }
    }
  }

  return { gate: 'C1', ok: failures.length === 0, failures };
}

// ── C2 — required-party / authority reconciliation ────────────────────────────

export interface RequiredPartyInput {
  /** The grantor set on the assembled draft. */
  draftGrantors: string[];
  /** The required-party set from commitment Schedule B-I, Requirement 4 ("Deed from ___"). */
  requiredParties: string[];
  /** A recorded authority basis per grantor (prior deed, Certificate of Qualification, etc.); null/'' = none. */
  authorityByGrantor: Record<string, string | null>;
}

/**
 * C2: assert {grantor set on the draft} == {required-party set from Sch. B-I Req. 4}, and that every grantor
 * carries a recorded authority basis, before emission. A missing required grantor = a void/unrecordable deed
 * or a chain gap (fail-closed).
 */
/** Count occurrences of each normalized name (a MULTISET — so two co-grantors who share an identical record
 *  name are not silently collapsed to one, which would hide a missing required party). */
function countByNorm(names: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of names) {
    const k = normalizeName(n);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function checkRequiredParties(input: RequiredPartyInput): GateResult {
  const failures: string[] = [];

  const draftRaw = input.draftGrantors.map((s) => (s ?? '').trim()).filter(Boolean);
  const reqRaw = input.requiredParties.map((s) => (s ?? '').trim()).filter(Boolean);

  if (draftRaw.length === 0) failures.push('draft grantor set is empty');
  if (reqRaw.length === 0) failures.push('required-party set (Sch. B-I Req. 4) is empty — cannot reconcile');

  // Cardinality-collapse guard: if normalization maps two DISTINCT raw names to the same key, a genuine
  // missing/extra party could hide behind the alias — fail closed for manual disambiguation.
  if (new Set(draftRaw.map(normalizeName)).size < new Set(draftRaw).size) {
    failures.push('two distinct draft grantors normalize to the same name — manual disambiguation required');
  }
  if (new Set(reqRaw.map(normalizeName)).size < new Set(reqRaw).size) {
    failures.push('two distinct required grantors normalize to the same name — manual disambiguation required');
  }

  // Multiset equality (counts, not sets) — two same-named co-grantors must BOTH be present on the draft.
  const draftCounts = countByNorm(draftRaw);
  const reqCounts = countByNorm(reqRaw);
  for (const [k, c] of reqCounts) {
    if ((draftCounts.get(k) ?? 0) !== c) failures.push(`required grantor not fully present on the draft: "${k}"`);
  }
  for (const [k, c] of draftCounts) {
    if ((reqCounts.get(k) ?? 0) !== c) failures.push(`draft grantor not in the required-party set: "${k}"`);
  }

  // Every draft grantor must carry a recorded authority basis that is RESOLVED — a non-empty string is not
  // enough: an unresolved "TODO: obtain Certificate of Qualification" is not a recorded authority.
  const authByNorm = new Map<string, string | null>();
  for (const [k, v] of Object.entries(input.authorityByGrantor)) authByNorm.set(normalizeName(k), v);
  for (const k of draftCounts.keys()) {
    const basis = (authByNorm.get(k) ?? '').trim();
    if (basis === '') {
      failures.push(`grantor "${k}" lacks a recorded authority basis`);
    } else if (!checkAnnotationLeak(basis).ok || /\b(TBD|TODO|FIXME|pending|unknown|forthcoming|to be (obtained|provided|confirmed))\b/i.test(basis)) {
      failures.push(`grantor "${k}" authority basis is an unresolved placeholder, not a recorded basis`);
    }
  }

  return { gate: 'C2', ok: failures.length === 0, failures };
}

// ── B6 — annotation-leak floor (deterministic; no LLM-as-judge) ───────────────

/** Denylist patterns: any match in a to-be-recorded deed is an unresolved annotation → fail-closed. */
// Stray characters that never appear in legitimate, fully-resolved recordable deed prose — any occurrence is
// an unresolved placeholder/markup token (the disposition's floor: [bracketed], {{ }}, <!-- -->, pipes,
// asterisks — generalized so a STRAY bracket/brace/angle, single-brace {price}, or <GRANTEE> also fails).
// Deliberately NOT underscores ("__________" signature lines are legitimate) and NOT forward slashes
// ("5/2/2014" dates). Hardened after adversarial review found these false-pass gaps.
const B6_STRAY_CHARS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'square-bracket placeholder [ ] (incl. [[ ]] leads)', re: /[[\]]/ },
  { label: 'brace placeholder { } / {{ }}', re: /[{}]/ },
  { label: 'angle placeholder / HTML comment < >', re: /[<>]/ },
  { label: 'residual markdown (asterisk)', re: /\*/ },
  { label: 'residual markdown (pipe)', re: /\|/ },
];

// Annotation / gap-marker WORDS — never legitimate on a resolved deed face. Case-INSENSITIVE: the realistic
// leak is "Note:"/"note:"/"Todo:", not ALL-CAPS (the corpus 36-2026-6684 NOTE: leak). A deed face never
// legitimately contains TODO/FIXME/INSERT/etc., so case-insensitive matching has ~zero false-positive cost.
const B6_MARKERS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'NOTE: annotation', re: /\bNOTE\s*:/i },
  { label: 'TODO marker', re: /\bTODO\b/i },
  { label: 'gap/placeholder marker (FIXME/TBD/XXX/INSERT/FILL IN/PLACEHOLDER)', re: /\b(FIXME|TBD|PLACEHOLDER|INSERT|FILL[\s-]?IN|X{3,})\b/i },
  { label: 'question-mark placeholder (???)', re: /\?{2,}/ },
];

/**
 * B6: the recordability annotation-leak floor. A to-be-recorded deed must contain ONLY resolved deed text —
 * any stray placeholder/markup char or annotation marker fails closed. Reproducible; no model in the loop.
 * (The allowlist render gate — only known-good deed sections render — is enforced at assembly; this is the
 * deterministic floor, cross-filed to EXPORT-FORMAT-FIX-1 as the single chokepoint for every category.)
 */
export function checkAnnotationLeak(renderedDeedText: string): GateResult {
  const failures: string[] = [];
  const text = renderedDeedText ?? '';
  for (const { label, re } of [...B6_STRAY_CHARS, ...B6_MARKERS]) {
    if (re.test(text)) failures.push(`annotation/markdown leak — ${label}`);
  }
  return { gate: 'B6', ok: failures.length === 0, failures };
}

// ── format / typo lints ───────────────────────────────────────────────────────

/** Format/typo lints from §2.1.6 — fail-closed (they alter a recorded instrument). */
export function checkFormatLints(renderedDeedText: string): GateResult {
  const failures: string[] = [];
  const text = renderedDeedText ?? '';

  // County-token spacing: "Fairfax County", never "FairfaxCounty".
  const countyJoin = /([A-Za-z])County\b/g;
  let m: RegExpExecArray | null;
  while ((m = countyJoin.exec(text)) !== null) {
    failures.push(`county token missing a space before "County" (…${m[1]}County)`);
  }
  // Authority recital: "with full power(s)", never "will full power(s)".
  if (/\bwill full power/i.test(text)) {
    failures.push('authority recital typo: "will full power(s)" should be "with full power(s)"');
  }
  // Vesting recital: "by virtue of a Deed from …", never "Deed form …".
  if (/\bDeed form\b/i.test(text)) {
    failures.push('vesting recital typo: "Deed form" should be "Deed from"');
  }

  return { gate: 'format', ok: failures.length === 0, failures };
}

// ── aggregate runner ──────────────────────────────────────────────────────────

export interface RecordabilityGateInput {
  legal: LegalDescriptionInput;
  parties: RequiredPartyInput;
  /** The fully assembled, to-be-recorded deed text (for B6 + format lints). */
  renderedDeedText: string;
}

export interface RecordabilityGateReport {
  /** true only when EVERY gate passes — fail-closed: any failure blocks emission. */
  ok: boolean;
  results: GateResult[];
}

/**
 * Run every hard §2.1.6 recordability gate. Emission is permitted ONLY when all gates pass. Any failing gate
 * blocks the draft and escalates to human resolution (fail-closed). This never auto-records or sends.
 */
export function runRecordabilityGates(input: RecordabilityGateInput): RecordabilityGateReport {
  const results: GateResult[] = [
    checkLegalDescription(input.legal),
    checkRequiredParties(input.parties),
    checkAnnotationLeak(input.renderedDeedText),
    checkFormatLints(input.renderedDeedText),
  ];
  return { ok: results.every((r) => r.ok), results };
}
