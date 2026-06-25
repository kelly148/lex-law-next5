/**
 * deed_tod_assembler.test.ts — DEED-DRAFT-AGENT-1 category C5 (Revocable Transfer on Death Deed) acceptance bar.
 *
 * NON-CIRCULAR: the GOLDEN inputs + expected deed bodies are READ from the committed, operator-authored fixture
 * pack (docs/deed/DEED_CAT_TOD_fixture_pack.md) — the assembler must reproduce them byte-for-byte (`toBe`). NEG
 * fixtures must FAIL CLOSED ({ status: 'WITHHELD', flags, no deed }), except N4 (a positive hyphenated-name
 * integrity assertion). Synthetic data only (PII-free pack).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { assembleTodDeed, type DeedTodInput } from '../deed/deedTodAssembler.js';
import { DEED_TYPE_REGISTRY, getDeedType } from '../deed/deedTypeRegistry.js';
import { VA_EXEMPTIONS } from '../deed/deedKbVa.js';

const PACK = readFileSync(
  fileURLToPath(new URL('../../../docs/deed/DEED_CAT_TOD_fixture_pack.md', import.meta.url)),
  'utf8',
);

interface Section { title: string; input: Record<string, unknown> | null; expectedDeed: string | null }

function parsePack(md: string): Section[] {
  return md.split('\n### ').slice(1).map((seg) => {
    const title = seg.split('\n')[0]!.trim();
    const jsonM = seg.match(/```json\n([\s\S]*?)\n```/);
    const deedM = seg.match(/\*\*EXPECTED ASSEMBLED DEED[\s\S]*?\n```\n([\s\S]*?)\n```/);
    return {
      title,
      input: jsonM ? (JSON.parse(jsonM[1]!) as Record<string, unknown>) : null,
      expectedDeed: deedM ? deedM[1]! : null,
    };
  });
}

/** Map the fixture's snake_case consolidated-facts JSON onto the assembler input (camelCase). */
function toInput(j: Record<string, any>): DeedTodInput {
  const out: DeedTodInput = {
    preparer: j.preparer,
    returnTo: j.return_to,
    taxId: j.tax_id,
    deedDatePhrase: j.deed_date_phrase,
    transferor: { name: j.transferor?.name, capacity: j.transferor?.capacity },
    propertyAddress: j.property_address,
    taxMapReference: j.tax_map_reference,
    legalDescription: j.legal_description,
    acknowledgmentMonthYear: j.acknowledgment_month_year,
  };
  if (j.grantee_named_in_premise !== undefined) out.granteeNamedInPremise = j.grantee_named_in_premise;
  if (j.grantee_premise_name !== undefined) out.granteePremiseName = j.grantee_premise_name;
  if (j.primary_beneficiaries !== undefined) {
    out.primaryBeneficiaries = {
      persons: j.primary_beneficiaries.persons,
      vesting: j.primary_beneficiaries.vesting,
      relationship: j.primary_beneficiaries.relationship ?? null,
    };
  }
  if (j.primary_beneficiary !== undefined) {
    out.primaryBeneficiary = {
      person: j.primary_beneficiary.person,
      relationship: j.primary_beneficiary.relationship,
      designation: j.primary_beneficiary.designation,
      trust: j.primary_beneficiary.trust,
      vesting: j.primary_beneficiary.vesting,
      commonlyKnownAs: j.primary_beneficiary.commonly_known_as,
    };
  }
  if (j.legal_description_preamble !== undefined) out.legalDescriptionPreamble = j.legal_description_preamble;
  if (j.condo_subject_to !== undefined) out.condoSubjectTo = j.condo_subject_to;
  if (j.derivation_of_title !== undefined) out.derivationOfTitle = j.derivation_of_title;
  if (j.being_recital !== undefined) out.beingRecital = j.being_recital;
  if (j.assessed_value !== undefined) out.assessedValue = j.assessed_value;
  if (j.prepared_without_title_exam !== undefined) out.preparedWithoutTitleExam = j.prepared_without_title_exam;
  if (j.notary_county_blank !== undefined) out.notaryCountyBlank = j.notary_county_blank;
  if (j.notary_city !== undefined) out.notaryCity = j.notary_city;
  if (j.revocation_block !== undefined) out.revocationBlock = j.revocation_block;
  return out;
}

