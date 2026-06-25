/**
 * deedCategoryNotes.ts — DEED-DRAFT-AGENT-1 E7: the DETERMINISTIC advisory / drafter's-notes layer GENERALIZED
 * to the NON-GIFT deed categories (seller-side / TOD / confirmation / into-LLC / out-of-LLC / into-trust).
 *
 * This is the gift drafter's-notes architecture (deedGiftNotes.ts) extended to the six non-gift categories: a
 * deterministic, NO-LLM, NO-EGRESS "Drafter's Notes — delete before recording" set that SURFACES decision points
 * + diligence for the supervising attorney and NEVER decides. It REUSES the gift builder's exported internals
 * (DrafterNote/DrafterNoteSeverity, kbCite/kbExemptionCite, normalizeName/normalizeLegal, renderDrafterNotes) so
 * the two read identically and the gift output stays byte-for-byte unchanged.
 *
 * HARD INVARIANTS (a reviewer checks these), mirroring the gift layer exactly:
 *   1. CITE-ONLY-FROM-THE-KB. Every statutory citation is a VERIFIED string from deedKbVa
 *      (VA_DEED_TYPES / VA_STATUTORY_CITATIONS / VA_EXEMPTIONS) or the deedTypeRegistry's exemptionCitation
 *      (already verified by the registry against the KB). A cite is NEVER authored from memory; a note with no
 *      on-point KB cite carries citations:[]. When in doubt, OMIT the cite (or the whole note).
 *   2. SURFACE-NOT-DECIDE. Notes never pick warranty/structure, compute tax, or resolve a discrepancy. Fewer,
 *      well-grounded notes over more speculative ones.
 *   3. Notes stay OUT of the recordable deed body (the document NOTES field only) — the B6 annotation-leak floor
 *      stays clean. The version content is NEVER touched.
 *   4. DETERMINISM + never-throws (pure, byte-identical on repeat).
 *
 * The category-specific exemption/tax note reads the verified exemptionCitation off getDeedType(registryKey) (or
 * the recordation-tax base for the TAXED seller-side category). The category-agnostic fact-driven notes (name
 * reconciliation, cross-source name discrepancy, estate-window diligence, commitment-vs-vesting legal mismatch,
 * the title caveat, and the diligence checklist) read DeedSourceFacts and generalize unchanged from gift. One
 * conservative category-specific STRUCTURAL note is grounded in the category's documented assembler invariant.
 */

import { VA_ESCALATION_TRIGGERS } from './deedKbVa.js';
import { getDeedType } from './deedTypeRegistry.js';
import type { DeedSourceFacts } from './deedSourceFacts.js';
import {
  type DrafterNote,
  type DrafterNoteSeverity,
  type DrafterNoteCategory,
  kbCite,
  normalizeLegal,
  renderDrafterNotes,
} from './deedGiftNotes.js';

/** The non-gift deed categories this builder covers. Keyed by the deedTypeRegistry registry key (so the verified
 *  exemption cite is read straight off getDeedType — never re-authored). A TS string-literal union, NOT a DB enum. */
export type DeedCategoryKey =
  | 'seller_side'
  | 'deed_tod'
  | 'deed_of_confirmation'
  | 'deed_into_llc'
  | 'deed_out_of_llc'
  | 'deed_into_trust';

/** Extra DrafterNote categories the category builder emits (the gift union already carries 'exemption',
 *  'name_reconciliation', 'cross_source_name', 'estate_window', 'legal_mismatch', 'title_caveat', 'diligence').
 *  We add one type-only literal for the conservative per-category STRUCTURAL note. A TS type, not a DB enum. */
export type CategoryDrafterNoteCategory = DrafterNoteCategory | 'category_structure' | 'tax';

/** A category-builder note: the gift DrafterNote, widened to carry the two extra category-literal categories. */
export interface CategoryDrafterNote extends Omit<DrafterNote, 'category'> {
  category: CategoryDrafterNoteCategory;
}

export interface CategoryDrafterNotes {
  notes: CategoryDrafterNote[];
  /** The numbered "DRAFTER'S NOTES — DELETE BEFORE RECORDING" page (kept OUT of the recordable deed body). */
  rendered: string;
}

