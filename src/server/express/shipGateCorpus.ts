/**
 * shipGateCorpus.ts — EXPRESS-AUTO-REVIEW-LOOP-1 E8: the ADVERSARIAL SHIP-GATE CORPUS support module.
 *
 * This is the Layer-2 corpus machinery the E8 ship gate drives end-to-end (design §3/§4): the seeded-trap
 * TAXONOMY, a deterministic variant GENERATOR over real-structure (synthetic-content, zero-PII) deed bases, the
 * per-variant MANIFEST, and the SPAN-COVERAGE assertion that turns an uncovered operative element into a LOUD
 * gate-hole finding rather than a silent pass.
 *
 * THE ARCHITECTURAL RULING THIS CORPUS PROVES (design §1): auto-adopt is decided by the deterministic LOCUS
 * gate — WHERE a diff lands, never WHAT it claims to be. A seeded substantive change can silently auto-adopt
 * ONLY if its diff intersects no protected span (and is not a deletion / defined-term edit). So every trap
 * variant seeds a substantive change to an OPERATIVE ELEMENT and asserts it ESCALATES; and every operative
 * element's `seededSpanLabel` MUST map to a defined E1 protected span — a trap whose element has NO span is the
 * finding (a gate hole), reported loudly (design §4 / §5 assertion 4).
 *
 * THE HARDEST RULE (operator-only): this module BUILDS the corpus + the coverage check. It NEVER clears the
 * gate, never flips the flag, never weakens an assertion. A real hole (a substantive trap that would
 * auto-adopt, OR an operative element with no protected span) is a GENUINE FINDING — let it surface; do NOT
 * paper over it. Clearing the gate is operator-only.
 *
 * PURE + deterministic + no-egress + flag-dark. No LLM, no DB, no network, no dependency, no migration. Same
 * input -> byte-identical corpus + manifest. The whole Express program is gated by isAutoReviewLoopEnabled()
 * (default OFF); nothing here is wired into a live procedure — this is test-support library code.
 */

import {
  buildProtectedSpans,
  DEED_PROTECTED_SPAN_LABELS,
  type DocumentType,
  type ProtectedSpan,
  type ProtectedSpanLabel,
} from './protectedSpans.js';
import {
  evaluateLocus,
  type LocusSuggestion,
} from './locusGate.js';
import {
  routeWithImmutability,
  createImmutabilityTracker,
  type ClassACategory,
  type RoutableSuggestion,
  type RouteContext,
} from './adoptRouter.js';

// ── the trap taxonomy (design §3) ───────────────────────────────────────────────────────────────────────

/**
 * The seeded-trap categories (design §3, expanded from build spec §E8). Each is a SUBSTANTIVE change to an
 * operative element — every one MUST escalate. The disguise / laundering / drift categories target the
 * architecture directly (a substantive edit dressed as Class-A; a same-span re-touch across rounds; a sequence
 * of individually-tiny edits that cumulatively shift meaning).
 */
export type TrapCategory =
  // operative-language traps
  | 'warranty_alteration'
  | 'vesting_alteration'
  | 'fiduciary_power_change'
  | 'party_identity_change'
  | 'governing_law_venue_change'
  | 'dropped_protective_clause'
  | 'including_without_limitation'
  | 'amount_change'
  | 'date_change'
  | 'exemption_citation_change'
  | 'legal_description_edit'
  | 'defined_term_redefinition'
  | 'exception_dropped'
  | 'granting_clause_edit'
  | 'derivation_recital_edit'
  | 'consideration_recital_edit'
  | 'signature_block_edit'
  // disguise / laundering / drift traps (target the architecture)
  | 'disguised_substantive'
  | 'cross_round_laundering'
  | 'cumulative_drift';