const sections = parsePack(PACK);
const golds = sections.filter((s) => s.title.startsWith('GOLDEN'));
const negs = sections.filter((s) => s.title.startsWith('NEG'));
const byPrefix = (p: string): Section => {
  const s = sections.find((x) => x.title.startsWith(p));
  if (!s) throw new Error(`fixture ${p} not found`);
  return s;
};

describe('TOD (C5) — fixture pack parsed', () => {
  it('parsed 3 GOLDEN + 4 NEG fixtures from the pack', () => {
    expect(golds.length).toBe(3);
    expect(negs.length).toBe(4);
  });
});

describe('TOD (C5) — GOLDEN fixtures reproduce the fixture pack exactly', () => {
  for (const g of golds) {
    it(`${g.title.slice(0, 28)} — full body byte-for-byte + segment contract`, () => {
      const j = g.input as Record<string, any>;
      const result = assembleTodDeed(toInput(j));
      expect(result.status).toBe('OK');
      expect(result.recordableFloorOk).toBe(true); // S3 in-module B6 + format floor
      expect(result.deed).toBeDefined();
      const d = result.deed!;

      // Strongest: the entire assembled document equals the fixture's EXPECTED block.
      expect(d.fullText).toBe(g.expectedDeed);

      // SECTION-3 fixed recitals (verbatim).
      expect(d.exemptionLine).toBe('THIS DEED IS EXEMPT FROM RECORDATION TAXES PURSUANT TO § 58.1-811(J) Va. Code.');
      expect(d.title).toBe('REVOCABLE TRANSFER ON DEATH DEED');
      expect(d.actRecital).toBe(
        'This Revocable Transfer on Death Deed is made pursuant to the provisions of the Uniform Real Property Transfer on Death Act, Virginia Code § 64.2-621 et seq. In accordance with the provisions of the Uniform Real Property Transfer on Death Act, at my death, I transfer and convey my interest in the below described property to my designated beneficiaries as follows:',
      );
      // The revocation block carries the curly apostrophes + the triple space ("office   of the circuit court").
      expect(d.revocationBlock).toContain('clerk’s office   of the circuit court');
      expect(d.revocationBlock).toContain('transferor’s death');
      expect(d.revocationBlock).toContain('(a).');
      expect(d.revocationBlock).toContain('(b).');
      expect(d.revocationBlock).toContain('(c).');
      expect(d.revocationBlock).toContain('(d).');

      // Legal description verbatim.
      expect(d.legalDescription).toBe(j.legal_description.trim());
    });
  }

  it('G1 — multiple individuals: plural heading, JTWROS vesting, no Grantee, hyphenated name intact', () => {
    const j = byPrefix('GOLDEN G1').input as Record<string, any>;
    const d = assembleTodDeed(toInput(j)).deed!;
    expect(d.beneficiaryHeading).toBe('PRIMARY BENEFICIARIES');
    expect(d.vesting).toBe('joint tenants with the common law right of survivorship');
    expect(d.beneficiaries).toEqual(['Daniel HOLLOWAY', 'Rebecca HOLLOWAY-MERCER', 'Theodore HOLLOWAY']);
    expect(d.beingRecital).toBe(j.being_recital.trim());
    // No fabricated Grantee party in a no-grantee premise.
    expect(d.premise).not.toMatch(/Grantee/);
    expect(d.fullText).not.toMatch(/Grantee/);
    // Hyphenated surname integrity.
    expect(d.fullText).toContain('HOLLOWAY-MERCER');
    expect(d.fullText).not.toMatch(/HOLLOWAY MERCER/);
  });

  it('G2 — single individual "my daughter": singular heading, sole owner, Grantee named, condo subject-to', () => {
    const j = byPrefix('GOLDEN G2').input as Record<string, any>;
    const d = assembleTodDeed(toInput(j)).deed!;
    expect(d.beneficiaryHeading).toBe('PRIMARY BENEFICIARY');
    expect(d.vesting).toBe('sole owner');
    expect(d.beneficiaries).toEqual(['Olivia Grace ABERNATHY']);
    // "commonly known" WITHOUT "as" (corpus quirk reproduced verbatim).
    expect(d.beneficiaryDesignation).toContain('commonly known 5125 N WAKEFIELD');
    expect(d.beneficiaryDesignation).not.toContain('commonly known as 5125');
    // Grantee named in the premise.
    expect(d.premise).toBe(
      'THIS REVOCABLE TRANSFER ON DEATH DEED, dated as of the __________ day of October 2025, is made by Patricia L. ABERNATHY, unmarried, Grantor, whose address is 5125 N WAKEFIELD ST UNIT 312 ARLINGTON VA 22207, and Olivia Grace ABERNATHY, Grantee.',
    );
    expect(d.condoSubjectTo).toBe(j.condo_subject_to.trim());
    expect(d.derivationOfTitle).toBe(j.derivation_of_title.trim());
  });

  it('G3 — trust / successor-trustee: plural heading even with one beneficiary, no Grantee', () => {
    const j = byPrefix('GOLDEN G3').input as Record<string, any>;
    const d = assembleTodDeed(toInput(j)).deed!;
    expect(d.beneficiaryHeading).toBe('PRIMARY BENEFICIARIES');
    expect(d.vesting).toBe('joint tenants with the common law right of survivorship');
    expect(d.beneficiaries).toEqual(['THE GERALD R. WINSTEAD TRUST AGREEMENT, DATED FEBRUARY 14, 2021']);
    // The "designate as my Primary Beneficiary as the Successor Trustee…" phrasing (corpus quirk).
    expect(d.beneficiaryDesignation).toContain('designate as my Primary Beneficiary as the Successor Trustee of my revocable trust');
    expect(d.premise).not.toMatch(/Grantee/);
    expect(d.fullText).not.toMatch(/Grantee/);
  });
});

