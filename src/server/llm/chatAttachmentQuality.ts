/**
 * CHAT-COPILOT-2 A2 — PURE title-document OCR-quality assessment (G5) + cross-matter / matter-mismatch
 * detection (Q3). No DB, no network, no provider. Deterministic + fully unit-testable.
 *
 * G5 dangerous-middle fields: a legal description or a recording/parcel/instrument identifier in a title
 * document is NEVER authoritative context without an attorney verify affordance + a source-image
 * spot-check. We detect the PRESENCE + TYPE of these fields (labels only — NEVER the field VALUES, which
 * would be NPI) and raise visual_review_required. The honesty floor itself (low-confidence/failed ->
 * textContent NULL) lives in intake/ocrExtract.classifyOcr and is reused unchanged.
 */
import { createHash } from 'node:crypto';
import { OCR_CONFIDENCE_FLOOR } from '../intake/ocrExtract.js';
import type { AttachmentOcrQuality, ChatAttachmentWarning } from '../../shared/schemas/chatCopilot.js';

// Below this many extracted characters on an IMAGE source, the document is treated as graphical
// (a plat/survey/drawing) — extraction is incomplete by nature.
const GRAPHICAL_TEXT_CHAR_FLOOR = 40;

// Dangerous-middle field detectors. Each maps a field TYPE label to a presence pattern. The VALUE is
// never captured or stored — only the type label (e.g. 'parcel_id').
const DANGEROUS_MIDDLE: ReadonlyArray<{ type: string; re: RegExp }> = [
  { type: 'legal_description', re: /\b(BEGINNING\s+AT|POINT\s+OF\s+BEGINNING|thence\b|more\s+or\s+less|metes\s+and\s+bounds|legal\s+description)\b/i },
  { type: 'legal_description', re: /\bLot\s+\d+\b[\s\S]{0,40}\bBlock\s+\d+\b/i },
  { type: 'parcel_id', re: /\b(A\.?\s?P\.?\s?N\.?|Assessor'?s?\s+Parcel|Parcel\s+(No\.?|Number|ID|#)|Tax\s+(Map|Parcel|ID))\b/i },
  { type: 'instrument_number', re: /\b(Instrument|Document)\s+(No\.?|Number|#)\s*\d/i },
  { type: 'book_page', re: /\b(Book\s+\d+[,\s]+Page\s+\d+|Deed\s+Book|Liber\s+\d+|Folio\s+\d+)\b/i },
  { type: 'recording_number', re: /\b(Recording\s+(No\.?|Number|#)|Reception\s+(No\.?|Number|#)|Recorded\s+(in|on|as))\b/i },
];

export interface AssessTitleDocArgs {
  text: string;
  meanConfidence: number | null;
  pageCount?: number | null;
  perPageConfidence?: number[] | null;
  /** True for image / scanned-PDF sources (vs an extractable text layer). */
  isImageSource?: boolean;
  /** Optional OCR-engine signals the pure text pass cannot infer (handwriting/seal regions, skew). */
  engineSignals?: { handwritingOrSeal?: boolean; skewOrRotation?: boolean };
}

/** Assess a (title) document's OCR quality and raise the G5 warnings. PURE. */
export function assessTitleDocumentQuality(args: AssessTitleDocArgs): AttachmentOcrQuality {
  const text = (args.text ?? '').trim();
  const warnings = new Set<ChatAttachmentWarning>();
  const dangerousMiddleFieldTypes: string[] = [];

  // Content-based dangerous-middle detection (precise; type labels only — never the values).
  let hasLegalDescription = false;
  let hasIdentifier = false;
  for (const { type, re } of DANGEROUS_MIDDLE) {
    if (re.test(text)) {
      if (!dangerousMiddleFieldTypes.includes(type)) dangerousMiddleFieldTypes.push(type);
      if (type === 'legal_description') hasLegalDescription = true;
      else hasIdentifier = true;
    }
  }
  if (hasLegalDescription) warnings.add('legal_description');
  if (hasIdentifier) warnings.add('recording_parcel_instrument_identifier');

  // Confidence-based.
  const lowConfidence = args.meanConfidence != null && args.meanConfidence < OCR_CONFIDENCE_FLOOR;
  if (lowConfidence) warnings.add('low_confidence');

  // Graphical-document heuristic: an image source that yielded almost no text is a drawing/plat/survey.
  const graphical = args.isImageSource === true && text.length < GRAPHICAL_TEXT_CHAR_FLOOR;
  if (graphical) warnings.add('graphical_document');

  // OCR-engine signals the text pass cannot infer.
  if (args.engineSignals?.handwritingOrSeal) warnings.add('handwriting_or_seal');
  if (args.engineSignals?.skewOrRotation) warnings.add('skew_or_rotation');

  // Umbrella: any of these means the attorney must visually review the source image before relying on it.
  const visualReviewRequired =
    hasLegalDescription ||
    hasIdentifier ||
    lowConfidence ||
    graphical ||
    args.engineSignals?.handwritingOrSeal === true ||
    args.engineSignals?.skewOrRotation === true;
  if (visualReviewRequired) warnings.add('visual_review_required');

  return {
    meanConfidence: args.meanConfidence ?? null,
    pageCount: args.pageCount ?? null,
    perPageConfidence: args.perPageConfidence ?? null,
    warnings: [...warnings],
    dangerousMiddleFieldTypes,
    visualReviewRequired,
  };
}

// ── Q3 cross-matter / matter-mismatch ─────────────────────────────────────────────────────────────────

/** SHA-256 of the uploaded bytes — drives the cross-matter DUPLICATE check. Not NPI. */
export function computeContentHash(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Normalize a name/parcel token for comparison (lowercase, collapse non-alphanumerics). */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export interface MatterMismatchArgs {
  text: string;
  /** The matter's known party display names. */
  matterPartyNames: readonly string[];
  /** The matter's known parcel ids (optional). */
  matterParcels?: readonly string[];
}

export interface MatterMismatchResult {
  mismatch: boolean;
  reasons: string[];
}

/**
 * SOFT matter-mismatch detection (Q3): does this document's parties/parcel look like THIS matter's? A
 * mismatch is an ADVISORY, logged "confirm before use" — never a hard block (a hard block would misfire
 * on legitimate refis / repeat parties). Heuristic + conservative: flags only when the document clearly
 * carries party/parcel signals AND none overlap the matter's known set.
 */
export function detectMatterMismatch(args: MatterMismatchArgs): MatterMismatchResult {
  const reasons: string[] = [];
  const hay = norm(args.text ?? '');

  // Party check: if the matter has known parties and NONE of them appear in the document, flag (soft).
  const partyNames = (args.matterPartyNames ?? []).filter((n) => n && n.trim().length > 1);
  if (partyNames.length > 0) {
    const anyPartyPresent = partyNames.some((n) => hay.includes(norm(n)));
    if (!anyPartyPresent) reasons.push('no_matter_party_named_in_document');
  }

  // Parcel check: if the document carries parcel ids and the matter has known parcels, require overlap.
  const matterParcels = (args.matterParcels ?? []).map(norm).filter((p) => p.length > 0);
  if (matterParcels.length > 0) {
    const docParcels = extractParcelTokens(args.text ?? '').map(norm);
    if (docParcels.length > 0 && !docParcels.some((p) => matterParcels.includes(p))) {
      reasons.push('document_parcel_not_in_matter');
    }
  }

  return { mismatch: reasons.length > 0, reasons };
}

/** Extract candidate parcel-id tokens from text (for the soft matter-mismatch check). Best-effort. */
function extractParcelTokens(text: string): string[] {
  const out: string[] = [];
  const re = /\b(?:A\.?\s?P\.?\s?N\.?|Parcel\s+(?:No\.?|Number|ID|#)?)\s*[:#]?\s*([0-9][0-9\-.]{4,})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}
