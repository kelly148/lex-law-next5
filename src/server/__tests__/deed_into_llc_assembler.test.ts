/**
 * deed_into_llc_assembler.test.ts — DEED-DRAFT-AGENT-1 category C3 acceptance bar.
 *
 * NON-CIRCULAR: the GOLDEN inputs + expected deed bodies are READ from the committed, operator-authored fixture
 * pack (docs/deed/DEED_CAT_INTO_LLC_fixture_pack.md) — the assembler must reproduce them byte-for-byte (`toBe`).
 * NEG fixtures must FAIL CLOSED ({ status: 'WITHHELD', flags, no deed }). Synthetic data only (PII-free pack).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  assembleDeedIntoLlc,
  type DeedIntoLlcInput,
} from '../deed/deedIntoLlcAssembler.js';
import { DEED_TYPE_REGISTRY, getDeedType } from '../deed/deedTypeRegistry.js';
import { VA_EXEMPTIONS } from '../deed/deedKbVa.js';

const PACK = readFileSync(
  fileURLToPath(new URL('../../../docs/deed/DEED_CAT_INTO_LLC_fixture_pack.md', import.meta.url)),
  'utf8',
);

interface Section { title: string; input: Record<string, unknown> | null; expectedDeed: string | null }

function parsePack(md: string): Section[] {
  return md.split('\n### ').slice(1).map((seg) => {
    const title = seg.split('\n')[0]!.trim();
    const jsonM = seg.match(/```json\n([\s\S]*?)\n```/);
    const deedM = seg.match(/#### EXPECTED ASSEMBLED DEED[\s\S]*?\n```\n([\s\S]*?)\n```/);
    return {
      title,
      input: jsonM ? (JSON.parse(jsonM[1]!) as Record<string, unknown>) : null,
      expectedDeed: deedM ? deedM[1]! : null,
    };
  });
}

/** Map the fixture's snake_case consolidated-facts JSON onto the assembler input (camelCase). */
function toInput(j: Record<string, any>): DeedIntoLlcInput {
  return {
    preparedBy: j.prepared_by,
    titleSearch: j.title_search,
    taxId: j.tax_id,
    granteeAddressReturn: j.grantee_address_return,
    assessedValue: j.assessed_value,
    consideration: j.consideration,
    instrumentDatePhrase: j.instrument_date_phrase,
    grantors: (j.grantors ?? []).map((g: any) => ({ name: g.name, maritalStatus: g.marital_status })),
    grantorCardinality: j.grantor_cardinality,
    granteeLlc: j.grantee_llc,
    propertyJurisdiction: j.property_jurisdiction,
    legalDescription: j.legal_description,
    derivationOfTitle: j.derivation_of_title,
    subjectTo: j.subject_to,
    notaryJurisdiction: j.notary_jurisdiction,
    ...(j.source_granting_body_override !== undefined ? { sourceGrantingBodyOverride: j.source_granting_body_override } : {}),
    ...(j.override_marked_authoritative !== undefined ? { overrideMarkedAuthoritative: j.override_marked_authoritative } : {}),
    ...(j.granting_verb_override !== undefined ? { grantingVerbOverride: j.granting_verb_override } : {}),
  };
}

const sections = parsePack(PACK);
const golds = sections.filter((s) => s.title.startsWith('GOLDEN'));
const negs = sections.filter((s) => s.title.startsWith('NEG-'));

