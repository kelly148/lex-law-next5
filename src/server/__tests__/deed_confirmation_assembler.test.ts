/**
 * deed_confirmation_assembler.test.ts — DEED-DRAFT-AGENT-1 category C1 (Deed of Confirmation) acceptance bar.
 *
 * NON-CIRCULAR: the GOLDEN inputs + expected deed bodies are READ from the committed, operator-authored fixture
 * pack (docs/deed/DEED_CAT_CONFIRMATION_fixture_pack.md) — the assembler must reproduce them byte-for-byte
 * (`toBe`). NEG fixtures must FAIL CLOSED ({ status: 'WITHHELD', flags, no deed }). The FIRE-watch guard cases
 * (incomplete devise chain, incomplete survivorship chain, truncated legal) mutate a valid GOLD base. Synthetic
 * data only (PII-free pack). A Deed of Confirmation confirms record title; it does NOT transfer (Grantor ===
 * Grantee).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  assembleConfirmationDeed,
  type DeedConfirmationInput,
} from '../deed/deedConfirmationAssembler.js';
import { DEED_TYPE_REGISTRY, getDeedType } from '../deed/deedTypeRegistry.js';
import { VA_EXEMPTIONS } from '../deed/deedKbVa.js';

const PACK = readFileSync(
  fileURLToPath(new URL('../../../docs/deed/DEED_CAT_CONFIRMATION_fixture_pack.md', import.meta.url)),
  'utf8',
);

/** Pull the JSON block that follows a "### <id> INPUT" sub-header. */
function grabInput(id: string): Record<string, any> {
  const i = PACK.indexOf(`### ${id} INPUT`);
  if (i < 0) throw new Error(`fixture input ${id} not found`);
  const m = PACK.slice(i).match(/```json\n([\s\S]*?)\n```/);
  if (!m) throw new Error(`fixture input JSON ${id} not found`);
  return JSON.parse(m[1]!) as Record<string, any>;
}

/** Pull the verbatim EXPECTED OUTPUT body that follows a "### <id> EXPECTED OUTPUT" sub-header. */
function grabExpected(id: string): string {
  const i = PACK.indexOf(`### ${id} EXPECTED OUTPUT`);
  if (i < 0) throw new Error(`fixture expected ${id} not found`);
  const m = PACK.slice(i).match(/```\n([\s\S]*?)\n```/);
  if (!m) throw new Error(`fixture expected body ${id} not found`);
  return m[1]!;
}

/** Map a GOLD fixture's snake_case consolidated-facts JSON onto the assembler input (camelCase). */
function toInput(j: Record<string, any>): DeedConfirmationInput {
  const out: DeedConfirmationInput = {
    archetype: j.archetype,
    exemptionCode: j.exemption_code,
    preparer: j.preparer,
    preparedNote: j.prepared_note,
    granteeReturnAddress: j.grantee_return_address,
    assessedValue: j.assessed_value,
    consideration: j.consideration,
    grantingDatePhrase: j.granting_month_year ?? j.granting_day_month_year,
    partyName: j.party_name,
    grantorGranteeSame: j.grantor_grantee_same,
    vesting: j.vesting,
    grantingVerb: j.granting_verb,
    warranty: j.warranty,
    locality: j.locality,
    legalDescription: j.legal_description,
    subjectTo: j.subject_to,
  };
  if (j.exemption_parenthetical !== undefined) out.exemptionParenthetical = j.exemption_parenthetical;
  if (j.tax_id !== undefined) out.taxId = j.tax_id;
  if (j.tax_map !== undefined) out.taxMap = j.tax_map;
  if (j.being_recital_prior_instrument !== undefined) out.beingRecitalPriorInstrument = j.being_recital_prior_instrument;
  if (j.being_recital_book_page !== undefined) out.beingRecitalBookPage = j.being_recital_book_page;
  if (j.tax_map_street_line !== undefined) out.taxMapStreetLine = j.tax_map_street_line;

  if (j.chain_of_title && j.archetype === 'C1-a-survivorship') {
    const c = j.chain_of_title;
    out.chainSurvivorship = {
      tookTitleAs: c.took_title_as,
      coOwners: c.co_owners,
      vestingDeedDate: c.vesting_deed_date,
      vestingDeedRecorded: c.vesting_deed_recorded,
      vestingInstrumentNumber: c.vesting_instrument_number,
      recordsCounty: c.records_county,
    };
  }
  if (j.decedent !== undefined) {
    out.decedent = { name: j.decedent.name, aka: j.decedent.aka, dateOfDeath: j.decedent.date_of_death };
  }
  if (j.chain_of_title && j.archetype === 'C1-b-testate-devise') {
    const c = j.chain_of_title;
    out.chainTestate = {
      originalGrantors: c.original_grantors,
      originalDeedDate: c.original_deed_date,
      originalDeedRecorded: c.original_deed_recorded,
      originalDeedBookPage: c.original_deed_book_page,
      originalGrantees: c.original_grantees,
      originalGranteesTenancy: c.original_grantees_tenancy,
    };
  }
  if (j.first_decedent !== undefined) {
    out.firstDecedent = {
      name: j.first_decedent.name,
      dateOfDeath: j.first_decedent.date_of_death,
      survivor: j.first_decedent.survivor,
    };
  }
  if (j.testator !== undefined) {
    out.testator = {
      name: j.testator.name,
      diedTestateDate: j.testator.died_testate_date,
      willDate: j.testator.will_date,
      probateCourt: j.testator.probate_court,
      fiduciaryNumber: j.testator.fiduciary_number,
      possessivePronoun: j.testator.possessive_pronoun,
      subjectPronoun: j.testator.subject_pronoun,
    };
  }
  if (j.devise !== undefined) {
    out.devise = {
      article: j.devise.article,
      devisee: j.devise.devisee,
      deviseeStatus: j.devise.devisee_status,
      deviseePossessive: j.devise.devisee_possessive,
      deviseeObject: j.devise.devisee_object,
    };
  }
  return out;
}

