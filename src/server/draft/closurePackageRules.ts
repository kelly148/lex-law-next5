/**
 * Closure-package integrity rules — FOLD-DRAFT-1 / package (Increment 2).
 *
 * PURE. Enforces the itemType <-> refId invariant at record time (mirrors provenanceRules.ts /
 * lddKeyTermRules.ts): item types that REFERENCE a concrete artifact (document, material, source)
 * must carry a refId; a free-form checklist item must NOT (it points at nothing). Keeps each
 * package item meaningful rather than free-form.
 */

import type { ClosurePackageItemType } from '../../shared/schemas/closurePackage.js';

/** Item types that reference a concrete artifact and therefore require a refId. */
const ITEM_TYPES_REQUIRING_REF: ReadonlySet<ClosurePackageItemType> = new Set(['document', 'material', 'source']);

export function itemRequiresRef(itemType: ClosurePackageItemType): boolean {
  return ITEM_TYPES_REQUIRING_REF.has(itemType);
}

export interface ClosurePackageRefValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Validate the itemType/refId pairing. A blank/whitespace refId is treated as absent.
 */
export function validateClosurePackageItemRef(
  itemType: ClosurePackageItemType,
  refId: string | null,
): ClosurePackageRefValidation {
  const hasRef = refId !== null && refId.trim() !== '';
  const needsRef = itemRequiresRef(itemType);
  if (needsRef && !hasRef) {
    return { ok: false, reason: `itemType '${itemType}' requires a refId (it references a concrete artifact)` };
  }
  if (!needsRef && hasRef) {
    return { ok: false, reason: `itemType '${itemType}' must not carry a refId (a checklist item has no concrete artifact)` };
  }
  return { ok: true };
}
