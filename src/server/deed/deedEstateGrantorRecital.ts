/**
 * deedEstateGrantorRecital.ts — DEED-DRAFT-AGENT-1 module B2: estate-source grantor-recital INPUT CONTRACT.
 *
 * PURE + deterministic + NO-EGRESS — NO LLM, no network, no clock, no random, no fs, no global state. This is NOT
 * a deed category; it is the input-handling contract for the grantor/granting block of a decedent-sourced deed,
 * grounded on docs/deed/DEED_KB_SEED__B2_grantor-recital-input-contract.md (the authoritative spec; the retired
 * inverse-power-of-sale authority-map is superseded per operator ruling 2026-06-23).
 *
 * THE BOUNDARY (spec §1): determining who may sign for an estate is the highest-liability legal judgment in the
 * deed flow and belongs to the supervising attorney, NOT the engine. So B2 never reasons about wills, heirs,
 * powers of sale, or elective shares. Its ONLY job is to take the grantor recital the attorney provides and place
 * it correctly — WITHOUT inventing anything. The engine stays deliberately dumb about authority and refuses to
 * guess (spec §3, the one surviving guardrail, inverted fail-closed).
 *
 * Two input modes (spec §2), per the operator ruling encoded in the spec header:
 *  - Mode A (PRIMARY) — attorney dictates the clause verbatim. Place it BYTE-IDENTICAL into recital.text. NO
 *    rewording, NO normalization, NO auto-correction, NO trimming of interior content, NO "cleanup" (the OCR-B1
 *    exact-match discipline — silent normalization is a DEFECT, not a feature). The only transformation permitted
 *    is a non-content `placement` hint exposed alongside the byte-identical text. Per-deed `dictationScope` says
 *    whether the dictated text is the grantor-recital-only (caller still owns the surrounding words-of-conveyance /
 *    consideration) or the entire granting clause (engine drops the whole block in).
 *  - Mode B (OPTIONAL FALLBACK) — assemble the recital from a deterministic template + the four supplied fields
 *    ONLY (signer / capacity / authority basis / probate reference). Never fill a missing field by inference.
 *    Always advisory-flagged "assembled — attorney must approve recital text before send."
 *
 * GATE B2 (the entire legal-safety content): require a COMPLETE Mode-A clause OR a COMPLETE Mode-B field set. On
 * absence or partial input, WITHHELD — no recital is emitted; the caller must request the clause/fields. There is
 * no code path here that fabricates/derives a signer, capacity, or authority from other inputs; if input is
 * insufficient, it STOPS. Surface-not-decide; never auto-record/send.
 *
 * STATUS: flag-dark Phase-1 infrastructure (release-gate domino #5). NO live caller — wiring B2 into the
 * seller-side estate branch / live ingest is the gated wiring step (domino #7), out of scope here.
 */

// ── Input model ─────────────────────────────────────────────────────────────────────────────────────────

/** Which input mode the attorney chose for this estate-source deed (spec §2). */
export type EstateGrantorMode = 'A' | 'B';

/** Mode A per-deed scope (spec §2 D2): whether the dictated text is the grantor-identification recital only, or
 *  the entire granting clause (grantor + words of conveyance + consideration recital). */
export type EstateDictationScope = 'grantor_recital' | 'full_granting_clause';

/** Mode A — attorney-dictated clause (PRIMARY). The clause is authoritative/final on signer/capacity/authority;
 *  the engine does not second-guess or legally validate it (that is the attorney's call, by design). */
export interface EstateGrantorModeAInput {
  mode: 'A';
  /** The complete dictated text, placed VERBATIM (byte-identical) into recital.text. Never reworded or cleaned. */
  dictatedClause: string;
  /** Per-deed scope (attorney's choice): grantor-recital-only vs. the entire granting clause. */
  dictationScope: EstateDictationScope;
}

/** Mode B structured facts (spec §2 Mode-B table) — the four fields the deterministic template assembles from. */
export interface EstateGrantorModeBFields {
  /** Signer name(s), e.g. "John Q. Smith". */
  signerNames: string;
  /** Fiduciary capacity, e.g. "Executor of the Estate of Jane A. Smith, deceased". */
  capacity: string;
  /** Authority basis as a BARE noun phrase (NO leading "the"/connective), e.g. "power of sale granted in Article
   *  IV of her will" — the template composes it as "under the <authorityBasis>", so the fixed connector hosts it
   *  cleanly. Any phrasing the fixed connector cannot host (e.g. a clause that needs different lead-in wording)
   *  should use Mode A (dictate the full clause verbatim) instead. */
  authorityBasis: string;
  /** Probate reference, e.g. "Circuit Court of Fairfax County, Will Book 412, Page 88". */
  probateReference: string;
}

