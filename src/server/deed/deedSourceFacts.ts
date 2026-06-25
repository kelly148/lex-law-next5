/**
 * deedSourceFacts.ts — DEED-DRAFT-AGENT-1 Inc 1: consolidate the OCR-B1 deed-ingest extraction across a
 * matter's deed-packet materials into a single, typed, honesty-floor-aware DeedSourceFacts view.
 *
 * PURE + deterministic + NO-EGRESS. Runs the OCR-B1 extractor (deedIngestExtract) over each material's
 * already-extracted text, classifies it, and picks the authoritative source per property fact (the verbatim
 * legal description from the vesting deed; assessed value from the tax record; etc.). Every fact carries
 * provenance (which material + doc type) and the honesty-floor withheld signal — a withheld/low-confidence
 * fact is surfaced as withheld (for attorney paste/confirm), NEVER silently filled.
 *
 * SCOPE BOUNDARY (Inc 1, the FIRE §7 spine): this stage consolidates only the PROPERTY facts that are
 * reliably present in the document TEXT (legal description, parcel/tax id, assessed value, locality, the
 * parties-of-record for reconciliation, and derivation CANDIDATES). It does NOT decide the new gift deed's
 * grantor/grantee identities (those are attorney-provided per the matter — §2.1.2 "not the commitment
 * caption", B4 evidence rule) and it does NOT assert the derivation reference (a deed body does not contain
 * its own recording stamp; the candidates below are leads for the attorney to confirm). The downstream
 * assembler treats withheld/absent facts as [[ ]] placeholders + research leads.
 */

import { extractDeedIngest, type DeedDocType, type DeedIngestField } from './deedIngestExtract.js';

/** One consolidated source fact with honesty-floor provenance. */
export interface DeedSourceFact {
  /** Single consolidated value; null when absent OR withheld (honesty floor). */
  value: string | null;
  /** Multi-valued form (e.g. the party set); [] when absent/withheld. */
  values: string[];
  /** true when the underlying extraction detected the field but WITHHELD it (sub-floor/truncated/ambiguous). */
  withheld: boolean;
  /** Which material this came from, and its classified type (provenance). */
  sourceMaterialId: string | null;
  sourceDocType: DeedDocType | null;
  /** Per-field flags carried from extraction (e.g. 'truncated', 'aka_variants_present'). */
  flags: string[];
}

export interface DeedSourceFacts {
  /** The verbatim legal description (vesting-deed body, else commitment Exhibit A). The C1 source — VERBATIM. */
  legalDescription: DeedSourceFact;
  /** The vesting deed's grantor of record (reconciliation only; NOT auto-used as the new-deed grantor, #19). */
  grantorOfRecord: DeedSourceFact;
  /** The vesting deed's grantee of record = the current owner / donor name of record (reconciliation only). */
  granteeOfRecord: DeedSourceFact;
  /** Parcel / Tax I.D. (GPIN/Map) — copied exactly, never normalized. */
  parcelId: DeedSourceFact;
  /** Current assessed value (tax record). */
  assessedValue: DeedSourceFact;
  /** Property locality (County / independent City). */
  propertyLocality: DeedSourceFact;
  /** Property (situs) STREET address — the grantee-address DEFAULT source (Quick Deed Layer 1). The tax-record
   *  situs; attorney-override-able. Absent for a packet whose tax record carries no labeled situs address. */
  propertyAddress: DeedSourceFact;
  /** Derivation-of-title CANDIDATES (the vesting deed's BEING reference; a commitment chain-of-title reference)
   *  — LEADS for the attorney to confirm the true derivation reference (where the donor's vesting deed is
   *  recorded), never auto-used. */
  derivationCandidates: DeedSourceFact;
  /** Inc 4 — the TITLE-COMMITMENT Exhibit A legal description, surfaced SEPARATELY from the consolidated winner
   *  (`legalDescription`, which prefers the vesting deed). Carried so the Inc-4 issue-spotter can compare the
   *  commitment legal against the vesting-deed legal and surface a mismatch (it never resolves the mismatch).
   *  Absent (the absent fact) when no title commitment is in the packet. */
  commitmentLegalDescription: DeedSourceFact;
  /** Inc 4 — a CONDITIONAL estate/decedent-source signal, derived deterministically: fires when the packet
   *  carries a probate/authority document, OR a vesting deed whose grantor is a decedent's estate (a surfaced
   *  decedent name / fiduciary-capacity clause). For a pure inter-vivos gift this stays dormant (signaled:false).
   *  Surfaces the signal for the issue-spotter to flag diligence; it NEVER decides who may sign for an estate
   *  (that is B2 / the supervising attorney's call). */
  estateSource: {
    /** true when ANY estate/decedent-source signal is present in the packet. */
    signaled: boolean;
    /** The deterministic signal tags that fired (e.g. 'probate_authority_document', 'vesting_grantor_decedent'). */
    signals: string[];
    /** The decedent name surfaced from the packet (probate authority or vesting estate caption), if any. */
    decedentName: string | null;
    /** The fiduciary-capacity clause surfaced from the packet, if any (e.g. "Executor of the Estate of …"). */
    fiduciaryCapacity: string | null;
  };
  /** Per-material classification + routing summary (transparency). */
  materials: { materialId: string; docType: DeedDocType; lowConfidence: boolean; warnings: string[] }[];
  /** Document-level consolidation warnings (e.g. no vesting deed found; legal withheld). */
  warnings: string[];
}