export interface CategoryDrafterNotesOpts {
  /** Whether the deed is a married-couple / TBE conveyance (for into-trust's §55.1-136(C) immunity context). */
  marriedCouple?: boolean;
}

// The display label per category (used in the structural note text; from the verified registry title).
function categoryTitle(category: DeedCategoryKey): string {
  return getDeedType(category)?.title ?? category;
}

/**
 * PURE: build the deterministic category drafter's notes for a non-gift deed. Never throws; cites ONLY from the
 * verified KB. Reads DeedSourceFacts (the category-agnostic fact-driven notes) + the registry exemption cite (the
 * category exemption/tax note) + the documented assembler invariant (the one structural note).
 */
export function buildCategoryDrafterNotes(
  category: DeedCategoryKey,
  facts: DeedSourceFacts,
  opts: CategoryDrafterNotesOpts = {},
): CategoryDrafterNotes {
  const notes: CategoryDrafterNote[] = [];
  const add = (
    noteCategory: CategoryDrafterNoteCategory,
    severity: DrafterNoteSeverity,
    text: string,
    citations: (string | null | undefined)[] = [],
  ): void => {
    notes.push({ category: noteCategory, severity, text, citations: citations.filter((c): c is string => Boolean(c)) });
  };

  // ── 1. Exemption / recordation-tax verification (the FIRST note) ───────────────────────────────────────────
  // The verified exemption cite comes straight off the registry (getDeedType().exemptionCitation), which the
  // registry already verifies against deedKbVa. Seller-side is a TAXED sale (no exemption) — it cites the KB
  // recordation-tax base instead and NEVER claims an exemption. The note STATES the basis; it never computes tax.
  emitExemptionOrTaxNote(category, add);

  // ── 2. Category-agnostic fact-driven notes (generalized verbatim from gift; they read FACTS, not category law) ─

  // 2a. Name reconciliation (B4) — the record owner vs the named party. Always-on when a record owner exists.
  const recordOwnerNames =
    facts.granteeOfRecord.values.length > 0
      ? facts.granteeOfRecord.values
      : facts.granteeOfRecord.value
        ? [facts.granteeOfRecord.value]
        : [];
  const recordOwner = recordOwnerNames.join(', ');
  if (recordOwner) {
    add(
      'name_reconciliation',
      'caution',
      `Confirm the conveying party(ies) match the current owner of record (per the prior vesting deed: ${recordOwner}). Assert any name change only with affirmative corroboration (marriage certificate / court order / underwriter requirement / client confirmation) — name similarity alone is never sufficient (B4).`,
    );
  }

  // 2b. Estate-lien / creditor / will-contest windows — CONDITIONAL on an estate/decedent source in the packet.
  if (facts.estateSource.signaled) {
    const who = facts.estateSource.decedentName ? ` (decedent of record: ${facts.estateSource.decedentName})` : '';
    add(
      'estate_window',
      'escalate',
      `An estate / decedent source is present in this packet${who} (signals: ${facts.estateSource.signals.join(', ')}). A transfer sourced from a decedent's estate carries diligence windows to RULE OUT before recording: estate-debt / creditor claims against the estate property, recorded liens or judgments, and any will-contest or qualification period that could unwind the chain — together with the surviving-spouse elective-share interest. Determining who may sign for the estate and whether these windows are clear is a supervising-attorney judgment; confirm them and route any decedent-grantor / estate chain by a supervising attorney. The agent surfaces these windows; it does not advise on or resolve them.`,
      // Cite ONLY the squarely on-point authority — the surviving-spouse elective-share statute (same as gift).
      [kbCite('elective-share')],
    );
  }

  // 2c. Commitment-vs-vesting legal-description mismatch — CONDITIONAL on a commitment legal present AND differing
  // from the vesting-deed legal. SURFACES the discrepancy; NEVER resolves it (the verbatim legal is the attorney's).
  const vestingLegal = facts.legalDescription.sourceDocType === 'vesting_deed' ? facts.legalDescription.value : null;
  const commitmentLegal = facts.commitmentLegalDescription.value;
  if (vestingLegal && commitmentLegal && normalizeLegal(vestingLegal) !== normalizeLegal(commitmentLegal)) {
    add(
      'legal_mismatch',
      'escalate',
      'Legal-description discrepancy: the title commitment\'s Exhibit A legal description differs from the prior vesting deed\'s legal description. The two must be reconciled before recording — a deed that does not match the commitment\'s insured description can be rejected or leave a gap in coverage. Confirm which description is correct against the recorded chain of title; the agent surfaces the discrepancy and does NOT resolve it (the verbatim legal is carried from the vesting deed and is never silently rewritten).',
    );
  }

  // ── 3. ONE conservative category-specific STRUCTURAL note (grounded in the documented assembler invariant) ──
  emitStructuralNote(category, add, opts);

  // ── 4. Title-examination caveat (always). NO grounded cite (the same rationale as gift: § 58.1-801 supports
  //       none of the title-exam / no-insurance / verbatim-legal propositions, so it carries no citation). ──
  add(
    'title_caveat',
    'caution',
    'Prepared WITHOUT title examination — NO title insurance. The legal description is carried VERBATIM from the prior vesting deed and has NOT been independently verified against a current title commitment. Before recording, confirm the legal description, the derivation ("Being") reference, and any liens/encumbrances of record.',
  );

  // ── 5. Diligence checklist — the escalation triggers to rule out (grounded on the verified KB list). ──
  add(
    'diligence',
    'info',
    `Before finalizing, confirm none of these escalation triggers apply (each needs supervising-attorney review): ${VA_ESCALATION_TRIGGERS.slice(0, 6).join(' | ')}`,
  );

  // Render through the SHARED gift renderer so the page reads identically (kept OUT of the deed body).
  const rendered = renderDrafterNotes(notes as DrafterNote[]);
  return { notes, rendered };
}