/** Extract every date-shaped token from a body (for the no-fabricated-date negative assertion). */
function extractDates(s: string): string[] {
  return s.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/g) ?? [];
}

const GOLD_IDS = ['G1', 'G2', 'G3'] as const;
const WHEREAS_COUNT: Record<string, number> = { G1: 3, G2: 5, G3: 3 };

describe('Confirmation (C1) — fixture pack parsed', () => {
  it('parses the 3 GOLDEN inputs + expected bodies and the 4 NEG inputs', () => {
    for (const id of GOLD_IDS) {
      expect(grabInput(id)).toBeTruthy();
      expect(grabExpected(id).length).toBeGreaterThan(200);
    }
    for (const id of ['N1', 'N2', 'N3', 'N4']) expect(grabInput(id)).toBeTruthy();
  });
});

describe('Confirmation (C1) — E0 S1/F2 independent-city locality', () => {
  it('renders "the City of <X>" when localityType is "city" (never "the County of <X>")', () => {
    const j = grabInput('G1');
    const result = assembleConfirmationDeed({ ...toInput(j), localityType: 'city' });
    expect(result.status).toBe('OK');
    const body = result.deed!.fullText;
    expect(body).toContain(`the City of ${j.locality}`);
    expect(body).not.toContain(`the County of ${j.locality}`);
  });

  it('the county path is unchanged (byte-identical): localityType omitted renders "the County of <X>"', () => {
    const j = grabInput('G1');
    const result = assembleConfirmationDeed(toInput(j));
    expect(result.deed!.fullText).toContain(`the County of ${j.locality}`);
  });
});