describe('Into-LLC (C3) — GOLDEN fixtures reproduce the fixture pack exactly', () => {
  it('parsed 3 GOLDEN + 4 NEG fixtures from the pack', () => {
    expect(golds.length).toBe(3);
    expect(negs.length).toBe(4);
  });

  for (const g of golds) {
    it(`${g.title} — full body byte-for-byte`, () => {
      const result = assembleDeedIntoLlc(toInput(g.input as Record<string, any>));
      expect(result.status).toBe('OK');
      expect(result.recordableFloorOk).toBe(true); // S3 in-module B6 + format floor
      expect(result.deed).toBeDefined();
      // A11 — strongest: the entire assembled document equals the fixture's EXPECTED block.
      expect(result.deed!.fullText).toBe(g.expectedDeed);
      // A5 — legal description carried verbatim (casing preserved).
      expect(result.deed!.legalDescription).toBe((g.input as any).legal_description);
      // A9 — derivation line equals the slot input exactly.
      expect(result.deed!.derivationLine).toBe((g.input as any).derivation_of_title);
      // N1–N6 — quitclaim, NO warranty.
      expect(result.deed!.fullText).not.toContain('General Warranty');
      expect(result.deed!.fullText).not.toContain('Special Warranty');
      expect(result.deed!.fullText).not.toContain('English Covenants');
      expect(result.deed!.fullText.toLowerCase()).not.toContain('covenants of title');
      expect(result.deed!.fullText).toContain('quitclaim release and convey');
    });
  }

  it('A1/A2/A7/A8 — fixed recitals (verbatim, single grantor G1)', () => {
    const g1 = golds[0]!;
    const d = assembleDeedIntoLlc(toInput(g1.input as Record<string, any>)).deed!;
    expect(d.exemptionLine).toBe('Exempt from recording tax pursuant to Sec 58.1-811(A)(10), 1950 Code of Virginia');
    expect(d.title).toBe('DEED');
    expect(d.witnesseth).toBe('W I T N E S S E T H');
    expect(d.paginationMarker).toBe('SIGNATURES AND SEALS TO APPEAR ON THE FOLLOWING PAGE');
    expect(d.subjectTo).toBe('This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.');
    // A3 — granting clause core (single, double space before County preserved).
    expect(d.grantingClause).toBe(
      "the GRANTOR does hereby quitclaim release and convey unto the GRANTEE, in fee simple, all of the Grantor's right, title and interest in and to the following described property, together with improvements thereon, situate, lying and being in the  County of Fairfax, Virginia, to-wit:",
    );
  });

  it('A4/A6/A12 — plural normalization (married couple G3)', () => {
    const g3 = golds[2]!;
    const r = assembleDeedIntoLlc(toInput(g3.input as Record<string, any>));
    const d = r.deed!;
    // A4 — plural granting verb, singular firm-standard possessive retained.
    expect(d.grantingClause).toBe(
      "the GRANTORS do hereby quitclaim release and convey unto the GRANTEE, in fee simple, all of the Grantor's right, title and interest in and to the following described property, together with improvements thereon, situate, lying and being in the  County of Fairfax, Virginia, to-wit:",
    );
    // A6 — caption parties line.
    expect(d.captionParties).toBe(
      'Rosalind A. TREMAINE and Desmond P. TREMAINE, a married couple, GRANTORS, and Briar Hollow Family LLC, a Virginia Limited Liability Company, GRANTEE;',
    );
    // A12 — two seal blocks.
    expect(d.sealBlocks).toEqual([
      '__________________________(seal)\nRosalind A. TREMAINE',
      '__________________________(seal)\nDesmond P. TREMAINE',
    ]);
    // The firm-standard singular possessive with two grantors is surfaced as a non-blocking advisory, not rewritten.
    expect(r.advisories.some((a) => /GRANTOR_CARDINALITY_ADVISORY/.test(a))).toBe(true);
  });
});

describe('Into-LLC (C3) — NEG fixtures fail closed', () => {
  const expectedFlag: Record<string, string> = {
    'NEG-1': 'TRUNCATED_LEGAL_DESCRIPTION',
    'NEG-2': 'GRANTOR_CARDINALITY_MISMATCH',
    'NEG-3': 'INVALID_LLC_DESIGNATOR',
    'NEG-4': 'WARRANTY_BLEED_INTO_QUITCLAIM',
  };
  for (const n of negs) {
    const key = n.title.split(' ')[0]!; // "NEG-1"
    it(`${n.title} — WITHHELD + ${expectedFlag[key]}`, () => {
      const r = assembleDeedIntoLlc(toInput(n.input as Record<string, any>));
      expect(r.status).toBe('WITHHELD'); // F1
      expect(r.flags).toContain(expectedFlag[key]); // F2–F5
      expect(r.deed).toBeUndefined(); // F6 — no deed emitted
    });
  }
});

