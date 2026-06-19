/**
 * Deed KB availability (FOLD-DEED-1) — the KB seam the deed gate consults. The SOLE place the evaluator's
 * KB-sourced inputs are computed; the evaluator stays pure and this is the only KB-touching point, so the
 * fail-closed behavior is provable.
 *
 * Disposition item 4: the model is NEVER the source of a jurisdiction-specific form or rate. Every datum is
 * read from the VERIFIED, seeded KB (src/server/deed/deedKbVa.ts — transcribed from the operator-supplied
 * primer) — never model memory.
 *
 * Inc 2 (KB seed) seeds the VA STATE-LEVEL content from the primer, which lets the vesting CONTROLLED-LIST
 * check clear for a VA vesting selection that matches the verified list. The LOCALITY-LEVEL content (per-
 * locality recordability/e-recording specs + RON/e-notary acknowledgment forms) is NOT in the primer, so
 * localityVerified is ALWAYS false and the deed-type × jurisdiction × LOCALITY template coverage cannot be
 * satisfied — every deed stays fail-closed at "recordable" until a verified LOCALITY source is supplied.
 * "No locality KB → no recordable status."
 */
import type { DeedKbAvailability } from '../../shared/schemas/deedGate.js';
import { isVaVestingValidated, isVaLocalityVerified, VA_SEED_LOCALITIES } from './deedKbVa.js';

/** The v1 VA localities the locality-seed increment will populate (none verified yet — the primer is state-level). */
export const DEED_V1_SEED_LOCALITIES = VA_SEED_LOCALITIES.map((l) => l.name);

export interface DeedKbLookup {
  jurisdiction: string | null; // matters.jurisdiction ('VA' | 'MD' | null)
  locality: string | null; // the selected recording locality (no per-locality KB is seeded yet)
  deedType: string; // the drafting documentType ('deed')
  vestingSelection?: string | null; // the deed gate's recorded vesting selection (validated vs the VA list)
}

/**
 * Resolve the KB-sourced availability inputs for a deed from the VERIFIED KB. STATE-LEVEL (seeded): the VA
 * vesting controlled-list validates a matching VA vesting selection. LOCALITY-LEVEL (NOT seeded — absent from
 * the primer): templateCoverage + localityVerified are always false (fail-closed). Maryland is unseeded too.
 */
export function resolveDeedKbAvailability(lookup: DeedKbLookup): DeedKbAvailability {
  const isVa = lookup.jurisdiction === 'VA';
  // STATE-LEVEL (from the primer): the vesting controlled-list validates a VA vesting selection.
  const vestingListValidated = isVa && isVaVestingValidated(lookup.vestingSelection ?? null);
  // LOCALITY-LEVEL: no per-locality recordability/e-recording spec is seeded for ANY of the five v1
  // localities (the primer is state-level), so localityVerified is always false and the locality-bearing
  // template coverage cannot be satisfied. Both stay false until a verified LOCALITY source is supplied.
  const localityVerified = isVaLocalityVerified(lookup.locality); // always false in the current seed
  return { templateCoverage: false, vestingListValidated, localityVerified };
}
