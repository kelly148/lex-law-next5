/**
 * documentTypeParsers.ts — FOLD-PM-2: deterministic, no-egress document-type parsers.
 *
 * PURE + fully unit-testable. Consumes a material's ALREADY-EXTRACTED text (from
 * extractPdfText / mammoth / OCR — the existing intake pipeline) and produces a
 * structured DocumentExtractionResult: the classified document type + per-field
 * values + confidence. NO network, NO provider, NO new dependency. Attorney-facing
 * only (the practice-management spine) — never an egress contract.
 *
 * Confidence model reuses the OCR floor (intake/ocrExtract.OCR_CONFIDENCE_FLOOR): a
 * field detected by a labeled match is surfaced (high confidence); a field detected
 * only by a weak heuristic falls BELOW the floor and has its VALUE withheld (null,
 * withheld=true) while the field + confidence stay visible — the same honesty posture
 * as classifyOcr nulling sub-floor OCR text. The attorney always sees what was sought.
 */

import { OCR_CONFIDENCE_FLOOR } from './ocrExtract.js';
import {
  DOCUMENT_TYPE_VALUES,
  type DocumentType,
  type ExtractedField,
  type DocumentExtractionResult,
} from '../../shared/schemas/documentExtraction.js';

// Confidence tiers (0–100). Labeled matches are trustworthy; heuristic matches fall
// below OCR_CONFIDENCE_FLOOR (60) and are therefore withheld at the data layer.
const CONF_LABELED = 88;
const CONF_HEURISTIC = 55; // intentionally below OCR_CONFIDENCE_FLOOR -> value withheld

// ── Classification ──────────────────────────────────────────────────────────
interface TypeSignal {
  type: Exclude<DocumentType, 'unknown'>;
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
    ],
  },
  {
    type: 'deed',
    patterns: [
      /\b(warranty|quitclaim|quit-claim|grant|bargain\s+and\s+sale|special\s+warranty)\s+deed\b/i,
      /\bthis\s+(deed|indenture)\b/i,
      /\bgrantor\b[\s\S]{0,400}\bgrantee\b/i,
      /\bdoes\s+hereby\s+(grant|convey|bargain)\b/i,
    ],
  },
  {
    type: 'survey',
    patterns: [
      /\b(plat\s+of\s+survey|boundary\s+survey|ALTA\/NSPS\s+land\s+title\s+survey)\b/i,
      /\b(surveyor'?s?\s+(certificate|certification)|professional\s+land\s+surveyor|registered\s+surveyor)\b/i,
      /\b(point\s+of\s+beginning|thence\s+(north|south|east|west|N\.?|S\.?)|bearing[s]?\b)/i,
      /\b(found\s+iron\s+(pin|rod)|set\s+iron\s+(pin|rod)|monument)\b/i,
    ],
  },
  {
    type: 'settlement_statement',
    patterns: [
      /\b(settlement\s+statement|closing\s+disclosure|HUD-?1|ALTA\s+settlement\s+statement)\b/i,
      /\bcash\s+to\s+close\b/i,
      /\b(disbursement\s+date|settlement\s+date|closing\s+date)\b/i,
      /\b(total\s+(settlement|closing)\s+charges|borrower'?s?\s+transaction|seller'?s?\s+transaction)\b/i,
    ],
  },
];

/** PURE: classify the document type by labeled-signal scoring. */
export function classifyDocumentType(text: string): { type: DocumentType; confidence: number } {
  const t = text ?? '';
  if (t.trim().length === 0) return { type: 'unknown', confidence: 0 };
  const scores = TYPE_SIGNALS.map((sig) => {
    const hits = sig.patterns.reduce((n, re) => (re.test(t) ? n + 1 : n), 0);
    return { type: sig.type as DocumentType, hits, total: sig.patterns.length };
  }).sort((a, b) => b.hits - a.hits);
  const best = scores[0]!;
  if (best.hits === 0) return { type: 'unknown', confidence: 0 };
  // Confidence scales with the share of this type's signals present (a single clean hit lands ~55-58,
  // below the 60 floor so it reads as "uncertain"; up to ~95), reduced when a runner-up also scored.
  const share = best.hits / best.total;
  const runnerUp = scores[1]?.hits ?? 0;
  let confidence = Math.round(45 + share * 50);
  if (runnerUp >= best.hits) confidence = Math.round(confidence * 0.7); // ambiguous
  else if (runnerUp > 0) confidence = Math.round(confidence * 0.88);
  return { type: best.type, confidence: Math.max(0, Math.min(100, confidence)) };
}