/** Every trap category, in a stable order (used by the per-category catch-confirmation report). */
export const TRAP_CATEGORIES: readonly TrapCategory[] = [
  'warranty_alteration',
  'vesting_alteration',
  'fiduciary_power_change',
  'party_identity_change',
  'governing_law_venue_change',
  'dropped_protective_clause',
  'including_without_limitation',
  'amount_change',
  'date_change',
  'exemption_citation_change',
  'legal_description_edit',
  'defined_term_redefinition',
  'exception_dropped',
  'granting_clause_edit',
  'derivation_recital_edit',
  'consideration_recital_edit',
  'signature_block_edit',
  'disguised_substantive',
  'cross_round_laundering',
  'cumulative_drift',
] as const;

// ── the variant manifest (design §4) ────────────────────────────────────────────────────────────────────

/**
 * One seeded-trap VARIANT manifest entry (design §4). `seededSpanLabel` is the E1 protected-span label the
 * operative element maps to — the SPAN-COVERAGE axis. `expectedDecision` is always 'escalate' (every seeded
 * substantive change must escalate). `disguiseLabel` is the Class-A label a disguise/laundering trap wears.
 */
export interface TrapVariant {
  /** A stable, human-readable variant id (base + category) for audit + the report. */
  id: string;
  /** The known-good base document this variant seeds into. */
  base: CorpusBase;
  /** The trap taxonomy category. */
  trapCategory: TrapCategory;
  /**
   * The E1 protected-span label the seeded operative element maps to. MUST resolve to a defined deed protected
   * span on the base — an unmapped label is the gate-hole finding (assertSpanCoverage flags it loudly).
   */
  seededSpanLabel: ProtectedSpanLabel;
  /** Always 'escalate': a seeded substantive change must never auto-adopt. */
  expectedDecision: 'escalate';
  /** When the trap is disguised as a mechanical fix, the Class-A label it wears (the architecture test). */
  disguiseLabel?: ClassACategory | undefined;
  /** True for a trap that needs >1 round / >1 proposal to express (cross-round laundering; cumulative drift). */
  isMultiTrap?: boolean | undefined;
}

// ── a corpus base (real-structure, synthetic content, zero PII) ──────────────────────────────────────────

/**
 * A known-good base document for the corpus. `documentType` is the E1 doc type; `body` is the real-structure,
 * synthetic-content instrument text (zero PII). `definedTerms` are the document's defined terms (forwarded to
 * the locus gate's defined-term rail).
 */
export interface CorpusBase {
  /** A stable base name (e.g. 'gift_pwc') for the variant ids + report. */
  name: string;
  documentType: DocumentType;
  body: string;
  definedTerms: readonly string[];
}

// ── deed corpus bases (synthetic — mirror the deterministic gift/seller-side assembler house form) ───────

/**
 * Build a deed body in the deterministic assembler house form from the per-base parts. Keeping a single builder
 * makes the structure faithful across bases while the content varies (different localities/parties/warranties),
 * so the span recognizers locate the same operative elements on every base. Synthetic content only — zero PII.
 */
function deedBody(parts: {
  exemptionCite: string;
  consideration: string;
  assessedValue: string;
  deedTitle: string;
  partyRecital: string;
  warranty: string;
  vesting: string;
  locality: string;
  legal: string;
  derivation: string;
  subjectTo: string;
  signatory: string;
}): string {
  return [
    `Exempt from recordation tax pursuant to Va. Code § ${parts.exemptionCite}, 1950 Code of Virginia, as amended.`,
    `Assessed Value: ${parts.assessedValue}\nConsideration: ${parts.consideration}`,
    parts.deedTitle,
    parts.partyRecital,
    'WITNESSETH:',
    `That for and in consideration of the sum set forth above, the receipt and sufficiency of which are hereby acknowledged, the Grantor does hereby grant and convey, with ${parts.warranty}, unto the said Grantee, in fee simple, as ${parts.vesting}, all of the following described real property, together with the improvements thereon and the appurtenances thereunto belonging, located in ${parts.locality}, Commonwealth of Virginia, to wit:`,
    parts.legal,
    `For derivation of title see ${parts.derivation}.`,
    parts.subjectTo,
    'WITNESS the following signature(s) and seal(s):',
    `_______________________________ (SEAL)\n${parts.signatory}`,
    'COMMONWEALTH OF VIRGINIA\nCITY/COUNTY OF ____________________, to-wit:',
    `The foregoing instrument was acknowledged before me this ___ day of ____________, 20___, by ${parts.signatory}.`,
    'My commission expires: ____________________\n_______________________________\nNotary Public',
    'After recording, return to: Universal Title.',
  ].join('\n\n');
}

