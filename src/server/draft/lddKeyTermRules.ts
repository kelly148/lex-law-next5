/**
 * LDD key-term integrity rules — FOLD-DRAFT-1 / LDD (Increment 2).
 *
 * PURE. Enforces the sourceType <-> sourceId invariant at record time (mirrors provenanceRules.ts):
 * source types that REFERENCE a concrete source (loi, operative_source, material) must carry a
 * sourceId; the attorney-specified type must NOT (the attorney typed the expected value directly,
 * there is no source to point at). Keeps each key-term entry meaningful rather than free-form.
 */

import type { LddKeyTermSourceType } from '../../shared/schemas/lddKeyTerm.js';

/** Source types that reference a concrete source and therefore require a sourceId. */
const SOURCE_TYPES_REQUIRING_ID: ReadonlySet<LddKeyTermSourceType> = new Set([
  'loi',
  'operative_source',
  'material',
]);

export function sourceRequiresId(sourceType: LddKeyTermSourceType): boolean {
  return SOURCE_TYPES_REQUIRING_ID.has(sourceType);
}

export interface LddKeyTermSourceValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Validate the sourceType/sourceId pairing. A blank/whitespace sourceId is treated as absent.
 */
export function validateLddKeyTermSource(
  sourceType: LddKeyTermSourceType,
  sourceId: string | null,
): LddKeyTermSourceValidation {
  const hasId = sourceId !== null && sourceId.trim() !== '';
  const needsId = sourceRequiresId(sourceType);
  if (needsId && !hasId) {
    return { ok: false, reason: `sourceType '${sourceType}' requires a sourceId (it references a concrete source)` };
  }
  if (!needsId && hasId) {
    return { ok: false, reason: `sourceType '${sourceType}' must not carry a sourceId (the attorney specified the value directly)` };
  }
  return { ok: true };
}
