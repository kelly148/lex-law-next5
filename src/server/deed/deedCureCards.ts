/**
 * deedCureCards — UB1-W3b-2 (S5 Confirmation-survivorship cure cards).
 *
 * Turns the deed assemblers' fail-closed machine-code `flags` (e.g. INCOMPLETE_SURVIVORSHIP_CHAIN) into
 * plain-English CURE CARDS the attorney can act on: WHAT is missing or mismatched, WHICH field to fix, and HOW to
 * fix-and-regenerate in place. This satisfies the #484 ratification condition for the S5 Confirmation-survivorship
 * lane -- every gate/withhold surfaces a cure card, never a silent or opaque-coded withhold -- while NEVER guessing
 * an operative recital: the gates stay fail-closed (no deed is drafted), and a cure card only tells the attorney
 * what to supply, it never fabricates the missing fact.
 *
 * PURE: flag string -> cure card. An UNKNOWN flag degrades to a humanized generic card so a withhold can never
 * surface as a bare machine code. Deterministic; no I/O.
 */

export interface DeedCureCard {
  /** The machine-code flag this card explains (stable identifier; for tests/telemetry). */
  flag: string;
  /** The intake-form field the attorney fixes (plain-English label matching the deed intake form). */
  field: string;
  /** What is missing or mismatched, in plain English. */
  problem: string;
  /** How to fix it and regenerate, in plain English. */
  fix: string;
}

/** Hand-authored cure cards keyed by the assembler flag. Covers the S5 Confirmation-survivorship gate classes
 *  (the #484 named condition) plus the shared Confirmation gates and the testate-devise sibling. */
const CARD_BY_FLAG: Record<string, Omit<DeedCureCard, 'flag'>> = {
  // ── S5 Confirmation-survivorship gate classes (the #484 ratified condition) ──
  INCOMPLETE_SURVIVORSHIP_CHAIN: {
    field: 'Survivorship chain (co-owners, decedent, and vesting deed)',
    problem:
      "The survivorship chain is incomplete, or the survivor can't be identified without guessing - the decedent's name must match exactly one of the co-owners.",
    fix:
      'Fill in both co-owners (as they took title), the decedent\'s name and date of death, the vesting deed\'s date / recorded date / instrument number, the records county, and the prior-instrument "Being" reference - or name the survivor explicitly - then regenerate.',
  },
  SURVIVORSHIP_UNSUPPORTED_OWNER_COUNT: {
    field: 'Co-owners',
    problem:
      'A survivorship-to-sole-owner confirmation is legally true only for exactly two co-owners (one dies, one survives). A different number of owners was listed.',
    fix:
      'List exactly the two co-owners who held title together, then regenerate. Three or more owners leaves multiple survivors (not a sole owner) and needs manual drafting - the sole-owner recital would be false.',
  },
  SURVIVORSHIP_TENANCY_NOT_SURVIVORSHIP: {
    field: 'Took title as',
    problem:
      'The tenancy entered does not carry a right of survivorship (for example, tenants in common), so "became the sole owner by operation of law" would be untrue.',
    fix:
      'Enter the survivorship tenancy the owners actually held - joint tenants with the right of survivorship, or tenants by the entirety - then regenerate.',
  },

  // ── Shared Confirmation gates that also fire on the survivorship path ──
  EXEMPTION_MISMATCH: {
    field: 'Exemption code',
    problem: 'The exemption code is not the one a Deed of Confirmation uses (Va. Code Sec. 58.1-810(1)).',
    fix:
      'Set the Exemption code to 58.1-810(1) and regenerate. The recital is attorney-load-bearing - the system will not silently substitute a cite.',
  },
  PARTIES_NOT_IDENTICAL: {
    field: 'Confirming party',
    problem:
      'A Deed of Confirmation confirms title in the SAME person - the party of the first part and the party of the second part must be identical.',
    fix: 'Make the confirming party the same on both sides (the current owner being confirmed) and regenerate.',
  },
  LEGAL_DESCRIPTION_INCOMPLETE: {
    field: 'Legal description (read from your uploads)',
    problem:
      'The legal description could not be read in full - it looks truncated or is missing its closing land-records clause.',
    fix:
      'Re-drop a clearer copy of the prior vesting deed so the complete legal description is captured, then regenerate. It is copied verbatim from your documents and is never written by the system.',
  },

  // ── Testate-devise (C1-b) sibling gate ──
  INCOMPLETE_DEVISE_CHAIN: {
    field: 'Testate-devise chain',
    problem:
      'The testate-devise chain is missing a probate or devise fact (testator, date of death, fiduciary number, devise article, or devisee).',
    fix:
      'Complete every link in the testate-devise chain - the original vesting deed, the first decedent, the testator and probate details, and the devise article and devisee - then regenerate.',
  },

  // ── System/config, not a form field ──
  UNVERIFIED_EXEMPTION_CITE: {
    field: '(not a form field - system configuration)',
    problem: 'The exemption citation is not grounded in the verified knowledge base, so it cannot be emitted.',
    fix:
      'This is a configuration issue, not something to hand-edit into a field - do not paste a cite manually. Report it so the verified exemption set can be corrected.',
  },
};

/** Humanize an unknown SNAKE_CASE flag so a withhold NEVER surfaces as a bare machine code. */
function humanizeFlag(flag: string): DeedCureCard {
  const words = flag.toLowerCase().replace(/_/g, ' ').trim();
  return {
    flag,
    field: 'The flagged fact',
    problem: `A required fact was withheld (${words}).`,
    fix: 'Complete or correct the flagged fact in the form and regenerate. Nothing was drafted, so no incorrect recital was produced.',
  };
}

/**
 * PURE: map the assembler's fail-closed `flags` to plain-English cure cards, deduped and order-preserving.
 * A known flag gets its hand-authored card; anything else degrades to a humanized card (never a bare code).
 */
export function deedCureCards(flags: readonly string[]): DeedCureCard[] {
  const seen = new Set<string>();
  const out: DeedCureCard[] = [];
  for (const flag of flags) {
    if (seen.has(flag)) continue;
    seen.add(flag);
    const known = CARD_BY_FLAG[flag];
    out.push(known ? { flag, ...known } : humanizeFlag(flag));
  }
  return out;
}

/** The flags with a hand-authored (non-fallback) cure card. Exported for coverage tests. */
export const CURE_CARD_KNOWN_FLAGS: readonly string[] = Object.keys(CARD_BY_FLAG);