// ── Field extraction ──────────────────────────────────────────────────────────
interface FieldSpec {
  key: string;
  label: string;
  strict: RegExp[]; // labeled matches (capture group 1 = value) -> CONF_LABELED
  loose?: RegExp[]; // heuristic matches -> CONF_HEURISTIC (below floor -> withheld)
}

function clean(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:]+$/, '')
    .trim()
    .slice(0, 200);
}

function extractField(text: string, spec: FieldSpec): ExtractedField {
  for (const re of spec.strict) {
    const m = re.exec(text);
    if (m && m[1] && clean(m[1]).length > 0) {
      return { key: spec.key, label: spec.label, value: clean(m[1]), confidence: CONF_LABELED, withheld: false };
    }
  }
  for (const re of spec.loose ?? []) {
    const m = re.exec(text);
    if (m && m[1] && clean(m[1]).length > 0) {
      // Heuristic-only match: below the honesty floor -> withhold the value (mirrors classifyOcr).
      return { key: spec.key, label: spec.label, value: null, confidence: CONF_HEURISTIC, withheld: true };
    }
  }
  return { key: spec.key, label: spec.label, value: null, confidence: 0, withheld: false };
}

const MONEY = String.raw`\$?\s?[\d,]+(?:\.\d{2})?`;
const DATE = String.raw`[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}`;

