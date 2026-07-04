/**
 * d3Observe.ts — D3-SIGNOFF (source-anchored deed sign-off), A.1 Inc 3: the OBSERVE-mode orchestration.
 *
 * OBSERVE (NC-D3-7) computes the comparator result at deed export and LOGS a would-block to measure the
 * false-fail rate — it NEVER enforces (no 409) and writes NO attorney sign-off record (there is no attorney
 * attestation in OBSERVE; the record + enforcement are the UI increment + the operator ENFORCE flip).
 *
 * PURE. NC-1: emits statuses + value HASHES + value-free notes only — never operative text.
 *
 * SCOPE (honest): OBSERVE compares the reliably-extractable, highest-value fields — LEGAL DESCRIPTION + PARCEL.
 * Party comparison is DEFERRED within OBSERVE (it needs structured draft grantors; extracting them from prose
 * is unreliable). An extraction GAP (no anchor found) is reported as not_applicable + a note — never a false
 * hard-block (a false fail is treated as seriously as a false pass, NC-D3-4).
 */
import { compareD3Signoff, type D3ComparatorInput, type D3ComparisonResult, type D3FieldResult, type D3SourceValue } from './d3Comparator.js';

/** The extracted source-fact shape this module consumes (a subset of DeedSourceFacts). */
export interface D3ObserveSourceFacts {
  legalDescription: { value: string | null; withheld: boolean; flags: readonly string[] };
  parcelId: { value: string | null; withheld: boolean };
  /** Current owners of record = the vesting-deed grantee-of-record (role-mapped to the new grantor; NC-D3-5). */
  currentOwners: { values: readonly string[]; withheld: boolean };
}

export interface D3ObserveInput {
  deedText: string;
  category: string;
  source: D3ObserveSourceFacts;
  parcelExpected: boolean;
}

export interface D3ObserveResult {
  result: D3ComparisonResult;
  legalExtracted: boolean;
  parcelExtracted: boolean;
  /** OBSERVE defers party comparison — always false here (documented). */
  partiesCompared: boolean;
  extractionNotes: string[];
}

/**
 * NC-D3-4-adjacent DETERMINISTIC extraction of the draft's legal description + parcel from the assembled deed
 * TEXT. Anchored on the assembler's known structure ("to wit:" for the legal; "Tax I.D. Number:"/"Tax Map
 * No."/"GPIN" for the parcel). No model, no fuzzy matching. A missing anchor -> null + a note.
 */
export function extractAssembledDeedFields(deedText: string): {
  legalDescription: string | null;
  parcelId: string | null;
  notes: string[];
} {
  const notes: string[] = [];
  const text = deedText ?? '';

  let legalDescription: string | null = null;
  const toWit = /to wit:\s*/i.exec(text);
  if (toWit) {
    const after = text.slice(toWit.index + toWit[0].length);
    // The legal runs until the derivation/BEING recital, a Tax-ID line, a subject-to clause, or a witness block.
    const stop = /(\n\s*\n|BEING the same|BEING all|This conveyance is made subject to|Tax I\.D\.|Tax Map No\.|GPIN|IN WITNESS|WITNESS the following)/i.exec(after);
    const raw = (stop ? after.slice(0, stop.index) : after).trim();
    legalDescription = raw.length > 0 ? raw : null;
  }
  if (legalDescription === null) notes.push('legal_description: no "to wit:" anchor found — not extracted');

  let parcelId: string | null = null;
  const parcel = /(?:Tax I\.D\.\s*(?:Number)?\s*:?|Tax Map No\.?\s*:?|GPIN\s*:?)\s*([A-Za-z0-9][A-Za-z0-9.\-\s]{2,40}?)(?:\n|\.|$)/i.exec(text);
  if (parcel && typeof parcel[1] === 'string' && parcel[1].trim() !== '') {
    parcelId = parcel[1].trim();
  } else {
    notes.push('parcel_id: no Tax I.D./GPIN anchor found — not extracted');
  }

  return { legalDescription, parcelId, notes };
}

const VERBATIM: D3SourceValue['provenanceClass'] = 'extraction_verbatim';

