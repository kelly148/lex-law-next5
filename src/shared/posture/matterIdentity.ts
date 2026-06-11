/**
 * CHAT-UI-1 W3 — matter-identity ingestion confirm (context integrity).
 *
 * "matter identity" is one of the 8 hard-stop acts (brief §0). When ingested context/documents
 * RESOLVE a matter identity that is set for the first time, changes, or is ambiguous, the human must
 * confirm "this is the right matter" BEFORE it binds — the system never silently infers and binds. An
 * unambiguous re-ingestion of the SAME matter identity must NOT over-prompt.
 *
 * This module is the pure trigger; it composes with whatever resolver produced the MatterResolution.
 * The confirm itself routes through the shared ConsequenceConfirm (act = 'matter_identity') and is
 * recorded via the W2 provenance ledger with a {type:'matter'} subject.
 */

export interface MatterIdentity {
  matterId: string;
  label?: string;
}

export interface MatterResolution {
  /** The resolved matter id, or null when ingestion could not resolve one. */
  matterId: string | null;
  /** The candidate matter ids considered (for surfacing an ambiguous choice). */
  candidates: string[];
  /** true when resolution is not a confident, unique match (multiple candidates, low confidence, …). */
  ambiguous: boolean;
  label?: string;
}

/**
 * Must the resolved matter identity be confirmed before it binds?
 *  - ambiguous OR unresolved (matterId null) -> ALWAYS confirm (the human must pick / verify).
 *  - no prior identity (first bind) -> confirm (set).
 *  - resolved differs from the prior bound identity -> confirm (change).
 *  - unambiguous AND the same identity as before -> NO confirm (no over-prompt on re-ingestion).
 */
export function matterIdentityRequiresConfirm(
  prior: MatterIdentity | null,
  resolved: MatterResolution,
): boolean {
  if (resolved.ambiguous || resolved.matterId === null) return true;
  if (prior === null) return true;
  return resolved.matterId !== prior.matterId;
}