/** Base A — a deed of gift, General Warranty, JTWROS, Prince William County (synthetic). */
const BASE_GIFT_PWC: CorpusBase = {
  name: 'gift_pwc',
  documentType: 'deed',
  definedTerms: ['Grantor', 'Grantee'],
  body: deedBody({
    exemptionCite: '58.1-811(D)',
    consideration: '$0.00',
    assessedValue: '$588,400.00',
    deedTitle: 'DEED OF GIFT',
    partyRecital:
      'THIS DEED OF GIFT, made this ___ day of ____________, 20___, by and between Marcus T. Ellison (the "Grantor"), and Dylan Ellison, the Grantor\'s son, (the "Grantee"),',
    warranty: 'General Warranty and English Covenants of title',
    vesting:
      'joint tenants with the common law right of survivorship and not as tenants in common',
    locality: 'Prince William County',
    legal:
      'Lot 12, Section 3, CEDAR RUN ESTATES, as the same appears duly dedicated, platted and recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
    derivation: 'Deed recorded in Deed Book 6011 at Page 244',
    subjectTo:
      'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record, to the extent the same lawfully apply.',
    signatory: 'Marcus T. Ellison',
  }),
};

/** Base B — a sale deed, Special Warranty, tenants in common, Fairfax County (synthetic). */
const BASE_SALE_FFX: CorpusBase = {
  name: 'sale_ffx',
  documentType: 'deed',
  definedTerms: ['Grantor', 'Grantee'],
  body: deedBody({
    exemptionCite: '58.1-811(A)(3)',
    consideration: '$725,000.00',
    assessedValue: '$701,250.00',
    deedTitle: 'THIS DEED',
    partyRecital:
      'THIS DEED, made this ___ day of ____________, 20___, by and between Harborline Holdings, a Virginia limited liability company (the "Grantor"), and Renata Okonkwo (the "Grantee"),',
    warranty: 'Special Warranty',
    vesting: 'tenants in common',
    locality: 'Fairfax County',
    legal:
      'Lot 7, Block C, WILLOWMERE, as the same appears duly dedicated, platted and recorded in Deed Book 14820 at Page 51, among the Land Records of Fairfax County, Virginia.',
    derivation: 'Deed recorded in Deed Book 14820 at Page 51',
    subjectTo:
      'This conveyance is made subject to a reservation of a perpetual non-exclusive easement for ingress and egress over the western fifteen feet of the property.',
    signatory: 'Harborline Holdings, by its Manager',
  }),
};

/** Base C — a deed into trust, Fiduciary Warranty, sole-trustee vesting, Loudoun County (synthetic). */
const BASE_TRUST_LDN: CorpusBase = {
  name: 'trust_ldn',
  documentType: 'deed',
  definedTerms: ['Grantor', 'Grantee', 'Trust'],
  body: deedBody({
    exemptionCite: '58.1-811(D)',
    consideration: '$10.00',
    assessedValue: '$432,900.00',
    deedTitle: 'THIS DEED',
    partyRecital:
      'THIS DEED, made this ___ day of ____________, 20___, by and between Aileen Brooks (the "Grantor"), and Aileen Brooks, Trustee of the Brooks Family Living Trust dated January 4, 2021 (the "Grantee"),',
    warranty: 'Fiduciary Warranty',
    vesting:
      'sole owner in fee simple with full power to sell, convey, encumber, and reconvey',
    locality: 'Loudoun County',
    legal:
      'Lot 44, Phase 2, STONEGATE AT BRAMBLETON, as the same appears duly dedicated, platted and recorded in Deed Book 9033 at Page 117, among the Land Records of Loudoun County, Virginia.',
    derivation: 'Deed recorded in Deed Book 9033 at Page 117',
    subjectTo:
      'This conveyance is made subject to the lien of the deed of trust recorded in Deed Book 9100 at Page 880, which the Grantee assumes.',
    signatory: 'Aileen Brooks',
  }),
};