function recomputeTier(fields: readonly D3FieldResult[]): D3ComparisonResult['tier'] {
  if (fields.some((f) => f.status === 'mismatch')) return 'hard_block';
  if (fields.some((f) => f.status === 'absent' || f.status === 'withheld')) return 'overridable_block';
  return 'pass';
}

/**
 * Compute the OBSERVE comparison for a deed at export. PURE. Extraction gaps are reported as not_applicable +
 * a note (never a false hard-block); party comparison is deferred.
 */
export function observeD3Comparison(input: D3ObserveInput): D3ObserveResult {
  const draft = extractAssembledDeedFields(input.deedText);
  const legalExtracted = draft.legalDescription !== null;
  const parcelExtracted = draft.parcelId !== null;

  // Legal descriptions come from OCR of scanned instruments by default -> ocr_derived (triggers the stronger
  // NC-D3-1 warning); a flag can upgrade it. Parcel comes from (often native) tax records -> extraction_verbatim.
  const legalProvenance: D3SourceValue['provenanceClass'] = input.source.legalDescription.flags.includes('native')
    ? VERBATIM
    : 'ocr_derived';

  const comparatorInput: D3ComparatorInput = {
    category: input.category,
    draft: {
      // When a field wasn't extracted, feed the source value (trivial match) so an extraction GAP does not
      // masquerade as a real divergence; the *Extracted flags + notes carry the truth. Post-filter marks it n/a.
      legalDescription: legalExtracted ? (draft.legalDescription as string) : (input.source.legalDescription.value ?? ''),
      grantors: [...input.source.currentOwners.values], // parties deferred in OBSERVE -> trivial pass, then dropped
      grantees: [],
      parcelId: parcelExtracted ? draft.parcelId : input.source.parcelId.value,
      parcelExpected: input.parcelExpected,
    },
    source: {
      legalDescription: { value: input.source.legalDescription.value, withheld: input.source.legalDescription.withheld, provenanceClass: legalProvenance },
      currentOwners: { values: [...input.source.currentOwners.values], withheld: input.source.currentOwners.withheld, provenanceClass: VERBATIM },
      parcelId: { value: input.source.parcelId.value, withheld: input.source.parcelId.withheld, provenanceClass: VERBATIM },
    },
  };

  const full = compareD3Signoff(comparatorInput);
  const fields = full.fields
    .filter((f) => f.field !== 'grantor') // parties deferred in OBSERVE
    .map((f): D3FieldResult => {
      if (f.field === 'legal_description' && !legalExtracted) return { ...f, status: 'not_applicable' };
      if (f.field === 'parcel_id' && !parcelExtracted && input.parcelExpected) return { ...f, status: 'not_applicable' };
      return f;
    });

  const notes = [...draft.notes, 'parties: comparison deferred in OBSERVE (structured draft grantors required)'];
  return {
    result: { ...full, tier: recomputeTier(fields), fields },
    legalExtracted,
    parcelExtracted,
    partiesCompared: false,
    extractionNotes: notes,
  };
}

/** Build the NC-1-safe telemetry payload for an OBSERVE run (statuses + flags only — no values). */
export function buildD3ObserveTelemetry(
  observe: D3ObserveResult,
  ctx: { documentVersionId: string; gateMode: 'observe' | 'enforce' },
): {
  documentVersionId: string;
  gateMode: 'observe' | 'enforce';
  tier: D3ComparisonResult['tier'];
  wouldBlock: boolean;
  comparatorVersion: string;
  legalStatus: string;
  parcelStatus: string;
  legalExtracted: boolean;
  parcelExtracted: boolean;
  partiesCompared: boolean;
} {
  const status = (field: string): string => observe.result.fields.find((f) => f.field === field)?.status ?? 'not_applicable';
  return {
    documentVersionId: ctx.documentVersionId,
    gateMode: ctx.gateMode,
    tier: observe.result.tier,
    wouldBlock: observe.result.tier !== 'pass',
    comparatorVersion: observe.result.comparatorVersion,
    legalStatus: status('legal_description'),
    parcelStatus: status('parcel_id'),
    legalExtracted: observe.legalExtracted,
    parcelExtracted: observe.parcelExtracted,
    partiesCompared: observe.partiesCompared,
  };
}