describe('TOD (C5) — NEG fixtures fail closed / integrity', () => {
  it('N1 — truncated condo legal → WITHHELD + LEGAL_DESCRIPTION_TRUNCATED + CONDO_SUBJECT_TO_MISSING, no deed', () => {
    const j = byPrefix('NEG N1').input as Record<string, any>;
    const r = assembleTodDeed(toInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('LEGAL_DESCRIPTION_TRUNCATED');
    expect(r.flags).toContain('CONDO_SUBJECT_TO_MISSING');
    expect(r.deed).toBeUndefined();
  });

  it('N2 — garbled revocation block (missing (c)/item 2/trailers) → WITHHELD + REVOCATION_BLOCK_INCOMPLETE, no deed', () => {
    const j = byPrefix('NEG N2').input as Record<string, any>;
    const r = assembleTodDeed(toInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('REVOCATION_BLOCK_INCOMPLETE');
    expect(r.deed).toBeUndefined();
  });

  it('N3 — malformed ZIP "VA 2230.1" → WITHHELD + ADDRESS_ZIP_MALFORMED, suggests 22301, never emits the bad value', () => {
    const j = byPrefix('NEG N3').input as Record<string, any>;
    const r = assembleTodDeed(toInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('ADDRESS_ZIP_MALFORMED');
    expect(r.advisories.some((a) => a.includes('22301'))).toBe(true);
    // The malformed ZIP must never reach an authoritative deed, and the suggested-normalization advisory must
    // surface the *normalized* value, never echo the malformed one.
    expect(r.deed).toBeUndefined();
    expect(r.advisories.join('\n')).not.toMatch(/\b2230\.1\b/);
  });

  it('N4 — hyphenated surname captured intact (positive; over a valid G1-style base)', () => {
    const base = byPrefix('GOLDEN G1').input as Record<string, any>;
    const n4 = byPrefix('NEG N4').input as Record<string, any>;
    // Merge the N4 beneficiary set over a complete, valid base so a deed is produced.
    const merged = { ...base, transferor: n4.transferor, primary_beneficiaries: n4.primary_beneficiaries };
    const r = assembleTodDeed(toInput(merged));
    expect(r.status).toBe('OK');
    const d = r.deed!;
    // The hyphenated surname is a SINGLE beneficiary token, not split across two.
    expect(d.beneficiaries).toContain('Rebecca HOLLOWAY-MERCER');
    expect(d.beneficiaries).toEqual(['Daniel HOLLOWAY', 'Rebecca HOLLOWAY-MERCER', 'Theodore HOLLOWAY']);
    expect(d.fullText).toContain('HOLLOWAY-MERCER');
    expect(d.fullText).not.toMatch(/HOLLOWAY MERCER/);
  });
});

describe('TOD (C5) — hardening guards (adversarial-review fixes)', () => {
  // A complete, valid single-individual-list base (GOLD G1) to mutate per case.
  const base = (): Record<string, any> => ({ ...(byPrefix('GOLDEN G1').input as Record<string, any>) });

  it('empty persons array -> WITHHELD + NO_BENEFICIARY_DESIGNATED, no deed', () => {
    const j = { ...base(), primary_beneficiaries: { persons: [], vesting: 'joint tenants with the common law right of survivorship', relationship: null } };
    const r = assembleTodDeed(toInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('NO_BENEFICIARY_DESIGNATED');
    expect(r.deed).toBeUndefined();
  });

  it('persons array of only blank/whitespace tokens -> WITHHELD + NO_BENEFICIARY_DESIGNATED', () => {
    const j = { ...base(), primary_beneficiaries: { persons: ['', '   '], vesting: 'sole owner', relationship: null } };
    const r = assembleTodDeed(toInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('NO_BENEFICIARY_DESIGNATED');
    expect(r.deed).toBeUndefined();
  });

  it('a single primary_beneficiary with a relationship but blank person -> WITHHELD + NO_BENEFICIARY_DESIGNATED', () => {
    const b = base();
    delete b.primary_beneficiaries;
    delete b.being_recital;
    const j = { ...b, primary_beneficiary: { person: '', relationship: 'my daughter', vesting: 'sole owner' } };
    const r = assembleTodDeed(toInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('NO_BENEFICIARY_DESIGNATED');
    expect(r.deed).toBeUndefined();
  });

  it('missing transferor name -> WITHHELD + TRANSFEROR_MISSING and does NOT throw', () => {
    const j = { ...base(), transferor: { name: '', capacity: 'surviving joint tenant' } };
    expect(() => assembleTodDeed(toInput(j))).not.toThrow();
    const r = assembleTodDeed(toInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('TRANSFEROR_MISSING');
    expect(r.deed).toBeUndefined();
  });

  it('absent transferor object -> WITHHELD + TRANSFEROR_MISSING and does NOT throw', () => {
    const j = base();
    delete j.transferor;
    // toInput will produce transferor:{ name: undefined, capacity: undefined } — must still fail closed.
    expect(() => assembleTodDeed(toInput(j))).not.toThrow();
    const r = assembleTodDeed(toInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('TRANSFEROR_MISSING');
    expect(r.deed).toBeUndefined();
  });

  it('a stray-period ZIP in the return_to header line -> WITHHELD + ADDRESS_ZIP_MALFORMED, no deed', () => {
    const j = { ...base(), return_to: '4490 Heronwood Court, Reston, VA 2019.4' };
    const r = assembleTodDeed(toInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('ADDRESS_ZIP_MALFORMED');
    expect(r.advisories.some((a) => a.includes('20194'))).toBe(true);
    expect(r.deed).toBeUndefined();
  });

  it('a stray-period ZIP in a named grantee premise -> WITHHELD + ADDRESS_ZIP_MALFORMED', () => {
    const j = { ...base(), grantee_named_in_premise: true, grantee_premise_name: 'Olivia ABERNATHY, 100 Main St, Reston, VA 2019.4' };
    const r = assembleTodDeed(toInput(j));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('ADDRESS_ZIP_MALFORMED');
    expect(r.deed).toBeUndefined();
  });
});

describe('TOD (C5) — registry + verified cite', () => {
  it('registered in the deed-type registry as available', () => {
    const e = getDeedType('deed_tod');
    expect(e).toBeDefined();
    expect(e!.status).toBe('available');
    expect(e!.exemptionCitation).toBe('Va. Code § 58.1-811(J)');
    expect(DEED_TYPE_REGISTRY.some((d) => d.key === 'deed_tod')).toBe(true);
  });

  it('the § 58.1-811(J) TOD exemption cite is in the verified KB', () => {
    const j = VA_EXEMPTIONS.find((e) => e.citation === 'Va. Code § 58.1-811(J)');
    expect(j).toBeDefined();
    expect(j!.transferType).toMatch(/Transfer-on-death deeds/);
  });
});