export interface DeedMaterialInput {
  materialId: string;
  /** The material's already-extracted text (matter_materials.textContent). Null/empty -> skipped. */
  textContent: string | null;
}

interface ClassifiedMaterial {
  materialId: string;
  result: ReturnType<typeof extractDeedIngest>;
}

const ABSENT_FACT: DeedSourceFact = {
  value: null, values: [], withheld: false, sourceMaterialId: null, sourceDocType: null, flags: [],
};

/** Build a DeedSourceFact from a chosen material's extracted field, preserving the honesty-floor withheld flag. */
function factFrom(material: ClassifiedMaterial, field: DeedIngestField | undefined): DeedSourceFact {
  if (!field) return { ...ABSENT_FACT };
  return {
    value: field.value,
    values: field.values,
    withheld: field.withheld,
    sourceMaterialId: material.materialId,
    sourceDocType: material.result.docType,
    flags: field.flags,
  };
}

function fieldOf(material: ClassifiedMaterial, key: string): DeedIngestField | undefined {
  return material.result.fields.find((f) => f.key === key);
}

/** First classified material of a given doc type (deterministic: input order). */
function firstOfType(materials: ClassifiedMaterial[], type: DeedDocType): ClassifiedMaterial | undefined {
  return materials.find((m) => m.result.docType === type);
}

/**
 * Pick the FIRST material/field (in the given preference order of doc types) whose field is present and NOT
 * withheld; if every candidate is withheld, return the first WITHHELD one (so the honesty-floor signal is
 * preserved into the consolidated fact). Returns the absent fact if no candidate has the field at all.
 */
function pickFact(
  materials: ClassifiedMaterial[],
  preferences: { type: DeedDocType; key: string }[],
): DeedSourceFact {
  let firstWithheld: DeedSourceFact | null = null;
  for (const pref of preferences) {
    for (const m of materials) {
      if (m.result.docType !== pref.type) continue;
      const field = fieldOf(m, pref.key);
      if (!field) continue;
      const surfaced = field.value !== null || field.values.length > 0;
      if (surfaced && !field.withheld) return factFrom(m, field);
      if (field.withheld && firstWithheld === null) firstWithheld = factFrom(m, field);
    }
  }
  return firstWithheld ?? { ...ABSENT_FACT };
}

/**
 * PURE: consolidate the OCR-B1 extraction across a matter's deed-packet materials into DeedSourceFacts.
 * Deterministic on the input order; never throws on empty/garbled input.
 */
