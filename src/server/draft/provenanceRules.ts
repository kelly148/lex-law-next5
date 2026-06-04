/**
 * Provision-provenance integrity rules — FOLD-DRAFT-1 (Increment 2).
 *
 * PURE. Enforces the originType <-> originId invariant at record time: origin types that REFERENCE
 * a concrete source (operative_source, material, adopted_suggestion, template, loi) must carry an
 * originId; the self-authored types (attorney_authored, model_generated) must NOT (they have no
 * source to point at). Keeps the provenance record meaningful rather than free-form.
 */

import type { ProvisionOriginType } from '../../shared/schemas/provisionProvenance.js';

/** Origin types that reference a concrete source and therefore require an originId. */
const ORIGIN_TYPES_REQUIRING_ID: ReadonlySet<ProvisionOriginType> = new Set([
  'operative_source',
  'material',
  'adopted_suggestion',
  'template',
  'loi',
]);

export function originRequiresId(originType: ProvisionOriginType): boolean {
  return ORIGIN_TYPES_REQUIRING_ID.has(originType);
}

export interface ProvenanceOriginValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Validate the originType/originId pairing. A blank/whitespace originId is treated as absent.
 */
export function validateProvenanceOrigin(
  originType: ProvisionOriginType,
  originId: string | null,
): ProvenanceOriginValidation {
  const hasId = originId !== null && originId.trim() !== '';
  const needsId = originRequiresId(originType);
  if (needsId && !hasId) {
    return { ok: false, reason: `originType '${originType}' requires an originId (it references a concrete source)` };
  }
  if (!needsId && hasId) {
    return { ok: false, reason: `originType '${originType}' must not carry an originId (it has no concrete source)` };
  }
  return { ok: true };
}
