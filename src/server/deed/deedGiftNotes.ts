/**
 * deedGiftNotes.ts — DEED-DRAFT-AGENT-1 Inc 2: the DETERMINISTIC advisory / drafter's-notes layer for a
 * Deed of Gift (operator-confirmed deterministic architecture; NO LLM, no egress).
 *
 * Produces a structured "Drafter's Notes — delete before recording" set: deterministic exemption verification
 * + rule-based issue-spotting (spec §3.6 categories) + a diligence checklist, grounded on the verified VA KB
 * (deedKbVa). HARD RULE (spec §5/§7): NO hallucinated citations — every statutory cite is pulled from the
 * verified KB constants (VA_DEED_TYPES / VA_STATUTORY_CITATIONS / VA_EXEMPTIONS), never authored from memory;
 * an advisory note with no grounded cite simply carries no citation.
 *
 * The notes are SEPARATE from the recordable deed body (returned here, surfaced alongside the draft; "delete
 * before recording") — they are NEVER spliced into the version content, so the deed's B6 annotation-leak floor
 * stays clean. The attorney is the final decision-maker: these notes surface decision points + diligence; they
 * never pick warranty/structure and never auto-resolve anything.
 */

import { VA_DEED_TYPES, VA_STATUTORY_CITATIONS, VA_EXEMPTIONS, VA_ESCALATION_TRIGGERS } from './deedKbVa.js';
import type { DeedSourceFacts } from './deedSourceFacts.js';
import type { GiftDeedInput, GiftDeedDraft } from './deedGiftAssembler.js';

export type DrafterNoteSeverity = 'info' | 'caution' | 'escalate';
export type DrafterNoteCategory =
  | 'exemption'
  | 'entity_party'
  | 'gift_tax'
  | 'alternative'
  | 'tenancy'
  | 'name_reconciliation'
  | 'unresolved_facts'
  | 'title_caveat'
  | 'diligence';

export interface DrafterNote {
  category: DrafterNoteCategory;
  severity: DrafterNoteSeverity;
  text: string;
  /** Statutory citations — ONLY verified KB strings (deedKbVa); empty for a non-statutory advisory note. */
  citations: string[];
}

export interface GiftDrafterNotes {
  notes: DrafterNote[];
  /** A numbered, plain-text "DRAFTER'S NOTES — DELETE BEFORE RECORDING" section (kept OUT of the deed body). */
  rendered: string;
}

// ── KB citation lookups (the cite text is ALWAYS the verified KB string) ─────────

const GIFT = VA_DEED_TYPES.find((t) => t.key === 'gift');
const GIFT_EXEMPTION = GIFT?.exemptionCitation ?? 'Va. Code § 58.1-811(D)';

/** The verified statutory citation whose KB subject matches a keyword (e.g. "survivorship"); null if absent. */
function kbCite(subjectKeyword: string): string | null {
  const hit = VA_STATUTORY_CITATIONS.find((c) => c.subject.toLowerCase().includes(subjectKeyword.toLowerCase()));
  return hit ? hit.citation : null;
}
/** The verified exemption citation for a Va. Code subsection keyword (e.g. "transfer-on-death"); null if absent. */
function kbExemptionCite(keyword: string): string | null {
  const hit = VA_EXEMPTIONS.find((e) => e.transferType.toLowerCase().includes(keyword.toLowerCase()));
  return hit ? hit.citation : null;
}

// Entity designator detection (mirrors the assembler's scope rule): a non-individual party is out of the
// grounded gift-individual category and the exemption analysis differs (deedKbVa gift.notes).
const ENTITY_RE =
  /\b(?:LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Compan(?:y|ies)|Co\.|Ltd\.?|Limited|Trust|Trustees?|Partnership|Foundation|Association|Bank|& Sons|and Sons)\b/i;

function partyNames(input: GiftDeedInput): string[] {
  return [...input.grantors, ...input.grantees].map((p) => p.name);
}

/**
 * PURE: build the deterministic drafter's notes for a gift draft. Never throws; cites only from the KB.
 */
