/**
 * Deed KB availability (FOLD-DEED-1, Inc 1 foundation) — the fail-closed KB seam.
 *
 * Disposition item 4: the model is NEVER the source of a jurisdiction-specific form or rate. The deed gate's
 * KB-sourced checks (deed-type × jurisdiction × locality TEMPLATE coverage, the vesting CONTROLLED LIST, and
 * the per-locality recordability/acknowledgment KB) come from a VERIFIED, seeded KB — never model memory.
 *
 * In the Inc-1 foundation NO KB is seeded (the VA primer ingestion is the blocked KB-seed increment), so this
 * resolver returns availability=false for every locality/jurisdiction. The evaluator therefore blocks every
 * deed at "recordable" — "no locality KB → no recordable status" (item 4). When the KB-seed increment lands,
 * this resolver reads the seeded locality/vesting tables (and only the operator-verified rows clear).
 *
 * The five v1 localities (Fairfax County · City of Alexandria · Arlington County · Loudoun County · Prince
 * William County — disposition §5.1) are listed here for forward reference ONLY; none is verified yet.
 */
import type { DeedKbAvailability } from '../../shared/schemas/deedGate.js';

/** The v1 VA localities the KB-seed increment will populate (none verified until then). Forward reference only. */
export const DEED_V1_SEED_LOCALITIES = [
  'Fairfax County',
  'City of Alexandria',
  'Arlington County',
  'Loudoun County',
  'Prince William County',
] as const;

export interface DeedKbLookup {
  jurisdiction: string | null; // matters.jurisdiction ('VA' | 'MD' | null)
  locality: string | null; // the selected recording locality (not yet a matter field in the foundation)
  deedType: string; // the drafting documentType ('deed')
}

/**
 * Resolve the KB-sourced availability inputs for a deed. FOUNDATION: always fail-closed (everything false) —
 * no KB is seeded, so nothing clears. This is the single seam the KB-seed increment replaces; keeping the
 * evaluator pure and this resolver the only KB-touching point means the fail-closed default is provable.
 */
export function resolveDeedKbAvailability(_lookup: DeedKbLookup): DeedKbAvailability {
  // No KB seeded in the foundation → every KB-sourced check is unavailable (fail-closed).
  return { templateCoverage: false, vestingListValidated: false, localityVerified: false };
}