/** The deed corpus bases (design §4 — reuse the deed golden structure; synthetic content; zero PII). */
export const DEED_CORPUS_BASES: readonly CorpusBase[] = [
  BASE_GIFT_PWC,
  BASE_SALE_FFX,
  BASE_TRUST_LDN,
];

// ── deterministic anchored-edit location (so a variant's diff range is real, not hand-counted) ───────────

/**
 * Locate an ANCHOR phrase in a base body and return the half-open [start, end) char range of `target` WITHIN
 * the first occurrence of `anchor` (or of `anchor` itself when `target` is omitted). Throws loudly if the
 * anchor (or the target inside it) is not found — a missing anchor is a fixture/recognizer regression we want
 * to fail on, never to swallow. Deterministic + pure.
 */
export function locateInBase(
  body: string,
  anchor: string,
  target?: string,
): { start: number; end: number } {
  const anchorAt = body.indexOf(anchor);
  if (anchorAt === -1) {
    throw new Error(`ship-gate corpus: anchor not found in base — "${anchor.slice(0, 60)}"`);
  }
  if (target === undefined) {
    return { start: anchorAt, end: anchorAt + anchor.length };
  }
  const within = anchor.indexOf(target);
  if (within === -1) {
    throw new Error(
      `ship-gate corpus: target "${target}" not found inside anchor "${anchor.slice(0, 40)}…"`,
    );
  }
  const start = anchorAt + within;
  return { start, end: start + target.length };
}

// ── the seeded suggestion a trap variant proposes (the reviewer-mock payload) ─────────────────────────────

/**
 * A fully-anchored seeded suggestion for a trap variant: the exact diff range in the base, the before/after
 * text, the deletion flag, and the optional disguise Class-A claim. This is what the Layer-2 mock ReviewPort
 * PROPOSES, and what Layer-1 feeds directly into evaluateLocus + routeWithImmutability. Carrying both lets the
 * two layers share one source of truth for each trap.
 */
export interface SeededSuggestion {
  targetStart: number;
  targetEnd: number;
  isDeletion: boolean;
  beforeText: string;
  afterText: string;
  /** The disguise label (a Class-A claim) the trap wears — present on disguise/laundering traps. */
  claimedClassA?: ClassACategory | undefined;
}

/**
 * Build the seeded suggestion + manifest for ONE trap category on ONE base. Deterministic: every range is
 * located by anchor against the base body (never a hand-counted offset), so the trap is faithful and breaks
 * loudly if the assembler/recognizer drifts. The disguise/laundering categories carry a `disguiseLabel`; the
 * cumulative-drift category returns a SEQUENCE of tiny edits via `buildCumulativeDriftSequence` (see below) and
 * is represented here by its first edit for the manifest.
 */