export function buildGiftDrafterNotes(
  facts: DeedSourceFacts,
  input: GiftDeedInput,
  draft: GiftDeedDraft,
): GiftDrafterNotes {
  const notes: DrafterNote[] = [];
  const add = (
    category: DrafterNoteCategory,
    severity: DrafterNoteSeverity,
    text: string,
    citations: (string | null | undefined)[] = [],
  ): void => {
    notes.push({ category, severity, text, citations: citations.filter((c): c is string => Boolean(c)) });
  };

  // 1. Exemption verification (the two-part P.D. 93-212 requirement the assembler structurally guarantees).
  add(
    'exemption',
    'info',
    'Gift recordation-tax exemption claimed. Two-part requirement (P.D. 93-212): the deed STATES on its face that it is a "Deed of Gift" AND the body uses "grant and convey" (not "grant, bargain, sell, and convey") — both are present in this draft. Failing either kills the exemption.',
    [GIFT_EXEMPTION],
  );

  // 2. Non-individual party -> escalate (the exemption analysis differs; deedKbVa gift.notes).
  const entityParties = partyNames(input).filter((n) => ENTITY_RE.test(n));
  if (entityParties.length > 0) {
    add(
      'entity_party',
      'escalate',
      `A non-individual party is named (${entityParties.join('; ')}). Run any non-individual grantor/grantee by a supervising attorney — the § 58.1-811(D) gift-exemption analysis differs for entities/trusts and may not apply.`,
      [GIFT_EXEMPTION],
    );
  }

  // 3. Gift tax / basis advisory (out-of-scope tax; surface, never compute — B5 / spec §3.6).
  add(
    'gift_tax',
    'caution',
    'A gift of real property may require a federal gift-tax return (IRS Form 709) if its value exceeds the annual exclusion, and the donee takes a CARRYOVER basis (no date-of-death step-up). Gift-tax/basis advice is OUTSIDE the deed engagement — advise the client to consult on the gift-tax and basis consequences.',
  );

  // 4. TODD alternative (retain control during life; record-before-death) — grounded.
  add(
    'alternative',
    'info',
    'If the client wishes to RETAIN ownership and control during life and pass the property at death instead of an inter-vivos gift, a Transfer on Death Deed is an alternative. A TODD is NOT effective unless recorded before the transferor\'s death.',
    [kbExemptionCite('transfer-on-death'), kbCite('Transfer on Death')].filter((c): c is string => Boolean(c)),
  );

  // 5. Tenancy / survivorship scope (driven by grantee count + marital flag).
  const granteeCount = input.grantees.length;
  if (granteeCount > 1) {
    if (input.granteesAreMarriedCouple === true) {
      add(
        'tenancy',
        'caution',
        'The married-couple grantees take as tenants by the entirety with the right of survivorship. TBE must be expressly written in (it is, in this draft) — confirm the grantees are in fact married.',
        [kbCite('tenants by the entirety')],
      );
    } else {
      add(
        'tenancy',
        'caution',
        'Multiple non-spouse grantees take as joint tenants with the right of survivorship. Survivorship is NOT implied in Virginia — absent the express survivorship language (present in this draft) they would take as tenants in common. Confirm the client intends survivorship.',
        [kbCite('survivorship')],
      );
    }
  }

  // 6. Name reconciliation (B4) — the record owner vs the named grantor.
  const recordOwner = facts.granteeOfRecord.value ?? facts.granteeOfRecord.values.join(', ');
  if (recordOwner && input.grantors.length > 0) {
    add(
      'name_reconciliation',
      'caution',
      `Confirm the Grantor(s) match the current owner of record (per the prior vesting deed: ${recordOwner}). Assert any name change only with affirmative corroboration (marriage certificate / court order / underwriter requirement / client confirmation) — name similarity alone is never sufficient (B4).`,
    );
  }

  // 7. Unresolved facts -> the draft cannot record until filled.
  if (draft.placeholders.length > 0) {
    add(
      'unresolved_facts',
      'caution',
      `${draft.placeholders.length} fact(s) are unresolved and MUST be filled before recording: ${draft.placeholders.map((p) => p.field).join('; ')}. The annotation-leak gate (B6) blocks recording while bracketed placeholders remain.`,
    );
  }

  // 8. No title examination caveat (always, for a gift).
  add(
    'title_caveat',
    'caution',
    'Prepared WITHOUT title examination — NO title insurance. The legal description is carried VERBATIM from the prior vesting deed and has NOT been verified against a current title commitment. Before recording, confirm the legal description, the derivation ("Being") reference, and any liens/encumbrances of record.',
    [kbCite('recordation tax')],
  );

  // 9. Diligence checklist — the escalation triggers to rule out (grounded on the verified KB list).
  add(
    'diligence',
    'info',
    `Before finalizing, confirm none of these escalation triggers apply (each needs supervising-attorney review): ${VA_ESCALATION_TRIGGERS.slice(0, 6).join(' | ')}`,
  );

  // ── render a numbered, plain-text notes page (kept OUT of the recordable deed body) ──
  const sevTag: Record<DrafterNoteSeverity, string> = { info: 'INFO', caution: 'CAUTION', escalate: 'ESCALATE' };
  const lines = notes.map((n, i) => {
    const cite = n.citations.length > 0 ? ` [${n.citations.join('; ')}]` : '';
    return `${i + 1}. (${sevTag[n.severity]}) ${n.text}${cite}`;
  });
  const rendered = [
    'DRAFTER\'S NOTES — DELETE BEFORE RECORDING',
    'These notes surface decision points and diligence for the supervising attorney; they are NOT part of the recordable instrument. The attorney is the final decision-maker.',
    '',
    ...lines,
  ].join('\n');

  return { notes, rendered };
}
