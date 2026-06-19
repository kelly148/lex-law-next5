/**
 * Deed KB availability (FOLD-DEED-1) — the KB seam the deed gate consults. The SOLE place the evaluator's
 * KB-sourced inputs are computed; the evaluator stays pure and this is the only KB-touching point, so the
 * fail-closed behavior is provable.
 *
 * Disposition item 4: the model is NEVER the source of a jurisdiction-specific form or rate. Every datum is
 * read from the VERIFIED, seeded KB — never model memory: state-level content from deedKbVa.ts (the primer),
 * per-locality recordability specs from deedKbLocalitiesVa.ts (the verified locality source).
 *
 * Resolution: STATE-LEVEL — the VA vesting controlled-list validates a matching VA vesting selection.
 * LOCALITY-LEVEL — localityVerified is true only when the selected recording locality is one whose [VERIFIED]
 * items support deed-instrument recordability (the five seeded VA localities); templateCoverage additionally
 * requires a known VA deed sub-type. A non-VA jurisdiction, an unseeded locality, or an unknown sub-type keeps
 * the gate fail-closed. "No locality KB → no recordable."
 */
import type { DeedKbAvailability } from '../../shared/schemas/deedGate.js';
import { isVaVestingValidated, isVaDeedTypeKnown } from './deedKbVa.js';
import { isVaDeedInstrumentRecordableLocality, isVaLocalityERecording, VA_LOCALITIES } from './deedKbLocalitiesVa.js';

/** The five v1 VA localities seeded with verified per-locality recordability specs. */
export const DEED_V1_SEED_LOCALITIES = VA_LOCALITIES.map((l) => l.name);

export interface DeedKbLookup {
  jurisdiction: string | null; // matters.jurisdiction ('VA' | 'MD' | null)
  locality: string | null; // the attorney-selected recording locality (deed gate state)
  deedType: string; // the drafting documentType ('deed')
  deedSubType?: string | null; // the selected deed sub-type (bargain_and_sale / gift / into_trust / …)
  vestingSelection?: string | null; // the deed gate's recorded vesting selection (validated vs the VA list)
}

/**
 * Resolve the KB-sourced availability inputs for a deed from the VERIFIED KB. localityVerified clears only for
 * a verified VA recording locality (cover sheets out of scope; deed-instrument recordability). templateCoverage
 * additionally requires a known VA deed sub-type. Anything unseeded/unknown stays false (fail-closed).
 */
export function resolveDeedKbAvailability(lookup: DeedKbLookup): DeedKbAvailability {
  const isVa = lookup.jurisdiction === 'VA';
  // STATE-LEVEL (from the primer): the vesting controlled-list validates a VA vesting selection.
  const vestingListValidated = isVa && isVaVestingValidated(lookup.vestingSelection ?? null);
  // LOCALITY-LEVEL (from the verified locality source): the selected recording locality has [VERIFIED]
  // deed-instrument recordability. Unseeded locality / non-VA → false.
  const localityVerified = isVa && isVaDeedInstrumentRecordableLocality(lookup.locality);
  // deed-type × jurisdiction × locality template coverage: a known VA deed sub-type + a verified locality.
  const templateCoverage = isVa && localityVerified && isVaDeedTypeKnown(lookup.deedSubType ?? null);
  // Does the recording locality operate an eRecording System? (required for an e-notary / RON execution mode).
  const localityERecording = isVa && isVaLocalityERecording(lookup.locality);
  return { templateCoverage, vestingListValidated, localityVerified, localityERecording };
}