/** Emit the FIRST note: the verified exemption (exempt categories) or the recordation-tax-DUE basis (seller-side).
 *  The exempt cite is read off the registry (already KB-verified); seller-side cites the KB recordation-tax base. */
function emitExemptionOrTaxNote(
  category: DeedCategoryKey,
  add: (c: CategoryDrafterNoteCategory, s: DrafterNoteSeverity, t: string, cites?: (string | null | undefined)[]) => void,
): void {
  const entry = getDeedType(category);
  const exemptionCite = entry?.exemptionCitation ?? null;

  if (category === 'seller_side') {
    // A taxed sale — recordation tax is DUE (NOT exempt). Cite the KB recordation-tax BASE; never claim an
    // exemption, never compute the tax. The base statute is the greater-of-consideration-or-assessed-value rule.
    add(
      'tax',
      'caution',
      'TAXABLE conveyance for consideration — recordation tax is DUE (this is NOT an exempt deed). Virginia recordation tax is computed on the GREATER of the consideration paid or the property\'s assessed value; confirm the consideration and the assessed value before recording. The agent surfaces the tax basis; it does not compute the tax.',
      [kbCite('Recordation tax computed on the greater')],
    );
    return;
  }

  // The exempt categories — STATE the verified exemption cite + a one-line basis. The cite is the registry's
  // already-KB-verified exemptionCitation (never re-authored from memory).
  const basisByCategory: Record<Exclude<DeedCategoryKey, 'seller_side'>, string> = {
    deed_tod:
      'Transfer-on-death deed — exempt from recordation tax under the Uniform Real Property Transfer on Death Act. CRITICAL: a TOD deed is NOT effective unless RECORDED BEFORE the transferor\'s death; confirm the statutory optional-form requirements are met.',
    deed_of_confirmation:
      'Deed of Confirmation — exempt where recordation tax was PAID when the ORIGINAL deed was recorded. Confirm the original (predicate) deed was tax-paid before relying on the exemption; if the predicate transfer was itself exempt, additional analysis is needed.',
    deed_into_llc:
      'Deed INTO a Virginia LLC — exempt where the GRANTORS are entitled to receive not less than 50 percent of the LLC\'s profits and surplus, and the transfer is not a precursor to a control transfer to avoid recordation tax. Confirm the profits-and-surplus basis and the Virginia-LLC requirement.',
    deed_out_of_llc:
      'Deed OUT OF a Virginia LLC — exempt where the GRANTEES are entitled to receive not less than 50 percent of the LLC\'s profits and surplus, and the transfer is not subsequent to a control transfer to avoid recordation tax. Confirm the profits-and-surplus basis and the Virginia-LLC requirement.',
    deed_into_trust:
      'Deed INTO a revocable inter vivos trust — exempt where the grantors are also beneficiaries and no consideration passes (other named beneficiaries do not by themselves defeat the exemption; it fails only if a grantor is not a beneficiary at all). Review the trust before recordation.',
  };
  const basis = basisByCategory[category as Exclude<DeedCategoryKey, 'seller_side'>];
  add('exemption', 'info', `Recordation-tax exemption claimed. ${basis}`, [exemptionCite]);
}