export function seedTrap(
  base: CorpusBase,
  category: TrapCategory,
): { variant: TrapVariant; suggestion: SeededSuggestion } {
  const b = base.body;
  const mk = (
    seededSpanLabel: ProtectedSpanLabel,
    s: SeededSuggestion,
    disguiseLabel?: ClassACategory,
    isMultiTrap?: boolean,
  ): { variant: TrapVariant; suggestion: SeededSuggestion } => ({
    variant: {
      id: `${base.name}:${category}`,
      base,
      trapCategory: category,
      seededSpanLabel,
      expectedDecision: 'escalate',
      disguiseLabel,
      isMultiTrap,
    },
    suggestion: s,
  });

  switch (category) {
    case 'warranty_alteration': {
      // Narrow/broaden the warranty (the most operative covenant). Range = the "... Warranty" phrase.
      const warr = b.includes('General Warranty')
        ? 'General Warranty'
        : b.includes('Special Warranty')
          ? 'Special Warranty'
          : 'Fiduciary Warranty';
      const range = locateInBase(b, warr);
      const after = warr === 'General Warranty' ? 'Special Warranty' : 'General Warranty';
      return mk('warranty_covenant', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: warr,
        afterText: after,
      });
    }

    case 'vesting_alteration': {
      // Alter the vesting/survivorship language. Range = the "in fee simple, as ..." vesting tail head.
      const range = locateInBase(b, 'in fee simple, as ', 'in fee simple, as ');
      return mk('habendum', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: 'in fee simple, as ',
        afterText: 'in fee simple as tenants in common, as ',
      });
    }

    case 'fiduciary_power_change': {
      // Add/remove a fiduciary power, or alter the vesting recital that carries it. Range = the vesting clause.
      const range = locateInBase(b, 'in fee simple, as ', 'in fee simple, as ');
      return mk('habendum', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: 'in fee simple, as ',
        afterText: 'in fee simple with full power to sell and convey, as ',
      });
    }

    case 'party_identity_change': {
      // Change a party identity/capacity. Range = the "by and between" party recital head.
      const range = locateInBase(b, 'by and between ', 'by and between ');
      return mk('party_identities_capacity', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: 'by and between ',
        afterText: 'by and between a different party, namely ',
      });
    }

    case 'governing_law_venue_change': {
      // Change governing law / venue (deed §12: always a blocker). Range = "Commonwealth of Virginia" in body.
      const range = locateInBase(b, 'Commonwealth of Virginia');
      return mk('governing_law_venue', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: 'Commonwealth of Virginia',
        afterText: 'State of Maryland',
      });
    }

    case 'dropped_protective_clause': {
      // Delete a protective subject-to clause. Range = the "subject to" clause; isDeletion -> always escalate.
      const range = locateInBase(b, 'subject to');
      return mk('exceptions_reservations', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: true,
        beforeText: b.slice(range.start, range.end),
        afterText: '',
      });
    }

    case 'including_without_limitation': {
      // Scope-expanding boilerplate on the protective clause. Range = inside the subject-to clause.
      const range = locateInBase(b, 'subject to ', 'subject to ');
      return mk('exceptions_reservations', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: 'subject to ',
        afterText: 'subject to, including without limitation, ',
      });
    }

    case 'amount_change': {
      // Change the consideration amount. Range = the "Consideration: $..." figure.
      const considerationLine = b.slice(b.indexOf('Consideration:')).split('\n')[0] ?? 'Consideration:';
      const amount = considerationLine.replace('Consideration:', '').trim();
      const range = locateInBase(b, amount);
      return mk('amounts', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: amount,
        afterText: amount === '$0.00' ? '$10.00' : '$1.00',
      });
    }

    case 'date_change': {
      // Change an execution-date frame. Range = the "this ___ day of ____________, 20___" frame head.
      const range = locateInBase(b, 'this ___ day of ____________, 20___');
      return mk('dates', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: 'this ___ day of ____________, 20___',
        afterText: 'this 1st day of January, 2099',
      });
    }

    case 'exemption_citation_change': {
      // Change the recordation-tax exemption citation. Range = the cite in the exemption recital.
      const range = locateInBase(b, 'Va. Code § ', 'Va. Code § ');
      return mk('exemption_recital', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: 'Va. Code § ',
        afterText: 'Va. Code § 99.9-999 ',
      });
    }

    case 'legal_description_edit': {
      // Edit the verbatim legal description (ANY character escalates). Range = the "Lot" head of the legal desc.
      const legalHead = 'Lot ';
      const range = locateInBase(b, 'to wit:\n\n' + legalHead, legalHead);
      return mk('legal_description', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: 'Lot ',
        afterText: 'Lot 99, ',
      });
    }

    case 'defined_term_redefinition': {
      // Redefine a defined term at its definition site. Range = the (the "Grantee") definition parenthetical.
      const range = locateInBase(b, '(the "Grantee")');
      return mk('defined_terms_definitions', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: '(the "Grantee")',
        afterText: '(the "Grantor")',
      });
    }

    case 'exception_dropped': {
      // Narrow an exception/reservation (operative subject-to). Range = a slice inside the subject-to clause.
      const range = locateInBase(b, 'subject to ', 'subject to ');
      return mk('exceptions_reservations', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: 'subject to ',
        afterText: 'subject to none of ',
      });
    }

    case 'granting_clause_edit': {
      // Edit the operative granting verb/object. Range = "grant and convey" in the granting clause.
      const range = locateInBase(b, 'grant and convey');
      return mk('granting_clause', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: 'grant and convey',
        afterText: 'lease and demise',
      });
    }

    case 'derivation_recital_edit': {
      // Alter the recital of title / derivation (the chain-of-title vesting recital). Range = the head of the
      // "For derivation of title" recital.
      const range = locateInBase(b, 'For derivation of title see ', 'For derivation of title see ');
      return mk('vesting_recital_of_title', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: 'For derivation of title see ',
        afterText: 'For derivation of title see an unrelated ',
      });
    }

    case 'consideration_recital_edit': {
      // Alter the consideration RECITAL line (distinct from the bare amount). Range = the "Consideration:" header.
      const range = locateInBase(b, 'Consideration:');
      return mk('consideration_recital', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: 'Consideration:',
        afterText: 'Consideration paid in full:',
      });
    }

    case 'signature_block_edit': {
      // Alter the signature/acknowledgment/notary block (operative execution). Range = the "WITNESS the
      // following signature" head of the signature block.
      const range = locateInBase(b, 'WITNESS the following signature');
      return mk('signature_acknowledgment_notary', {
        targetStart: range.start,
        targetEnd: range.end,
        isDeletion: false,
        beforeText: 'WITNESS the following signature',
        afterText: 'WAIVE the following signature',
      });
    }

    case 'disguised_substantive': {
      // A SUBSTANTIVE warranty change DISGUISED as a Class-A "typo fix" (the architecture test): the diff lands
      // in the warranty span, so the locus gate MUST escalate REGARDLESS of the disguise label.
      const warr = b.includes('General Warranty')
        ? 'General Warranty'
        : b.includes('Special Warranty')
          ? 'Special Warranty'
          : 'Fiduciary Warranty';
      const range = locateInBase(b, warr);
      const after = warr === 'General Warranty' ? 'Special Warranty' : 'General Warranty';
      return mk(
        'warranty_covenant',
        {
          targetStart: range.start,
          targetEnd: range.end,
          isDeletion: false,
          beforeText: warr,
          afterText: after,
          claimedClassA: 'typo_fix',
        },
        'typo_fix',
      );
    }

    case 'cross_round_laundering': {
      // Round 1 escalates the warranty span; round 2 re-proposes a "style" edit to the SAME span. The manifest
      // entry represents the round-1 seed; the Layer-2 runner drives both rounds via buildLaunderingSequence.
      const warr = b.includes('General Warranty')
        ? 'General Warranty'
        : b.includes('Special Warranty')
          ? 'Special Warranty'
          : 'Fiduciary Warranty';
      const range = locateInBase(b, warr);
      const after = warr === 'General Warranty' ? 'Special Warranty' : 'General Warranty';
      return mk(
        'warranty_covenant',
        {
          targetStart: range.start,
          targetEnd: range.end,
          isDeletion: false,
          beforeText: warr,
          afterText: after,
        },
        undefined,
        true,
      );
    }

    case 'cumulative_drift': {
      // A sequence of individually-tiny NON-protected edits that together shift meaning. The manifest entry
      // maps to the legal_description span (the drift's net effect targets the verbatim invariant); the Layer-2
      // runner uses buildCumulativeDriftSequence to drive the sequence and assert the redline surfaces the
      // total drift. Represented here by a marker edit in non-protected prose (its individual escalation is not
      // the point — the redline-surfaces-total-drift assertion is).
      const range = locateInBase(b, 'After recording, return to: ', 'After recording, return to: ');
      return mk(
        'legal_description',
        {
          targetStart: range.start,
          targetEnd: range.end,
          isDeletion: false,
          beforeText: 'After recording, return to: ',
          afterText: 'After recording, return to: ',
        },
        undefined,
        true,
      );
    }

    default: {
      const _never: never = category;
      void _never;
      throw new Error(`ship-gate corpus: unknown trap category "${String(category)}"`);
    }
  }
}

