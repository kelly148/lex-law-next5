/**
 * deedTypeRegistry.ts — DEED-DRAFT-AGENT-1: the deed-type registry.
 *
 * A flag-dark catalog of the deterministic deed-category assemblers the agent can produce. The Quick-Deed
 * surface (later domino) reads this to enumerate the available deed types for the attorney's type selector, and
 * to dispatch to the right assembler. Each entry carries the category's verified exemption cite (from
 * deedKbVa — never model memory) + the house warranty posture. Registering a category here is additive and
 * flag-dark; nothing is wired to a live path by this module.
 */

export interface DeedTypeRegistryEntry {
  /** Stable registry key. */
  key: string;
  /** Operative deed title / display name. */
  title: string;
  /** Grounding category id (C1–C5, or gift/seller-side). */
  category: string;
  /** The verified recordation-tax exemption cite, or null for a taxable deed. */
  exemptionCitation: string | null;
  /** House warranty posture for the category. */
  warranty: string;
  /** Whether a deterministic assembler is built and registered. */
  status: 'available' | 'planned';
}

/**
 * The registered deed types. Append-only as categories land. Cites are the verified KB cites (deedKbVa /
 * DEED_KB_SEED §3); see docs/deed/DEED_KB_CATEGORY_GROUNDING.md for the per-category grounding.
 */
export const DEED_TYPE_REGISTRY: readonly DeedTypeRegistryEntry[] = [
  { key: 'deed_of_gift', title: 'Deed of Gift', category: 'gift', exemptionCitation: 'Va. Code § 58.1-811(D)', warranty: 'General Warranty (Mason house, B1-overridable)', status: 'available' },
  { key: 'seller_side', title: 'Seller-Side Conveyance', category: 'seller-side', exemptionCitation: null, warranty: 'General Warranty (default) | Special (B1 override)', status: 'available' },
  { key: 'deed_into_llc', title: 'Deed Into an LLC', category: 'C3', exemptionCitation: 'Va. Code § 58.1-811(A)(10)', warranty: 'none (quitclaim)', status: 'available' },
  { key: 'deed_tod', title: 'Transfer on Death Deed', category: 'C5', exemptionCitation: 'Va. Code § 58.1-811(J)', warranty: 'none (death-effective)', status: 'available' },
  { key: 'deed_of_confirmation', title: 'Deed of Confirmation', category: 'C1', exemptionCitation: 'Va. Code § 58.1-810(1)', warranty: 'General Warranty', status: 'available' },
  // Planned (grounded; assembler build in progress under MONSTER-v2):
  { key: 'deed_into_trust', title: 'Deed Into Trust', category: 'C2', exemptionCitation: 'Va. Code § 58.1-811(A)(12)', warranty: 'General Warranty', status: 'planned' },
  { key: 'deed_out_of_llc', title: 'Deed Out of an LLC', category: 'C4', exemptionCitation: 'Va. Code § 58.1-811(A)(11)', warranty: 'Special Warranty', status: 'available' },
];

/** Look up a registered deed type by key. */
export function getDeedType(key: string): DeedTypeRegistryEntry | undefined {
  return DEED_TYPE_REGISTRY.find((d) => d.key === key);
}

/** The deed types with a built assembler (the Quick-Deed selector's available set). */
export function listAvailableDeedTypes(): readonly DeedTypeRegistryEntry[] {
  return DEED_TYPE_REGISTRY.filter((d) => d.status === 'available');
}
