/**
 * RELAYOUT-1 — pure version-status derivation for the DocumentDetail page-first canvas.
 *
 * The versions table has NO status column (VersionRowSchema = id / versionNumber / content /
 * generatedByJobId / iterationNumber / createdAt). A version's legal status — draft vs
 * accepted-substantive vs final vs superseded, and whether it is the current renderable
 * version — is therefore DERIVED from document-level fields:
 *   - documents.currentVersionId                 — the latest renderable version (rewritten at
 *                                                  every generate/regenerate/render/finalize)
 *   - documents.officialSubstantiveVersionNumber — the accepted-substantive version number (or null)
 *   - documents.officialFinalVersionNumber       — the final/formatted version number (or null)
 * matched against each version's versionNumber (current is matched by id).
 *
 * A single row can satisfy several predicates at once (e.g. accept-unformatted makes one row
 * current AND substantive AND final), so derivation applies a PRECEDENCE:
 *   final > substantive > current(draft) > superseded.
 * The draft-vs-accepted label is load-bearing legal legibility (RELAYOUT spec v1.1, gate G1):
 * the attorney must never mistake a working draft for the operative accepted version.
 */

export type VersionStatusKey = 'final' | 'substantive' | 'draft' | 'superseded';

export interface VersionStatusInfo {
  key: VersionStatusKey;
  /** Human label for the switcher entry + provenance line. */
  label: string;
  /** True when this version is documents.currentVersionId (the latest renderable version). */
  isCurrent: boolean;
}

/** Minimal version shape the derivation needs. */
export interface VersionStatusVersion {
  id: string;
  versionNumber: number;
}

/** Minimal document shape the derivation needs. */
export interface VersionStatusDoc {
  currentVersionId: string | null;
  officialSubstantiveVersionNumber: number | null;
  officialFinalVersionNumber: number | null;
}

const LABELS: Record<VersionStatusKey, string> = {
  final: 'final',
  substantive: 'accepted substantive',
  draft: 'draft',
  superseded: 'superseded',
};

/**
 * Derive a single version's status from the document-level fields, applying the
 * final > substantive > current(draft) > superseded precedence.
 */
export function deriveVersionStatus(
  version: VersionStatusVersion,
  doc: VersionStatusDoc,
): VersionStatusInfo {
  const isCurrent =
    doc.currentVersionId !== null && version.id === doc.currentVersionId;
  const isFinal =
    doc.officialFinalVersionNumber !== null &&
    version.versionNumber === doc.officialFinalVersionNumber;
  const isSubstantive =
    doc.officialSubstantiveVersionNumber !== null &&
    version.versionNumber === doc.officialSubstantiveVersionNumber;

  let key: VersionStatusKey;
  if (isFinal) key = 'final';
  else if (isSubstantive) key = 'substantive';
  else if (isCurrent) key = 'draft'; // current but not yet accepted = the working draft
  else key = 'superseded';

  return { key, label: LABELS[key], isCurrent };
}

/**
 * Compact label for the switcher button / selected line, e.g. "v2 · draft (current)".
 * Always reflects what the canvas is rendering (RELAYOUT spec v1.1 §1.2).
 */
export function formatVersionLabel(
  version: VersionStatusVersion,
  doc: VersionStatusDoc,
): string {
  const s = deriveVersionStatus(version, doc);
  return `v${version.versionNumber} · ${s.label}${s.isCurrent ? ' (current)' : ''}`;
}