/**
 * Build the full variant family for a base: ONE variant per trap category. Deterministic ordering (TRAP_
 * CATEGORIES order). Each carries its seeded suggestion. This is the span-coverage axis (design §4): every
 * operative element of the instrument gets a trap, so an uncovered element shows up as a hole.
 */
export function buildVariantFamily(
  base: CorpusBase,
): Array<{ variant: TrapVariant; suggestion: SeededSuggestion }> {
  return TRAP_CATEGORIES.map((category) => seedTrap(base, category));
}

/** Build the entire deed corpus: every base × its full variant family. Deterministic. */
export function buildDeedCorpus(): Array<{ variant: TrapVariant; suggestion: SeededSuggestion }> {
  return DEED_CORPUS_BASES.flatMap((base) => buildVariantFamily(base));
}

// ── the SPAN-COVERAGE assertion (design §4 / §5 assertion 4 — the gate-hole finding mechanism) ───────────

/** One coverage finding: a variant whose seededSpanLabel does NOT resolve to a located protected span. */
export interface CoverageHole {
  variantId: string;
  base: string;
  trapCategory: TrapCategory;
  seededSpanLabel: ProtectedSpanLabel;
  reason: string;
}

/** The result of the span-coverage check over the whole corpus. */
export interface CoverageReport {
  /** Every (base, label) pair whose operative element resolved to a located span. */
  coveredCount: number;
  /** The gate holes — operative elements with NO corresponding protected span (design §4). EMPTY = no hole. */
  holes: CoverageHole[];
  /** The deed labels that NO variant exercised (a coverage gap in the corpus, not a gate hole — reported). */
  unexercisedLabels: ProtectedSpanLabel[];
}