/** Mode B — structured-facts assembly (OPTIONAL FALLBACK). */
export interface EstateGrantorModeBInput {
  mode: 'B';
  fields: EstateGrantorModeBFields;
}

/** B2 input: a discriminated union on `mode`. An unknown/absent mode is handled fail-closed (UNKNOWN_INPUT_MODE).
 *  Typed loosely on the public boundary so a malformed runtime payload (no/garbage mode) is caught, not crashed. */
export type EstateGrantorRecitalInput =
  | EstateGrantorModeAInput
  | EstateGrantorModeBInput;

// ── Output model ────────────────────────────────────────────────────────────────────────────────────────

/** A non-content placement hint: which deed block the recital text belongs in. NEVER alters recital.text. For a
 *  grantor-recital-only dictation/assembly the caller still owns the surrounding granting language; for a full
 *  granting clause the engine's block IS the whole granting clause. */
export type EstateRecitalPlacement = 'grantor_block' | 'granting_clause';

/** The placed/assembled recital (present ONLY on status: 'OK'). */
export interface EstateGrantorRecital {
  /** Which mode produced it. */
  mode: EstateGrantorMode;
  /** The per-deed scope carried through to the caller (so it knows whether it still owns the surrounding
   *  words-of-conveyance / consideration). For Mode B the assembled recital is always grantor-recital scope. */
  scope: EstateDictationScope;
  /** Mode A: BYTE-IDENTICAL to the supplied dictatedClause. Mode B: the deterministically assembled recital. */
  text: string;
  /** Non-content placement hint (never alters `text`). */
  placement: EstateRecitalPlacement;
}

export interface EstateGrantorRecitalResult {
  status: 'OK' | 'WITHHELD';
  flags: string[];
  advisories: string[];
  recital?: EstateGrantorRecital;
}

// ── Helpers (mirror the sibling assemblers' fail-closed idiom) ──────────────────────────────────────────

/** A field is missing/blank if it is NOT a string (undefined, null, or any non-string value from a loosely-typed
 *  runtime payload), all-whitespace, or carries a "[[ … ]]" placeholder marker (the matter-file "fact not
 *  captured" convention). A placeholder is NEVER rendered as if it were a fact. Treating any non-string as blank
 *  (rather than calling .trim() on it) keeps the module's "never throws / malformed payload caught not crashed"
 *  contract — a numeric/garbage field fails closed to WITHHELD instead of raising a TypeError. Mirrors the isBlank
 *  in deedConfirmationAssembler / the sibling assemblers, hardened for the public input boundary. */