describe('Into-LLC (C3) — hardening guards (adversarial-review fixes)', () => {
  const base = (): DeedIntoLlcInput => toInput(golds[0]!.input as Record<string, any>); // a valid single-grantor input

  it('warranty token in the legal description bleeds -> WITHHELD', () => {
    const r = assembleDeedIntoLlc({ ...base(), legalDescription: 'Lot 1, with General Warranty, recorded in Deed Book 1, at Page 2, among the land records of Fairfax County, Virginia.' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('WARRANTY_BLEED_INTO_QUITCLAIM');
  });

  it('warranty token in subject-to bleeds -> WITHHELD', () => {
    const r = assembleDeedIntoLlc({ ...base(), subjectTo: 'This conveyance is made with Special Warranty subject to easements of record.' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('WARRANTY_BLEED_INTO_QUITCLAIM');
  });

  it('a derivation naming a prior "General Warranty Deed" is NOT a bleed (legitimate prior-instrument reference)', () => {
    const r = assembleDeedIntoLlc({ ...base(), derivationOfTitle: 'For derivation of title, see General Warranty Deed recorded in Deed Book 5, at page 9, among the aforesaid land records.' });
    expect(r.status).toBe('OK');
    expect(r.flags).not.toContain('WARRANTY_BLEED_INTO_QUITCLAIM');
  });

  it('empty grantors fails closed (no throw)', () => {
    const r = assembleDeedIntoLlc({ ...base(), grantors: [] });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('UNSUPPORTED_GRANTOR_CARDINALITY');
    expect(r.deed).toBeUndefined();
  });

  it('three grantors fails closed (ungrounded cardinality, not mislabeled "a married couple")', () => {
    const r = assembleDeedIntoLlc({
      ...base(),
      grantors: [
        { name: 'Ana ALPHA', maritalStatus: 'unmarried' },
        { name: 'Ben BRAVO', maritalStatus: 'unmarried' },
        { name: 'Cara CHARLIE', maritalStatus: 'unmarried' },
      ],
    });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('UNSUPPORTED_GRANTOR_CARDINALITY');
  });

  it('a condo legal cut mid-amendment (ending in a period) is withheld', () => {
    const r = assembleDeedIntoLlc({
      ...base(),
      legalDescription:
        'All of Apartment Unit 612, THE WINDERMERE, A CONDOMINIUM, as described in that certain Declaration recorded in Deed Book 2188 at Page 0451, and by First Amendment to Declaration recorded in Deed Book 2201 at page 0907.',
    });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('TRUNCATED_LEGAL_DESCRIPTION');
  });

  it('NEG-3 Variant B — a non-Virginia (Delaware) LLC fails closed', () => {
    const r = assembleDeedIntoLlc({ ...base(), granteeLlc: 'Marlowe Glen Holdings, a Delaware Limited Liability Company' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('INVALID_LLC_DESIGNATOR');
  });
});

describe('Into-LLC (C3) — registry + verified cite', () => {
  it('registered in the deed-type registry as available', () => {
    const e = getDeedType('deed_into_llc');
    expect(e).toBeDefined();
    expect(e!.status).toBe('available');
    expect(e!.exemptionCitation).toBe('Va. Code § 58.1-811(A)(10)');
    expect(DEED_TYPE_REGISTRY.some((d) => d.key === 'deed_into_llc')).toBe(true);
  });

  it('the (A)(10) into-LLC + corrected (A)(11) out-of-LLC cites are in the verified KB', () => {
    const a10 = VA_EXEMPTIONS.find((e) => e.citation === 'Va. Code § 58.1-811(A)(10)');
    const a11 = VA_EXEMPTIONS.find((e) => e.citation === 'Va. Code § 58.1-811(A)(11)');
    expect(a10).toBeDefined();
    expect(a10!.transferType).toMatch(/^To a partnership or limited liability company, when the grantors/);
    expect(a11).toBeDefined();
    expect(a11!.transferType).toMatch(/^From a partnership or limited liability company, when the grantees/);
  });
});