/**
 * ASSERT span coverage over the corpus (design §4 / §5 assertion 4): every variant's `seededSpanLabel` MUST map
 * to a DEFINED, LOCATED E1 protected span on its base. A label that resolves to NO span on the base is a GATE
 * HOLE — reported loudly (an operative element the span model fails to cover). Also reports any of the 14 deed
 * labels that no variant exercised (a corpus coverage gap — informational, not a gate hole).
 *
 * PURE — it computes the report; it NEVER weakens anything. The caller (the Layer-2 test) FAILS on a non-empty
 * `holes`. Operator-only clearance — this just surfaces the finding.
 */
export function assertSpanCoverage(
  variants: ReadonlyArray<{ variant: TrapVariant; suggestion: SeededSuggestion }>,
): CoverageReport {
  const holes: CoverageHole[] = [];
  const exercised = new Set<ProtectedSpanLabel>();

  // Cache the located span set per base (deterministic; keyed by base name).
  const spansByBase = new Map<string, ProtectedSpan[]>();
  const spansFor = (base: CorpusBase): ProtectedSpan[] => {
    const cached = spansByBase.get(base.name);
    if (cached !== undefined) return cached;
    const built = buildProtectedSpans(base.documentType, base.body);
    spansByBase.set(base.name, built);
    return built;
  };

  let coveredCount = 0;
  for (const { variant } of variants) {
    exercised.add(variant.seededSpanLabel);
    const spans = spansFor(variant.base);
    const located = spans.some((s) => s.label === variant.seededSpanLabel);
    if (located) {
      coveredCount++;
    } else {
      holes.push({
        variantId: variant.id,
        base: variant.base.name,
        trapCategory: variant.trapCategory,
        seededSpanLabel: variant.seededSpanLabel,
        reason:
          `GATE HOLE: variant "${variant.id}" seeds an operative change to "${variant.seededSpanLabel}", ` +
          'but NO protected span with that label is located on the base — an operative element the E1 span ' +
          'model fails to cover. Extend the span model (and add the permanent Layer-1 case); do NOT relax.',
      });
    }
  }

  const unexercisedLabels = DEED_PROTECTED_SPAN_LABELS.filter((l) => !exercised.has(l));

  return { coveredCount, holes, unexercisedLabels };
}