const FIELD_SPECS: Record<Exclude<DocumentType, 'unknown'>, FieldSpec[]> = {
  title_commitment: [
    { key: 'commitmentNumber', label: 'Commitment number', strict: [/\bcommitment\s+(?:no\.?|number)\s*[:#]?\s*([A-Za-z0-9-]{3,})/i] },
    { key: 'effectiveDate', label: 'Effective date', strict: [new RegExp(String.raw`\beffective\s+date\s*[:#]?\s*(${DATE})`, 'i')] },
    { key: 'proposedInsured', label: 'Proposed insured', strict: [/\bproposed\s+insured\s*[:#]?\s*([^\n]{2,120})/i] },
    { key: 'policyAmount', label: 'Policy amount', strict: [new RegExp(String.raw`\b(?:policy\s+amount|amount\s+of\s+insurance)\s*[:#]?\s*(${MONEY})`, 'i')] },
    { key: 'legalDescription', label: 'Legal description', strict: [/\blegal\s+description\s*[:#]?\s*([^\n]{4,200})/i], loose: [/\b((?:Lot\s+\d+[\s\S]{0,40}Block\s+\d+)[^\n]{0,160})/i] },
  ],
  deed: [
    { key: 'grantor', label: 'Grantor', strict: [/\bgrantor\s*\(?s?\)?\s*[:#]?\s*([^\n]{2,120})/i] },
    { key: 'grantee', label: 'Grantee', strict: [/\bgrantee\s*\(?s?\)?\s*[:#]?\s*([^\n]{2,120})/i] },
    { key: 'consideration', label: 'Consideration', strict: [new RegExp(String.raw`\b(?:consideration|sum\s+of)\s*[:#]?\s*(${MONEY}|[A-Za-z][^\n]{2,80}?dollars)`, 'i')] },
    { key: 'recordingReference', label: 'Recording reference', strict: [/\b(book\s+\d+[,\s]+page\s+\d+)/i, /\binstrument\s+(?:no\.?|number|#)\s*[:#]?\s*([A-Za-z0-9-]{3,})/i, /\b(liber\s+\d+[,\s]+folio\s+\d+)/i] },
    { key: 'parcelId', label: 'Parcel / tax ID', strict: [/\b(?:A\.?P\.?N\.?|assessor'?s?\s+parcel|parcel\s+(?:no\.?|number|id|#)|tax\s+(?:map|parcel|id))\s*[:#]?\s*([A-Za-z0-9-]{3,})/i] },
  ],
  survey: [
    { key: 'surveyor', label: 'Surveyor', strict: [/\b(?:surveyor|prepared\s+by|surveyed\s+by)\s*[:#]?\s*([^\n]{2,120})/i] },
    { key: 'surveyDate', label: 'Survey date', strict: [new RegExp(String.raw`\b(?:date\s+of\s+survey|survey\s+date|dated)\s*[:#]?\s*(${DATE})`, 'i')] },
    { key: 'area', label: 'Area / acreage', strict: [/\b([\d,.]+\s*(?:acres?|square\s+feet|sq\.?\s*ft\.?))/i] },
    // Two independent single-group regexes (the recordingReference idiom): a nested group inside only
    // one alternative would leave m[1] undefined for the other, silently dropping the field.
    { key: 'platReference', label: 'Plat / recording reference', strict: [/\b(plat\s+book\s+\d+[,\s]+page\s+\d+)/i, /\brecorded\s+(?:as|in)\s+([^\n]{3,80})/i] },
  ],
  settlement_statement: [
    { key: 'borrower', label: 'Borrower', strict: [/\bborrower\s*\(?s?\)?\s*(?:name)?\s*[:#]?\s*([^\n]{2,120})/i] },
    { key: 'seller', label: 'Seller', strict: [/\bseller\s*\(?s?\)?\s*(?:name)?\s*[:#]?\s*([^\n]{2,120})/i] },
    { key: 'salePrice', label: 'Sale price', strict: [new RegExp(String.raw`\b(?:sale\s+price|contract\s+sales\s+price|purchase\s+price)\s*[:#]?\s*(${MONEY})`, 'i')] },
    { key: 'loanAmount', label: 'Loan amount', strict: [new RegExp(String.raw`\b(?:loan\s+amount|new\s+loan|principal\s+amount)\s*[:#]?\s*(${MONEY})`, 'i')] },
    { key: 'closingDate', label: 'Closing / disbursement date', strict: [new RegExp(String.raw`\b(?:closing\s+date|disbursement\s+date|settlement\s+date)\s*[:#]?\s*(${DATE})`, 'i')] },
    { key: 'cashToClose', label: 'Cash to close', strict: [new RegExp(String.raw`\bcash\s+to\s+close\s*(?:from\s+borrower)?\s*[:#]?\s*(${MONEY})`, 'i')] },
  ],
};

/**
 * PURE: classify + extract structured fields from a document's text. Surfaces
 * per-field confidence and an honesty-floor low-confidence signal. Never throws on
 * empty/unknown input — returns documentType 'unknown' with lowConfidence true.
 */
export function extractStructuredDocument(text: string): DocumentExtractionResult {
  const t = text ?? '';
  const { type, confidence: typeConfidence } = classifyDocumentType(t);
  const warnings: string[] = [];

  if (type === 'unknown') {
    warnings.push('document_type_unrecognized');
    return { documentType: 'unknown', typeConfidence: 0, overallConfidence: 0, lowConfidence: true, fields: [], warnings };
  }

  const fields = FIELD_SPECS[type].map((spec) => extractField(t, spec));
  const surfaced = fields.filter((f) => f.value !== null);
  const withheldCount = fields.filter((f) => f.withheld).length;

  if (typeConfidence < OCR_CONFIDENCE_FLOOR) warnings.push('document_type_uncertain');
  if (surfaced.length === 0) warnings.push('no_fields_extracted');
  if (withheldCount > 0) warnings.push(`fields_withheld_low_confidence:${withheldCount}`);

  const meanSurfaced =
    surfaced.length > 0 ? surfaced.reduce((s, f) => s + f.confidence, 0) / surfaced.length : 0;
  // Weight: 40% classification certainty + 60% mean confidence of surfaced fields.
  let overallConfidence = Math.round(0.4 * typeConfidence + 0.6 * meanSurfaced);
  if (surfaced.length === 0) overallConfidence = Math.min(overallConfidence, 40);
  overallConfidence = Math.max(0, Math.min(100, overallConfidence));

  const lowConfidence = overallConfidence < OCR_CONFIDENCE_FLOOR;
  if (lowConfidence && !warnings.includes('document_type_uncertain')) warnings.push('low_confidence_extraction');

  return { documentType: type, typeConfidence, overallConfidence, lowConfidence, fields, warnings };
}

export { DOCUMENT_TYPE_VALUES };
