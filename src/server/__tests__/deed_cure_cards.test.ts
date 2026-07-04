/**
 * deed_cure_cards — UB1-W3b-2. Proves the #484 ratified condition: every S5 Confirmation-survivorship
 * gate/withhold surfaces a plain-English cure card (what's missing/mismatched, WHICH field, fix-and-regenerate),
 * never a silent or bare-code withhold — and it never fabricates the missing fact (the gate stays fail-closed).
 *
 * Covers each S5 survivorship gate class + a coverage guard that EVERY Confirmation-assembler flag has a
 * hand-authored card, + the humanized fallback (an unknown flag can never surface as a raw code).
 */
import { describe, it, expect } from 'vitest';
import { deedCureCards, CURE_CARD_KNOWN_FLAGS } from '../deed/deedCureCards.js';
import { assembleConfirmationDeed, type DeedConfirmationInput } from '../deed/deedConfirmationAssembler.js';

// The flag vocabulary the Confirmation assembler (S5 survivorship + siblings) can emit — kept in lockstep with
// deedConfirmationAssembler.ts. Every one MUST have a hand-authored cure card so no gate surfaces a bare code.
const CONFIRMATION_ASSEMBLER_FLAGS = [
  'UNVERIFIED_EXEMPTION_CITE',
  'EXEMPTION_MISMATCH',
  'PARTIES_NOT_IDENTICAL',
  'LEGAL_DESCRIPTION_INCOMPLETE',
  'INCOMPLETE_DEVISE_CHAIN',
  'INCOMPLETE_SURVIVORSHIP_CHAIN',
  'SURVIVORSHIP_UNSUPPORTED_OWNER_COUNT',
  'SURVIVORSHIP_TENANCY_NOT_SURVIVORSHIP',
] as const;

// The three S5 survivorship gate classes (the #484 named condition), with the field each cure card must name.
const S5_GATE_CLASSES: Array<{ flag: string; field: string }> = [
  { flag: 'INCOMPLETE_SURVIVORSHIP_CHAIN', field: 'Survivorship chain (co-owners, decedent, and vesting deed)' },
  { flag: 'SURVIVORSHIP_UNSUPPORTED_OWNER_COUNT', field: 'Co-owners' },
  { flag: 'SURVIVORSHIP_TENANCY_NOT_SURVIVORSHIP', field: 'Took title as' },
];

describe('deedCureCards — every S5 survivorship gate class surfaces a plain-English, field-specific cure card', () => {
  for (const { flag, field } of S5_GATE_CLASSES) {
    it(`${flag} -> cure card naming "${field}" with plain-English problem + fix-and-regenerate (never a bare code)`, () => {
      const cards = deedCureCards([flag]);
      expect(cards).toHaveLength(1);
      const card = cards[0]!;
      expect(card.flag).toBe(flag);
      expect(card.field).toBe(field); // WHICH field to fix
      expect(card.problem.length).toBeGreaterThan(20); // plain-English "what's wrong"
      expect(card.fix.length).toBeGreaterThan(20); // plain-English "how to fix"
      expect(card.fix.toLowerCase()).toContain('regenerate'); // fix-and-regenerate in place
      expect(card.problem).not.toContain(flag); // never surface the raw machine code
      expect(card.field).not.toBe('The flagged fact'); // a real, hand-authored card, not the fallback
    });
  }
});

describe('deedCureCards — coverage + fallback (never a silent or opaque withhold)', () => {
  it('every Confirmation-assembler flag has a hand-authored (non-fallback) cure card', () => {
    for (const flag of CONFIRMATION_ASSEMBLER_FLAGS) {
      expect(CURE_CARD_KNOWN_FLAGS).toContain(flag);
      const card = deedCureCards([flag])[0]!;
      expect(card.field).not.toBe('The flagged fact'); // hand-authored, not the generic fallback
      expect(card.problem.length).toBeGreaterThan(20);
      expect(card.fix.length).toBeGreaterThan(20);
    }
  });

  it('an unknown flag degrades to a humanized card — never a bare machine code', () => {
    const card = deedCureCards(['SOME_FUTURE_UNKNOWN_FLAG'])[0]!;
    expect(card.flag).toBe('SOME_FUTURE_UNKNOWN_FLAG');
    expect(card.field).toBe('The flagged fact');
    expect(card.problem).toContain('some future unknown flag'); // humanized, not the raw SNAKE_CASE
    expect(card.fix.toLowerCase()).toContain('regenerate');
  });

  it('dedups repeated flags and preserves order; empty -> no cards', () => {
    expect(deedCureCards(['PARTIES_NOT_IDENTICAL', 'EXEMPTION_MISMATCH', 'PARTIES_NOT_IDENTICAL']).map((c) => c.flag))
      .toEqual(['PARTIES_NOT_IDENTICAL', 'EXEMPTION_MISMATCH']);
    expect(deedCureCards([])).toEqual([]);
  });
});

describe('deedCureCards — end-to-end from the real S5 gate (assembler WITHHELD -> cure cards)', () => {
  // A minimal C1-a survivorship input with NO chain facts: the assembler fails closed with the survivorship flag.
  const minimalSurvivorship: DeedConfirmationInput = {
    archetype: 'C1-a-survivorship',
    exemptionCode: '58.1-810(1)',
    partyName: 'Marcus T. ELLISON',
    vesting: 'sole owner',
    grantingVerb: 'grant and convey',
    warranty: 'General Warranty and English Covenants of title',
    subjectTo: 'covenants, conditions, restrictions, easements and rights of way of record',
    legalDescription: 'Lot 12, Section 3, CEDAR RUN ESTATES, among the Land Records of Prince William County, Virginia.',
    preparer: 'The Mason Law Firm, PLC',
    preparedNote: 'Prepared without the benefit of a title examination.',
    consideration: '$0.00 (confirmatory)',
    grantingDatePhrase: 'March, 2026',
  } as unknown as DeedConfirmationInput;

  it('a survivorship confirmation missing its chain is WITHHELD, and every returned flag maps to a real cure card', () => {
    const r = assembleConfirmationDeed(minimalSurvivorship);
    expect(r.status).toBe('WITHHELD');
    expect(r.deed).toBeUndefined(); // fail-closed: no fabricated recital
    expect(r.flags.length).toBeGreaterThan(0);
    const cards = deedCureCards(r.flags);
    expect(cards.length).toBe(new Set(r.flags).size);
    // Every card is plain-English and names a field — none surfaces a bare code.
    for (const c of cards) {
      expect(c.field.length).toBeGreaterThan(0);
      expect(c.problem.length).toBeGreaterThan(10);
      expect(c.fix.length).toBeGreaterThan(10);
    }
    // The core survivorship gate is present with its hand-authored card.
    expect(r.flags).toContain('INCOMPLETE_SURVIVORSHIP_CHAIN');
    expect(cards.find((c) => c.flag === 'INCOMPLETE_SURVIVORSHIP_CHAIN')!.field)
      .toBe('Survivorship chain (co-owners, decedent, and vesting deed)');
  });
});