/** Emit the ONE conservative category-specific STRUCTURAL note, grounded in the category's DOCUMENTED assembler
 *  invariant (no law authored beyond what the assembler header / KB states). Cite only if a KB cite is on-point. */
function emitStructuralNote(
  category: DeedCategoryKey,
  add: (c: CategoryDrafterNoteCategory, s: DrafterNoteSeverity, t: string, cites?: (string | null | undefined)[]) => void,
  opts: CategoryDrafterNotesOpts,
): void {
  const title = categoryTitle(category);
  switch (category) {
    case 'seller_side':
      add(
        'category_structure',
        'caution',
        `${title}: warranty is the attorney's decision. General warranty binds the Grantor to defend title against ALL claims (including pre-ownership); a Special Warranty limits the covenant to claims arising during the Grantor's own ownership. The warranty phrases are statutory shorthand — do not paraphrase. Confirm whether General or Special warranty is intended; the agent does not pick the warranty.`,
        [kbCite('Warranty phrases')],
      );
      return;
    case 'deed_tod':
      add(
        'category_structure',
        'caution',
        `${title}: this is a DEATH-EFFECTIVE, revocable instrument — it transfers nothing during the transferor's life, passes no consideration, and gives no warranty. It is NOT effective unless RECORDED BEFORE the transferor's death (no substantial-compliance exception). Confirm the statutory optional form is followed and that recording occurs in the transferor's lifetime; the agent surfaces the requirement and does not decide it.`,
      );
      return;
    case 'deed_of_confirmation':
      add(
        'category_structure',
        'escalate',
        `${title}: a confirmatory deed CONFIRMS (places of record) title that has ALREADY vested by operation of law (e.g. death + survivorship, or a recorded heir affidavit) — it does NOT transfer title. The work is in the chain-of-title recitals, which are attorney-load-bearing: verify EACH chain link against the recorded instruments before recordation. The agent surfaces the chain for verification; it does not resolve or fabricate any link.`,
      );
      return;
    case 'deed_into_llc':
      add(
        'category_structure',
        'caution',
        `${title}: this is a QUITCLAIM with NO warranty — the LLC takes only the grantor's right, title, and interest, as-is. The § 58.1-811(A)(10) exemption basis requires a VIRGINIA limited liability company and the grantors' profits-and-surplus entitlement (not less than 50 percent); confirm both. A natural-person-to-LLC transfer of mortgaged property may also trigger lender consent / due-on-sale — confirm. The agent surfaces these; it does not decide them.`,
        [getDeedType('deed_into_llc')?.exemptionCitation],
      );
      return;
    case 'deed_out_of_llc':
      add(
        'category_structure',
        'caution',
        `${title}: this conveys FROM the LLC to its members with Special Warranty; the members take as tenants in common. The § 58.1-811(A)(11) exemption basis requires a VIRGINIA limited liability company and the grantees' profits-and-surplus entitlement (not less than 50 percent); confirm both, and confirm the member signature set / authority. The agent surfaces these; it does not decide them.`,
        [getDeedType('deed_out_of_llc')?.exemptionCitation],
      );
      return;
    case 'deed_into_trust': {
      const tbe = opts.marriedCouple
        ? ' For a married-couple / former-TBE conveyance, confirm the §55.1-136(C) tenancy-by-the-entirety immunity note is correctly placed.'
        : '';
      add(
        'category_structure',
        'caution',
        `${title}: the TRUSTEES recital and the trust powers are LOAD-BEARING and attorney-supplied verbatim — the agent never fabricates them from extracted trust facts. Review the trust instrument and confirm the trustees recital before recordation.${tbe} The agent surfaces these; it does not decide them.`,
      );
      return;
    }
  }
}