export function consolidateDeedSourceFacts(materials: readonly DeedMaterialInput[]): DeedSourceFacts {
  const classified: ClassifiedMaterial[] = [];
  for (const m of materials) {
    const text = (m.textContent ?? '').trim();
    if (text.length === 0) continue; // honesty floor upstream: withheld/empty text is not classified
    classified.push({ materialId: m.materialId, result: extractDeedIngest(text) });
  }

  const warnings: string[] = [];

  // Legal description (VERBATIM): vesting-deed body first, then commitment Exhibit A.
  const legalDescription = pickFact(classified, [
    { type: 'vesting_deed', key: 'legalDescription' },
    { type: 'title_commitment', key: 'exhibitALegal' },
  ]);

  // Parties of record (reconciliation only).
  const grantorOfRecord = pickFact(classified, [{ type: 'vesting_deed', key: 'grantor' }]);
  const granteeOfRecord = pickFact(classified, [{ type: 'vesting_deed', key: 'grantee' }]);

  // Parcel / Tax I.D.: prefer the tax record, then the vesting-deed caption, then the commitment.
  const parcelId = pickFact(classified, [
    { type: 'tax_record', key: 'parcelId' },
    { type: 'vesting_deed', key: 'taxId' },
    { type: 'title_commitment', key: 'taxId' },
  ]);

  // Assessed value: the tax record.
  const assessedValue = pickFact(classified, [{ type: 'tax_record', key: 'assessedValue' }]);

  // Property locality.
  const propertyLocality = pickFact(classified, [{ type: 'vesting_deed', key: 'propertyLocality' }]);

  // Property (situs) STREET address — the grantee-address default source (Quick Deed Layer 1). The tax record's
  // labeled situs is the clean source; never auto-used as anything but the override-able grantee-address default.
  const propertyAddress = pickFact(classified, [{ type: 'tax_record', key: 'propertyAddress' }]);

  // Derivation CANDIDATES (leads only): the vesting deed's BEING reference, then a commitment chain-of-title ref.
  const derivationCandidates = pickFact(classified, [
    { type: 'vesting_deed', key: 'vestingPriorDeedRef' },
    { type: 'title_commitment', key: 'priorDeedRef' },
  ]);

  // Inc 4 — the title-commitment Exhibit A legal, surfaced SEPARATELY (so a vesting-vs-commitment mismatch can
  // be spotted). Distinct from the consolidated winner above, which prefers the vesting-deed legal.
  const commitmentLegalDescription = pickFact(classified, [{ type: 'title_commitment', key: 'exhibitALegal' }]);

  // Inc 4 — the CONDITIONAL estate/decedent-source signal. Derived deterministically from the packet; it NEVER
  // decides authority — it only surfaces that an estate/decedent source is present so the issue-spotter can flag
  // the timing/creditor/will-contest diligence windows. Dormant (signaled:false) for a pure inter-vivos gift.
  const estateSignals: string[] = [];
  let decedentName: string | null = null;
  let fiduciaryCapacity: string | null = null;
  for (const m of classified) {
    // (a) a probate/authority document in the packet is the strongest estate signal.
    if (m.result.docType === 'probate_authority' && !estateSignals.includes('probate_authority_document')) {
      estateSignals.push('probate_authority_document');
    }
    // (b) a vesting deed whose grantor is a decedent's estate (a surfaced decedent name / fiduciary capacity).
    const dec = fieldOf(m, 'decedentName');
    const cap = fieldOf(m, 'fiduciaryCapacity');
    const decValue = dec && !dec.withheld ? dec.value : null;
    const capValue = cap && !cap.withheld ? cap.value : null;
    if (decValue && decedentName === null) decedentName = decValue;
    if (capValue && fiduciaryCapacity === null) fiduciaryCapacity = capValue;
    if (m.result.docType === 'vesting_deed' && (decValue || capValue) && !estateSignals.includes('vesting_grantor_decedent')) {
      estateSignals.push('vesting_grantor_decedent');
    }
    // a probate doc's own decedent/capacity also seed the surfaced values.
    if (m.result.docType === 'probate_authority') {
      if (decValue && decedentName === null) decedentName = decValue;
      if (capValue && fiduciaryCapacity === null) fiduciaryCapacity = capValue;
    }
  }
  const estateSource = {
    signaled: estateSignals.length > 0,
    signals: estateSignals,
    decedentName,
    fiduciaryCapacity,
  };

  if (!firstOfType(classified, 'vesting_deed')) warnings.push('no_vesting_deed_in_packet');
  if (legalDescription.value === null) {
    warnings.push(legalDescription.withheld ? 'legal_description_withheld' : 'legal_description_absent');
  }

  return {
    legalDescription,
    grantorOfRecord,
    granteeOfRecord,
    parcelId,
    assessedValue,
    propertyLocality,
    propertyAddress,
    derivationCandidates,
    commitmentLegalDescription,
    estateSource,
    materials: classified.map((m) => ({
      materialId: m.materialId,
      docType: m.result.docType,
      lowConfidence: m.result.lowConfidence,
      warnings: m.result.warnings,
    })),
    warnings,
  };
}