describe('Confirmation (C1) — GOLDEN fixtures reproduce the fixture pack exactly', () => {
  for (const id of GOLD_IDS) {
    it(`${id} — full body byte-for-byte + segment contract`, () => {
      const j = grabInput(id);
      const result = assembleConfirmationDeed(toInput(j));
      expect(result.status).toBe('OK');
      expect(result.deed).toBeDefined();
      const d = result.deed!;

      // Strongest: the entire assembled document equals the fixture's EXPECTED block (PART-3 master assertion).
      expect(d.fullText).toBe(grabExpected(id));

      // §0 / PART-3 per-segment exact-equality.
      expect(d.title).toBe('DEED OF CONFIRMATION');
      expect(d.legalDescription).toBe(j.legal_description); // verbatim, casing/spell-outs preserved
      expect(d.vesting).toBe('sole owner');
      expect(d.nowTherefore).toBe('NOW, THEREFORE, WITNESSETH:');

      // Exemption recital — the two house forms are NOT interchangeable; assert each verbatim.
      if (id === 'G2') {
        expect(d.exemptionLine).toBe('Exempt from recordation tax pursuant to Va. Code § 58.1-810(1)');
      } else {
        expect(d.exemptionLine).toBe('Exempt from recording tax pursuant to Sec 58.1-810(1), 1950 Code of Virginia');
      }

      // WHEREAS-link integrity — exactly the input chain length (no dropped / no fabricated link).
      expect((d.fullText.match(/WHEREAS/g) ?? []).length).toBe(WHEREAS_COUNT[id]);
      expect((d.whereasRecitals.match(/WHEREAS/g) ?? []).length).toBe(WHEREAS_COUNT[id]);

      // Negative-assertion family (GOLDEN output): no leftover placeholder; no fabricated probate data; the date
      // set in the output is a SUBSET of the input date set (no date the input did not supply).
      expect(d.fullText).not.toContain('[[');
      expect(d.fullText).not.toContain('58.1-811(A)(10)');
      const inputDates = new Set(JSON.stringify(j).match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/g) ?? []);
      for (const dt of extractDates(d.fullText)) expect(inputDates.has(dt)).toBe(true);
    });
  }

  it('G1/G3 (survivorship) — granting verb "grant and convey", warranty "...of title", same-person premise', () => {
    for (const id of ['G1', 'G3']) {
      const d = assembleConfirmationDeed(toInput(grabInput(id))).deed!;
      expect(d.grantingClause).toContain('grant and convey, with General Warranty and English Covenants of title');
      expect(d.grantingClause).not.toContain('grant, confirm, and convey');
      // Same person, party of the first part -> party of the second part.
      expect(d.premise).toContain('party of the first part, and');
      expect(d.premise).toContain('party of the second part;');
      // The survivorship WHEREAS chain shape.
      expect(d.whereasRecitals).toContain('took title to the subject property as joint tenants with the common law right of survivorship');
      expect(d.whereasRecitals).toContain('departed this life on or about');
      expect(d.whereasRecitals).toContain('by operation of law');
      // The "Also known as" corpus quirk (capital A) is reproduced.
      expect(d.whereasRecitals).toContain('Also known as');
    }
  });

  it('G2 (testate-devise) — granting verb "grant, confirm, and convey", warranty "...of Title", 5-link chain + BEING + advisory', () => {
    const r = assembleConfirmationDeed(toInput(grabInput('G2')));
    const d = r.deed!;
    expect(d.grantingClause).toContain('grant, confirm, and convey, with General Warranty and English Covenants of Title');
    // The longer testate/devise WHEREAS chain.
    expect(d.whereasRecitals).toContain('departed this life testate on');
    expect(d.whereasRecitals).toContain('admitted to probate');
    expect(d.whereasRecitals).toContain('as Fiduciary No. FI-2015-0002736');
    expect(d.whereasRecitals).toContain('is the sole residuary beneficiary and devisee');
    expect(d.whereasRecitals).toContain('title thereto vested in her as devisee upon the death of the Testator');
    expect(d.whereasRecitals).toContain('the Grantor desires by this Deed of Confirmation to confirm');
    // The BEING recital is present.
    expect(d.beingRecital).toContain('BEING the same real property conveyed unto');
    // Surface-not-decide advisory (non-blocking) emitted on the testate path.
    expect(r.advisories.some((a) => /DEED_OF_CONFIRMATION_DEVISE_ADVISORY/.test(a))).toBe(true);
    expect(r.advisories.some((a) => /confirmation — not estate administration — is the appropriate instrument/.test(a))).toBe(true);
  });

  it('the parties are IDENTICAL in every GOLDEN (Grantor === Grantee — confirms, does not transfer)', () => {
    for (const id of GOLD_IDS) {
      const j = grabInput(id);
      const d = assembleConfirmationDeed(toInput(j)).deed!;
      // The party name appears as both the first and the second part.
      const occurrences = (d.premise.match(new RegExp(j.party_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
      expect(occurrences).toBe(2);
    }
  });
});

describe('Confirmation (C1) — NEG fixtures fail closed (WITHHELD, exact flag, no deed)', () => {
  const NEG_FLAG: Record<string, string> = {
    N1: 'LEGAL_DESCRIPTION_INCOMPLETE',
    N2: 'PARTIES_NOT_IDENTICAL',
    N3: 'INCOMPLETE_DEVISE_CHAIN', // testate-devise with missing probate facts (pack's CHAIN_OF_TITLE_INCOMPLETE intent)
    N4: 'EXEMPTION_MISMATCH',
  };

  it('N1 — truncated legal description (ends mid-instrument-number) -> WITHHELD + LEGAL_DESCRIPTION_INCOMPLETE, no deed', () => {
    const j = grabInput('N1');
    const r = assembleConfirmationDeed(buildNegInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain(NEG_FLAG.N1);
    expect(r.deed).toBeUndefined();
    // Never fabricates the missing instrument number / a terminating period.
    expect(r.flags).not.toContain('OK');
  });

  it('N2 — parties not identical (father vs. son) -> WITHHELD + PARTIES_NOT_IDENTICAL, no deed', () => {
    const j = grabInput('N2');
    const r = assembleConfirmationDeed(buildNegInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain(NEG_FLAG.N2);
    expect(r.deed).toBeUndefined();
  });

  it('N3 — testate-devise missing probate FI / will date / devise article -> WITHHELD + INCOMPLETE_DEVISE_CHAIN, no deed, no invented FI', () => {
    const j = grabInput('N3');
    const r = assembleConfirmationDeed(buildNegInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain(NEG_FLAG.N3);
    expect(r.deed).toBeUndefined();
    // Fabricating a Fiduciary No. / will date / devise article is the single most dangerous failure mode — none emitted.
    expect(JSON.stringify(r)).not.toMatch(/FI-20\d{2}-\d{7}/);
    expect(JSON.stringify(r)).not.toMatch(/\bArticle [IVXLC]+\b/);
  });

  it('N4 — wrong exemption (58.1-811(A)(10) into-LLC pasted onto a confirmation) -> WITHHELD + EXEMPTION_MISMATCH, never emits the wrong cite', () => {
    const j = grabInput('N4');
    const r = assembleConfirmationDeed(buildNegInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain(NEG_FLAG.N4);
    expect(r.deed).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('58.1-811(A)(10)');
  });
});

/** Build an assembler input for a (sparse) NEG fixture over a valid base of the matching archetype, so each NEG
 *  isolates exactly the defect it targets (a complete base would otherwise fail closed for unrelated reasons). */
function buildNegInput(j: Record<string, any>): DeedConfirmationInput {
  const archetype = j.archetype as DeedConfirmationInput['archetype'];
  const baseId = archetype === 'C1-b-testate-devise' ? 'G2' : 'G1';
  const base = toInput(grabInput(baseId));
  const out: DeedConfirmationInput = { ...base, archetype };

  // N1 — truncated legal.
  if (j.legal_description_raw !== undefined) out.legalDescription = j.legal_description_raw;

  // N2 — distinct first/second part.
  if (j.party_of_first_part !== undefined) {
    out.partyOfFirstPart = j.party_of_first_part;
    out.partyOfSecondPart = j.party_of_second_part;
    out.partyName = j.party_of_first_part;
  }
  if (j.grantor_grantee_same !== undefined) out.grantorGranteeSame = j.grantor_grantee_same;
  if (j.party_name !== undefined) out.partyName = j.party_name;

  // N3 — testate-devise with [[MISSING]] probate facts (placeholders fail closed; never rendered as facts).
  if (j.testator !== undefined) {
    out.testator = {
      name: j.testator.name,
      diedTestateDate: j.testator.died_testate_date,
      willDate: j.testator.will_date,
      probateCourt: j.testator.probate_court,
      fiduciaryNumber: j.testator.fiduciary_number,
      possessivePronoun: j.testator.possessive_pronoun ?? base.testator!.possessivePronoun,
      subjectPronoun: j.testator.subject_pronoun ?? base.testator!.subjectPronoun,
    };
  }
  if (j.devise !== undefined) {
    out.devise = {
      article: j.devise.article,
      devisee: j.devise.devisee,
      deviseeStatus: j.devise.devisee_status ?? base.devise!.deviseeStatus,
      deviseePossessive: j.devise.devisee_possessive ?? base.devise!.deviseePossessive,
      deviseeObject: j.devise.devisee_object ?? base.devise!.deviseeObject,
    };
  }

  // N4 — a stray exemption code.
  if (j.exemption_code_supplied !== undefined) out.exemptionCode = j.exemption_code_supplied;

  return out;
}

describe('Confirmation (C1) — FIRE-watch guards (deterministic surface-not-decide; fail closed, never fabricate)', () => {
  const survBase = (): DeedConfirmationInput => toInput(grabInput('G1'));
  const testateBase = (): DeedConfirmationInput => toInput(grabInput('G2'));

  it('incomplete devise chain (blank Fiduciary No.) -> WITHHELD + INCOMPLETE_DEVISE_CHAIN, no deed', () => {
    const b = testateBase();
    const r = assembleConfirmationDeed({ ...b, testator: { ...b.testator!, fiduciaryNumber: '' } });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('INCOMPLETE_DEVISE_CHAIN');
    expect(r.deed).toBeUndefined();
  });

  it('incomplete devise chain (blank devise article) -> WITHHELD + INCOMPLETE_DEVISE_CHAIN', () => {
    const b = testateBase();
    const r = assembleConfirmationDeed({ ...b, devise: { ...b.devise!, article: '   ' } });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('INCOMPLETE_DEVISE_CHAIN');
    expect(r.deed).toBeUndefined();
  });

  it('incomplete devise chain (placeholder devisee name) -> WITHHELD + INCOMPLETE_DEVISE_CHAIN, no fabrication', () => {
    const b = testateBase();
    const r = assembleConfirmationDeed({ ...b, devise: { ...b.devise!, devisee: '[[MISSING — devisee]]' } });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('INCOMPLETE_DEVISE_CHAIN');
    expect(r.deed).toBeUndefined();
  });

  it('incomplete survivorship chain (blank decedent death date) -> WITHHELD + INCOMPLETE_SURVIVORSHIP_CHAIN', () => {
    const b = survBase();
    const r = assembleConfirmationDeed({ ...b, decedent: { ...b.decedent!, dateOfDeath: '' } });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('INCOMPLETE_SURVIVORSHIP_CHAIN');
    expect(r.deed).toBeUndefined();
  });

  it('incomplete survivorship chain (missing prior-instrument BEING reference) -> WITHHELD + INCOMPLETE_SURVIVORSHIP_CHAIN', () => {
    const b = survBase();
    const r = assembleConfirmationDeed({ ...b, beingRecitalPriorInstrument: '' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('INCOMPLETE_SURVIVORSHIP_CHAIN');
    expect(r.deed).toBeUndefined();
  });

  it('incomplete survivorship chain (only one co-owner supplied) -> WITHHELD + INCOMPLETE_SURVIVORSHIP_CHAIN', () => {
    const b = survBase();
    const r = assembleConfirmationDeed({ ...b, chainSurvivorship: { ...b.chainSurvivorship!, coOwners: ['Marcus Delacroix'] } });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('INCOMPLETE_SURVIVORSHIP_CHAIN');
    expect(r.deed).toBeUndefined();
  });

  it('truncated legal (condo cut mid-amendment, ends on a period) -> WITHHELD + LEGAL_DESCRIPTION_INCOMPLETE', () => {
    const b = survBase();
    const r = assembleConfirmationDeed({
      ...b,
      legalDescription:
        'Condominium Unit No. 9, of THE WINDERMERE, A CONDOMINIUM, as established by the Declaration recorded in Deed Book 2188 at Page 0451, and by First Amendment recorded in Deed Book 2201 at Page 0907.',
    });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('LEGAL_DESCRIPTION_INCOMPLETE');
    expect(r.deed).toBeUndefined();
  });

  it('truncated legal (no terminating period) -> WITHHELD + LEGAL_DESCRIPTION_INCOMPLETE', () => {
    const b = survBase();
    const r = assembleConfirmationDeed({ ...b, legalDescription: 'Lot 47, STONEBRIAR MEADOWS, Phase 2, recorded in Deed Book 1987 at Page' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('LEGAL_DESCRIPTION_INCOMPLETE');
    expect(r.deed).toBeUndefined();
  });

  // ── Fix 1: the BEING-recital testator subject pronoun is parameterized, not a literal "he" ──
  it('female testator: the BEING recital renders the attorney-supplied subject pronoun ("she"), never a literal "he"', () => {
    const b = testateBase();
    // A female-testator / female-survivor matter: rename the testator + first-decedent survivor and flip pronouns.
    const r = assembleConfirmationDeed({
      ...b,
      firstDecedent: { ...b.firstDecedent!, name: 'George T. Penhallow', survivor: 'Margaret S. Penhallow' },
      testator: { ...b.testator!, name: 'Margaret S. Penhallow', possessivePronoun: 'her', subjectPronoun: 'she' },
    });
    expect(r.status).toBe('OK');
    const d = r.deed!;
    expect(d.beingRecital).toContain('whereby she became sole owner by survivorship');
    expect(d.beingRecital).toContain('of her Last Will and Testament');
    expect(d.beingRecital).not.toContain('whereby he became sole owner');
    // No hardcoded gendered word leaked: the masculine literal must be absent from the female-matter BEING recital.
    expect(d.fullText).not.toContain('whereby he became sole owner');
  });

  it('the G2 GOLD (male testator) still renders "whereby he became sole owner" from its subject pronoun "he"', () => {
    const d = assembleConfirmationDeed(testateBase()).deed!;
    expect(d.beingRecital).toContain('whereby he became sole owner by survivorship');
    expect(d.beingRecital).toContain('of his Last Will and Testament');
  });

  it('blank testator subject pronoun -> WITHHELD + INCOMPLETE_DEVISE_CHAIN (a rendered pronoun must be attorney-supplied)', () => {
    const b = testateBase();
    const r = assembleConfirmationDeed({ ...b, testator: { ...b.testator!, subjectPronoun: '' } });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('INCOMPLETE_DEVISE_CHAIN');
    expect(r.deed).toBeUndefined();
  });

  // ── Fix 2: survivor must be UNAMBIGUOUS; no silent owners[0] default on a decedent-name mismatch ──
  it('survivorship decedent name matching NO co-owner (ambiguous) -> WITHHELD + INCOMPLETE_SURVIVORSHIP_CHAIN, no deed', () => {
    const b = survBase();
    // Decedent "Helene M. Quintero" does not string-equal either co-owner ("...Delacroix"/"Helene Quintero").
    const r = assembleConfirmationDeed({ ...b, decedent: { ...b.decedent!, name: 'Helene M. Quintero' } });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('INCOMPLETE_SURVIVORSHIP_CHAIN');
    expect(r.deed).toBeUndefined();
  });

  it('survivorship decedent name matching BOTH co-owners (ambiguous duplicate) -> WITHHELD + INCOMPLETE_SURVIVORSHIP_CHAIN', () => {
    const b = survBase();
    const r = assembleConfirmationDeed({
      ...b,
      chainSurvivorship: { ...b.chainSurvivorship!, coOwners: ['Helene Quintero', 'Helene Quintero'] },
      decedent: { ...b.decedent!, name: 'Helene Quintero' },
    });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('INCOMPLETE_SURVIVORSHIP_CHAIN');
    expect(r.deed).toBeUndefined();
  });

  it('normal G1 (exactly one decedent match) -> OK with the correct survivor named (not the decedent, not owners[0] by default)', () => {
    const d = assembleConfirmationDeed(survBase()).deed!;
    // The surviving sole owner is Marcus Delacroix; the operation-of-law WHEREAS must name him, not the decedent.
    expect(d.whereasRecitals).toContain('by operation of law Marcus Delacroix became the sole owner');
    expect(d.whereasRecitals).not.toContain('by operation of law Helene Quintero became the sole owner');
  });

  it('an explicit attorney-supplied survivorName is honored (and resolves an otherwise-ambiguous mismatch)', () => {
    const b = survBase();
    const r = assembleConfirmationDeed({
      ...b,
      decedent: { ...b.decedent!, name: 'Helene M. Quintero' }, // matches no co-owner
      survivorName: 'Marcus Delacroix',
    });
    expect(r.status).toBe('OK');
    expect(r.deed!.whereasRecitals).toContain('by operation of law Marcus Delacroix became the sole owner');
  });
});

describe('Confirmation (C1) — registry + verified cite', () => {
  it('registered in the deed-type registry as available', () => {
    const e = getDeedType('deed_of_confirmation');
    expect(e).toBeDefined();
    expect(e!.status).toBe('available');
    expect(e!.exemptionCitation).toBe('Va. Code § 58.1-810(1)');
    expect(DEED_TYPE_REGISTRY.some((d) => d.key === 'deed_of_confirmation')).toBe(true);
  });

  it('the § 58.1-810(1) confirmation exemption cite is in the verified KB (no-hallucination guard)', () => {
    const c = VA_EXEMPTIONS.find((e) => e.citation === 'Va. Code § 58.1-810(1)');
    expect(c).toBeDefined();
    expect(c!.transferType).toMatch(/Deed of confirmation/);
  });
});
