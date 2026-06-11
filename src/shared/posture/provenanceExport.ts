/**
 * CHAT-UI-1 W2 — portable provenance export (pure serializer).
 *
 * Serializes a per-matter ledger bundle (the chronological entries + the tamper-evident chain
 * verdict) to a portable, self-describing JSON document the attorney can download/archive. Pure +
 * dependency-free so it is unit-testable and safe in the client bundle; the structural input matches
 * what the chatUi.exportProvenance procedure returns (tRPC carries the precise type to the caller).
 */
export const PROVENANCE_EXPORT_FORMAT = 'lex-posture-provenance/v1';

export interface ProvenanceExportEnvelopeInput {
  matterId: string;
  count: number;
  chain: { valid: boolean; brokenAtSeq: number | null; reason: string | null };
  entries: unknown[];
}

/** Wrap the bundle in a versioned, self-describing envelope and pretty-print it. */
export function serializeProvenanceExport(bundle: ProvenanceExportEnvelopeInput): string {
  return JSON.stringify(
    {
      format: PROVENANCE_EXPORT_FORMAT,
      matterId: bundle.matterId,
      count: bundle.count,
      chainVerified: bundle.chain.valid,
      chain: bundle.chain,
      entries: bundle.entries,
    },
    null,
    2,
  );
}
