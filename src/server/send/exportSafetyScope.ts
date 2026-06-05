/**
 * Export-safety scope guard — FOLD-SEND-1 (Increment 1). PURE.
 *
 * Per the triad disposition (docs/reviews/FOLD-SEND-1_disposition.md, decision 7) and the CLAUDE.md
 * scope fence: the export-safety gate — and especially jurisdiction-specific execution formalities
 * (jurisdiction_rule / missing_required_signer) — must apply ONLY to in-scope transactional
 * document-assembly. It must NOT pull in settlement / title (or litigation / M&A) execution
 * formalities. This guard is the single chokepoint that decides whether a document type is in scope;
 * jurisdiction_rule seeds and the Inc-2 engine both respect it.
 *
 * Conservative + explicit: out-of-scope is a denylist of settlement/title-class markers (case- and
 * separator-insensitive). When in doubt the guard returns true (in scope) for ordinary transactional
 * documents, but any document type matching an out-of-scope marker is excluded.
 */

// Markers (substring, normalized) that indicate a settlement/title-class document — OUT of scope.
const OUT_OF_SCOPE_MARKERS: readonly string[] = [
  'settlement',
  'title',
  'deed',
  'closing_disclosure',
  'closingdisclosure',
  'hud1',
  'hud_1',
  'alta',
  'escrow',
];

/** Normalize a document type for matching: lowercase, strip separators. */
function normalizeType(documentType: string): string {
  return documentType.toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * True when the document type is in scope for the export-safety gate. Settlement/title-class types
 * are excluded so their execution formalities can never be pulled into this gate.
 */
export function isExportSafetyInScope(documentType: string): boolean {
  const normalized = normalizeType(documentType);
  return !OUT_OF_SCOPE_MARKERS.some((marker) => normalized.includes(normalizeType(marker)));
}