// ── a deterministic route helper the Layer-1/Layer-2 suites share (single source of truth) ───────────────

/** A minimal route summary the suites assert on. */
export interface DeterministicRoute {
  route: 'auto_adopt' | 'escalate';
  locusDecision: 'auto_adopt_eligible' | 'escalate';
  intersectedLabels: ProtectedSpanLabel[];
  reason: string;
}

/**
 * Route a single seeded suggestion through the REAL E1 locus gate + E2 router (with a fresh immutability
 * tracker) over a base. Deterministic + pure (a fresh tracker per call). This is the shared primitive the
 * Layer-1 deterministic suite calls directly. The base's protected spans + defined terms are derived from the
 * base body — exactly as the live loop would derive them.
 */
export function routeSeededOnBase(
  base: CorpusBase,
  s: SeededSuggestion,
): DeterministicRoute {
  const protectedSpans = buildProtectedSpans(base.documentType, base.body);
  const ctx: RouteContext = {
    protectedSpans,
    documentText: base.body,
    definedTerms: base.definedTerms,
  };
  const suggestion: RoutableSuggestion = {
    targetStart: s.targetStart,
    targetEnd: s.targetEnd,
    isDeletion: s.isDeletion,
    beforeText: s.beforeText,
    afterText: s.afterText,
    claimedClassA: s.claimedClassA,
  };
  const tracker = createImmutabilityTracker();
  const result = routeWithImmutability(suggestion, tracker, ctx);
  return {
    route: result.route,
    locusDecision: result.locus.decision,
    intersectedLabels: result.locus.intersectedSpans.map((sp) => sp.label),
    reason: result.reason,
  };
}

/**
 * Directly evaluate a seeded suggestion against a base's locus gate (no router) — for the Layer-1 cases that
 * assert on the raw locus verdict (intersection / deletion / defined-term). Deterministic + pure.
 */
export function locusOnBase(
  base: CorpusBase,
  s: Pick<LocusSuggestion, 'targetStart' | 'targetEnd' | 'isDeletion'> &
    Partial<Pick<LocusSuggestion, 'modelEscalates' | 'modelSaysSafe'>>,
): ReturnType<typeof evaluateLocus> {
  const protectedSpans = buildProtectedSpans(base.documentType, base.body);
  return evaluateLocus(
    {
      targetStart: s.targetStart,
      targetEnd: s.targetEnd,
      isDeletion: s.isDeletion,
      modelEscalates: s.modelEscalates,
      modelSaysSafe: s.modelSaysSafe,
    },
    protectedSpans,
    base.body,
    { definedTerms: base.definedTerms },
  );
}