function isBlank(v: unknown): boolean {
  if (typeof v !== 'string') return true;
  const t = v.trim();
  if (t === '') return true;
  if (/\[\[/.test(t)) return true; // unresolved "[[ MISSING … ]]" placeholder
  return false;
}

/** Fail-closed WITHHELD result — no recital is emitted (the GATE-B2 contract). */
function withheld(flags: string[], advisories: string[] = []): EstateGrantorRecitalResult {
  return { status: 'WITHHELD', flags, advisories };
}

/** The two valid per-deed dictation scopes (spec §2 D2). */
const VALID_SCOPES: readonly EstateDictationScope[] = ['grantor_recital', 'full_granting_clause'];

/**
 * The deterministic Mode-B template advisory: a Mode-B recital is engine-assembled from supplied fields and must
 * be attorney-approved before send (spec §2 Mode B — "assembled — attorney must approve recital text before
 * send."). Surface-not-decide.
 */
const MODE_B_ADVISORY = 'assembled — attorney must approve recital text before send.';

// ── The B2 input contract ───────────────────────────────────────────────────────────────────────────────

/**
 * PURE: place (Mode A, verbatim) or assemble (Mode B, from supplied fields only) the estate-source grantor
 * recital. Never throws. Fail-closed (WITHHELD, no recital) on absence/partial input or an unknown mode — the
 * engine never infers a grantor, capacity, or authority.
 */
export function buildEstateGrantorRecital(
  input: EstateGrantorRecitalInput,
): EstateGrantorRecitalResult {
  // Read the discriminant defensively — a malformed runtime payload may carry no/garbage mode.
  const mode = (input as { mode?: unknown } | null | undefined)?.mode;

  if (mode === 'A') {
    return buildModeA(input as EstateGrantorModeAInput);
  }
  if (mode === 'B') {
    return buildModeB(input as EstateGrantorModeBInput);
  }
  // Unknown/absent mode (not 'A' or 'B') → fail closed; never guess a mode.
  return withheld(['UNKNOWN_INPUT_MODE']);
}

// ── Mode A — verbatim placement (PRIMARY) ───────────────────────────────────────────────────────────────

function buildModeA(input: EstateGrantorModeAInput): EstateGrantorRecitalResult {
  const flags: string[] = [];

  // GATE B2: a complete dictated clause is REQUIRED. Blank/missing, or an unresolved "[[ ]]" placeholder, stops.
  if (isBlank(input.dictatedClause)) {
    flags.push('ESTATE_GRANTOR_CLAUSE_REQUIRED');
  }
  // GATE B2: the per-deed dictation scope must be a valid choice; a blank/invalid scope stops.
  const scopeValid =
    typeof input.dictationScope === 'string' &&
    (VALID_SCOPES as readonly string[]).includes(input.dictationScope);
  if (!scopeValid) {
    flags.push('ESTATE_DICTATION_SCOPE_INVALID');
  }

  if (flags.length > 0) return withheld(flags);

  const scope = input.dictationScope;
  // VERBATIM: recital.text is BYTE-IDENTICAL to the supplied clause. The ONLY thing the engine adds is a
  // non-content `placement` hint — it does NOT touch, trim, normalize, or re-case the text.
  const placement: EstateRecitalPlacement =
    scope === 'full_granting_clause' ? 'granting_clause' : 'grantor_block';

  return {
    status: 'OK',
    flags: [],
    advisories: [],
    recital: {
      mode: 'A',
      scope,
      text: input.dictatedClause, // byte-identical — no transformation of content
      placement,
    },
  };
}

// ── Mode B — structured-facts assembly (OPTIONAL FALLBACK) ──────────────────────────────────────────────

function buildModeB(input: EstateGrantorModeBInput): EstateGrantorRecitalResult {
  const f = (input.fields ?? {}) as Partial<EstateGrantorModeBFields>;

  // GATE B2: ALL FOUR required fields must be present and non-placeholder. Never fill a missing field by
  // inference (no field is ever derived from another — e.g. capacity is NOT back-filled from signerNames).
  const missing: string[] = [];
  if (isBlank(f.signerNames)) missing.push('signerNames');
  if (isBlank(f.capacity)) missing.push('capacity');
  if (isBlank(f.authorityBasis)) missing.push('authorityBasis');
  if (isBlank(f.probateReference)) missing.push('probateReference');

  if (missing.length > 0) {
    // Enumerate which fields are missing (in an advisory) — but NEVER invent the missing fact.
    return withheld(
      ['ESTATE_GRANTOR_FIELDS_INCOMPLETE'],
      [`missing required estate grantor field(s): ${missing.join(', ')}`],
    );
  }

  // Deterministic template (spec §2 worked example, "connect-the-dots" order: signer, capacity, authority basis,
  // probate reference). Built from the supplied fields ONLY — kept faithful + minimal. By contract each field
  // value is trimmed of OUTER whitespace ONLY, for clean joining; interior content is preserved exactly.
  const signer = f.signerNames!.trim();
  const capacity = f.capacity!.trim();
  const authority = f.authorityBasis!.trim();
  const probate = f.probateReference!.trim();
  const text = `${signer}, ${capacity}, under the ${authority}, ${probate}.`;

  return {
    status: 'OK',
    flags: [],
    // Mode B is always engine-assembled → attorney must approve before send (spec §2 Mode B).
    advisories: [MODE_B_ADVISORY],
    recital: {
      mode: 'B',
      // An assembled recital is the grantor-identification recital only; the caller still owns the surrounding
      // words-of-conveyance / consideration.
      scope: 'grantor_recital',
      text,
      placement: 'grantor_block',
    },
  };
}
