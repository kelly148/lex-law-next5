/**
 * ocrHonesty.ts — TITLE-EXAM-1 (T2), NC-9 OCR honesty for critical fields.
 *
 * Critical fields (parties, instrument/recording references, dates, testacy status, legal description)
 * asserted from OCR are flagged OCR-derived and carry a source-page pincite so the attorney verifies
 * against the IMAGE, not the extraction. Reuses the intake honesty posture: a value below the OCR
 * confidence floor has its VALUE withheld (the field + confidence stay visible) — the same discipline as
 * intake/documentTypeParsers.extractField and ocrPipeline.classifyOcr.
 *
 * PURE. Flag-dark by construction. Emits the source-basis posture the T1 finding data model records
 * (sourceBasis 'ocr_extracted', ocrDerived, ocrSourcePagePincite, downgraded).
 */

/** Mirrors intake/ocrExtract.OCR_CONFIDENCE_FLOOR (60). Kept local so the title-exam module is
 *  self-contained and testable in isolation; documented as a deliberate mirror to avoid silent drift. */
export const TITLE_EXAM_OCR_CONFIDENCE_FLOOR = 60;

/** NC-9 critical fields — the ones whose OCR provenance an attorney must be able to verify. */
export const TITLE_EXAM_CRITICAL_FIELDS = [
  'parties',
  'instrument_reference',
  'recording_reference',
  'date',
  'testacy_status',
  'legal_description',
] as const;
export type TitleExamCriticalField = (typeof TITLE_EXAM_CRITICAL_FIELDS)[number];

export interface OcrFieldClaim {
  field: TitleExamCriticalField;
  value: string | null;
  /** 0–100 OCR confidence for this field's extraction. */
  confidence: number;
  /** The source page the value was read from (the pincite anchor). Null when unrecorded. */
  sourcePage: number | null;
  /** True when the value was asserted from OCR (vs a typed instrument / court record). */
  ocrDerived: boolean;
}

export type OcrHonestyFlag = 'ok' | 'ocr_flagged' | 'withheld';

export interface HonestOcrField {
  field: TitleExamCriticalField;
  value: string | null;
  confidence: number;
  sourcePage: number | null;
  ocrDerived: boolean;
  /** True when the value was withheld because OCR confidence was below the floor. */
  withheld: boolean;
  /** The source-page pincite for an OCR-derived field (e.g. "OCR p.4"); null for non-OCR fields. */
  pincite: string | null;
  flag: OcrHonestyFlag;
}

function pinciteFor(sourcePage: number | null): string {
  return sourcePage != null && Number.isFinite(sourcePage) && sourcePage > 0
    ? `OCR p.${Math.floor(sourcePage)}`
    : 'OCR (source page unrecorded)';
}

/**
 * Apply the NC-9 honesty posture to one critical-field claim.
 *  - non-OCR field            → 'ok', value kept, no pincite (it is instrument/record-confirmed elsewhere).
 *  - OCR field, confident     → 'ocr_flagged', value kept, source-page pincite attached.
 *  - OCR field, below floor    → 'withheld', value nulled (field + confidence stay visible), pincite attached.
 */
export function applyOcrHonesty(claim: OcrFieldClaim): HonestOcrField {
  const confidence = Number.isFinite(claim.confidence) ? claim.confidence : 0;

  if (!claim.ocrDerived) {
    return {
      field: claim.field,
      value: claim.value,
      confidence,
      sourcePage: claim.sourcePage,
      ocrDerived: false,
      withheld: false,
      pincite: null,
      flag: 'ok',
    };
  }

  const pincite = pinciteFor(claim.sourcePage);
  if (confidence < TITLE_EXAM_OCR_CONFIDENCE_FLOOR) {
    return {
      field: claim.field,
      value: null,
      confidence,
      sourcePage: claim.sourcePage,
      ocrDerived: true,
      withheld: true,
      pincite,
      flag: 'withheld',
    };
  }

  return {
    field: claim.field,
    value: claim.value,
    confidence,
    sourcePage: claim.sourcePage,
    ocrDerived: true,
    withheld: false,
    pincite,
    flag: 'ocr_flagged',
  };
}

export function applyOcrHonestyAll(claims: readonly OcrFieldClaim[]): HonestOcrField[] {
  return claims.map(applyOcrHonesty);
}

/**
 * Map a honest OCR field to the T1 finding source-basis posture. An OCR-derived critical field is
 * sourceBasis 'ocr_extracted' and is DOWNGRADED (NC-8: an OCR-only conclusion is downgraded until the
 * instrument is reviewed) — whether or not its value survived the floor. A non-OCR field is not marked
 * OCR-derived here (its true basis is set by the caller from the instrument/record).
 */
export interface FindingOcrBasis {
  ocrDerived: boolean;
  ocrSourcePagePincite: string | null;
  downgraded: boolean;
}

export function toFindingOcrBasis(honest: HonestOcrField): FindingOcrBasis {
  if (!honest.ocrDerived) {
    return { ocrDerived: false, ocrSourcePagePincite: null, downgraded: false };
  }
  return {
    ocrDerived: true,
    ocrSourcePagePincite: honest.pincite,
    // OCR-only critical fields are downgraded until the instrument is reviewed (NC-8/NC-9).
    downgraded: true,
  };
}
